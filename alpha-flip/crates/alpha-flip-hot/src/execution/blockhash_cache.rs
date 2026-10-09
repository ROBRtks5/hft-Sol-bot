use crate::errors::ExecutionError;
use crate::types::{Blockhash, Slot};

#[derive(Debug, Clone)]
pub struct BlockhashCache {
    pub latest_blockhash: Option<Blockhash>,
    pub last_updated_slot: Slot,
    pub max_age_slots: u64,
    pub refresh_threshold_slots: u64,
}

impl Default for BlockhashCache {
    fn default() -> Self {
        Self {
            latest_blockhash: None,
            last_updated_slot: Slot::ZERO,
            max_age_slots: 150,           // ~60s at 400ms/slot
            refresh_threshold_slots: 60,   // Proactively refresh after ~24s
        }
    }
}

impl BlockhashCache {
    pub fn new(max_age_slots: u64, refresh_threshold_slots: u64) -> Self {
        Self {
            latest_blockhash: None,
            last_updated_slot: Slot::ZERO,
            max_age_slots,
            refresh_threshold_slots,
        }
    }

    /// Update with fresh blockhash from gRPC or RPC snapshot
    pub fn update(&mut self, blockhash: Blockhash, slot: Slot) {
        if slot >= self.last_updated_slot {
            self.latest_blockhash = Some(blockhash);
            self.last_updated_slot = slot;
        }
    }

    /// Check if blockhash needs proactive refresh
    pub fn needs_refresh(&self, current_slot: Slot) -> bool {
        if self.latest_blockhash.is_none() {
            return true;
        }
        let age = current_slot.saturating_sub(self.last_updated_slot);
        age >= self.refresh_threshold_slots
    }

    /// Retrieve blockhash with stale guard before constructing a transaction bundle
    pub fn get_valid_blockhash(&self, current_slot: Slot) -> Result<Blockhash, ExecutionError> {
        let blockhash = self
            .latest_blockhash
            .ok_or(ExecutionError::UninitializedBlockhash)?;

        let age = current_slot.saturating_sub(self.last_updated_slot);
        if age > self.max_age_slots {
            Err(ExecutionError::StaleBlockhash {
                age_slots: age,
                max_slots: self.max_age_slots,
            })
        } else {
            Ok(blockhash)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blockhash_cache_lifecycle() {
        let mut cache = BlockhashCache::new(100, 40);
        assert!(cache.needs_refresh(Slot(10)));
        assert!(matches!(
            cache.get_valid_blockhash(Slot(10)),
            Err(ExecutionError::UninitializedBlockhash)
        ));

        let hash = Blockhash::new([1u8; 32]);
        cache.update(hash, Slot(100));

        // Age 10: fresh
        assert!(!cache.needs_refresh(Slot(110)));
        assert_eq!(cache.get_valid_blockhash(Slot(110)).unwrap(), hash);

        // Age 50: needs refresh, but still valid
        assert!(cache.needs_refresh(Slot(150)));
        assert_eq!(cache.get_valid_blockhash(Slot(150)).unwrap(), hash);

        // Age 105: stale guard breach!
        assert!(matches!(
            cache.get_valid_blockhash(Slot(205)),
            Err(ExecutionError::StaleBlockhash { age_slots: 105, max_slots: 100 })
        ));
    }
}
