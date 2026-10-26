//! Event struct definitions — kept for documentation purposes.
//! Actual events are emitted inline in lib.rs using e.events().publish().
//! These structs mirror the README event table for reference.

#![allow(dead_code)]

use soroban_sdk::Address;

pub struct FundedEvent {
    pub id: u64,
    pub funder: Address,
    pub school: Address,
    pub token: Address,
    pub amount: i128,
    pub category: u32,
    pub expires_at: u64,
}

pub struct AttestedEvent {
    pub id: u64,
    pub attester: Address,
    pub count: u32,
}

pub struct ReleasedEvent {
    pub id: u64,
    pub school: Address,
    pub amount: i128,
}

pub struct ReclaimedEvent {
    pub id: u64,
    pub funder: Address,
    pub amount: i128,
}

pub struct CancelledEvent {
    pub id: u64,
}
