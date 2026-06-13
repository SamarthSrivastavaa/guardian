// Copyright (c) Guardian. SPDX-License-Identifier: Apache-2.0

/// Guardian protection policies. A `ProtectionPolicy` is an owned object that authorizes
/// Guardian's executor to deleverage exactly one `MarginManager` the caller owns, under
/// on-chain trigger/rate-limit guards. Creating a policy binds it to the manager's owner and
/// id; all risk thresholds use the protocol's 9-decimal fixed-point convention (not bps).
module guardian::policy;

use deepbook_margin::margin_manager::MarginManager;
use sui::balance::{Self, Balance};
use sui::sui::SUI;
use sui::event;

// === Errors ===
const ENotManagerOwner: u64 = 1;
const EInvalidTier: u64 = 2;
/// Thresholds must satisfy whiteknight < trigger and target > trigger, all above 1.0.
const EInvalidThresholds: u64 = 3;
const EInvalidSlippage: u64 = 4;
const EInvalidTranche: u64 = 5;
const ENotPolicyOwner: u64 = 6;

// === Constants (upgrade-required safety envelope) ===
const FLOAT_SCALING: u64 = 1_000_000_000; // protocol RR fixed-point (1.0)
const MAX_SLIPPAGE_BPS: u64 = 200; // hard ceiling: a policy can never authorize >2% slippage
const MAX_TRANCHE_BPS: u64 = 10_000; // 100%
const TIER_AUTOPILOT: u8 = 2;

// === Structs ===
/// One policy authorizes deleveraging one margin manager. Thresholds are 9-dec fixed point.
public struct ProtectionPolicy has key, store {
    id: UID,
    owner: address, // == margin_manager.owner at creation
    margin_manager_id: ID,
    deepbook_pool_id: ID,
    tier: u8, // 0 alert, 1 copilot, 2 autopilot
    trigger_rr: u64, // act when RR < trigger_rr
    target_rr: u64, // ladder restores RR up to target_rr
    whiteknight_rr: u64, // self-liquidate below this (above pool liq threshold)
    max_slippage_bps: u64,
    tranche_bps: u64,
    min_action_interval_ms: u64, // rate limit between executor actions
    last_action_ms: u64,
    keeper_tip: Balance<SUI>, // user-funded, segregated from collateral (S4)
    active: bool,
}

// === Events ===
public struct PolicyCreated has copy, drop {
    policy_id: ID,
    owner: address,
    margin_manager_id: ID,
    tier: u8,
    trigger_rr: u64,
    target_rr: u64,
    whiteknight_rr: u64,
}

public struct PolicyUpdated has copy, drop { policy_id: ID, trigger_rr: u64, target_rr: u64, whiteknight_rr: u64 }
public struct PolicyRevoked has copy, drop { policy_id: ID, owner: address }

// === Public Functions ===
/// Create a policy bound to a manager the caller owns. Validates the threshold ladder and the
/// safety envelope (S5 binding, S7 bounds) before anything is shared.
public fun create<B, Q>(
    manager: &MarginManager<B, Q>,
    tier: u8,
    trigger_rr: u64,
    target_rr: u64,
    whiteknight_rr: u64,
    max_slippage_bps: u64,
    tranche_bps: u64,
    min_action_interval_ms: u64,
    tip: Balance<SUI>,
    ctx: &mut TxContext,
): ProtectionPolicy {
    assert!(ctx.sender() == manager.owner(), ENotManagerOwner);
    assert_thresholds(tier, trigger_rr, target_rr, whiteknight_rr, max_slippage_bps, tranche_bps);

    let policy = ProtectionPolicy {
        id: object::new(ctx),
        owner: manager.owner(),
        margin_manager_id: manager.id(),
        deepbook_pool_id: manager.deepbook_pool(),
        tier,
        trigger_rr,
        target_rr,
        whiteknight_rr,
        max_slippage_bps,
        tranche_bps,
        min_action_interval_ms,
        last_action_ms: 0,
        keeper_tip: tip,
        active: true,
    };
    event::emit(PolicyCreated {
        policy_id: policy.id.to_inner(),
        owner: policy.owner,
        margin_manager_id: policy.margin_manager_id,
        tier,
        trigger_rr,
        target_rr,
        whiteknight_rr,
    });
    policy
}

