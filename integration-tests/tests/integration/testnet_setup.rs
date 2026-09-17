//! Testnet setup utilities for integration tests
//!
//! Account generation/funding lives in the crate root (`src/lib.rs`,
//! `TestAccount`) — this module previously kept its own duplicate copy;
//! it now just re-exports that one so both are covered by a single
//! implementation.

pub use integration_tests::TestAccount;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // Run with: cargo test --test integration -- --ignored
    fn test_account_generation() {
        let account = TestAccount::generate().expect("Failed to generate account");
        assert!(!account.address.is_empty());
        assert!(!account.name.is_empty());
        println!("Generated account: {}", account.address);
    }

    #[test]
    #[ignore]
    fn test_account_funding() {
        let account = TestAccount::generate().expect("Failed to generate account");
        account.fund("testnet").expect("Failed to fund account");
        println!("Funded account: {}", account.address);
    }
}
