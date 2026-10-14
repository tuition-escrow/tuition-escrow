use soroban_sdk::Address;

#[derive(Clone, Debug)]
pub struct FundedEvent {
    pub id: u64,
    pub funder: Address,
    pub school: Address,
    pub token: Address,
    pub amount: i128,
    pub category: u32,
    pub expires_at: u64,
}

#[derive(Clone, Debug)]
pub struct AttestedEvent {
    pub id: u64,
    pub attester: Address,
    pub count: u32,
}

#[derive(Clone, Debug)]
pub struct ReleasedEvent {
    pub id: u64,
}

#[derive(Clone, Debug)]
pub struct ReclaimedEvent {
    pub id: u64,
}

#[derive(Clone, Debug)]
pub struct CancelledEvent {
    pub id: u64,
}
