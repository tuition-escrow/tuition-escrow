//! Contract tests — unit, property/invariant, and adversarial.
//!
//! README sections covered:
//!   • "Testing strategy" — contract unit tests, property/invariant tests,
//!     security tests.
//!   • "Smart contract specification" — every public function, every error,
//!     every status transition.
//!   • "Voucher lifecycle" — state-machine invariants.
//!
//! ## Soroban SDK 22 client API conventions
//!
//! `#[contractimpl]` generates two method variants per function:
//!   • `client.fund(...)` → returns `T` directly, panics on contract error.
//!   • `client.try_fund(...)` → returns `Result<Result<T, Error>, InvokeError>`.
//!
//! Tests use `client.fund(...)` for happy paths and
//! `client.try_fund(...).unwrap().unwrap_err()` for expected-error paths.
//!
//! ## Expiry boundary semantics (documented here and in README)
//!   confirm  succeeds when ledger_timestamp  < expires_at  (strictly before)
//!   reclaim  succeeds when ledger_timestamp >= expires_at  (at or after)
//!
//! At the exact second where ledger_timestamp == expires_at:
//!   - reclaim SUCCEEDS
//!   - confirm FAILS with AlreadyExpired
//!
//! Deliberate "fail-closed": when in doubt, return money to the funder.
//!
//! ## Note on proptest
//! proptest 1.x requires rand_core 0.10, which conflicts with
//! soroban-env-host's dependency on rand 0.8 / rand_core 0.6.
//! Property tests are therefore written as exhaustive parameterized loops
//! over representative input sets — no external property-test crate is used.

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, Vec,
};

use crate::{Error, Status, VoucherContract, VoucherContractClient};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn student_ref(e: &Env) -> BytesN<32> {
    BytesN::from_array(e, &[0u8; 32])
}

fn unique_student_ref(e: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(e, &[seed; 32])
}

fn base_ledger() -> LedgerInfo {
    LedgerInfo {
        timestamp: 1_000_000,
        protocol_version: 22,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 6_312_000,
    }
}

struct TestEnv {
    env: Env,
    contract: Address,
    client: VoucherContractClient<'static>,
    token: Address,
    admin: Address,
    funder: Address,
    school: Address,
    attester1: Address,
    attester2: Address,
    attester3: Address,
}

impl TestEnv {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set(base_ledger());

        let admin = Address::generate(&env);
        let funder = Address::generate(&env);
        let school = Address::generate(&env);
        let attester1 = Address::generate(&env);
        let attester2 = Address::generate(&env);
        let attester3 = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();
        StellarAssetClient::new(&env, &token).mint(&funder, &10_000_000);

        let contract = env.register_contract(None, VoucherContract);
        let client: VoucherContractClient<'static> =
            unsafe { std::mem::transmute(VoucherContractClient::new(&env, &contract)) };

        let allowed = Vec::from_array(&env, [token.clone()]);
        client.initialize(&admin, &allowed, &100, &1_000_000, &8760);

        let attesters = Vec::from_array(
            &env,
            [attester1.clone(), attester2.clone(), attester3.clone()],
        );
        client.register_school(&school, &attesters, &2);

