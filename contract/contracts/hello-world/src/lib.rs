#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error,
    token, Address, Env, String, Symbol, Vec,
};

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

    fn assert_creator(env: &Env, survey: &Survey, caller: &Address) {
        if &survey.creator != caller {
            panic_with_error!(env, ContractError::NotAuthorized);
        }
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
    }

    pub fn pause_survey(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_creator(&env, &survey, &creator);

        if survey.status != SurveyStatus::Active {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }

        survey.status = SurveyStatus::Paused;
        Self::save_survey(&env, &survey);
    }

    pub fn resume_survey(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_creator(&env, &survey, &creator);

        if survey.status != SurveyStatus::Paused {
            panic_with_error!(&env, ContractError::SurveyNotActive);
        }

        survey.status = SurveyStatus::Active;
        Self::save_survey(&env, &survey);
    }

    pub fn close_survey(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_creator(&env, &survey, &creator);

        survey.status = SurveyStatus::Closed;
        Self::save_survey(&env, &survey);
    }

    pub fn extend_survey(env: Env, id: Symbol, creator: Address, new_end_time: u64) {
        creator.require_auth();
        let mut survey = Self::load_survey(&env, &id);
        Self::assert_creator(&env, &survey, &creator);

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
    /// Allowed when the survey is closed OR has passed its end time.
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

    // -- Whitelist --

    pub fn enable_whitelist(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_creator(&env, &survey, &creator);
        env.storage()
            .instance()
            .set(&DataKey::WhitelistEnabled(id), &true);
    }

    pub fn add_to_whitelist(env: Env, id: Symbol, creator: Address, addresses: Vec<Address>) {
        creator.require_auth();
        let survey = Self::load_survey(&env, &id);
        Self::assert_creator(&env, &survey, &creator);

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

        // Whitelist
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
}
