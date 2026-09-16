//! Testnet setup utilities for integration tests
//!
//! This module provides utilities for setting up and managing Stellar testnet
//! accounts for integration testing. Contract deployment/fixture management
//! lives in the crate root (`src/lib.rs`, `TestSuite`/`DeployedContract`) —
//! this module only covers standalone account generation/funding.

use std::process::Command;
use std::time::Duration;

/// Test account with keypair
#[derive(Debug, Clone)]
pub struct TestAccount {
    pub address: String,
    pub secret: String,
}

impl TestAccount {
    /// Generate a new test account
    pub fn generate() -> Result<Self, String> {
        let output = Command::new("stellar")
            .args(["keys", "generate", "--no-fund"])
            .output()
            .map_err(|e| format!("Failed to generate keypair: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "stellar keys generate failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().collect();

        // Parse output to extract address and secret
        let address = lines
            .iter()
            .find(|l| l.contains("Public key:"))
            .and_then(|l| l.split(':').nth(1))
            .map(|s| s.trim().to_string())
            .ok_or("Failed to parse public key")?;

        let secret = lines
            .iter()
            .find(|l| l.contains("Secret key:"))
            .and_then(|l| l.split(':').nth(1))
            .map(|s| s.trim().to_string())
            .ok_or("Failed to parse secret key")?;

        Ok(Self { address, secret })
    }

    /// Fund this account using Friendbot
    pub fn fund(&self, network: &str) -> Result<(), String> {
        println!(
            "Funding account {} via Friendbot on {}...",
            self.address, network
        );

        let output = Command::new("stellar")
            .args(["keys", "fund", &self.address, "--network", network])
            .output()
            .map_err(|e| format!("Failed to fund account: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "Friendbot funding failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        // Wait for funding to be confirmed
        std::thread::sleep(Duration::from_secs(2));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // Run with: cargo test --test integration -- --ignored
    fn test_account_generation() {
        let account = TestAccount::generate().expect("Failed to generate account");
        assert!(!account.address.is_empty());
        assert!(!account.secret.is_empty());
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
