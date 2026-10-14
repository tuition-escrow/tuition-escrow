use soroban_sdk::{contracttype, Address, BytesN, Vec};

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum Status {
    Funded = 0,
    Released = 1,
    Reclaimed = 2,
    Cancelled = 3,
    Disputed = 4,  // reserved, not implemented
    Refunded = 5,  // reserved, not implemented
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct Voucher {
    pub funder: Address,
    pub school: Address,
    pub token: Address,
    pub amount: i128,
    pub category: u32,
    pub student_ref: BytesN<32>,
    pub expires_at: u64,
    pub status: Status,
    pub attesters: Vec<Address>,
    pub threshold: u32,
    pub attestation_count: u32,
    pub created_at: u64,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct School {
    pub attesters: Vec<Address>,
    pub threshold: u32,
    pub active: bool,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub min_amount: i128,
    pub max_amount: i128,
    pub max_expiry_hours: u64,
    pub allowed_tokens: Vec<Address>,
}
