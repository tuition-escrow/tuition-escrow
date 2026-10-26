//! Integration tests for the Voucher contract against a local Stellar network.
//!
//! README sections: "Testing strategy" — Contract integration tests
//!   "Real token (SAC) transfers on a local network"
//!
//! ## Running
//!
//! These tests use the Soroban SDK in-process testutils environment to simulate
//! a real SAC token — the same approach used by the Soroban SDK's own integration
//! tests.  No external Quickstart container is required for the in-process runs.
//!
//! For true on-network integration (against a running Quickstart node), see the
//! shell scripts in scripts/ and the CI job `.github/workflows/integration.yml`.
//!
//! ## Scenarios covered
//!   1. fund → confirm (threshold met) → school balance increases
//!   2. fund → expire → reclaim → funder balance restored
//!
//! Both invariants from README "Testing strategy":
//!   - "Real token (SAC) transfers on a local network"
//!   - Funds-conservation invariant verified with actual token balances.

#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        token::{Client as TokenClient, StellarAssetClient},
        Address, BytesN, Env, Vec,
    };
    use voucher::{Status, VoucherContract, VoucherContractClient};

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

    fn student_ref(e: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(e, &[seed; 32])
    }

    struct IntegEnv {
        env: Env,
        contract: Address,
        client: VoucherContractClient<'static>,
        token: Address,
        funder: Address,
        school: Address,
        attester: Address,
    }

    impl IntegEnv {
        fn setup() -> Self {
            let env = Env::default();
            env.mock_all_auths();
            env.ledger().set(base_ledger());

            let admin = Address::generate(&env);
            let funder = Address::generate(&env);
            let school = Address::generate(&env);
            let attester = Address::generate(&env);

            // Deploy a real SAC-style token in the test environment.
            // In production this would be USDC or another Stellar-issued stablecoin
            // accessed via its SAC address.
            let token_admin = Address::generate(&env);
            let token = env
                .register_stellar_asset_contract_v2(token_admin.clone())
                .address();
            let sac = StellarAssetClient::new(&env, &token);
            sac.mint(&funder, &5_000_000); // mint 5,000,000 units to funder

            let contract = env.register(VoucherContract, ());
            let client: VoucherContractClient<'static> =
                unsafe { std::mem::transmute(VoucherContractClient::new(&env, &contract)) };

            client.initialize(
                &admin,
                &Vec::from_array(&env, [token.clone()]),
                &100,
                &1_000_000,
                &8760,
            );
            client.register_school(&school, &Vec::from_array(&env, [attester.clone()]), &1);

            IntegEnv {
                env,
                contract,
                client,
                token,
                funder,
                school,
                attester,
            }
        }

        fn balance(&self, addr: &Address) -> i128 {
            TokenClient::new(&self.env, &self.token).balance(addr)
        }

        fn now(&self) -> u64 {
            self.env.ledger().timestamp()
        }

        fn set_timestamp(&self, ts: u64) {
            let info = self.env.ledger().get();
            self.env.ledger().set(LedgerInfo {
                timestamp: ts,
                ..info
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 1: fund → confirm (threshold met) → school balance increases
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn integration_fund_confirm_school_balance_increases() {
        let t = IntegEnv::setup();

        let funder_before = t.balance(&t.funder);
        let school_before = t.balance(&t.school);
        let contract_before = t.balance(&t.contract);

        let amount: i128 = 250_000; // 250,000 units
        let expires_at = t.now() + 86_400;

        // 1. Fund: funder locks tokens in escrow
        let voucher_id = t.client.fund(
            &t.funder,
            &t.school,
            &t.token,
            &amount,
            &0, // TUITION
            &student_ref(&t.env, 42),
            &expires_at,
        );

        // Verify escrow has received tokens
        assert_eq!(
            t.balance(&t.funder),
            funder_before - amount,
            "funder debited"
        );
        assert_eq!(
            t.balance(&t.contract),
            contract_before + amount,
            "contract credited"
        );
        assert_eq!(
            t.balance(&t.school),
            school_before,
            "school unchanged before confirm"
        );

        let v = t.client.get_voucher(&voucher_id);
        assert_eq!(v.status, Status::Funded);
        assert_eq!(v.amount, amount);

        // 2. Confirm: attester confirms, threshold=1 → immediate release
        t.client.confirm(&voucher_id, &t.attester);

        // Verify release: tokens moved from contract to school
        let v = t.client.get_voucher(&voucher_id);
        assert_eq!(v.status, Status::Released, "voucher must be Released");
        assert_eq!(
            t.balance(&t.school),
            school_before + amount,
            "school balance increased by amount"
        );
        assert_eq!(
            t.balance(&t.contract),
            contract_before,
            "contract balance back to zero"
        );
        assert_eq!(
            t.balance(&t.funder),
            funder_before - amount,
            "funder balance unchanged after release"
        );

        println!("✓ Scenario 1 passed: fund({amount}) → confirm → school balance +{amount}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 2: fund → expire → reclaim → funder balance restored
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn integration_fund_expire_reclaim_funder_balance_restored() {
        let t = IntegEnv::setup();

        let funder_before = t.balance(&t.funder);
        let school_before = t.balance(&t.school);

        let amount: i128 = 400_000; // 400,000 units
        let expires_at = t.now() + 86_400;

        // 1. Fund
        let voucher_id = t.client.fund(
            &t.funder,
            &t.school,
            &t.token,
            &amount,
            &1, // BOARDING
            &student_ref(&t.env, 99),
            &expires_at,
        );

        assert_eq!(t.balance(&t.funder), funder_before - amount);
        assert_eq!(t.client.get_voucher(&voucher_id).status, Status::Funded);

        // 2. Expire: advance ledger to exactly expires_at (boundary: reclaim succeeds at >=)
        t.set_timestamp(expires_at);

        // 3. Reclaim: funder recovers tokens
        t.client.reclaim(&voucher_id);

        let v = t.client.get_voucher(&voucher_id);
        assert_eq!(v.status, Status::Reclaimed, "voucher must be Reclaimed");
        assert_eq!(
            t.balance(&t.funder),
            funder_before,
            "funder balance fully restored"
        );
        assert_eq!(
            t.balance(&t.school),
            school_before,
            "school balance unchanged"
        );
        assert_eq!(t.balance(&t.contract), 0, "contract balance back to zero");

        println!(
            "✓ Scenario 2 passed: fund({amount}) → expire → reclaim → funder balance +{amount}"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 3: multiple concurrent vouchers — funds conservation
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn integration_multiple_vouchers_funds_conservation() {
        let t = IntegEnv::setup();

        let amounts: &[i128] = &[100_000, 200_000, 300_000];
        let total: i128 = amounts.iter().sum();
        let funder_before = t.balance(&t.funder);

        let mut ids = std::vec::Vec::new();
        for (i, &amt) in amounts.iter().enumerate() {
            let id = t.client.fund(
                &t.funder,
                &t.school,
                &t.token,
                &amt,
                &0,
                &student_ref(&t.env, i as u8),
                &(t.now() + 86_400),
            );
            ids.push(id);
        }

        // All funded: contract holds total
        assert_eq!(t.balance(&t.contract), total);
        assert_eq!(t.balance(&t.funder), funder_before - total);

        // Release first two via confirm
        t.client.confirm(&ids[0], &t.attester);
        t.client.confirm(&ids[1], &t.attester);
        assert_eq!(t.balance(&t.contract), amounts[2]);

        // Reclaim third after expiry
        let expires = t.client.get_voucher(&ids[2]).expires_at;
        t.set_timestamp(expires);
        t.client.reclaim(&ids[2]);

        // All resolved: contract empty
        assert_eq!(t.balance(&t.contract), 0);

        println!("✓ Scenario 3 passed: multiple vouchers, funds conservation verified");
    }
}
