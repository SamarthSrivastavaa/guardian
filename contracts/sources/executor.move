// Copyright (c) Guardian. SPDX-License-Identifier: Apache-2.0

/// Guardian executor — the only module that drives state changes on a protected manager.
///
/// `execute_protection` runs the deleverage ladder steps 1–2 (cancel open orders → repay from
/// idle) under on-chain guards that are revalidated even though the owner pre-signed the envelope
/// (§0.6): the keeper cannot fire it early. Every state-changing path ends in the REDUCE-ONLY
/// INVARIANT — debt never increases and the action made progress — and the module contains no
/// path that sends a manager's collateral to any address other than the manager owner.
///
/// `whiteknight_rescue` self-liquidates a position the instant the protocol allows it
/// (`can_liquidate`). The vault funds the liquidation (paying `repay·(1+pool_reward)`) and recovers
/// that outlay from the seized collateral; only the user-reward portion (`repay·user_reward`, ~2%)
/// is forwarded to the owner — the reward an MEV bot would have kept, captured for the user instead.
/// The vault is made whole each rescue, so the white-knight float is preserved (see test
/// `whiteknight_float_preserved_across_n_rescues`).
module guardian::executor;

use deepbook::{constants, math, pool::Pool};
use deepbook_margin::margin_manager::MarginManager;
use deepbook_margin::margin_pool::MarginPool;
use deepbook_margin::margin_registry::MarginRegistry;
use deepbook_margin::pool_proxy;
use guardian::policy::ProtectionPolicy;
use guardian::registry::{GuardianRegistry, GuardianVault};
use pyth::price_info::PriceInfoObject;
use sui::clock::Clock;
use sui::coin;
use sui::event;

// === Errors ===
const ENotAutopilot: u64 = 1; // policy inactive or not Tier 2
const EManagerMismatch: u64 = 2; // policy not bound to this manager (S5)
const ERateLimited: u64 = 3; // min_action_interval not elapsed (S1/S4)
const ETriggerNotMet: u64 = 4; // RR >= trigger_rr, no action warranted (S1)
const EReduceOnlyViolated: u64 = 5; // debt increased — must never happen
const ENoProgress: u64 = 6; // nothing to cancel and nothing repaid

const TIP_PER_ACTION_MIST: u64 = 10_000_000; // 0.01 SUI keeper tip, capped at the pot

// === Events ===
public struct ProtectionExecuted has copy, drop {
    policy_id: ID,
    margin_manager_id: ID,
    rr_before: u64,
    debt_before: u64,
    debt_after: u64,
    debt_repaid: u64,
    orders_cancelled: u64,
    keeper: address,
}

public struct WhiteKnightRescue has copy, drop {
    policy_id: ID,
    margin_manager_id: ID,
    owner: address,
    debt_before: u64,
    debt_after: u64,
    reward_to_owner_base: u64, // user-reward portion of seized collateral, forwarded to the owner
    reward_to_owner_quote: u64,
    keeper: address,
}

