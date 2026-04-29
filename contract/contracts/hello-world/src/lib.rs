#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    token, Address, Env, String, Symbol, Vec,
};

// Typed client for the companion `points-token` contract. Lets the survey
// contract call mint() on the token without depending on its source crate.
#[contractclient(name = "PointsTokenClient")]
pub trait PointsTokenInterface {
    fn mint(env: Env, caller: Address, to: Address, amount: i128);
    fn balance(env: Env, addr: Address) -> i128;
}

// --- Data Structures ---

#[contracttype]
#[derive(Clone)]
pub struct Survey {
    pub id: Symbol,
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub questions: Vec<String>,
    pub response_count: u32,
    pub status: SurveyStatus,
    pub created_at: u64,
    pub end_time: u64,
    pub max_responses: u32,
    /// Reward per response in token base units (stroops for native XLM).
    pub reward_per_response: i128,
    /// Token contract address used to pay rewards (e.g. native XLM SAC).
    pub reward_token: Address,
    /// Remaining escrowed funds inside this contract for this survey.
    pub funded_remaining: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct ResponseEntry {
    pub respondent: Address,
    pub answers: String,
    pub submitted_at: u64,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum SurveyStatus {
    Active,
    Closed,
    Paused,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    IdList,
    TotalCount,
    Survey(Symbol),
    Response(Symbol, Address),
    Responses(Symbol),
    Whitelist(Symbol),
    WhitelistEnabled(Symbol),
    // New: shared admin access (co-admins) per survey.
    CoAdmins(Symbol),
    // New: visibility flag. true = Private, absent/false = Public.
    Private(Symbol),
    // New: addresses allowed to see/respond to a private survey.
    AllowedViewers(Symbol),
    // Contract-wide configuration set by the contract admin.
    ContractAdmin,
    PointsToken,
    CreatorPoints,
    RespondentPoints,
}

// --- Errors ---

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    NotFound          = 1,
    NotAuthorized     = 2,
    InvalidTitle      = 3,
    SurveyNotActive   = 4,
    AlreadyResponded  = 5,
    SurveyExpired     = 6,
    ResponseLimitHit  = 7,
    NotWhitelisted    = 8,
    InvalidEndTime    = 9,
    AlreadyExists     = 10,
    InvalidReward     = 11,
    InvalidQuestions  = 12,
    CannotWithdraw    = 13,
    NotAllowedViewer  = 14,
    NotContractAdmin  = 15,
    AlreadyInitialized = 16,
}

// --- Contract ---

#[contract]
pub struct SurveyBuilderContract;

#[contractimpl]
impl SurveyBuilderContract {

    fn load_survey(env: &Env, id: &Symbol) -> Survey {
        env.storage()
            .instance()
            .get(&DataKey::Survey(id.clone()))
            .unwrap_or_else(|| panic_with_error!(env, ContractError::NotFound))
    }

    fn save_survey(env: &Env, survey: &Survey) {
        env.storage()
            .instance()
            .set(&DataKey::Survey(survey.id.clone()), survey);
    }

    fn load_ids(env: &Env) -> Vec<Symbol> {
        env.storage()
            .instance()
            .get(&DataKey::IdList)
            .unwrap_or(Vec::new(env))
    }

    fn save_ids(env: &Env, ids: &Vec<Symbol>) {
        env.storage().instance().set(&DataKey::IdList, ids);
    }

