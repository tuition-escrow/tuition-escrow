use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized = 1,
    VoucherNotFound = 2,
    InvalidStatus = 3,
    NotExpired = 4,
    AlreadyExpired = 5,
    InvalidAmount = 6,
    SchoolNotRegistered = 7,
    TokenNotAllowed = 8,
    DuplicateAttestation = 9,
    ThresholdNotMet = 10,
}