/// Ladder steps 1–2: cancel open orders, repay from idle. Owner-signed envelope, keeper-broadcast.
public fun execute_protection<B, Q>(
    policy: &mut ProtectionPolicy,
    manager: &mut MarginManager<B, Q>,
    pool: &mut Pool<B, Q>,
    base_margin_pool: &mut MarginPool<B>,
    quote_margin_pool: &mut MarginPool<Q>,
    margin_registry: &MarginRegistry,
    guardian_registry: &mut GuardianRegistry,
    base_oracle: &PriceInfoObject,
    quote_oracle: &PriceInfoObject,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let now = clock.timestamp_ms();
    let rr_before = manager.risk_ratio(
        margin_registry, base_oracle, quote_oracle, pool, base_margin_pool, quote_margin_pool, clock,
    );
    // ── Guards (revalidated on-chain; the keeper cannot fire this early) ──
    assert_execution_allowed(
        policy.active(), policy.tier(), policy.margin_manager_id(), manager.id(),
        now, policy.last_action_ms(), policy.min_action_interval_ms(), rr_before, policy.trigger_rr(),
    );

    let has_base = manager.has_base_debt();
    let debt_before = current_debt(manager, base_margin_pool, quote_margin_pool, has_base, clock);
    let orders_before = manager.account_open_orders(pool).length();

    // Step 1: cancel all open orders (frees locked balance into idle).
    pool_proxy::cancel_all_orders(margin_registry, manager, pool, clock, ctx);

    // Step 2: repay from idle. `none` repays min(idle, debt) — adaptive inside a static envelope.
    let debt_repaid = if (has_base) {
        manager.repay_base(margin_registry, base_margin_pool, option::none(), clock, ctx)
    } else {
        manager.repay_quote(margin_registry, quote_margin_pool, option::none(), clock, ctx)
    };

    let debt_after = current_debt(manager, base_margin_pool, quote_margin_pool, has_base, clock);

    // ── REDUCE-ONLY INVARIANT ──
    assert_reduce_only(debt_before, debt_after, orders_before);

    policy.mark_action(now);
    pay_keeper_tip(policy, ctx);
    guardian_registry.record_protection(debt_repaid);

    event::emit(ProtectionExecuted {
        policy_id: object::id(policy),
        margin_manager_id: manager.id(),
        rr_before,
        debt_before,
        debt_after,
        debt_repaid,
        orders_cancelled: orders_before,
        keeper: ctx.sender(),
    });
}

/// White-knight self-liquidation. Permissionless to *broadcast*, but `manager.liquidate` only
/// succeeds when `can_liquidate` holds (rr below the pool's liquidation threshold) — so Guardian
/// races to be the liquidator the instant it is legal and returns 100% of the seized collateral
/// to the owner. `repay_amount` is drawn from the white-knight float vault.
public fun whiteknight_rescue<B, Q, DebtAsset>(
    policy: &mut ProtectionPolicy,
    manager: &mut MarginManager<B, Q>,
    vault: &mut GuardianVault,
    guardian_registry: &mut GuardianRegistry,
    margin_pool: &mut MarginPool<DebtAsset>,
    pool: &mut Pool<B, Q>,
    margin_registry: &MarginRegistry,
    base_oracle: &PriceInfoObject,
    quote_oracle: &PriceInfoObject,
    repay_amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(policy.active(), ENotAutopilot);
    assert!(policy.margin_manager_id() == manager.id(), EManagerMismatch);

    let has_base = manager.has_base_debt();
    let (bd, qd) = manager.calculate_debts(margin_pool, clock);
    let debt_before = if (has_base) bd else qd;

    let repay_coin = vault.take_float<DebtAsset>(repay_amount).into_coin(ctx);
    // `liquidate` cancels orders, asserts can_liquidate (the real gate), repays debt, pays the
    // caller collateral worth repay·(1 + user_reward + pool_reward), and returns the unused input.
    let (mut base_coin, mut quote_coin, change) = manager.liquidate<B, Q, DebtAsset>(
        margin_registry, base_oracle, quote_oracle, margin_pool, pool, repay_coin, clock, ctx,
    );

    // Split the seized collateral: the user-reward fraction goes to the owner; the rest (= the
    // vault's `repay·(1+pool_reward)` outlay) plus the unused input returns to the vault, keeping
    // the white-knight float whole across rescues.
    let frac = owner_reward_fraction(
        margin_registry.user_liquidation_reward(pool.id()),
        margin_registry.pool_liquidation_reward(pool.id()),
    );
    let owner = policy.owner();
    let reward_to_owner_base = math::mul(base_coin.value(), frac);
    let reward_to_owner_quote = math::mul(quote_coin.value(), frac);
    let reward_base = base_coin.split(reward_to_owner_base, ctx);
    let reward_quote = quote_coin.split(reward_to_owner_quote, ctx);
    transfer::public_transfer(reward_base, owner);
    transfer::public_transfer(reward_quote, owner);
    // Vault recovers its outlay (the remaining collateral) + the unused repay input.
    vault.return_float(base_coin.into_balance());
    vault.return_float(quote_coin.into_balance());
    vault.return_float(change.into_balance());

    let shares_after = if (has_base) manager.borrowed_base_shares() else manager.borrowed_quote_shares();
    let debt_after = if (shares_after == 0) 0 else {
        let (bd2, qd2) = manager.calculate_debts(margin_pool, clock); if (has_base) bd2 else qd2
    };
    // Reduce-only invariant for the rescue path: liquidation strictly reduces debt.
    assert!(debt_after < debt_before, EReduceOnlyViolated);

    policy.mark_action(clock.timestamp_ms());
    pay_keeper_tip(policy, ctx);
    guardian_registry.record_rescue(reward_to_owner_base + reward_to_owner_quote);

    event::emit(WhiteKnightRescue {
        policy_id: object::id(policy),
        margin_manager_id: manager.id(),
        owner,
        debt_before,
        debt_after,
        reward_to_owner_base,
        reward_to_owner_quote,
        keeper: ctx.sender(),
    });
}

