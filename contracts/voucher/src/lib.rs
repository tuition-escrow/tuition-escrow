#![no_std]
mod errors;
mod event;
mod storage;
#[cfg(test)]
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env, Vec};

pub use errors::Error;
pub use types::{Config, School, Status, Voucher};

#[contract]
pub struct VoucherContract;

#[contractimpl]
impl VoucherContract {
    /// One-time initialisation.  Calling again returns `InvalidStatus`.
    pub fn initialize(
        e: Env,
        admin: Address,
        allowed_tokens: Vec<Address>,
        min_amount: i128,
        max_amount: i128,
        max_expiry_hours: u64,
    ) -> Result<(), Error> {
        if storage::get_config(&e).is_some() {
            return Err(Error::InvalidStatus);
        }
        admin.require_auth();

        if min_amount <= 0 || max_amount <= 0 || min_amount > max_amount {
            return Err(Error::InvalidAmount);
        }
        if max_expiry_hours == 0 {
            return Err(Error::InvalidAmount);
        }

        let config = Config {
            admin,
            allowed_tokens,
            min_amount,
            max_amount,
            max_expiry_hours,
        };
        storage::set_config(&e, &config);
        Ok(())
    }

    /// Admin-only: whitelist a school and set its default attester set + threshold.
    pub fn register_school(
        e: Env,
        school: Address,
        attesters: Vec<Address>,
        threshold: u32,
    ) -> Result<(), Error> {
        let config = storage::get_config(&e).ok_or(Error::NotAuthorized)?;
        config.admin.require_auth();

        if threshold < 1 || threshold > attesters.len() {
            return Err(Error::InvalidAmount);
        }

        let school_data = School {
            attesters,
            threshold,
            active: true,
        };
        storage::set_school(&e, &school, &school_data);
        Ok(())
    }

    /// Funder deposits tokens and creates a voucher.
    ///
    /// Expiry boundary: `expires_at` is the **exclusive** lower bound for
    /// `reclaim` and the **exclusive** upper bound for `confirm`.  That is:
    ///   - `confirm` succeeds when `ledger_timestamp < expires_at`
    ///   - `reclaim` succeeds when `ledger_timestamp >= expires_at`
    /// This prevents both operations from succeeding at the exact same second
    /// and is documented in README § Smart contract specification.
    #[allow(clippy::too_many_arguments)]
    pub fn fund(
        e: Env,
        funder: Address,
        school: Address,
        token: Address,
        amount: i128,
        category: u32,
        student_ref: BytesN<32>,
        expires_at: u64,
    ) -> Result<u64, Error> {
        funder.require_auth();

        let config = storage::get_config(&e).ok_or(Error::NotAuthorized)?;
        let school_data = storage::get_school(&e, &school).ok_or(Error::SchoolNotRegistered)?;

        if !school_data.active {
            return Err(Error::SchoolNotRegistered);
        }

        // Token allowlist
        let token_allowed = config.allowed_tokens.iter().any(|t| t == token);
        if !token_allowed {
            return Err(Error::TokenNotAllowed);
        }

        // Amount bounds (also rejects zero and negative via min_amount > 0 invariant)
        if amount < config.min_amount || amount > config.max_amount {
            return Err(Error::InvalidAmount);
        }

        // Category range
        if category > 4 {
            return Err(Error::InvalidAmount);
        }

        let now = e.ledger().timestamp();
        if expires_at <= now {
            return Err(Error::AlreadyExpired);
        }

        let max_expiry = now
            .checked_add(
                config
                    .max_expiry_hours
                    .checked_mul(3600)
                    .ok_or(Error::InvalidAmount)?,
            )
            .ok_or(Error::InvalidAmount)?;
        if expires_at > max_expiry {
            return Err(Error::InvalidAmount);
        }

        let token_client = token::Client::new(&e, &token);
        token_client.transfer(&funder, &e.current_contract_address(), &amount);

        let id = storage::increment_voucher_counter(&e);
        let voucher = Voucher {
            funder: funder.clone(),
            school: school.clone(),
            token: token.clone(),
            amount,
            category,
            student_ref,
            expires_at,
            status: Status::Funded,
            attesters: school_data.attesters.clone(),
            threshold: school_data.threshold,
            attestation_count: 0,
            confirmed_by: Vec::new(&e),
            created_at: now,
        };

        storage::set_voucher(&e, id, &voucher);

        e.events().publish(
            (symbol_short!("funded"),),
            (id, funder, school, token, amount, category, expires_at),
        );

        Ok(id)
    }

