// Copyright (c) Guardian. SPDX-License-Identifier: Apache-2.0

/// Negative tests for the §9 security guards (S1, S5, S6, S7). Each attack attempt must abort
/// on a specific named code. Guards that require a live MarginManager (S2 oracle staleness, S3
/// MEV/slippage, S8 keeper liveness, S9 white-knight gate) are enforced by composition with the
/// protocol's own checks and are exercised in the deploy-time integration suite (Phase E).
#[test_only]
module guardian::guards_test;

use guardian::policy;
use guardian::executor;

const FLOAT: u64 = 1_000_000_000;
fun id_a(): ID { object::id_from_address(@0xA) }
fun id_b(): ID { object::id_from_address(@0xB) }

// Valid baseline ladder: wk 1.13 < trigger 1.25 < target 1.40, slippage 50bps, tranche 25%.
fun ok_thresholds() { policy::assert_thresholds(2, 1_250_000_000, 1_400_000_000, 1_130_000_000, 50, 2_500); }

// ── S7: policy bounds (AI/param injection) ──────────────────────────────────
#[test]
fun s7_valid_thresholds_pass() { ok_thresholds(); }

#[test, expected_failure(abort_code = policy::EInvalidTier)]
fun s7_tier_too_high_aborts() { policy::assert_thresholds(3, 1_250_000_000, 1_400_000_000, 1_130_000_000, 50, 2_500); }

#[test, expected_failure(abort_code = policy::EInvalidThresholds)]
fun s7_whiteknight_below_one_aborts() { policy::assert_thresholds(2, 1_250_000_000, 1_400_000_000, FLOAT, 50, 2_500); }

#[test, expected_failure(abort_code = policy::EInvalidThresholds)]
fun s7_whiteknight_above_trigger_aborts() { policy::assert_thresholds(2, 1_250_000_000, 1_400_000_000, 1_300_000_000, 50, 2_500); }

#[test, expected_failure(abort_code = policy::EInvalidThresholds)]
fun s7_target_below_trigger_aborts() { policy::assert_thresholds(2, 1_250_000_000, 1_200_000_000, 1_130_000_000, 50, 2_500); }

#[test, expected_failure(abort_code = policy::EInvalidSlippage)]
fun s7_slippage_over_cap_aborts() { policy::assert_thresholds(2, 1_250_000_000, 1_400_000_000, 1_130_000_000, 201, 2_500); }

#[test, expected_failure(abort_code = policy::EInvalidSlippage)]
fun s7_zero_slippage_aborts() { policy::assert_thresholds(2, 1_250_000_000, 1_400_000_000, 1_130_000_000, 0, 2_500); }

#[test, expected_failure(abort_code = policy::EInvalidTranche)]
fun s7_zero_tranche_aborts() { policy::assert_thresholds(2, 1_250_000_000, 1_400_000_000, 1_130_000_000, 50, 0); }

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
