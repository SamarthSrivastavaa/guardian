// Copyright (c) Guardian. SPDX-License-Identifier: Apache-2.0

/// Guardian registry + white-knight float vault. The shared `GuardianRegistry` tracks
/// aggregate protection stats for the dashboard; `GuardianVault` holds the repay-side float the
/// white-knight path spends to self-liquidate a user's position (capturing the liquidation
/// reward for the user instead of a MEV bot). MVP: admin-funded; flash-loan float is a stretch.
module guardian::registry;

use sui::bag::{Self, Bag};
use sui::balance::{Self, Balance};
use sui::coin::Coin;
use sui::event;

const ENotEnoughFloat: u64 = 1;

public struct GuardianAdminCap has key, store { id: UID }

/// Aggregate stats power the live demo metrics panel and the ecosystem dashboard.
public struct GuardianRegistry has key {
    id: UID,
    total_protections: u64, // execute_protection calls that reduced risk
    total_rescues: u64, // white-knight self-liquidations
    debt_repaid_cumulative: u64, // summed debt repaid across protections (debt-asset units, mixed)
    rewards_returned_cumulative: u64, // liquidation reward value returned to users via white-knight
}

/// Repay-side float for white-knight self-liquidation, keyed by coin type (Bag of Balances).
public struct GuardianVault has key {
    id: UID,
    funds: Bag,
}

public struct VaultFunded has copy, drop { amount: u64 }
public struct StatsUpdated has copy, drop { total_protections: u64, total_rescues: u64 }

fun init(ctx: &mut TxContext) {
    transfer::share_object(GuardianRegistry {
        id: object::new(ctx),
        total_protections: 0,
        total_rescues: 0,
        debt_repaid_cumulative: 0,
        rewards_returned_cumulative: 0,
    });
    transfer::share_object(GuardianVault { id: object::new(ctx), funds: bag::new(ctx) });
    transfer::public_transfer(GuardianAdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Vault ===
public struct BalanceKey<phantom T>() has copy, drop, store;

/// Fund the white-knight float (anyone may contribute; MVP funds it from an admin wallet).
public fun fund_vault<T>(self: &mut GuardianVault, coin: Coin<T>) {
    let bal = coin.into_balance();
    event::emit(VaultFunded { amount: bal.value() });
    let key = BalanceKey<T>();
    if (self.funds.contains(key)) {
        let v: &mut Balance<T> = &mut self.funds[key];
        v.join(bal);
    } else {
        self.funds.add(key, bal);
    };
}

public fun vault_balance<T>(self: &GuardianVault): u64 {
    let key = BalanceKey<T>();
    if (self.funds.contains(key)) { let v: &Balance<T> = &self.funds[key]; v.value() } else { 0 }
}

/// Withdraw repay float for a white-knight liquidation. Package-only: executor spends it.
public(package) fun take_float<T>(self: &mut GuardianVault, amount: u64): Balance<T> {
    let key = BalanceKey<T>();
    assert!(self.funds.contains(key), ENotEnoughFloat);
    let v: &mut Balance<T> = &mut self.funds[key];
    assert!(v.value() >= amount, ENotEnoughFloat);
    v.split(amount)
}

/// Return unspent float (e.g. liquidation change) to the vault. Package-only.
public(package) fun return_float<T>(self: &mut GuardianVault, bal: Balance<T>) {
    if (bal.value() == 0) { bal.destroy_zero(); return };
    let key = BalanceKey<T>();
    if (self.funds.contains(key)) { let v: &mut Balance<T> = &mut self.funds[key]; v.join(bal); }
    else { self.funds.add(key, bal); };
}

// === Stats (executor-only) ===
public(package) fun record_protection(self: &mut GuardianRegistry, debt_repaid: u64) {
    self.total_protections = self.total_protections + 1;
    self.debt_repaid_cumulative = self.debt_repaid_cumulative + debt_repaid;
    event::emit(StatsUpdated { total_protections: self.total_protections, total_rescues: self.total_rescues });
}

public(package) fun record_rescue(self: &mut GuardianRegistry, reward_returned: u64) {
    self.total_rescues = self.total_rescues + 1;
    self.rewards_returned_cumulative = self.rewards_returned_cumulative + reward_returned;
    event::emit(StatsUpdated { total_protections: self.total_protections, total_rescues: self.total_rescues });
}

// === Getters ===
public fun total_protections(self: &GuardianRegistry): u64 { self.total_protections }
public fun total_rescues(self: &GuardianRegistry): u64 { self.total_rescues }
public fun debt_repaid_cumulative(self: &GuardianRegistry): u64 { self.debt_repaid_cumulative }
public fun rewards_returned_cumulative(self: &GuardianRegistry): u64 { self.rewards_returned_cumulative }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
