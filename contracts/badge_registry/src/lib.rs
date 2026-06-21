#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[derive(Clone)]
#[contracttype]
pub struct Badge {
    pub name: String,
    pub earned_at: u64,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    UserBadge(Address),
}

#[contract]
pub struct BadgeRegistry;

#[contractimpl]
impl BadgeRegistry {
    /// Awards a badge to the user. In a real app, this might only be callable by an authorized contract.
    pub fn award_badge(env: Env, user: Address, badge_name: String) {
        let earned_at = env.ledger().timestamp();
        let badge = Badge {
            name: badge_name.clone(),
            earned_at,
        };

        env.storage()
            .persistent()
            .set(&DataKey::UserBadge(user.clone()), &badge);
    }

    /// Gets the user's latest badge.
    pub fn get_latest_badge(env: Env, user: Address) -> Option<Badge> {
        env.storage().persistent().get(&DataKey::UserBadge(user))
    }
}