    fn load_co_admins(env: &Env, id: &Symbol) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::CoAdmins(id.clone()))
            .unwrap_or(Vec::new(env))
    }

    fn save_co_admins(env: &Env, id: &Symbol, list: &Vec<Address>) {
        env.storage()
            .instance()
            .set(&DataKey::CoAdmins(id.clone()), list);
    }

    fn load_viewers(env: &Env, id: &Symbol) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AllowedViewers(id.clone()))
            .unwrap_or(Vec::new(env))
    }

    fn save_viewers(env: &Env, id: &Symbol, list: &Vec<Address>) {
        env.storage()
            .instance()
            .set(&DataKey::AllowedViewers(id.clone()), list);
    }

    fn is_private_internal(env: &Env, id: &Symbol) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Private(id.clone()))
            .unwrap_or(false)
    }

    fn is_co_admin_internal(env: &Env, id: &Symbol, addr: &Address) -> bool {
        let list = Self::load_co_admins(env, id);
        list.iter().any(|a| &a == addr)
    }

    fn assert_creator(env: &Env, survey: &Survey, caller: &Address) {
        if &survey.creator != caller {
            panic_with_error!(env, ContractError::NotAuthorized);
        }
    }

    /// Authorise either the original creator OR a registered co-admin.
    fn assert_admin_or_co_admin(env: &Env, survey: &Survey, caller: &Address) {
        if &survey.creator == caller {
            return;
        }
        if Self::is_co_admin_internal(env, &survey.id, caller) {
            return;
        }
        panic_with_error!(env, ContractError::NotAuthorized);
    }

    /// Mint reward points to `recipient` if the contract admin has wired up
    /// a points-token and configured a non-zero reward amount.
    /// Mint failures (token contract not authorising us, etc.) are intentionally
    /// allowed to bubble up so the calling action also reverts — keeps the
    /// reward in lock-step with the on-chain action.
    fn mint_points(env: &Env, recipient: &Address, amount_key: &DataKey) {
        let token_addr: Option<Address> = env.storage().instance().get(&DataKey::PointsToken);
        let amount: i128 = env.storage().instance().get(amount_key).unwrap_or(0);
        let token_addr = match token_addr {
            Some(addr) => addr,
            None => return,
        };
        if amount <= 0 {
            return;
        }
        let client = PointsTokenClient::new(env, &token_addr);
        let caller = env.current_contract_address();
        client.mint(&caller, recipient, &amount);
    }

    fn can_view_internal(env: &Env, id: &Symbol, addr: &Address) -> bool {
        if !Self::is_private_internal(env, id) {
            return true;
        }
        let survey = Self::load_survey(env, id);
        if &survey.creator == addr {
            return true;
        }
        if Self::is_co_admin_internal(env, id, addr) {
            return true;
        }
        let viewers = Self::load_viewers(env, id);
        viewers.iter().any(|a| &a == addr)
    }

    // -- Survey lifecycle --

    pub fn create_survey(
        env: Env,
        id: Symbol,
        creator: Address,
        title: String,
        description: String,
        questions: Vec<String>,
        end_time: u64,
        max_responses: u32,
        reward_per_response: i128,
        reward_token: Address,
    ) {
        creator.require_auth();

        if title.len() == 0 {
            panic_with_error!(&env, ContractError::InvalidTitle);
        }
        if questions.len() == 0 {
            panic_with_error!(&env, ContractError::InvalidQuestions);
        }
        if reward_per_response < 0 {
            panic_with_error!(&env, ContractError::InvalidReward);
        }
        // Need a known cap to escrow rewards.
        if reward_per_response > 0 && max_responses == 0 {
            panic_with_error!(&env, ContractError::InvalidReward);
        }

        let now = env.ledger().timestamp();
        if end_time <= now {
            panic_with_error!(&env, ContractError::InvalidEndTime);
        }

        let key = DataKey::Survey(id.clone());
        if env.storage().instance().has(&key) {
            panic_with_error!(&env, ContractError::AlreadyExists);
        }

        // Escrow upfront: total = reward_per_response * max_responses.
        let total: i128 = if reward_per_response > 0 {
            reward_per_response * (max_responses as i128)
        } else {
            0
        };

        if total > 0 {
            let client = token::Client::new(&env, &reward_token);
            client.transfer(&creator, &env.current_contract_address(), &total);
        }

        let survey = Survey {
            id: id.clone(),
            creator,
            title,
            description,
            questions,
            response_count: 0,
            status: SurveyStatus::Active,
            created_at: now,
            end_time,
            max_responses,
            reward_per_response,
            reward_token,
            funded_remaining: total,
        };

        env.storage().instance().set(&key, &survey);

        let mut ids = Self::load_ids(&env);
        ids.push_back(id.clone());
        Self::save_ids(&env, &ids);

        env.storage()
            .instance()
            .set(&DataKey::Responses(id), &Vec::<ResponseEntry>::new(&env));

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCount, &(count + 1));

        // Reward the creator with points-token (no-op if unconfigured).
        Self::mint_points(&env, &survey.creator, &DataKey::CreatorPoints);
    }

    pub fn pause_survey(env: Env, id: Symbol, caller: Address) {
        caller.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_admin_or_co_admin(&env, &survey, &caller);

        if survey.status != SurveyStatus::Active {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }

        survey.status = SurveyStatus::Paused;
        Self::save_survey(&env, &survey);
    }

    pub fn resume_survey(env: Env, id: Symbol, caller: Address) {
        caller.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_admin_or_co_admin(&env, &survey, &caller);

        if survey.status != SurveyStatus::Paused {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }

        survey.status = SurveyStatus::Active;
        Self::save_survey(&env, &survey);
    }

    pub fn close_survey(env: Env, id: Symbol, caller: Address) {
        caller.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_admin_or_co_admin(&env, &survey, &caller);

        survey.status = SurveyStatus::Closed;
        Self::save_survey(&env, &survey);
    }

    pub fn extend_survey(env: Env, id: Symbol, caller: Address, new_end_time: u64) {
        caller.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_admin_or_co_admin(&env, &survey, &caller);

        if survey.status == SurveyStatus::Closed {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }
        if new_end_time <= survey.end_time {
            panic_with_error!(&env, ContractError::InvalidEndTime);
        }

        survey.end_time = new_end_time;
        Self::save_survey(&env, &survey);
    }

    /// Withdraw any unused escrowed funds back to the creator.
    /// Only the original creator can withdraw — co-admins cannot pull funds.
    pub fn withdraw_unused_funds(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_creator(&env, &survey, &creator);

        if survey.funded_remaining <= 0 {
            return;
        }

        let now = env.ledger().timestamp();
        let terminated = survey.status == SurveyStatus::Closed || now > survey.end_time;
        if !terminated {
            panic_with_error!(&env, ContractError::CannotWithdraw);
        }

        let amount = survey.funded_remaining;
        let client = token::Client::new(&env, &survey.reward_token);
        client.transfer(&env.current_contract_address(), &creator, &amount);

        survey.funded_remaining = 0;
        Self::save_survey(&env, &survey);
    }

    // -- Response whitelist (gates who may submit) --

    pub fn enable_whitelist(env: Env, id: Symbol, caller: Address) {
        caller.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_admin_or_co_admin(&env, &survey, &caller);
        env.storage()
            .instance()
            .set(&DataKey::WhitelistEnabled(id), &true);
    }

    pub fn add_to_whitelist(env: Env, id: Symbol, caller: Address, addresses: Vec<Address>) {
        caller.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_admin_or_co_admin(&env, &survey, &caller);

        let wl_key = DataKey::Whitelist(id);
        let mut wl: Vec<Address> = env
            .storage()
            .instance()
            .get(&wl_key)
            .unwrap_or(Vec::new(&env));

        for addr in addresses.iter() {
            wl.push_back(addr);
        }
        env.storage().instance().set(&wl_key, &wl);
    }

    // -- Co-admin management (only the original creator can mutate) --

    pub fn add_co_admin(env: Env, id: Symbol, creator: Address, addr: Address) {
        creator.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_creator(&env, &survey, &creator);

        // No-op when already co-admin or when adding the creator themselves.
        if addr == survey.creator {
            return;
        }
        let mut list = Self::load_co_admins(&env, &id);
        if list.iter().any(|a| a == addr) {
            return;
        }
        list.push_back(addr);
        Self::save_co_admins(&env, &id, &list);
    }

    pub fn remove_co_admin(env: Env, id: Symbol, creator: Address, addr: Address) {
        creator.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_creator(&env, &survey, &creator);

        let list = Self::load_co_admins(&env, &id);
        let mut next: Vec<Address> = Vec::new(&env);
        for existing in list.iter() {
            if existing != addr {
                next.push_back(existing);
            }
        }
        Self::save_co_admins(&env, &id, &next);
    }

    // -- Visibility & viewer list (admin or co-admin can mutate) --

    /// Set survey visibility. `is_private = true` makes the survey only
    /// viewable/answerable by the creator, co-admins, and addresses in
    /// the allowed-viewers list.
    pub fn set_visibility(env: Env, id: Symbol, caller: Address, is_private: bool) {
        caller.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_admin_or_co_admin(&env, &survey, &caller);
        env.storage()
            .instance()
            .set(&DataKey::Private(id), &is_private);
    }

    pub fn add_allowed_viewers(env: Env, id: Symbol, caller: Address, addresses: Vec<Address>) {
        caller.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_admin_or_co_admin(&env, &survey, &caller);

        let mut list = Self::load_viewers(&env, &id);
        for addr in addresses.iter() {
            if list.iter().any(|a| a == addr) {
                continue;
            }
            list.push_back(addr);
        }
        Self::save_viewers(&env, &id, &list);
    }

    pub fn remove_allowed_viewer(env: Env, id: Symbol, caller: Address, addr: Address) {
        caller.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_admin_or_co_admin(&env, &survey, &caller);

        let list = Self::load_viewers(&env, &id);
        let mut next: Vec<Address> = Vec::new(&env);
        for existing in list.iter() {
            if existing != addr {
                next.push_back(existing);
            }
        }
        Self::save_viewers(&env, &id, &next);
    }

    // -- Response submission --

    pub fn submit_response(
        env: Env,
        survey_id: Symbol,
        respondent: Address,
        answers: String,
    ) {
        respondent.require_auth();

        let mut survey = Self::load_survey(&env, &survey_id);

        if survey.status != SurveyStatus::Active {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }

        let now = env.ledger().timestamp();
        if now > survey.end_time {
            panic_with_error!(&env, ContractError::SurveyExpired);
        }

        if survey.max_responses > 0 && survey.response_count >= survey.max_responses {
            panic_with_error!(&env, ContractError::ResponseLimitHit);
        }

        // Wallet-level dedup
        let resp_key = DataKey::Response(survey_id.clone(), respondent.clone());
        if env.storage().instance().has(&resp_key) {
            panic_with_error!(&env, ContractError::AlreadyResponded);
        }

        // Private-mode access gate (visibility list).
        if !Self::can_view_internal(&env, &survey_id, &respondent) {
            panic_with_error!(&env, ContractError::NotAllowedViewer);
        }

        // Response whitelist (orthogonal to visibility — gates who may submit).
        let wl_enabled: bool = env
            .storage()
            .instance()
            .get(&DataKey::WhitelistEnabled(survey_id.clone()))
            .unwrap_or(false);

        if wl_enabled {
            let wl: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::Whitelist(survey_id.clone()))
                .unwrap_or(Vec::new(&env));

            let allowed = wl.iter().any(|a| a == respondent);
            if !allowed {
                panic_with_error!(&env, ContractError::NotWhitelisted);
            }
        }

        env.storage().instance().set(&resp_key, &true);
        survey.response_count += 1;

        let entries_key = DataKey::Responses(survey_id.clone());
        let mut entries: Vec<ResponseEntry> = env
            .storage()
            .instance()
            .get(&entries_key)
            .unwrap_or(Vec::new(&env));

        entries.push_back(ResponseEntry {
            respondent: respondent.clone(),
            answers,
            submitted_at: now,
        });
        env.storage().instance().set(&entries_key, &entries);

        // Auto-payout from escrow
        if survey.reward_per_response > 0 && survey.funded_remaining >= survey.reward_per_response {
            let client = token::Client::new(&env, &survey.reward_token);
            client.transfer(
                &env.current_contract_address(),
                &respondent,
                &survey.reward_per_response,
            );
            survey.funded_remaining -= survey.reward_per_response;
        }

        if survey.max_responses > 0 && survey.response_count >= survey.max_responses {
            survey.status = SurveyStatus::Closed;
        }

        Self::save_survey(&env, &survey);

        // Reward the respondent with points-token (no-op if unconfigured).
        Self::mint_points(&env, &respondent, &DataKey::RespondentPoints);
    }

    // -- Read-only queries --

    pub fn get_survey(env: Env, id: Symbol) -> Option<Survey> {
        env.storage().instance().get(&DataKey::Survey(id))
    }

    pub fn list_surveys(env: Env) -> Vec<Symbol> {
        Self::load_ids(&env)
    }

    pub fn get_total_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalCount)
            .unwrap_or(0)
    }

    pub fn get_response_count(env: Env, survey_id: Symbol) -> u32 {
        match env
            .storage()
            .instance()
            .get::<DataKey, Survey>(&DataKey::Survey(survey_id))
        {
            Some(s) => s.response_count,
            None => 0,
        }
    }

    pub fn has_responded(env: Env, survey_id: Symbol, respondent: Address) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::Response(survey_id, respondent))
    }

    pub fn is_accepting_responses(env: Env, survey_id: Symbol) -> bool {
        let survey: Option<Survey> = env
            .storage()
            .instance()
            .get(&DataKey::Survey(survey_id));

        match survey {
            None => false,
            Some(s) => {
                let now = env.ledger().timestamp();
                s.status == SurveyStatus::Active
                    && now <= s.end_time
                    && (s.max_responses == 0 || s.response_count < s.max_responses)
            }
        }
    }

    pub fn get_responses(env: Env, survey_id: Symbol) -> Vec<ResponseEntry> {
        env.storage()
            .instance()
            .get(&DataKey::Responses(survey_id))
            .unwrap_or(Vec::new(&env))
    }

    // -- New read queries --

    pub fn get_co_admins(env: Env, id: Symbol) -> Vec<Address> {
        Self::load_co_admins(&env, &id)
    }

    pub fn get_allowed_viewers(env: Env, id: Symbol) -> Vec<Address> {
        Self::load_viewers(&env, &id)
    }

    pub fn is_private(env: Env, id: Symbol) -> bool {
        Self::is_private_internal(&env, &id)
    }

    pub fn is_co_admin(env: Env, id: Symbol, addr: Address) -> bool {
        Self::is_co_admin_internal(&env, &id, &addr)
    }

    pub fn can_view(env: Env, id: Symbol, addr: Address) -> bool {
        Self::can_view_internal(&env, &id, &addr)
    }

    // -- Contract admin & points-token configuration --

    /// One-time bootstrap: assigns the contract-wide admin who can later wire
    /// the points-token integration. Anyone can call this once after deploy.
    pub fn init_admin(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::ContractAdmin) {
            panic_with_error!(&env, ContractError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::ContractAdmin, &admin);
    }

    /// Configure (or rotate) the reward points integration. Only the contract
    /// admin can call this. Pass amounts in the token's base units.
    pub fn set_points_config(
        env: Env,
        admin: Address,
        token: Address,
        creator_points: i128,
        respondent_points: i128,
    ) {
        admin.require_auth();
        Self::assert_contract_admin(&env, &admin);
        if creator_points < 0 || respondent_points < 0 {
            panic_with_error!(&env, ContractError::InvalidReward);
        }
        env.storage().instance().set(&DataKey::PointsToken, &token);
        env.storage()
            .instance()
            .set(&DataKey::CreatorPoints, &creator_points);
        env.storage()
            .instance()
            .set(&DataKey::RespondentPoints, &respondent_points);
    }

    /// Convenience read: (token_address, creator_points, respondent_points).
    /// Returns zero amounts and `None` token when not configured.
    pub fn get_points_config(env: Env) -> (Option<Address>, i128, i128) {
        let token: Option<Address> = env.storage().instance().get(&DataKey::PointsToken);
        let creator: i128 = env
            .storage()
            .instance()
            .get(&DataKey::CreatorPoints)
            .unwrap_or(0);
        let respondent: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RespondentPoints)
            .unwrap_or(0);
        (token, creator, respondent)
    }

    pub fn get_contract_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::ContractAdmin)
    }

    fn assert_contract_admin(env: &Env, caller: &Address) {
        let admin: Option<Address> = env.storage().instance().get(&DataKey::ContractAdmin);
        match admin {
            Some(a) if &a == caller => {}
            _ => panic_with_error!(env, ContractError::NotContractAdmin),
        }
    }
}
