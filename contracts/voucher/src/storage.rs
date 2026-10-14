use soroban_sdk::{contracttype, Address, Env, Vec};
use crate::types::{Config, School, Voucher};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Config,
    VoucherCounter,
    Voucher(u64),
    School(Address),
}

pub const DAY_IN_LEDGERS: u32 = 17280; // ~1 day
pub const INSTANCE_BUMP_AMOUNT: u32 = 7 * DAY_IN_LEDGERS;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

pub fn extend_instance_ttl(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn get_config(e: &Env) -> Option<Config> {
    extend_instance_ttl(e);
    e.storage().instance().get(&DataKey::Config)
}

pub fn set_config(e: &Env, config: &Config) {
    e.storage().instance().set(&DataKey::Config, config);
    extend_instance_ttl(e);
}

pub fn get_voucher_counter(e: &Env) -> u64 {
    extend_instance_ttl(e);
    e.storage().instance().get(&DataKey::VoucherCounter).unwrap_or(0)
}

pub fn increment_voucher_counter(e: &Env) -> u64 {
    let counter = get_voucher_counter(e) + 1;
    e.storage().instance().set(&DataKey::VoucherCounter, &counter);
    extend_instance_ttl(e);
    counter
}

pub fn get_voucher(e: &Env, id: u64) -> Option<Voucher> {
    e.storage().persistent().get(&DataKey::Voucher(id))
}

pub fn set_voucher(e: &Env, id: u64, voucher: &Voucher) {
    e.storage().persistent().set(&DataKey::Voucher(id), voucher);
    e.storage()
        .persistent()
        .extend_ttl(&DataKey::Voucher(id), DAY_IN_LEDGERS, 30 * DAY_IN_LEDGERS);
}

pub fn get_school(e: &Env, school: &Address) -> Option<School> {
    e.storage().persistent().get(&DataKey::School(school.clone()))
}

pub fn set_school(e: &Env, school: &Address, school_data: &School) {
    e.storage().persistent().set(&DataKey::School(school.clone()), school_data);
    e.storage()
        .persistent()
        .extend_ttl(&DataKey::School(school.clone()), DAY_IN_LEDGERS, 30 * DAY_IN_LEDGERS);
}