// === Guards (pure; single source of truth, exercised directly by the S1/S5/S6 negative tests) ===
/// All preconditions for `execute_protection`. Aborts identify the attack each guard blocks:
/// ENotAutopilot (inactive/non-Tier-2), EManagerMismatch (S5 fake policy↔manager binding),
/// ERateLimited (S1/S4 spam), ETriggerNotMet (S1 premature/needless action).
public(package) fun assert_execution_allowed(
    active: bool,
    tier: u8,
    policy_manager_id: ID,
    manager_id: ID,
    now_ms: u64,
    last_action_ms: u64,
    min_interval_ms: u64,
    rr: u64,
    trigger_rr: u64,
) {
    assert!(active && tier == 2, ENotAutopilot);
    assert!(policy_manager_id == manager_id, EManagerMismatch);
    assert!(now_ms - last_action_ms >= min_interval_ms, ERateLimited);
    assert!(rr < trigger_rr, ETriggerNotMet);
}

/// The reduce-only postcondition (S6): debt never increases, and the action made progress.
public(package) fun assert_reduce_only(debt_before: u64, debt_after: u64, orders_before: u64) {
    assert!(debt_after <= debt_before, EReduceOnlyViolated);
    assert!(debt_after < debt_before || orders_before > 0, ENoProgress);
}

/// Fraction (9-dec) of seized white-knight collateral that belongs to the owner. The liquidator
/// receives collateral worth `repay·(1+user_reward+pool_reward)` for an outlay of
/// `repay·(1+pool_reward)`; the user-reward slice = `user_reward/(1+user_reward+pool_reward)` of
/// the collateral, so retaining the rest exactly restores the vault's outlay. Single source of
/// truth for the float-preservation invariant.
public(package) fun owner_reward_fraction(user_reward: u64, pool_reward: u64): u64 {
    math::div(user_reward, constants::float_scaling() + user_reward + pool_reward)
}

// === Internal ===
/// Current debt on the active side, robust to the fully-repaid case (margin_pool_id cleared).
fun current_debt<B, Q>(
    manager: &MarginManager<B, Q>,
    base_margin_pool: &MarginPool<B>,
    quote_margin_pool: &MarginPool<Q>,
    has_base: bool,
    clock: &Clock,
): u64 {
    let shares = if (has_base) manager.borrowed_base_shares() else manager.borrowed_quote_shares();
    if (shares == 0) return 0;
    if (has_base) { let (b, _) = manager.calculate_debts(base_margin_pool, clock); b }
    else { let (_, q) = manager.calculate_debts(quote_margin_pool, clock); q }
}

/// Pay the broadcasting keeper a fixed tip from the policy's segregated tip pot (never collateral).
#[allow(lint(self_transfer))]
fun pay_keeper_tip(policy: &mut ProtectionPolicy, ctx: &mut TxContext) {
    let tip = policy.take_tip(TIP_PER_ACTION_MIST);
    if (tip.value() == 0) { tip.destroy_zero(); return };
    transfer::public_transfer(tip.into_coin(ctx), ctx.sender());
}
