#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    panic_with_error, Address, Env, String, Symbol, Vec,
};

// ─── Data Structures ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct Survey {
    pub id: Symbol,
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub question_count: u32,
    pub response_count: u32,
    pub status: SurveyStatus,
    pub created_at: u64,
    pub end_time: u64,
    pub max_responses: u32, // 0 = unlimited
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
    // Global list of survey IDs
    IdList,
    // Total surveys ever created
    TotalCount,
    // Survey data by ID
    Survey(Symbol),
    // Whether an address has responded to a survey
    Response(Symbol, Address),
    // Whitelist: only these addresses may respond (if set)
    Whitelist(Symbol),
    // Whether a whitelist is enabled for a survey
    WhitelistEnabled(Symbol),
}

// ─── Errors ─────────────────────────────────────────────────────────────────

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
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct SurveyBuilderContract;

#[contractimpl]
impl SurveyBuilderContract {

    // ── Internal helpers ────────────────────────────────────────────────────

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

    fn assert_creator(survey: &Survey, caller: &Address) {
        if &survey.creator != caller {
            panic!("not authorized");
        }
    }

    // ── Survey lifecycle ────────────────────────────────────────────────────

    /// Create a new survey.
    ///
    /// - `id`             – unique on-chain identifier (Symbol)
    /// - `creator`        – owning address; must sign the transaction
    /// - `title`          – non-empty human-readable title
    /// - `description`    – free-text description
    /// - `question_count` – number of questions (informational; answers stored off-chain)
    /// - `end_time`       – UNIX timestamp after which responses are rejected
    /// - `max_responses`  – response cap (0 = unlimited)
    pub fn create_survey(
        env: Env,
        id: Symbol,
        creator: Address,
        title: String,
        description: String,
        question_count: u32,
        end_time: u64,
        max_responses: u32,
    ) {
        creator.require_auth();

        if title.len() == 0 {
            panic_with_error!(&env, ContractError::InvalidTitle);
        }

        let now = env.ledger().timestamp();
        if end_time <= now {
            panic_with_error!(&env, ContractError::InvalidEndTime);
        }

        let key = DataKey::Survey(id.clone());
        if env.storage().instance().has(&key) {
            panic_with_error!(&env, ContractError::AlreadyExists);
        }

        let survey = Survey {
            id: id.clone(),
            creator,
            title,
            description,
            question_count,
            response_count: 0,
            status: SurveyStatus::Active,
            created_at: now,
            end_time,
            max_responses,
        };

        env.storage().instance().set(&key, &survey);

        let mut ids = Self::load_ids(&env);
        ids.push_back(id);
        Self::save_ids(&env, &ids);

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCount, &(count + 1));
    }

    /// Temporarily pause a survey (creator only). Responses are blocked while paused.
    pub fn pause_survey(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_creator(&survey, &creator);

        if survey.status != SurveyStatus::Active {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }

        survey.status = SurveyStatus::Paused;
        Self::save_survey(&env, &survey);
    }

    /// Resume a previously paused survey (creator only).
    pub fn resume_survey(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_creator(&survey, &creator);

        if survey.status != SurveyStatus::Paused {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }

        survey.status = SurveyStatus::Active;
        Self::save_survey(&env, &survey);
    }

    /// Permanently close a survey (creator only). Cannot be re-opened.
    pub fn close_survey(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_creator(&survey, &creator);

        survey.status = SurveyStatus::Closed;
        Self::save_survey(&env, &survey);
    }

    /// Extend the end time of an active or paused survey (creator only).
    /// New end time must be strictly later than the current one.
    pub fn extend_survey(env: Env, id: Symbol, creator: Address, new_end_time: u64) {
        creator.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_creator(&survey, &creator);

        if survey.status == SurveyStatus::Closed {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }
        if new_end_time <= survey.end_time {
            panic_with_error!(&env, ContractError::InvalidEndTime);
        }

        survey.end_time = new_end_time;
        Self::save_survey(&env, &survey);
    }

    // ── Whitelist management ─────────────────────────────────────────────────

    /// Enable a whitelist for a survey. Only whitelisted addresses can respond.
    /// Call `add_to_whitelist` afterwards to populate it.
    pub fn enable_whitelist(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_creator(&survey, &creator);
        env.storage()
            .instance()
            .set(&DataKey::WhitelistEnabled(id), &true);
    }

    /// Add addresses to a survey's whitelist (creator only).
    pub fn add_to_whitelist(env: Env, id: Symbol, creator: Address, addresses: Vec<Address>) {
        creator.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_creator(&survey, &creator);

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

    // ── Response submission ──────────────────────────────────────────────────

    /// Submit a response to a survey.
    ///
    /// `answers` is an opaque string — encode your answers however suits your
    /// frontend (JSON, CSV, base64, etc.). The contract records participation
    /// on-chain; answer data lives off-chain or in a separate storage layer.
    pub fn submit_response(
        env: Env,
        survey_id: Symbol,
        respondent: Address,
        answers: String,
    ) {
        respondent.require_auth();
        let _ = answers; // stored off-chain; tracked on-chain via the Response key

        let mut survey = Self::load_survey(&env, &survey_id);

        // Status check
        if survey.status != SurveyStatus::Active {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }

        // Expiry check
        let now = env.ledger().timestamp();
        if now > survey.end_time {
            panic_with_error!(&env, ContractError::SurveyExpired);
        }

        // Response cap check
        if survey.max_responses > 0 && survey.response_count >= survey.max_responses {
            panic_with_error!(&env, ContractError::ResponseLimitHit);
        }

        // Duplicate response check
        let resp_key = DataKey::Response(survey_id.clone(), respondent.clone());
        if env.storage().instance().has(&resp_key) {
            panic_with_error!(&env, ContractError::AlreadyResponded);
        }

        // Whitelist check
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

        // Record response
        env.storage().instance().set(&resp_key, &true);
        survey.response_count += 1;

        // Auto-close when cap is reached
        if survey.max_responses > 0 && survey.response_count >= survey.max_responses {
            survey.status = SurveyStatus::Closed;
        }

        Self::save_survey(&env, &survey);
    }

    // ── Read-only queries ────────────────────────────────────────────────────

    /// Fetch full survey data. Returns `None` if the ID doesn't exist.
    pub fn get_survey(env: Env, id: Symbol) -> Option<Survey> {
        env.storage().instance().get(&DataKey::Survey(id))
    }

    /// Return all survey IDs registered on-chain (insertion order).
    pub fn list_surveys(env: Env) -> Vec<Symbol> {
        Self::load_ids(&env)
    }

    /// Total number of surveys ever created (never decrements).
    pub fn get_total_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalCount)
            .unwrap_or(0)
    }

    /// Current response count for a survey. Returns 0 if not found.
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

    /// Check whether a specific address has already responded.
    pub fn has_responded(env: Env, survey_id: Symbol, respondent: Address) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::Response(survey_id, respondent))
    }

    /// Check whether a survey is still accepting responses right now.
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
}