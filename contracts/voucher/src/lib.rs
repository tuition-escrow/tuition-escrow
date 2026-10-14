#![no_std]
mod errors;
mod event;
mod storage;
mod types;

use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, BytesN, Env, Vec,
};

pub use errors::Error;
pub use types::{Config, School, Status, Voucher};

#[contract]
pub struct VoucherContract;

#[contractimpl]
impl VoucherContract {
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

    pub fn register_school(
        e: Env,
        school: Address,
        attesters: Vec<Address>,
        threshold: u32,
    ) -> Result<(), Error> {
        let config = storage::get_config(&e).ok_or(Error::NotAuthorized)?;
        config.admin.require_auth();

        if threshold < 1 || (threshold as u32) > attesters.len() as u32 {
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

        let token_allowed = config.allowed_tokens.iter().any(|t| t == token);
        if !token_allowed {
            return Err(Error::TokenNotAllowed);
        }

        if amount < config.min_amount || amount > config.max_amount {
            return Err(Error::InvalidAmount);
        }

        if category > 4 {
            return Err(Error::InvalidAmount);
        }

        let now = e.ledger().timestamp();
        if expires_at <= now {
            return Err(Error::AlreadyExpired);
        }

        let max_expiry = now + config.max_expiry_hours * 3600;
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
            created_at: now,
        };

        storage::set_voucher(&e, id, &voucher);

        e.events().publish(
            (symbol_short!("funded"),),
            (id, funder, school, token, amount, category, expires_at),
        );

        Ok(id)
    }

    pub fn confirm(e: Env, voucher_id: u64, attester: Address) -> Result<(), Error> {
        attester.require_auth();

        let mut voucher = storage::get_voucher(&e, voucher_id).ok_or(Error::VoucherNotFound)?;

        let now = e.ledger().timestamp();
        if voucher.expires_at <= now {
            return Err(Error::AlreadyExpired);
        }

        if voucher.status != Status::Funded {
            return Err(Error::InvalidStatus);
        }

        let is_attester = voucher.attesters.iter().any(|a| a == attester);
        if !is_attester {
            return Err(Error::NotAuthorized);
        }

        voucher.attestation_count += 1;

        e.events().publish(
            (symbol_short!("attested"),),
            (voucher_id, attester.clone(), voucher.attestation_count),
        );

        if voucher.attestation_count >= voucher.threshold {
            let token_client = token::Client::new(&e, &voucher.token);
            token_client.transfer(&e.current_contract_address(), &voucher.school, &voucher.amount);
            voucher.status = Status::Released;
            e.events().publish(
                (symbol_short!("released"),),
                (voucher_id,),
            );
        }

        storage::set_voucher(&e, voucher_id, &voucher);
        Ok(())
    }

    pub fn reclaim(e: Env, voucher_id: u64) -> Result<(), Error> {
        let mut voucher = storage::get_voucher(&e, voucher_id).ok_or(Error::VoucherNotFound)?;

        voucher.funder.require_auth();

        let now = e.ledger().timestamp();
        if voucher.expires_at > now {
            return Err(Error::NotExpired);
        }

        if voucher.status != Status::Funded {
            return Err(Error::InvalidStatus);
        }

        let token_client = token::Client::new(&e, &voucher.token);
        token_client.transfer(&e.current_contract_address(), &voucher.funder, &voucher.amount);
        voucher.status = Status::Reclaimed;
        e.events().publish(
            (symbol_short!("reclaimed"),),
            (voucher_id,),
        );

        storage::set_voucher(&e, voucher_id, &voucher);
        Ok(())
    }

    pub fn cancel(e: Env, voucher_id: u64) -> Result<(), Error> {
        let mut voucher = storage::get_voucher(&e, voucher_id).ok_or(Error::VoucherNotFound)?;

        voucher.funder.require_auth();
        voucher.school.require_auth();

        let now = e.ledger().timestamp();
        if voucher.expires_at <= now {
            return Err(Error::AlreadyExpired);
        }

        if voucher.status != Status::Funded {
            return Err(Error::InvalidStatus);
        }

        let token_client = token::Client::new(&e, &voucher.token);
        token_client.transfer(&e.current_contract_address(), &voucher.funder, &voucher.amount);
        voucher.status = Status::Cancelled;
        e.events().publish(
            (symbol_short!("cancelled"),),
            (voucher_id,),
        );

        storage::set_voucher(&e, voucher_id, &voucher);
        Ok(())
    }

    pub fn get_voucher(e: Env, id: u64) -> Result<Voucher, Error> {
        storage::get_voucher(&e, id).ok_or(Error::VoucherNotFound)
    }

    pub fn extend_ttl(e: Env, id: u64) -> Result<(), Error> {
        let voucher = storage::get_voucher(&e, id).ok_or(Error::VoucherNotFound)?;
        storage::set_voucher(&e, id, &voucher);
        Ok(())
    }
}
