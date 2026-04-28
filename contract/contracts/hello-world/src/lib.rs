#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, String,
    Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Survey {
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub question_count: u32,
    pub response_count: u32,
    pub is_closed: bool,
    pub created_at: u64,
    pub end_time: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    IdList,
    Survey(Symbol),
    Count,
    Response(Symbol, Address),
    ResponseCount(Symbol),
}

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    NotFound = 1,
    NotAuthorized = 2,
    InvalidTitle = 3,
    SurveyClosed = 4,
    AlreadyResponded = 5,
    SurveyExpired = 6,
}

#[contract]
pub struct SurveyBuilderContract;

#[contractimpl]
impl SurveyBuilderContract {
    fn load_ids(env: &Env) -> Vec<Symbol> {
        env.storage().instance().get(&DataKey::IdList).unwrap_or(Vec::new(env))
    }

    fn save_ids(env: &Env, ids: &Vec<Symbol>) {
        env.storage().instance().set(&DataKey::IdList, ids);
    }

    fn has_id(ids: &Vec<Symbol>, id: &Symbol) -> bool {
        for current in ids.iter() {
            if current == id.clone() {
                return true;
            }
        }
        false
    }

    pub fn create_survey(
        env: Env,
        id: Symbol,
        creator: Address,
        title: String,
        description: String,
        question_count: u32,
        end_time: u64,
    ) {
        creator.require_auth();

        if title.len() == 0 {
            panic_with_error!(&env, ContractError::InvalidTitle);
        }

        let now = env.ledger().timestamp();

        let survey = Survey {
            creator,
            title,
            description,
            question_count,
            response_count: 0,
            is_closed: false,
            created_at: now,
            end_time,
        };

        let key = DataKey::Survey(id.clone());
        let exists = env.storage().instance().has(&key);
        env.storage().instance().set(&key, &survey);

        let mut ids = Self::load_ids(&env);
        if !Self::has_id(&ids, &id) {
            ids.push_back(id);
            Self::save_ids(&env, &ids);
            if !exists {
                let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
                env.storage().instance().set(&DataKey::Count, &(count + 1));
            }
        }
    }

    pub fn submit_response(
        env: Env,
        survey_id: Symbol,
        respondent: Address,
        answers: String,
    ) {
        respondent.require_auth();
        let _ = answers;

        let key = DataKey::Survey(survey_id.clone());
        let mut survey: Survey = env.storage().instance().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::NotFound));

        if survey.is_closed {
            panic_with_error!(&env, ContractError::SurveyClosed);
        }

        let now = env.ledger().timestamp();
        if now > survey.end_time {
            panic_with_error!(&env, ContractError::SurveyExpired);
        }

        let resp_key = DataKey::Response(survey_id.clone(), respondent.clone());
        if env.storage().instance().has(&resp_key) {
            panic_with_error!(&env, ContractError::AlreadyResponded);
        }

        env.storage().instance().set(&resp_key, &true);
        survey.response_count += 1;
        env.storage().instance().set(&key, &survey);
    }

    pub fn close_survey(env: Env, id: Symbol, creator: Address) {
        creator.require_auth();

        let key = DataKey::Survey(id.clone());
        let mut survey: Survey = env.storage().instance().get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::NotFound));

        if survey.creator != creator {
            panic_with_error!(&env, ContractError::NotAuthorized);
        }

        survey.is_closed = true;
        env.storage().instance().set(&key, &survey);
    }

    pub fn get_survey(env: Env, id: Symbol) -> Option<Survey> {
        env.storage().instance().get(&DataKey::Survey(id))
    }

    pub fn list_surveys(env: Env) -> Vec<Symbol> {
        Self::load_ids(&env)
    }

    pub fn get_response_count(env: Env, survey_id: Symbol) -> u32 {
        let key = DataKey::Survey(survey_id);
        let survey: Option<Survey> = env.storage().instance().get(&key);
        match survey {
            Some(s) => s.response_count,
            None => 0,
        }
    }

    pub fn has_responded(env: Env, survey_id: Symbol, respondent: Address) -> bool {
        let resp_key = DataKey::Response(survey_id, respondent);
        env.storage().instance().has(&resp_key)
    }

    pub fn get_survey_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }
}