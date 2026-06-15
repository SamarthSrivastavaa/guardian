// Copyright (c) Guardian. SPDX-License-Identifier: Apache-2.0

/// Negative tests for the §9 security guards (S1, S5, S6, S7). Each attack attempt must abort
/// on a specific named code. Guards that require a live MarginManager (S2 oracle staleness, S3
/// MEV/slippage, S8 keeper liveness, S9 white-knight gate) are enforced by composition with the
/// protocol's own checks and are exercised in the deploy-time integration suite (Phase E).
#[test_only]
module guardian::guards_test;

use guardian::policy;
use guardian::executor;
use deepbook::{constants, math};

const FLOAT: u64 = 1_000_000_000;
fun id_a(): ID { object::id_from_address(@0xA) }
fun id_b(): ID { object::id_from_address(@0xB) }
fun approx(a: u64, b: u64, tol: u64): bool { if (a > b) a - b <= tol else b - a <= tol }

// Valid baseline ladder: 1.0 < trigger 1.25 < target 1.40.
fun ok_thresholds() { policy::assert_thresholds(2, 1_250_000_000, 1_400_000_000); }

// ── S7: policy bounds (param injection) ─────────────────────────────────────
#[test]
fun s7_valid_thresholds_pass() { ok_thresholds(); }

#[test, expected_failure(abort_code = policy::EInvalidTier)]
fun s7_tier_too_high_aborts() { policy::assert_thresholds(3, 1_250_000_000, 1_400_000_000); }

#[test, expected_failure(abort_code = policy::EInvalidThresholds)]
fun s7_trigger_not_above_one_aborts() { policy::assert_thresholds(2, FLOAT, 1_400_000_000); }

#[test, expected_failure(abort_code = policy::EInvalidThresholds)]
fun s7_target_below_trigger_aborts() { policy::assert_thresholds(2, 1_250_000_000, 1_200_000_000); }

// ── S1 / S5: executor execution guards ──────────────────────────────────────
// args: active, tier, policy_mgr, mgr, now, last, interval, rr, trigger
#[test]
fun execution_allowed_baseline_passes() {
    executor::assert_execution_allowed(true, 2, id_a(), id_a(), 100_000, 0, 30_000, 1_200_000_000, 1_250_000_000);
}

#[test, expected_failure(abort_code = executor::ENotAutopilot)]
fun inactive_policy_aborts() {
    executor::assert_execution_allowed(false, 2, id_a(), id_a(), 100_000, 0, 30_000, 1_200_000_000, 1_250_000_000);
}

#[test, expected_failure(abort_code = executor::ENotAutopilot)]
fun non_tier2_policy_aborts() {
    executor::assert_execution_allowed(true, 1, id_a(), id_a(), 100_000, 0, 30_000, 1_200_000_000, 1_250_000_000);
}

#[test, expected_failure(abort_code = executor::EManagerMismatch)]
fun s5_fake_policy_manager_binding_aborts() {
    executor::assert_execution_allowed(true, 2, id_a(), id_b(), 100_000, 0, 30_000, 1_200_000_000, 1_250_000_000);
}

#[test, expected_failure(abort_code = executor::ERateLimited)]
fun s1_rate_limit_aborts() {
    // now=10_000, last=0, interval=30_000 → only 10s elapsed
    executor::assert_execution_allowed(true, 2, id_a(), id_a(), 10_000, 0, 30_000, 1_200_000_000, 1_250_000_000);
}

#[test, expected_failure(abort_code = executor::ETriggerNotMet)]
fun s1_trigger_not_met_aborts() {
    // rr 1.30 >= trigger 1.25 → no action warranted
    executor::assert_execution_allowed(true, 2, id_a(), id_a(), 100_000, 0, 30_000, 1_300_000_000, 1_250_000_000);
}

// ── S6: reduce-only invariant ───────────────────────────────────────────────
#[test]
fun reduce_only_debt_decreased_passes() { executor::assert_reduce_only(1000, 800, 0); }

#[test]
fun reduce_only_orders_cancelled_passes() { executor::assert_reduce_only(1000, 1000, 3); }

#[test, expected_failure(abort_code = executor::EReduceOnlyViolated)]
fun s6_debt_increase_aborts() { executor::assert_reduce_only(1000, 1200, 0); }

#[test, expected_failure(abort_code = executor::ENoProgress)]
fun s6_no_progress_aborts() { executor::assert_reduce_only(1000, 1000, 0); }

// ── C5: white-knight float preservation (the economic invariant) ─────────────
// Each rescue: vault pays outlay = repay·(1+pool_reward) and receives collateral worth
// repay·(1+user_reward+pool_reward). owner_reward_fraction forwards the user-reward slice to the
// owner; the vault MUST retain exactly its outlay so the float is preserved across N rescues.
#[test]
fun whiteknight_float_preserved_across_n_rescues() {
    let one = constants::float_scaling();
    let user_reward = 20_000_000; // 0.02
    let pool_reward = 30_000_000; // 0.03
    let frac = executor::owner_reward_fraction(user_reward, pool_reward);

    let start_float = 1_000_000_000_000; // 1,000 units of the debt asset (6-dec scaled)
    let mut vault = start_float;
    let mut i = 0;
    while (i < 10) {
        let repay = 40_000_000 + i * 9_000_000; // vary the rescue size each iteration
        let outlay = math::mul(repay, one + pool_reward); // vault pays repay·(1+pool_reward)
        let collateral = math::mul(repay, one + user_reward + pool_reward); // worth repay·1.05
        let owner_reward = math::mul(collateral, frac); // user-reward slice → owner
        let vault_retain = collateral - owner_reward; // rest → vault

        // Owner receives exactly the user reward (repay·user_reward).
        assert!(approx(owner_reward, math::mul(repay, user_reward), 2), 100);
        // Vault is made whole: what it retains equals what it paid out.
        assert!(approx(vault_retain, outlay, 2), 101);

        vault = vault - outlay + vault_retain;
        i = i + 1;
    };
    // After 10 consecutive rescues the float is unchanged (no drain).
    assert!(approx(vault, start_float, 20), 102);
}