    /// Authorised attester records one attestation.
    /// When the threshold is reached the funds transfer to the school.
    ///
    /// Boundary: `confirm` requires `ledger_timestamp < expires_at` (strictly before).
    pub fn confirm(e: Env, voucher_id: u64, attester: Address) -> Result<(), Error> {
        attester.require_auth();

        let mut voucher = storage::get_voucher(&e, voucher_id).ok_or(Error::VoucherNotFound)?;

        if voucher.status != Status::Funded {
            return Err(Error::InvalidStatus);
        }

        let now = e.ledger().timestamp();
        if now >= voucher.expires_at {
            return Err(Error::AlreadyExpired);
        }

        // Must be in the school's attester set
        let is_attester = voucher.attesters.iter().any(|a| a == attester);
        if !is_attester {
            return Err(Error::NotAuthorized);
        }

        // Prevent duplicate attestations by the same address
        let already_confirmed = voucher.confirmed_by.iter().any(|a| a == attester);
        if already_confirmed {
            return Err(Error::DuplicateAttestation);
        }

        voucher.confirmed_by.push_back(attester.clone());
        voucher.attestation_count += 1;

        e.events().publish(
            (symbol_short!("attested"),),
            (voucher_id, attester.clone(), voucher.attestation_count),
        );

        if voucher.attestation_count >= voucher.threshold {
            let token_client = token::Client::new(&e, &voucher.token);
            token_client.transfer(
                &e.current_contract_address(),
                &voucher.school,
                &voucher.amount,
            );
            voucher.status = Status::Released;
            e.events().publish(
                (symbol_short!("released"),),
                (voucher_id, voucher.school.clone(), voucher.amount),
            );
        }

        storage::set_voucher(&e, voucher_id, &voucher);
        Ok(())
    }

    /// Funder reclaims funds after expiry.
    ///
    /// Boundary: `reclaim` requires `ledger_timestamp >= expires_at`.
    pub fn reclaim(e: Env, voucher_id: u64) -> Result<(), Error> {
        let mut voucher = storage::get_voucher(&e, voucher_id).ok_or(Error::VoucherNotFound)?;

        voucher.funder.require_auth();

        if voucher.status != Status::Funded {
            return Err(Error::InvalidStatus);
        }

        let now = e.ledger().timestamp();
        if now < voucher.expires_at {
            return Err(Error::NotExpired);
        }

        let token_client = token::Client::new(&e, &voucher.token);
        token_client.transfer(
            &e.current_contract_address(),
            &voucher.funder,
            &voucher.amount,
        );
        voucher.status = Status::Reclaimed;
        e.events().publish(
            (symbol_short!("reclaimed"),),
            (voucher_id, voucher.funder.clone(), voucher.amount),
        );

        storage::set_voucher(&e, voucher_id, &voucher);
        Ok(())
    }

    /// Funder and school jointly cancel before expiry; funds return to funder.
    pub fn cancel(e: Env, voucher_id: u64) -> Result<(), Error> {
        let mut voucher = storage::get_voucher(&e, voucher_id).ok_or(Error::VoucherNotFound)?;

        voucher.funder.require_auth();
        voucher.school.require_auth();

        if voucher.status != Status::Funded {
            return Err(Error::InvalidStatus);
        }

        let now = e.ledger().timestamp();
        if now >= voucher.expires_at {
            return Err(Error::AlreadyExpired);
        }

        let token_client = token::Client::new(&e, &voucher.token);
        token_client.transfer(
            &e.current_contract_address(),
            &voucher.funder,
            &voucher.amount,
        );
        voucher.status = Status::Cancelled;
        e.events()
            .publish((symbol_short!("cancelled"),), (voucher_id,));

        storage::set_voucher(&e, voucher_id, &voucher);
        Ok(())
    }

    /// Read a voucher (anyone).
    pub fn get_voucher(e: Env, id: u64) -> Result<Voucher, Error> {
        storage::get_voucher(&e, id).ok_or(Error::VoucherNotFound)
    }

    /// Extend the persistent-storage TTL for a long-running voucher (anyone).
    pub fn extend_ttl(e: Env, id: u64) -> Result<(), Error> {
        let voucher = storage::get_voucher(&e, id).ok_or(Error::VoucherNotFound)?;
        storage::set_voucher(&e, id, &voucher);
        Ok(())
    }
}