/// Owner-only retune of thresholds. Revalidates the full ladder + envelope.
public fun update(
    self: &mut ProtectionPolicy,
    trigger_rr: u64,
    target_rr: u64,
    whiteknight_rr: u64,
    max_slippage_bps: u64,
    tranche_bps: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == self.owner, ENotPolicyOwner);
    assert_thresholds(self.tier, trigger_rr, target_rr, whiteknight_rr, max_slippage_bps, tranche_bps);
    self.trigger_rr = trigger_rr;
    self.target_rr = target_rr;
    self.whiteknight_rr = whiteknight_rr;
    self.max_slippage_bps = max_slippage_bps;
    self.tranche_bps = tranche_bps;
    event::emit(PolicyUpdated { policy_id: self.id.to_inner(), trigger_rr, target_rr, whiteknight_rr });
}

/// Owner-only, instant, unconditional revoke. Returns the unused keeper tip to the owner.
public fun revoke(self: ProtectionPolicy, ctx: &mut TxContext): Balance<SUI> {
    assert!(ctx.sender() == self.owner, ENotPolicyOwner);
    let ProtectionPolicy { id, owner, keeper_tip, .. } = self;
    event::emit(PolicyRevoked { policy_id: id.to_inner(), owner });
    id.delete();
    keeper_tip
}

/// Top up the keeper-tip pot (anyone may fund a policy's tips).
public fun fund_tip(self: &mut ProtectionPolicy, tip: Balance<SUI>) {
    self.keeper_tip.join(tip);
}

// === Package Functions (executor-only state transitions) ===
/// Record an executor action time for rate limiting. Called only by guardian::executor.
public(package) fun mark_action(self: &mut ProtectionPolicy, now_ms: u64) {
    self.last_action_ms = now_ms;
}

/// Pay a keeper tip of at most `amount` from the segregated tip pot (never from collateral).
public(package) fun take_tip(self: &mut ProtectionPolicy, amount: u64): Balance<SUI> {
    let avail = self.keeper_tip.value();
    self.keeper_tip.split(if (amount > avail) avail else amount)
}

// === Read-only getters ===
public fun owner(self: &ProtectionPolicy): address { self.owner }
public fun margin_manager_id(self: &ProtectionPolicy): ID { self.margin_manager_id }
public fun deepbook_pool_id(self: &ProtectionPolicy): ID { self.deepbook_pool_id }
public fun tier(self: &ProtectionPolicy): u8 { self.tier }
public fun trigger_rr(self: &ProtectionPolicy): u64 { self.trigger_rr }
public fun target_rr(self: &ProtectionPolicy): u64 { self.target_rr }
public fun whiteknight_rr(self: &ProtectionPolicy): u64 { self.whiteknight_rr }
public fun max_slippage_bps(self: &ProtectionPolicy): u64 { self.max_slippage_bps }
public fun tranche_bps(self: &ProtectionPolicy): u64 { self.tranche_bps }
public fun min_action_interval_ms(self: &ProtectionPolicy): u64 { self.min_action_interval_ms }
public fun last_action_ms(self: &ProtectionPolicy): u64 { self.last_action_ms }
public fun active(self: &ProtectionPolicy): bool { self.active }
public fun tip_balance(self: &ProtectionPolicy): u64 { self.keeper_tip.value() }

// === Internal ===
/// The threshold ladder + safety envelope. Public(package) so executor/tests share one path.
public(package) fun assert_thresholds(
    tier: u8,
    trigger_rr: u64,
    target_rr: u64,
    whiteknight_rr: u64,
    max_slippage_bps: u64,
    tranche_bps: u64,
) {
    assert!(tier <= TIER_AUTOPILOT, EInvalidTier);
    // Ladder: 1.0 < whiteknight < trigger < target. wk sits just above the pool liq threshold;
    // we act (trigger) before the position is critical and aim the ladder above trigger (target).
    assert!(whiteknight_rr > FLOAT_SCALING, EInvalidThresholds);
    assert!(whiteknight_rr < trigger_rr, EInvalidThresholds);
    assert!(target_rr > trigger_rr, EInvalidThresholds);
    assert!(max_slippage_bps > 0 && max_slippage_bps <= MAX_SLIPPAGE_BPS, EInvalidSlippage);
    assert!(tranche_bps > 0 && tranche_bps <= MAX_TRANCHE_BPS, EInvalidTranche);
}

#[test_only]
public fun destroy_for_testing(self: ProtectionPolicy) {
    let ProtectionPolicy { id, keeper_tip, .. } = self;
    id.delete();
    keeper_tip.destroy_for_testing();
}
