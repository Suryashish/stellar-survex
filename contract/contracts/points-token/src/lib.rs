#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error,
    Address, Env, String,
};

// --- Storage ---

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Minter,
    TotalSupply,
    Balance(Address),
    Name,
    Symbol,
    Decimals,
}

// --- Errors ---

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    NotInitialized      = 1,
    AlreadyInitialized  = 2,
    NotAuthorized       = 3,
    InsufficientBalance = 4,
    InvalidAmount       = 5,
}

// --- Contract ---

#[contract]
pub struct SurvexPointsToken;

#[contractimpl]
impl SurvexPointsToken {
    /// One-time initialization. The `admin` becomes the only address that can
    /// configure the contract (rotate minter, change metadata).
    pub fn initialize(
        env: Env,
        admin: Address,
        name: String,
        symbol: String,
        decimals: u32,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, TokenError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
    }

    /// Authorise a minter (typically the survey contract address). Only the
    /// admin can call this. The previous minter is replaced.
    pub fn set_minter(env: Env, admin: Address, minter: Address) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Minter, &minter);
    }

    /// Mint `amount` units of the token to `to`. Callable by the admin or by
    /// the registered minter (e.g. the survey contract during create/respond).
    pub fn mint(env: Env, caller: Address, to: Address, amount: i128) {
        caller.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, TokenError::InvalidAmount);
        }
        Self::assert_admin_or_minter(&env, &caller);

        let bal_key = DataKey::Balance(to.clone());
        let current: i128 = env.storage().persistent().get(&bal_key).unwrap_or(0);
        env.storage().persistent().set(&bal_key, &(current + amount));

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(total + amount));
    }

    /// Standard transfer of points between two wallets.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, TokenError::InvalidAmount);
        }
        let from_key = DataKey::Balance(from.clone());
        let from_bal: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_bal < amount {
            panic_with_error!(&env, TokenError::InsufficientBalance);
        }
        env.storage().persistent().set(&from_key, &(from_bal - amount));

        let to_key = DataKey::Balance(to.clone());
        let to_bal: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage().persistent().set(&to_key, &(to_bal + amount));
    }

    // --- Read-only ---

    pub fn balance(env: Env, addr: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(addr))
            .unwrap_or(0)
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .unwrap_or(String::from_str(&env, ""))
    }

    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .unwrap_or(String::from_str(&env, ""))
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    pub fn minter(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Minter)
    }

    // --- Internal helpers ---

    fn assert_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, TokenError::NotInitialized));
        if &admin != caller {
            panic_with_error!(env, TokenError::NotAuthorized);
        }
    }

    fn assert_admin_or_minter(env: &Env, caller: &Address) {
        let admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        if let Some(a) = admin {
            if &a == caller {
                return;
            }
        } else {
            panic_with_error!(env, TokenError::NotInitialized);
        }
        let minter: Option<Address> = env.storage().instance().get(&DataKey::Minter);
        if let Some(m) = minter {
            if &m == caller {
                return;
            }
        }
        panic_with_error!(env, TokenError::NotAuthorized);
    }
}
