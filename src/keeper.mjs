// Guardian keeper brain (Phase E) — wires the risk engine (C) to the executor contract (D).
//
// `decide()` is the PURE policy: given a live manager state (from reader.mjs) + an on-chain
// policy's thresholds, it returns the action the keeper should take this tick. Deterministic and
// unit-tested — no AI, no network. `buildProtectionTx`/`buildWhiteKnightTx` then construct the
// PTBs (Pyth-refreshed) that call guardian::executor. PTB construction is parameterized by the
// deployed package id (set after Phase D deploy).
import { Transaction } from '@mysten/sui/transactions';
import { guardianRiskScore } from './risk.mjs';
import { refreshPyth } from './oracle.mjs';
import { makeSuiClient, testnetPools, testnetMarginPools, testnetCoins, MARGIN_REGISTRY_ID } from './config.mjs';

export const ACTIONS = Object.freeze({
  SLEEP: 'SLEEP', // SAFE — do nothing
  NOTIFY: 'NOTIFY', // WATCH — alert + AI narration, no execution
  PROTECT: 'PROTECT', // PROTECT — run ladder steps 1-2 via execute_protection
  WHITE_KNIGHT: 'WHITE_KNIGHT', // liquidatable — self-liquidate, reward to owner
});

/**
 * Pure keeper decision. Inputs are plain numbers so this is fully unit-testable.
 * @param {object} state  reader output fields: riskRatio, debtSide, collateral, debt, markPrice,
 *                         sigmaPerHour, utilization
 * @param {object} policy on-chain policy thresholds (decimal RR): triggerRr, whiteknightRr,
 *                         rrLiq (pool liquidation threshold), maxSlippage, uKink, ratePerYear
 * @returns {{action, grs, band, riskRatio, reason}}
 */
export function decide(state, policy) {
  const { riskRatio, rrLiq = 1.10 } = state;

  // Liquidatable now → white-knight is the only value-preserving move (protocol allows liquidate).
  if (riskRatio != null && riskRatio < rrLiq) {
    return { action: ACTIONS.WHITE_KNIGHT, grs: 100, band: 'EMERGENCY', riskRatio,
      reason: `RR ${fmt(riskRatio)} < pool liquidation ${fmt(rrLiq)} — racing to liquidate for the user` };
  }

  const g = guardianRiskScore({
    side: state.debtSide,
    baseAsset: state.collateral.base, quoteAsset: state.collateral.quote,
    debt: state.debtSide === 'base' ? state.debt.base : state.debt.quote,
    rrLiq, markPrice: state.markPrice,
    sigmaPerHour: state.sigmaPerHour ?? 0, ratePerYear: policy.ratePerYear ?? 0.1,
    utilization: state.utilization ?? 0, uKink: policy.uKink ?? 0.8,
    exitSlippage: state.exitSlippage ?? 0, maxSlippage: policy.maxSlippage ?? 0.005,
  });

  // Trigger gate mirrors the on-chain executor guard: act only when RR < trigger_rr.
  const triggered = riskRatio != null && riskRatio < policy.triggerRr;

  let action;
  if (state.debtSide === 'none' || riskRatio == null) action = ACTIONS.SLEEP;
  else if (triggered) action = ACTIONS.PROTECT;
  else if (g.band === 'WATCH' || g.band === 'PROTECT' || g.band === 'EMERGENCY') action = ACTIONS.NOTIFY;
  else action = ACTIONS.SLEEP;

  return { action, grs: g.grs, band: g.band, riskRatio,
    reason: reasonFor(action, riskRatio, policy.triggerRr, g) };
}

function reasonFor(action, rr, trigger, g) {
  switch (action) {
    case ACTIONS.PROTECT: return `RR ${fmt(rr)} < trigger ${fmt(trigger)} (GRS ${g.grs.toFixed(0)}) — deleverage ladder`;
    case ACTIONS.NOTIFY: return `GRS ${g.grs.toFixed(0)} [${g.band}] — alert + narrate, no execution yet`;
    default: return `GRS ${g.grs.toFixed(0)} [${g.band}] — safe`;
  }
}
const fmt = (x) => x >= 1000 ? '∞' : x.toFixed(4);

// ── PTB construction (parameterized by deployed guardian package id) ─────────
const SUI_DEC = 1_000_000_000;
const toFixedRr = (decimal) => Math.round(decimal * SUI_DEC); // decimal RR → 9-dec fixed point

/**
 * Build the execute_protection PTB (ladder steps 1-2), Pyth-refreshed.
 * Requires the deployed guardian package id + the on-chain object ids.
 */
export async function buildProtectionTx({ pkg, policyId, managerId, guardianRegistryId, poolKey = 'SUI_DBUSDC' }) {
  const client = makeSuiClient();
  const pool = testnetPools[poolKey];
  const baseCoin = testnetCoins[pool.baseCoin];
  const quoteCoin = testnetCoins[pool.quoteCoin];
  const baseMarginPool = testnetMarginPools[pool.baseCoin];
  const quoteMarginPool = testnetMarginPools[pool.quoteCoin];

  const tx = new Transaction();
  await refreshPyth(tx, client, [pool.baseCoin, pool.quoteCoin]);
  tx.moveCall({
    target: `${pkg}::executor::execute_protection`,
    typeArguments: [baseCoin.type, quoteCoin.type],
    arguments: [
      tx.object(policyId), tx.object(managerId), tx.object(pool.address),
      tx.object(baseMarginPool.address), tx.object(quoteMarginPool.address),
      tx.object(MARGIN_REGISTRY_ID), tx.object(guardianRegistryId),
      tx.object(baseCoin.priceInfoObjectId), tx.object(quoteCoin.priceInfoObjectId),
      tx.object.clock(),
    ],
  });
  return tx;
}

/** Build the whiteknight_rescue PTB. debtCoinKey selects the DebtAsset generic + margin pool. */
export async function buildWhiteKnightTx({ pkg, policyId, managerId, vaultId, guardianRegistryId, debtCoinKey, repayAmount, poolKey = 'SUI_DBUSDC' }) {
  const client = makeSuiClient();
  const pool = testnetPools[poolKey];
  const baseCoin = testnetCoins[pool.baseCoin];
  const quoteCoin = testnetCoins[pool.quoteCoin];
  const debtCoin = testnetCoins[debtCoinKey];
  const marginPool = testnetMarginPools[debtCoinKey];

  const tx = new Transaction();
  await refreshPyth(tx, client, [pool.baseCoin, pool.quoteCoin]);
  tx.moveCall({
    target: `${pkg}::executor::whiteknight_rescue`,
    typeArguments: [baseCoin.type, quoteCoin.type, debtCoin.type],
    arguments: [
      tx.object(policyId), tx.object(managerId), tx.object(vaultId), tx.object(guardianRegistryId),
      tx.object(marginPool.address), tx.object(pool.address), tx.object(MARGIN_REGISTRY_ID),
      tx.object(baseCoin.priceInfoObjectId), tx.object(quoteCoin.priceInfoObjectId),
      tx.pure.u64(repayAmount), tx.object.clock(),
    ],
  });
  return tx;
}

export { toFixedRr };
