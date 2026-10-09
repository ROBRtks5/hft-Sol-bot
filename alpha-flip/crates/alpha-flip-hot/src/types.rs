use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::{Add, AddAssign, Sub, SubAssign};
use std::str::FromStr;

pub use solana_sdk::pubkey::Pubkey;

/// Mint address type alias
pub type Mint = Pubkey;

/// Solana slot number (logical sequence clock)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
pub struct Slot(pub u64);

impl Slot {
    pub const ZERO: Self = Self(0);

    #[inline]
    pub fn new(val: u64) -> Self {
        Self(val)
    }

    #[inline]
    pub fn as_u64(&self) -> u64 {
        self.0
    }

    #[inline]
    pub fn saturating_sub(&self, other: Slot) -> u64 {
        self.0.saturating_sub(other.0)
    }
}

impl From<u64> for Slot {
    #[inline]
    fn from(val: u64) -> Self {
        Self(val)
    }
}

impl fmt::Display for Slot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Add<u64> for Slot {
    type Output = Self;
    #[inline]
    fn add(self, rhs: u64) -> Self::Output {
        Self(self.0.saturating_add(rhs))
    }
}

impl Sub<u64> for Slot {
    type Output = Self;
    #[inline]
    fn sub(self, rhs: u64) -> Self::Output {
        Self(self.0.saturating_sub(rhs))
    }
}

/// Yellowstone gRPC write version for deduplication and monotonic ordering
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
pub struct WriteVersion(pub u64);

impl WriteVersion {
    #[inline]
    pub fn as_u64(&self) -> u64 {
        self.0
    }
}

impl From<u64> for WriteVersion {
    #[inline]
    fn from(val: u64) -> Self {
        Self(val)
    }
}

impl fmt::Display for WriteVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Solana native lamports (1 SOL = 1,000,000,000 lamports)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
pub struct Lamports(pub u64);

impl Lamports {
    pub const ZERO: Self = Self(0);
    pub const ONE_SOL: Self = Self(1_000_000_000);

    #[inline]
    pub fn as_u64(&self) -> u64 {
        self.0
    }

    #[inline]
    pub fn to_sol_f64(&self) -> f64 {
        self.0 as f64 / 1_000_000_000.0
    }

    #[inline]
    pub fn from_sol_f64(sol: f64) -> Self {
        Self((sol * 1_000_000_000.0).round() as u64)
    }

    #[inline]
    pub fn saturating_sub(&self, other: Lamports) -> Self {
        Self(self.0.saturating_sub(other.0))
    }

    #[inline]
    pub fn saturating_add(&self, other: Lamports) -> Self {
        Self(self.0.saturating_add(other.0))
    }
}

impl From<u64> for Lamports {
    #[inline]
    fn from(val: u64) -> Self {
        Self(val)
    }
}

impl fmt::Display for Lamports {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} lamports ({:.4} SOL)", self.0, self.to_sol_f64())
    }
}

impl Add for Lamports {
    type Output = Self;
    #[inline]
    fn add(self, rhs: Self) -> Self::Output {
        self.saturating_add(rhs)
    }
}

impl AddAssign for Lamports {
    #[inline]
    fn add_assign(&mut self, rhs: Self) {
        *self = self.saturating_add(rhs);
    }
}

impl Sub for Lamports {
    type Output = Self;
    #[inline]
    fn sub(self, rhs: Self) -> Self::Output {
        self.saturating_sub(rhs)
    }
}

impl SubAssign for Lamports {
    #[inline]
    fn sub_assign(&mut self, rhs: Self) {
        *self = self.saturating_sub(rhs);
    }
}

/// Raw SPL token units (taking token decimals into account)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
pub struct TokenAmount(pub u64);

impl TokenAmount {
    pub const ZERO: Self = Self(0);

    #[inline]
    pub fn as_u64(&self) -> u64 {
        self.0
    }

    #[inline]
    pub fn saturating_sub(&self, other: TokenAmount) -> Self {
        Self(self.0.saturating_sub(other.0))
    }

    #[inline]
    pub fn saturating_add(&self, other: TokenAmount) -> Self {
        Self(self.0.saturating_add(other.0))
    }
}

impl From<u64> for TokenAmount {
    #[inline]
    fn from(val: u64) -> Self {
        Self(val)
    }
}

impl fmt::Display for TokenAmount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Add for TokenAmount {
    type Output = Self;
    #[inline]
    fn add(self, rhs: Self) -> Self::Output {
        self.saturating_add(rhs)
    }
}

impl AddAssign for TokenAmount {
    #[inline]
    fn add_assign(&mut self, rhs: Self) {
        *self = self.saturating_add(rhs);
    }
}

impl Sub for TokenAmount {
    type Output = Self;
    #[inline]
    fn sub(self, rhs: Self) -> Self::Output {
        self.saturating_sub(rhs)
    }
}

impl SubAssign for TokenAmount {
    #[inline]
    fn sub_assign(&mut self, rhs: Self) {
        *self = self.saturating_sub(rhs);
    }
}

/// 64-byte Ed25519 Solana transaction signature wrapper
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Signature(pub [u8; 64]);

impl Signature {
    pub const ZERO: Self = Self([0u8; 64]);

    pub fn new(bytes: [u8; 64]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 64] {
        &self.0
    }
}

impl Default for Signature {
    fn default() -> Self {
        Self::ZERO
    }
}

impl fmt::Debug for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Signature({})", self)
    }
}

impl fmt::Display for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", bs58::encode(&self.0).into_string())
    }
}

impl FromStr for Signature {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut bytes = [0u8; 64];
        let decoded = bs58::decode(s.trim()).into_vec()?;
        anyhow::ensure!(
            decoded.len() == 64,
            "Invalid signature byte length: expected 64, got {}",
            decoded.len()
        );
        bytes.copy_from_slice(&decoded);
        Ok(Self(bytes))
    }
}

impl Serialize for Signature {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Signature {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::from_str(&s).map_err(serde::de::Error::custom)
    }
}

/// 32-byte Solana recent blockhash wrapper
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Blockhash(pub [u8; 32]);

impl Blockhash {
    pub const ZERO: Self = Self([0u8; 32]);

    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl Default for Blockhash {
    fn default() -> Self {
        Self::ZERO
    }
}

impl fmt::Debug for Blockhash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Blockhash({})", self)
    }
}

impl fmt::Display for Blockhash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", bs58::encode(&self.0).into_string())
    }
}

impl FromStr for Blockhash {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut bytes = [0u8; 32];
        let decoded = bs58::decode(s.trim()).into_vec()?;
        anyhow::ensure!(
            decoded.len() == 32,
            "Invalid blockhash byte length: expected 32, got {}",
            decoded.len()
        );
        bytes.copy_from_slice(&decoded);
        Ok(Self(bytes))
    }
}

impl Serialize for Blockhash {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Blockhash {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::from_str(&s).map_err(serde::de::Error::custom)
    }
}