        TestEnv {
            env,
            contract,
            client,
            token,
            admin,
            funder,
            school,
            attester1,
            attester2,
            attester3,
        }
    }

    fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }

    fn expires_future(&self) -> u64 {
        self.now() + 86_400
    }

    fn fund_default(&self) -> u64 {
        self.client.fund(
            &self.funder,
            &self.school,
            &self.token,
            &1_000,
            &0,
            &student_ref(&self.env),
            &self.expires_future(),
        )
    }

    fn set_timestamp(&self, ts: u64) {
        let info = self.env.ledger().get();
        self.env.ledger().set(LedgerInfo {
            timestamp: ts,
            ..info
        });
    }

    fn token_balance(&self, addr: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(addr)
    }

    /// Expect a contract error from a `try_` call on a function returning a value type.
    ///
    /// In Soroban SDK 22, `try_<fn>` on functions returning `T` (non-unit):
    ///   `Result<Result<T, Error>, Result<Error, InvokeError>>`
    /// Contract-level error: `Err(Ok(error))`.
    fn expect_err_val<T: core::fmt::Debug>(
        result: Result<Result<T, Error>, Result<Error, soroban_sdk::InvokeError>>,
        expected: Error,
    ) {
        match result {
            Err(Ok(e)) => assert_eq!(e, expected, "wrong contract error"),
            Ok(Ok(v)) => panic!("expected Err({expected:?}) but got Ok({v:?})"),
            Ok(Err(e)) => panic!("expected Err({expected:?}) but got inner Error: {e:?}"),
            Err(Err(e)) => panic!("expected Err({expected:?}) but got InvokeError: {e:?}"),
        }
    }

    /// Expect a contract error from a `try_` call on a function returning `()`.
    ///
    /// In Soroban SDK 22, `try_<fn>` on functions returning `()`:
    ///   `Result<Result<(), ConversionError>, Result<Error, InvokeError>>`
    /// Contract-level error: `Err(Ok(error))`.
    fn expect_err_unit(
        result: Result<
            Result<(), soroban_sdk::ConversionError>,
            Result<Error, soroban_sdk::InvokeError>,
        >,
        expected: Error,
    ) {
        match result {
            Err(Ok(e)) => assert_eq!(e, expected, "wrong contract error"),
            Ok(Ok(_)) => panic!("expected Err({expected:?}) but got Ok"),
            Ok(Err(e)) => panic!("expected Err({expected:?}) but got ConversionError: {e:?}"),
            Err(Err(e)) => panic!("expected Err({expected:?}) but got InvokeError: {e:?}"),
        }
    }

    /// Expect a contract error from try_fund.
    ///
    /// try_fund returns:
    ///   Ok(Ok(u64))               — success
    ///   Ok(Err(soroban_sdk::Error)) — host-level error on success path (rare)
    ///   Err(Ok(crate::Error))     — contract-level error (what we test)
    ///   Err(Err(InvokeError))     — invocation failure
    fn expect_err_fund(
        result: Result<Result<u64, soroban_sdk::Error>, Result<Error, soroban_sdk::InvokeError>>,
        expected: Error,
    ) {
        match result {
            Err(Ok(e)) => assert_eq!(e, expected, "wrong contract error"),
            Ok(Ok(v)) => panic!("expected Err({expected:?}) but got Ok({v:?})"),
            Ok(Err(e)) => panic!("expected Err({expected:?}) but got soroban_sdk::Error: {e:?}"),
            Err(Err(e)) => panic!("expected Err({expected:?}) but got InvokeError: {e:?}"),
        }
    }

    /// Expect a contract error from try_get_voucher.
    fn expect_err_get_voucher(
        result: Result<
            Result<crate::Voucher, soroban_sdk::ConversionError>,
            Result<Error, soroban_sdk::InvokeError>,
        >,
        expected: Error,
    ) {
        match result {
            Err(Ok(e)) => assert_eq!(e, expected, "wrong contract error"),
            Ok(Ok(_)) => panic!("expected Err({expected:?}) but got Ok"),
            Ok(Err(e)) => panic!("expected Err({expected:?}) but got ConversionError: {e:?}"),
            Err(Err(e)) => panic!("expected Err({expected:?}) but got InvokeError: {e:?}"),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — happy path
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_fund_creates_voucher() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let v = t.client.get_voucher(&id);
    assert_eq!(v.status, Status::Funded);
    assert_eq!(v.amount, 1_000);
    assert_eq!(v.funder, t.funder);
    assert_eq!(v.school, t.school);
    assert_eq!(v.attestation_count, 0);
}

#[test]
fn test_happy_path_fund_confirm_release() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let school_before = t.token_balance(&t.school);

    t.client.confirm(&id, &t.attester1);
    assert_eq!(t.client.get_voucher(&id).status, Status::Funded);

    t.client.confirm(&id, &t.attester2); // threshold=2
    let v = t.client.get_voucher(&id);
    assert_eq!(v.status, Status::Released);
    assert_eq!(t.token_balance(&t.school), school_before + 1_000);
}

#[test]
fn test_reclaim_after_expiry() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let funder_before = t.token_balance(&t.funder);
    let expires = t.client.get_voucher(&id).expires_at;

    t.set_timestamp(expires);
    t.client.reclaim(&id);

    assert_eq!(t.client.get_voucher(&id).status, Status::Reclaimed);
    assert_eq!(t.token_balance(&t.funder), funder_before + 1_000);
}

