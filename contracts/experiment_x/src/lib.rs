#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env, String};

const DAY_IN_SECONDS: u64 = 86_400;
const STATUS_ACTIVE: u32 = 0;
const STATUS_SUCCEEDED: u32 = 1;
const STATUS_FAILED: u32 = 2;

pub const MIN_TITLE_LENGTH: u32 = 3;
pub const MAX_TITLE_LENGTH: u32 = 48;
pub const ALLOWED_DURATIONS: [u32; 3] = [7, 14, 30];

#[derive(Clone)]
#[contracttype]
pub struct ExperimenterProfile {
    pub display_name: String,
    pub created_at: u64,
    pub experiment_count: u32,
    pub active_experiment_count: u32,
    pub completed_experiment_count: u32,
    pub successful_experiment_count: u32,
    pub failed_experiment_count: u32,
    pub total_check_ins: u32,
    pub current_streak: u32,
    pub last_compliance_day: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct Experiment {
    pub id: u32,
    pub title: String,
    pub duration_days: u32,
    pub start_day: u64,
    pub last_check_in_day: u64,
    pub compliant_days: u32,
    pub missed_days: u32,
    pub check_in_count: u32,
    pub status: u32,
    pub completed_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct Dashboard {
    pub display_name: String,
    pub active_experiments: u32,
    pub completed_experiments: u32,
    pub successful_experiments: u32,
    pub failed_experiments: u32,
    pub total_experiments: u32,
    pub total_check_ins: u32,
    pub current_streak: u32,
    pub created_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct GlobalStats {
    pub experimenter_count: u32,
    pub total_experiments: u32,
    pub active_experiments: u32,
    pub completed_experiments: u32,
    pub successful_experiments: u32,
    pub failed_experiments: u32,
    pub total_check_ins: u32,
    pub latest_activity_at: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct ProfileSaved {
    #[topic]
    pub experimenter: Address,
    pub display_name: String,
}

#[contractevent]
#[derive(Clone)]
pub struct ExperimentCreated {
    #[topic]
    pub experimenter: Address,
    #[topic]
    pub experiment_id: u32,
    pub title: String,
    pub duration_days: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct ComplianceLogged {
    #[topic]
    pub experimenter: Address,
    #[topic]
    pub experiment_id: u32,
    pub compliant: u32,
    pub day_number: u32,
    pub current_streak: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct ExperimentSucceeded {
    #[topic]
    pub experimenter: Address,
    #[topic]
    pub experiment_id: u32,
    pub title: String,
    pub duration_days: u32,
    pub compliant_days: u32,
    pub missed_days: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct ExperimentFailed {
    #[topic]
    pub experimenter: Address,
    #[topic]
    pub experiment_id: u32,
    pub title: String,
    pub duration_days: u32,
    pub compliant_days: u32,
    pub missed_days: u32,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Profile(Address),
    Experiment(Address, u32),
    RegisteredExperimenter(Address),
    GlobalStats,
}

#[contract]
pub struct ExperimentX;

#[contractimpl]
impl ExperimentX {
    pub fn save_profile(env: Env, experimenter: Address, display_name: String) {
        experimenter.require_auth();
        validate_display_name(&display_name);

        let now = env.ledger().timestamp();
        let is_new_profile = !env
            .storage()
            .persistent()
            .has(&DataKey::RegisteredExperimenter(experimenter.clone()));

        let mut profile = read_profile_optional(&env, &experimenter).unwrap_or(ExperimenterProfile {
            display_name: display_name.clone(),
            created_at: now,
            experiment_count: 0,
            active_experiment_count: 0,
            completed_experiment_count: 0,
            successful_experiment_count: 0,
            failed_experiment_count: 0,
            total_check_ins: 0,
            current_streak: 0,
            last_compliance_day: 0,
        });

        profile.display_name = display_name.clone();
        write_profile(&env, &experimenter, &profile);

        if is_new_profile {
            register_experimenter(&env, &experimenter, now);
        }

        ProfileSaved {
            experimenter,
            display_name,
        }
        .publish(&env);
    }

    pub fn create_experiment(env: Env, experimenter: Address, title: String, duration_days: u32) {
        experimenter.require_auth();
        validate_title(&title);
        validate_duration(duration_days);

        let mut profile = read_profile_required(&env, &experimenter);
        settle_overdue_experiments(&env, &experimenter, &mut profile);

        let experiment_id = profile.experiment_count;
        let experiment = Experiment {
            id: experiment_id,
            title: title.clone(),
            duration_days,
            start_day: current_day(&env),
            last_check_in_day: 0,
            compliant_days: 0,
            missed_days: 0,
            check_in_count: 0,
            status: STATUS_ACTIVE,
            completed_at: 0,
        };

        write_experiment(&env, &experimenter, experiment_id, &experiment);
        profile.experiment_count += 1;
        profile.active_experiment_count += 1;
        write_profile(&env, &experimenter, &profile);
        record_experiment_created(&env, env.ledger().timestamp());

        ExperimentCreated {
            experimenter,
            experiment_id,
            title,
            duration_days,
        }
        .publish(&env);
    }

    pub fn log_compliance(env: Env, experimenter: Address, experiment_id: u32, compliant: u32) {
        experimenter.require_auth();
        validate_compliance_flag(compliant);
        let is_compliant = compliant == 1;

        let mut profile = read_profile_required(&env, &experimenter);
        let timestamp = env.ledger().timestamp();
        let mut experiment = read_experiment_required(&env, &experimenter, experiment_id);
        let ledger_day = current_day(&env);
        let current_day = if ledger_day < experiment.start_day {
            experiment.start_day
        } else {
            ledger_day
        };

        assert!(is_active(experiment.status), "Experiment already resolved");
        let end_day = experiment_end_day(&experiment);
        assert!(current_day <= end_day, "Experiment already finished");
        assert!(
            !(experiment.check_in_count > 0 && experiment.last_check_in_day == current_day),
            "Daily compliance already logged"
        );

        let streak_after_log = if is_compliant {
            advance_compliance_streak(&mut profile, current_day)
        } else {
            displayed_streak(&profile, current_day)
        };

        let day_number = (current_day - experiment.start_day + 1) as u32;
        if is_compliant {
            experiment.compliant_days += 1;
        } else {
            experiment.missed_days += 1;
        }
        experiment.check_in_count += 1;
        experiment.last_check_in_day = current_day;

        profile.total_check_ins += 1;

        ComplianceLogged {
            experimenter: experimenter.clone(),
            experiment_id,
            compliant,
            day_number,
            current_streak: streak_after_log,
        }
        .publish(&env);

        write_experiment(&env, &experimenter, experiment_id, &experiment);
        write_profile(&env, &experimenter, &profile);
        record_check_in(&env, timestamp);
    }

    pub fn finalize_experiment(env: Env, experimenter: Address, experiment_id: u32) {
        experimenter.require_auth();

        let mut profile = read_profile_required(&env, &experimenter);
        let mut experiment = read_experiment_required(&env, &experimenter, experiment_id);
        assert!(is_active(experiment.status), "Experiment already resolved");

        let today = current_day(&env);
        sync_experiment_progress(&mut experiment, today);
        assert!(today > experiment_end_day(&experiment), "Experiment still active");

        finalize_experiment_state(
            &env,
            &experimenter,
            &mut profile,
            &mut experiment,
            env.ledger().timestamp(),
        );

        write_experiment(&env, &experimenter, experiment_id, &experiment);
        write_profile(&env, &experimenter, &profile);
    }

    pub fn has_profile(env: Env, experimenter: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Profile(experimenter))
    }

    pub fn get_dashboard(env: Env, experimenter: Address) -> Dashboard {
        let profile = read_profile_required(&env, &experimenter);
        let display_name = profile.display_name.clone();

        Dashboard {
            display_name,
            active_experiments: profile.active_experiment_count,
            completed_experiments: profile.completed_experiment_count,
            successful_experiments: profile.successful_experiment_count,
            failed_experiments: profile.failed_experiment_count,
            total_experiments: profile.experiment_count,
            total_check_ins: profile.total_check_ins,
            current_streak: displayed_streak(&profile, current_day(&env)),
            created_at: profile.created_at,
        }
    }

    pub fn get_experiment_count(env: Env, experimenter: Address) -> u32 {
        read_profile_optional(&env, &experimenter)
            .map(|profile| profile.experiment_count)
            .unwrap_or(0)
    }

    pub fn get_experiment(env: Env, experimenter: Address, index: u32) -> Experiment {
        let count = Self::get_experiment_count(env.clone(), experimenter.clone());
        assert!(index < count, "Experiment index out of bounds");

        read_experiment_required(&env, &experimenter, index)
    }

    pub fn get_log_count(env: Env, experimenter: Address) -> u32 {
        let _ = env;
        let _ = experimenter;
        0
    }

    pub fn get_log(env: Env, experimenter: Address, index: u32) -> u32 {
        let _ = env;
        let _ = experimenter;
        let _ = index;
        panic!("Recent logs now come from contract events")
    }

    pub fn get_global_stats(env: Env) -> GlobalStats {
        read_global_stats(&env)
    }
}

fn read_profile_optional(env: &Env, experimenter: &Address) -> Option<ExperimenterProfile> {
    env.storage()
        .persistent()
        .get(&DataKey::Profile(experimenter.clone()))
}

fn read_profile_required(env: &Env, experimenter: &Address) -> ExperimenterProfile {
    read_profile_optional(env, experimenter).unwrap_or_else(|| panic!("Profile not found"))
}

fn write_profile(env: &Env, experimenter: &Address, profile: &ExperimenterProfile) {
    env.storage()
        .persistent()
        .set(&DataKey::Profile(experimenter.clone()), profile);
}

fn read_experiment_required(env: &Env, experimenter: &Address, experiment_id: u32) -> Experiment {
    env.storage()
        .persistent()
        .get(&DataKey::Experiment(experimenter.clone(), experiment_id))
        .unwrap_or_else(|| panic!("Experiment not found"))
}

fn write_experiment(env: &Env, experimenter: &Address, experiment_id: u32, experiment: &Experiment) {
    env.storage()
        .persistent()
        .set(&DataKey::Experiment(experimenter.clone(), experiment_id), experiment);
}

fn default_global_stats() -> GlobalStats {
    GlobalStats {
        experimenter_count: 0,
        total_experiments: 0,
        active_experiments: 0,
        completed_experiments: 0,
        successful_experiments: 0,
        failed_experiments: 0,
        total_check_ins: 0,
        latest_activity_at: 0,
    }
}

fn read_global_stats(env: &Env) -> GlobalStats {
    env.storage()
        .persistent()
        .get(&DataKey::GlobalStats)
        .unwrap_or_else(default_global_stats)
}

fn write_global_stats(env: &Env, stats: &GlobalStats) {
    env.storage().persistent().set(&DataKey::GlobalStats, stats);
}

fn register_experimenter(env: &Env, experimenter: &Address, created_at: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::RegisteredExperimenter(experimenter.clone()), &true);

    let mut stats = read_global_stats(env);
    stats.experimenter_count += 1;
    stats.latest_activity_at = created_at;
    write_global_stats(env, &stats);
}

fn record_experiment_created(env: &Env, timestamp: u64) {
    let mut stats = read_global_stats(env);
    stats.total_experiments += 1;
    stats.active_experiments += 1;
    stats.latest_activity_at = timestamp;
    write_global_stats(env, &stats);
}

fn record_check_in(env: &Env, timestamp: u64) {
    let mut stats = read_global_stats(env);
    stats.total_check_ins += 1;
    stats.latest_activity_at = timestamp;
    write_global_stats(env, &stats);
}

fn settle_overdue_experiments(env: &Env, experimenter: &Address, profile: &mut ExperimenterProfile) {
    let today = current_day(env);
    let timestamp = env.ledger().timestamp();

    for experiment_id in 0..profile.experiment_count {
        let mut experiment = read_experiment_required(env, experimenter, experiment_id);
        if !is_active(experiment.status) {
            continue;
        }

        sync_experiment_progress(&mut experiment, today);
        if today > experiment_end_day(&experiment) {
            finalize_experiment_state(env, experimenter, profile, &mut experiment, timestamp);
        }

        write_experiment(env, experimenter, experiment_id, &experiment);
    }

    write_profile(env, experimenter, profile);
}

fn finalize_experiment_state(
    env: &Env,
    experimenter: &Address,
    profile: &mut ExperimenterProfile,
    experiment: &mut Experiment,
    timestamp: u64,
) {
    assert!(is_active(experiment.status), "Experiment already resolved");

    let successful = is_successful(experiment);
    experiment.status = if successful {
        STATUS_SUCCEEDED
    } else {
        STATUS_FAILED
    };
    experiment.completed_at = timestamp;

    if profile.active_experiment_count > 0 {
        profile.active_experiment_count -= 1;
    }
    profile.completed_experiment_count += 1;
    if successful {
        profile.successful_experiment_count += 1;
    } else {
        profile.failed_experiment_count += 1;
    }

    let mut stats = read_global_stats(env);
    if stats.active_experiments > 0 {
        stats.active_experiments -= 1;
    }
    stats.completed_experiments += 1;
    if successful {
        stats.successful_experiments += 1;
    } else {
        stats.failed_experiments += 1;
    }
    stats.latest_activity_at = timestamp;
    write_global_stats(env, &stats);

    if successful {
        ExperimentSucceeded {
            experimenter: experimenter.clone(),
            experiment_id: experiment.id,
            title: experiment.title.clone(),
            duration_days: experiment.duration_days,
            compliant_days: experiment.compliant_days,
            missed_days: experiment.missed_days,
        }
        .publish(env);
    } else {
        ExperimentFailed {
            experimenter: experimenter.clone(),
            experiment_id: experiment.id,
            title: experiment.title.clone(),
            duration_days: experiment.duration_days,
            compliant_days: experiment.compliant_days,
            missed_days: experiment.missed_days,
        }
        .publish(env);
    }
}

fn is_successful(experiment: &Experiment) -> bool {
    experiment.compliant_days * 100 >= experiment.duration_days * 80
}

fn is_active(status: u32) -> bool {
    status == STATUS_ACTIVE
}

fn experiment_end_day(experiment: &Experiment) -> u64 {
    experiment.start_day + u64::from(experiment.duration_days) - 1
}

fn next_untracked_day(experiment: &Experiment) -> u64 {
    if experiment.check_in_count == 0 {
        experiment.start_day
    } else {
        experiment.last_check_in_day + 1
    }
}

fn sync_experiment_progress(experiment: &mut Experiment, today: u64) {
    if !is_active(experiment.status) {
        return;
    }

    let first_untracked_day = next_untracked_day(experiment);
    if first_untracked_day >= today {
        return;
    }

    let end_day = experiment_end_day(experiment);
    let missed_until = if today - 1 < end_day { today - 1 } else { end_day };
    if missed_until < first_untracked_day {
        return;
    }

    experiment.missed_days += (missed_until - first_untracked_day + 1) as u32;
}

fn advance_compliance_streak(profile: &mut ExperimenterProfile, today: u64) -> u32 {
    if profile.total_check_ins == 0 || profile.current_streak == 0 {
        profile.current_streak = 1;
    } else if today == profile.last_compliance_day {
    } else if today == profile.last_compliance_day + 1 {
        profile.current_streak += 1;
    } else {
        profile.current_streak = 1;
    }

    profile.last_compliance_day = today;
    profile.current_streak
}

fn displayed_streak(profile: &ExperimenterProfile, today: u64) -> u32 {
    if profile.current_streak == 0 {
        return 0;
    }

    if today > profile.last_compliance_day + 1 {
        0
    } else {
        profile.current_streak
    }
}

fn validate_compliance_flag(compliant: u32) {
    assert!(compliant <= 1, "Compliance flag must be 0 or 1");
}

fn current_day(env: &Env) -> u64 {
    env.ledger().timestamp() / DAY_IN_SECONDS
}

fn validate_display_name(display_name: &String) {
    let length = display_name.len();
    assert!(
        length >= 3 && length <= 32,
        "Display name must be 3-32 chars"
    );
}

fn validate_title(title: &String) {
    let length = title.len();
    assert!(
        length >= MIN_TITLE_LENGTH && length <= MAX_TITLE_LENGTH,
        "Experiment title must be 3-48 chars"
    );
}

fn validate_duration(duration_days: u32) {
    assert!(
        ALLOWED_DURATIONS.contains(&duration_days),
        "Duration must be 7, 14, or 30 days"
    );
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger},
        Address, Env, Event,
    };

    fn setup() -> (Env, ExperimentXClient<'static>, Address, Address) {
        let env = Env::default();
        let contract_id = env.register(ExperimentX, ());
        let client = ExperimentXClient::new(&env, &contract_id);
        let experimenter = Address::generate(&env);
        env.mock_all_auths();
        (env, client, experimenter, contract_id)
    }

    fn text(env: &Env, value: &str) -> String {
        String::from_str(env, value)
    }

    #[test]
    fn creates_profile_and_reads_dashboard() {
        let (env, client, experimenter, _) = setup();

        client.save_profile(&experimenter, &text(&env, "Ritual Builder"));
        let dashboard = client.get_dashboard(&experimenter);

        assert_eq!(dashboard.display_name, text(&env, "Ritual Builder"));
        assert_eq!(dashboard.total_experiments, 0);
        assert_eq!(dashboard.current_streak, 0);
    }

    #[test]
    fn creates_experiment_and_reads_dashboard() {
        let (env, client, experimenter, _) = setup();

        client.save_profile(&experimenter, &text(&env, "Habit Pilot"));
        client.create_experiment(&experimenter, &text(&env, "No Social Media"), &14);

        let dashboard = client.get_dashboard(&experimenter);
        let experiment = client.get_experiment(&experimenter, &0);

        assert_eq!(dashboard.active_experiments, 1);
        assert_eq!(dashboard.total_experiments, 1);
        assert_eq!(experiment.title, text(&env, "No Social Media"));
        assert_eq!(experiment.duration_days, 14);
        assert_eq!(experiment.status, STATUS_ACTIVE);
    }

    #[test]
    fn logs_first_check_in_when_ledger_day_matches_or_lags_start_day() {
        let (env, client, experimenter, _) = setup();
        env.ledger().set_timestamp(1_776_902_400);

        client.save_profile(&experimenter, &text(&env, "Boundary Guard"));
        client.create_experiment(&experimenter, &text(&env, "No Sugar"), &7);
        client.log_compliance(&experimenter, &0, &1);

        let dashboard = client.get_dashboard(&experimenter);
        assert_eq!(dashboard.total_check_ins, 1);
    }

    #[test]
    fn logs_compliance_and_grows_streak_across_days() {
        let (env, client, experimenter, _) = setup();

        client.save_profile(&experimenter, &text(&env, "Signal Keeper"));
        client.create_experiment(&experimenter, &text(&env, "5AM Wake-Up"), &7);
        client.log_compliance(&experimenter, &0, &1);

        env.ledger().set_timestamp(DAY_IN_SECONDS + 90);
        client.log_compliance(&experimenter, &0, &1);

        let dashboard = client.get_dashboard(&experimenter);

        assert_eq!(dashboard.total_check_ins, 2);
        assert_eq!(dashboard.current_streak, 2);
    }

    #[test]
    fn finalizes_overdue_experiment_and_records_failure() {
        let (env, client, experimenter, _) = setup();

        client.save_profile(&experimenter, &text(&env, "Outcome Analyst"));
        client.create_experiment(&experimenter, &text(&env, "No Sugar"), &7);
        client.log_compliance(&experimenter, &0, &1);

        env.ledger().set_timestamp((DAY_IN_SECONDS * 8) + 5);
        client.finalize_experiment(&experimenter, &0);

        let dashboard = client.get_dashboard(&experimenter);
        let experiment = client.get_experiment(&experimenter, &0);

        assert_eq!(dashboard.active_experiments, 0);
        assert_eq!(dashboard.completed_experiments, 1);
        assert_eq!(dashboard.failed_experiments, 1);
        assert_eq!(experiment.status, STATUS_FAILED);
        assert_eq!(experiment.missed_days, 6);
    }

    #[test]
    fn tracks_global_stats_across_profiles_experiments_and_logs() {
        let (env, client, experimenter_one, _) = setup();
        let experimenter_two = Address::generate(&env);
        env.ledger().set_timestamp(1_000);

        client.save_profile(&experimenter_one, &text(&env, "Builder One"));
        client.save_profile(&experimenter_two, &text(&env, "Builder Two"));
        client.create_experiment(&experimenter_one, &text(&env, "Reading Habit"), &7);
        client.create_experiment(&experimenter_two, &text(&env, "Morning Walk"), &30);
        client.log_compliance(&experimenter_one, &0, &1);
        client.log_compliance(&experimenter_two, &0, &0);

        let stats = client.get_global_stats();

        assert_eq!(stats.experimenter_count, 2);
        assert_eq!(stats.total_experiments, 2);
        assert_eq!(stats.active_experiments, 2);
        assert_eq!(stats.total_check_ins, 2);
        assert!(stats.latest_activity_at > 0);
    }

    #[test]
    #[should_panic(expected = "Profile not found")]
    fn rejects_missing_profile_experiment_creation() {
        let (env, client, experimenter, _) = setup();
        client.create_experiment(&experimenter, &text(&env, "Cold Showers"), &7);
    }

    #[test]
    #[should_panic(expected = "Display name must be 3-32 chars")]
    fn rejects_short_display_names() {
        let (env, client, experimenter, _) = setup();
        client.save_profile(&experimenter, &text(&env, "AB"));
    }

    #[test]
    #[should_panic(expected = "Experiment title must be 3-48 chars")]
    fn rejects_short_experiment_titles() {
        let (env, client, experimenter, _) = setup();
        client.save_profile(&experimenter, &text(&env, "Title Guard"));
        client.create_experiment(&experimenter, &text(&env, "Hi"), &7);
    }

    #[test]
    #[should_panic(expected = "Duration must be 7, 14, or 30 days")]
    fn rejects_invalid_experiment_durations() {
        let (env, client, experimenter, _) = setup();
        client.save_profile(&experimenter, &text(&env, "Duration Guard"));
        client.create_experiment(&experimenter, &text(&env, "No Social Media"), &10);
    }

    #[test]
    #[should_panic(expected = "Daily compliance already logged")]
    fn rejects_duplicate_daily_check_ins() {
        let (env, client, experimenter, _) = setup();

        client.save_profile(&experimenter, &text(&env, "Routine Watch"));
        client.create_experiment(&experimenter, &text(&env, "Morning Walk"), &7);
        client.log_compliance(&experimenter, &0, &1);
        client.log_compliance(&experimenter, &0, &0);
    }

    #[test]
    fn emits_result_event_once_when_experiment_concludes() {
        let (env, client, experimenter, contract_id) = setup();
        let title = text(&env, "5AM Wake-Up");

        client.save_profile(&experimenter, &text(&env, "Event Watcher"));
        client.create_experiment(&experimenter, &title, &7);

        for day in 0..7u64 {
            env.ledger().set_timestamp((day * DAY_IN_SECONDS) + 15);
            client.log_compliance(&experimenter, &0, &1);
        }

        env.ledger().set_timestamp((8 * DAY_IN_SECONDS) + 15);
        client.finalize_experiment(&experimenter, &0);

        let expected_event = ExperimentSucceeded {
            experimenter: experimenter.clone(),
            experiment_id: 0,
            title,
            duration_days: 7,
            compliant_days: 7,
            missed_days: 0,
        }
        .to_xdr(&env, &contract_id);

        let contract_events = env.events().all().filter_by_contract(&contract_id);
        let matching_events = contract_events
            .events()
            .iter()
            .filter(|event| **event == expected_event)
            .count();

        assert_eq!(matching_events, 1);
        assert_eq!(client.get_experiment(&experimenter, &0).status, STATUS_SUCCEEDED);
    }
}