#[test]
fn test_cancel_before_expiry() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let funder_before = t.token_balance(&t.funder);

    t.client.cancel(&id);
    assert_eq!(t.client.get_voucher(&id).status, Status::Cancelled);
    assert_eq!(t.token_balance(&t.funder), funder_before + 1_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Expiry boundary semantics
// ─────────────────────────────────────────────────────────────────────────────

/// At exactly expires_at: confirm FAILS (AlreadyExpired), reclaim SUCCEEDS.
#[test]
fn test_expiry_boundary_confirm_fails_reclaim_succeeds() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let expires = t.client.get_voucher(&id).expires_at;
    t.set_timestamp(expires);

    TestEnv::expect_err_unit(
        t.client.try_confirm(&id, &t.attester1),
        Error::AlreadyExpired,
    );
    t.client.reclaim(&id); // must not panic
}

/// One second before expiry: reclaim FAILS (NotExpired), confirm SUCCEEDS.
#[test]
fn test_one_second_before_expiry() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let expires = t.client.get_voucher(&id).expires_at;
    t.set_timestamp(expires - 1);

    TestEnv::expect_err_unit(t.client.try_reclaim(&id), Error::NotExpired);
    t.client.confirm(&id, &t.attester1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant: funds conservation
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_funds_conservation_across_lifecycle() {
    let t = TestEnv::setup();

    let id1 = t.fund_default();
    let id2 = t.client.fund(
        &t.funder,
        &t.school,
        &t.token,
        &2_000,
        &1,
        &unique_student_ref(&t.env, 1),
        &t.expires_future(),
    );
    let id3 = t.client.fund(
        &t.funder,
        &t.school,
        &t.token,
        &3_000,
        &2,
        &unique_student_ref(&t.env, 2),
        &t.expires_future(),
    );

    assert_eq!(t.token_balance(&t.contract), 6_000);

    t.client.confirm(&id1, &t.attester1);
    t.client.confirm(&id1, &t.attester2);
    assert_eq!(t.token_balance(&t.contract), 5_000);

    t.client.cancel(&id2);
    assert_eq!(t.token_balance(&t.contract), 3_000);

    let expires3 = t.client.get_voucher(&id3).expires_at;
    t.set_timestamp(expires3);
    t.client.reclaim(&id3);
    assert_eq!(t.token_balance(&t.contract), 0);
}

/// P1: exhaustive funds-conservation over several amounts.
#[test]
fn prop_funds_conservation_exhaustive() {
    let amounts: &[i128] = &[100, 500, 1_000, 5_000, 1_000_000];
    for (i, &amt) in amounts.iter().enumerate() {
        let t = TestEnv::setup();
        let sref = unique_student_ref(&t.env, i as u8);
        let id = t.client.fund(
            &t.funder,
            &t.school,
            &t.token,
            &amt,
            &0,
            &sref,
            &t.expires_future(),
        );

        assert_eq!(t.token_balance(&t.contract), amt);
        t.client.confirm(&id, &t.attester1);
        t.client.confirm(&id, &t.attester2);
        assert_eq!(
            t.token_balance(&t.contract),
            0,
            "amt={amt}: contract must be 0 after release"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant: at most one terminal transition per voucher — P2
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_double_release_impossible() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    t.client.confirm(&id, &t.attester1);
    t.client.confirm(&id, &t.attester2);
    TestEnv::expect_err_unit(
        t.client.try_confirm(&id, &t.attester3),
        Error::InvalidStatus,
    );
}

#[test]
fn test_double_reclaim_impossible() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let expires = t.client.get_voucher(&id).expires_at;
    t.set_timestamp(expires);
    t.client.reclaim(&id);
    TestEnv::expect_err_unit(t.client.try_reclaim(&id), Error::InvalidStatus);
}

#[test]
fn test_double_cancel_impossible() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    t.client.cancel(&id);
    TestEnv::expect_err_unit(t.client.try_cancel(&id), Error::InvalidStatus);
}

/// P2 exhaustive: all terminal transitions are truly one-shot.
#[test]
fn prop_at_most_one_terminal_transition() {
    // Release then others fail
    {
        let t = TestEnv::setup();
        let id = t.fund_default();
        t.client.confirm(&id, &t.attester1);
        t.client.confirm(&id, &t.attester2);
        TestEnv::expect_err_unit(
            t.client.try_confirm(&id, &t.attester3),
            Error::InvalidStatus,
        );
        TestEnv::expect_err_unit(t.client.try_reclaim(&id), Error::InvalidStatus);
    }
    // Reclaim then others fail
    {
        let t = TestEnv::setup();
        let id = t.fund_default();
        let expires = t.client.get_voucher(&id).expires_at;
        t.set_timestamp(expires);
        t.client.reclaim(&id);
        TestEnv::expect_err_unit(t.client.try_reclaim(&id), Error::InvalidStatus);
        TestEnv::expect_err_unit(
            t.client.try_confirm(&id, &t.attester1),
            Error::InvalidStatus,
        );
    }
    // Cancel then others fail
    {
        let t = TestEnv::setup();
        let id = t.fund_default();
        t.client.cancel(&id);
        TestEnv::expect_err_unit(t.client.try_cancel(&id), Error::InvalidStatus);
        TestEnv::expect_err_unit(
            t.client.try_confirm(&id, &t.attester1),
            Error::InvalidStatus,
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant: only the right party receives funds — P3
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn prop_only_school_receives_release() {
    let amounts: &[i128] = &[100, 1_000, 1_000_000];
    for (i, &amt) in amounts.iter().enumerate() {
        let t = TestEnv::setup();
        let other = Address::generate(&t.env);
        let other_before = t.token_balance(&other);
        let school_before = t.token_balance(&t.school);

        let sref = unique_student_ref(&t.env, i as u8);
        let id = t.client.fund(
            &t.funder,
            &t.school,
            &t.token,
            &amt,
            &0,
            &sref,
            &t.expires_future(),
        );
        t.client.confirm(&id, &t.attester1);
        t.client.confirm(&id, &t.attester2);

        assert_eq!(t.token_balance(&t.school), school_before + amt);
        assert_eq!(
            t.token_balance(&other),
            other_before,
            "unrelated address must not change"
        );
    }
}

#[test]
fn prop_only_funder_receives_refund() {
    // Reclaim
    {
        let t = TestEnv::setup();
        let school_before = t.token_balance(&t.school);
        let id = t.fund_default();
        let expires = t.client.get_voucher(&id).expires_at;
        t.set_timestamp(expires);
        t.client.reclaim(&id);
        assert_eq!(t.token_balance(&t.school), school_before);
    }
    // Cancel
    {
        let t = TestEnv::setup();
        let school_before = t.token_balance(&t.school);
        let id = t.fund_default();
        t.client.cancel(&id);
        assert_eq!(t.token_balance(&t.school), school_before);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant: reclaim boundary — P4
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn prop_reclaim_boundary_exhaustive() {
    let before_deltas: &[u64] = &[1, 60, 3600, 86_399];
    for &delta in before_deltas {
        let t = TestEnv::setup();
        let id = t.fund_default();
        let expires = t.client.get_voucher(&id).expires_at;

        t.set_timestamp(expires - delta);
        TestEnv::expect_err_unit(t.client.try_reclaim(&id), Error::NotExpired);

        t.set_timestamp(expires);
        t.client.reclaim(&id);
        TestEnv::expect_err_unit(t.client.try_reclaim(&id), Error::InvalidStatus);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant: confirm after expiry / terminal status — P5
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn prop_confirm_after_terminal_always_fails() {
    // After expiry
    {
        let t = TestEnv::setup();
        let id = t.fund_default();
        let expires = t.client.get_voucher(&id).expires_at;
        t.set_timestamp(expires);
        TestEnv::expect_err_unit(
            t.client.try_confirm(&id, &t.attester1),
            Error::AlreadyExpired,
        );
    }
    // After release
    {
        let t = TestEnv::setup();
        let id = t.fund_default();
        t.client.confirm(&id, &t.attester1);
        t.client.confirm(&id, &t.attester2);
        TestEnv::expect_err_unit(
            t.client.try_confirm(&id, &t.attester3),
            Error::InvalidStatus,
        );
    }
    // After reclaim
    {
        let t = TestEnv::setup();
        let id = t.fund_default();
        let expires = t.client.get_voucher(&id).expires_at;
        t.set_timestamp(expires);
        t.client.reclaim(&id);
        TestEnv::expect_err_unit(
            t.client.try_confirm(&id, &t.attester1),
            Error::InvalidStatus,
        );
    }
    // After cancel
    {
        let t = TestEnv::setup();
        let id = t.fund_default();
        t.client.cancel(&id);
        TestEnv::expect_err_unit(
            t.client.try_confirm(&id, &t.attester1),
            Error::InvalidStatus,
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant: duplicate attestations — P6
// ─────────────────────────────────────────────────────────────────────────────

/// Regression: same attester confirming twice must error; count stays 1.
#[test]
fn test_duplicate_attestation_rejected() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    t.client.confirm(&id, &t.attester1);
    TestEnv::expect_err_unit(
        t.client.try_confirm(&id, &t.attester1),
        Error::DuplicateAttestation,
    );

    let v = t.client.get_voucher(&id);
    assert_eq!(v.attestation_count, 1);
    assert_eq!(v.status, Status::Funded);
}

/// P6 exhaustive: every attester tried twice never double-counts.
#[test]
fn prop_no_duplicate_attestation_counts() {
    for (first_idx, second_idx) in [(0usize, 0), (1, 1), (2, 2)] {
        let t = TestEnv::setup();
        let id = t.fund_default();
        let attesters = [
            t.attester1.clone(),
            t.attester2.clone(),
            t.attester3.clone(),
        ];

        t.client.confirm(&id, &attesters[first_idx]);
        TestEnv::expect_err_unit(
            t.client.try_confirm(&id, &attesters[second_idx]),
            Error::DuplicateAttestation,
        );

        let v = t.client.get_voucher(&id);
        assert_eq!(v.attestation_count, 1);
        assert_eq!(v.status, Status::Funded);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Amount validation — P7
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_zero_amount_rejected() {
    let t = TestEnv::setup();
    TestEnv::expect_err_fund(
        t.client.try_fund(
            &t.funder,
            &t.school,
            &t.token,
            &0,
            &0,
            &student_ref(&t.env),
            &t.expires_future(),
        ),
        Error::InvalidAmount,
    );
}

#[test]
fn test_negative_amount_rejected() {
    let t = TestEnv::setup();
    TestEnv::expect_err_fund(
        t.client.try_fund(
            &t.funder,
            &t.school,
            &t.token,
            &-1,
            &0,
            &student_ref(&t.env),
            &t.expires_future(),
        ),
        Error::InvalidAmount,
    );
}

#[test]
fn test_i128_min_rejected() {
    let t = TestEnv::setup();
    TestEnv::expect_err_fund(
        t.client.try_fund(
            &t.funder,
            &t.school,
            &t.token,
            &i128::MIN,
            &0,
            &student_ref(&t.env),
            &t.expires_future(),
        ),
        Error::InvalidAmount,
    );
}

/// P7 exhaustive: a range of invalid amounts are all rejected.
#[test]
fn prop_invalid_amounts_rejected() {
    let invalid: &[i128] = &[
        i128::MIN,
        -1_000_000,
        -1,
        0,
        99,        // below min=100
        1_000_001, // above max
    ];
    for &amt in invalid {
        let t = TestEnv::setup();
        TestEnv::expect_err_fund(
            t.client.try_fund(
                &t.funder,
                &t.school,
                &t.token,
                &amt,
                &0,
                &student_ref(&t.env),
                &t.expires_future(),
            ),
            Error::InvalidAmount,
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial — unauthorized callers
// ─────────────────────────────────────────────────────────────────────────────

/// Attester from a different school cannot confirm a voucher.
#[test]
fn test_attester_from_different_school_rejected() {
    let t = TestEnv::setup();
    let id = t.fund_default();

    let school2 = Address::generate(&t.env);
    let foreign = Address::generate(&t.env);
    t.client
        .register_school(&school2, &Vec::from_array(&t.env, [foreign.clone()]), &1);

    TestEnv::expect_err_unit(t.client.try_confirm(&id, &foreign), Error::NotAuthorized);
}

/// Completely unknown attester cannot confirm.
#[test]
fn test_unknown_attester_rejected() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let unknown = Address::generate(&t.env);
    TestEnv::expect_err_unit(t.client.try_confirm(&id, &unknown), Error::NotAuthorized);
}

/// Nonexistent voucher returns VoucherNotFound on all functions.
#[test]
fn test_nonexistent_voucher_errors() {
    let t = TestEnv::setup();
    let bad: u64 = 99_999;
    TestEnv::expect_err_get_voucher(t.client.try_get_voucher(&bad), Error::VoucherNotFound);
    TestEnv::expect_err_unit(
        t.client.try_confirm(&bad, &t.attester1),
        Error::VoucherNotFound,
    );
    TestEnv::expect_err_unit(t.client.try_reclaim(&bad), Error::VoucherNotFound);
    TestEnv::expect_err_unit(t.client.try_cancel(&bad), Error::VoucherNotFound);
    TestEnv::expect_err_unit(t.client.try_extend_ttl(&bad), Error::VoucherNotFound);
}

/// Fund with unregistered school fails.
#[test]
fn test_fund_unregistered_school() {
    let t = TestEnv::setup();
    let unknown = Address::generate(&t.env);
    TestEnv::expect_err_fund(
        t.client.try_fund(
            &t.funder,
            &unknown,
            &t.token,
            &1_000,
            &0,
            &student_ref(&t.env),
            &t.expires_future(),
        ),
        Error::SchoolNotRegistered,
    );
}

/// Fund with disallowed token fails.
#[test]
fn test_fund_disallowed_token() {
    let t = TestEnv::setup();
    let other_admin = Address::generate(&t.env);
    let bad_token = t
        .env
        .register_stellar_asset_contract_v2(other_admin)
        .address();
    TestEnv::expect_err_fund(
        t.client.try_fund(
            &t.funder,
            &t.school,
            &bad_token,
            &1_000,
            &0,
            &student_ref(&t.env),
            &t.expires_future(),
        ),
        Error::TokenNotAllowed,
    );
}

/// Fund with past expiry fails.
#[test]
fn test_fund_expired_at_rejected() {
    let t = TestEnv::setup();
    TestEnv::expect_err_fund(
        t.client.try_fund(
            &t.funder,
            &t.school,
            &t.token,
            &1_000,
            &0,
            &student_ref(&t.env),
            &(t.now() - 1),
        ),
        Error::AlreadyExpired,
    );
}

/// Fund with expiry == now fails (must be strictly future).
#[test]
fn test_fund_expiry_now_rejected() {
    let t = TestEnv::setup();
    TestEnv::expect_err_fund(
        t.client.try_fund(
            &t.funder,
            &t.school,
            &t.token,
            &1_000,
            &0,
            &student_ref(&t.env),
            &t.now(),
        ),
        Error::AlreadyExpired,
    );
}

/// Fund with expiry beyond max_expiry_hours fails.
#[test]
fn test_fund_expiry_too_far_rejected() {
    let t = TestEnv::setup();
    let far = t.now() + 2 * 365 * 24 * 3600;
    TestEnv::expect_err_fund(
        t.client.try_fund(
            &t.funder,
            &t.school,
            &t.token,
            &1_000,
            &0,
            &student_ref(&t.env),
            &far,
        ),
        Error::InvalidAmount,
    );
}

/// Invalid category code (> 4) is rejected.
#[test]
fn test_invalid_category_rejected() {
    let t = TestEnv::setup();
    TestEnv::expect_err_fund(
        t.client.try_fund(
            &t.funder,
            &t.school,
            &t.token,
            &1_000,
            &5,
            &student_ref(&t.env),
            &t.expires_future(),
        ),
        Error::InvalidAmount,
    );
}

/// All five valid category codes are accepted.
#[test]
fn test_all_valid_categories_accepted() {
    for cat in 0u32..=4 {
        let t = TestEnv::setup();
        let sref = unique_student_ref(&t.env, cat as u8);
        let id = t.client.fund(
            &t.funder,
            &t.school,
            &t.token,
            &1_000,
            &cat,
            &sref,
            &t.expires_future(),
        );
        assert_eq!(t.client.get_voucher(&id).category, cat);
    }
}

/// Double initialization fails.
#[test]
fn test_double_initialize_rejected() {
    let t = TestEnv::setup();
    let allowed = Vec::from_array(&t.env, [t.token.clone()]);
    TestEnv::expect_err_unit(
        t.client
            .try_initialize(&t.admin, &allowed, &100, &1_000_000, &8760),
        Error::InvalidStatus,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial — call ordering / re-entrancy-style races
// ─────────────────────────────────────────────────────────────────────────────

/// reclaim then confirm: after reclaim the voucher is terminal.
#[test]
fn test_reclaim_then_confirm_fails() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let expires = t.client.get_voucher(&id).expires_at;
    t.set_timestamp(expires);
    t.client.reclaim(&id);
    TestEnv::expect_err_unit(
        t.client.try_confirm(&id, &t.attester1),
        Error::InvalidStatus,
    );
}

/// Partial confirm (below threshold) → expire → reclaim succeeds.
#[test]
fn test_partial_confirm_then_expire_reclaim() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    t.client.confirm(&id, &t.attester1); // one attestation, threshold=2
    assert_eq!(t.client.get_voucher(&id).status, Status::Funded);

    let expires = t.client.get_voucher(&id).expires_at;
    t.set_timestamp(expires);
    t.client.reclaim(&id);
    assert_eq!(t.client.get_voucher(&id).status, Status::Reclaimed);
}

/// Partial confirm → cancel → further confirm fails.
#[test]
fn test_partial_confirm_then_cancel_then_confirm_fails() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    t.client.confirm(&id, &t.attester1);
    t.client.cancel(&id);
    TestEnv::expect_err_unit(
        t.client.try_confirm(&id, &t.attester2),
        Error::InvalidStatus,
    );
}

/// reclaim wins at expiry, cancel fails.
#[test]
fn test_reclaim_wins_over_cancel_at_expiry() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let expires = t.client.get_voucher(&id).expires_at;
    t.set_timestamp(expires);
    t.client.reclaim(&id);
    TestEnv::expect_err_unit(t.client.try_cancel(&id), Error::InvalidStatus);
}

/// cancel then reclaim fails (cancelled is terminal).
#[test]
fn test_cancel_then_reclaim_fails() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    t.client.cancel(&id);
    let expires = t.client.get_voucher(&id).expires_at;
    t.set_timestamp(expires);
    TestEnv::expect_err_unit(t.client.try_reclaim(&id), Error::InvalidStatus);
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage TTL / archived-and-restored simulation — P8
// ─────────────────────────────────────────────────────────────────────────────

/// extend_ttl preserves all voucher fields unchanged.
#[test]
fn test_extend_ttl_preserves_state() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    let before = t.client.get_voucher(&id);

    t.client.extend_ttl(&id);

    let after = t.client.get_voucher(&id);
    assert_eq!(before.status, after.status);
    assert_eq!(before.amount, after.amount);
    assert_eq!(before.funder, after.funder);
    assert_eq!(before.school, after.school);
    assert_eq!(before.attestation_count, after.attestation_count);
    assert_eq!(before.threshold, after.threshold);
    assert_eq!(before.expires_at, after.expires_at);
}

/// Full release lifecycle works after repeated TTL extensions.
#[test]
fn test_full_release_lifecycle_after_ttl_extension() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    t.client.extend_ttl(&id);
    t.client.confirm(&id, &t.attester1);
    t.client.extend_ttl(&id);
    t.client.confirm(&id, &t.attester2);
    assert_eq!(t.client.get_voucher(&id).status, Status::Released);
}

/// Reclaim lifecycle works after TTL extension.
#[test]
fn test_reclaim_lifecycle_after_ttl_extension() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    t.client.extend_ttl(&id);
    let expires = t.client.get_voucher(&id).expires_at;
    t.set_timestamp(expires);
    t.client.reclaim(&id);
    assert_eq!(t.client.get_voucher(&id).status, Status::Reclaimed);
}

/// Duplicate attestation prevention survives TTL extension.
#[test]
fn test_duplicate_attestation_after_ttl_extension() {
    let t = TestEnv::setup();
    let id = t.fund_default();
    t.client.confirm(&id, &t.attester1);
    t.client.extend_ttl(&id);
    TestEnv::expect_err_unit(
        t.client.try_confirm(&id, &t.attester1),
        Error::DuplicateAttestation,
    );
}

/// P8 exhaustive: archived-and-restored (extend_ttl mid-lifecycle) behaves identically.
#[test]
fn prop_archived_restored_behavior_identical() {
    // (extend_ttl calls before 1st confirm, before 2nd confirm)
    let stages: &[(u32, u32)] = &[(0, 0), (1, 0), (0, 1), (1, 1), (3, 3)];
    for &(pre1, pre2) in stages {
        let t = TestEnv::setup();
        let id = t.fund_default();

        for _ in 0..pre1 {
            t.client.extend_ttl(&id);
        }
        t.client.confirm(&id, &t.attester1);
        assert_eq!(t.client.get_voucher(&id).attestation_count, 1);

        for _ in 0..pre2 {
            t.client.extend_ttl(&id);
        }
        t.client.confirm(&id, &t.attester2);
        assert_eq!(
            t.client.get_voucher(&id).status,
            Status::Released,
            "stage ({pre1}, {pre2}): should be Released"
        );
    }
}
