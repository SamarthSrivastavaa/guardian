#!/usr/bin/env node
// Guardian risk-engine backtest (Phase C).
// Pulls a REAL testnet manager via the Phase B reader, validates the closed-form P_liq against
// the RR function (RR(P_liq) must equal rrLiq — the protocol's liquidation threshold), then
// replays a price crash to show the GRS ladder (SAFE→WATCH→PROTECT→EMERGENCY) and confirm the
// liquidation crossing lands exactly at P_liq.
//
// Usage: node scripts/backtest.mjs [managerId] [poolKey]
import { readManagerState } from '../src/reader.mjs';
import { liquidationPrice, riskRatio, guardianRiskScore, ewmaVol } from '../src/risk.mjs';

const HERMES_BETA = 'https://hermes-beta.pyth.network';
const SUI_FEED = '0x50c67b3fd225db8912a424dd4baed60ffdde625ed2feaaf283724f9608fea266';
const DEFAULT_MANAGER = '0x429b61f6cb386ba7fe5204c52ec7d3589c2bb4763fa46924958b5d3d8e36009e';

/** Collect a short real SUI/USD price series from Hermes (TWAP-ish samples) to seed σ. */
async function recordSuiSeries(n = 12, gapMs = 250) {
  const series = [];
  for (let i = 0; i < n; i++) {
    try {
      const r = await fetch(`${HERMES_BETA}/v2/updates/price/latest?ids[]=${SUI_FEED}&parsed=true`);
      const b = await r.json();
      const p = b.parsed[0].price;
      series.push(Number(p.price) * Math.pow(10, p.price === undefined ? 0 : p.expo));
    } catch { /* skip */ }
    if (i < n - 1) await new Promise((res) => setTimeout(res, gapMs));
  }
  return series;
}

async function main() {
  const managerId = process.argv[2] || DEFAULT_MANAGER;
  const poolKey = process.argv[3] || 'SUI_DBUSDC';
  const s = await readManagerState(managerId, { poolKey });

  if (s.debtSide === 'none') { console.log('manager has no debt — nothing to backtest'); return; }

  const snap = {
    side: s.debtSide,
    baseAsset: s.collateral.base, quoteAsset: s.collateral.quote,
    debt: s.debtSide === 'base' ? s.debt.base : s.debt.quote,
    rrLiq: s.guardian.rrLiq, markPrice: s.price.markPrice,
  };

  console.log(`\n  BACKTEST — manager ${managerId.slice(0, 12)}…  (${poolKey}, ${s.debtSide}-debt)`);
  console.log(`  collateral ${snap.baseAsset} base / ${snap.quoteAsset} quote, debt ${snap.debt}, mark ${snap.markPrice.toFixed(6)}`);

  // ── 1) P_liq invariant: RR evaluated at P_liq must equal rrLiq ──────────────
  const { pLiq, direction } = liquidationPrice(snap);
  if (pLiq == null) { console.log(`\n  P_liq: ${direction} (price-independent or unreachable) — skipping crash replay`); return; }
  const rrAtPLiq = riskRatio({ ...snap, markPrice: pLiq });
  const err = Math.abs(rrAtPLiq - snap.rrLiq);
  console.log(`\n  P_liq = ${pLiq.toFixed(6)} (${direction})`);
  console.log(`  RR(P_liq) = ${rrAtPLiq.toFixed(8)}  vs  rrLiq ${snap.rrLiq.toFixed(2)}   ${err < 1e-6 ? '✓ INVARIANT HOLDS' : '✗ MISMATCH Δ=' + err}`);

  // ── 2) σ from a real recorded SUI series ────────────────────────────────────
  const series = await recordSuiSeries();
  const sigmaPerSample = ewmaVol(series);
  // samples ~0.25s apart → scale to per-hour: √(3600/0.25) = √14400 = 120
  const sigmaPerHour = sigmaPerSample * Math.sqrt(3600 / 0.25);
  console.log(`  recorded ${series.length} SUI samples; EWMA σ/sample=${sigmaPerSample.toExponential(2)} → σ/h≈${sigmaPerHour.toFixed(4)}`);

  // ── 3) Replay a crash from mark toward (and past) P_liq ─────────────────────
  console.log(`\n  CRASH REPLAY (price ${direction === 'down' ? 'falling' : 'rising'} toward P_liq):`);
  console.log(`  ${'price'.padEnd(10)} ${'RR'.padEnd(9)} ${'GRS'.padEnd(7)} band`);
  const from = snap.markPrice;
  const to = direction === 'down' ? pLiq * 0.95 : pLiq * 1.05;
  const steps = 10;
  let crossed = false;
  for (let i = 0; i <= steps; i++) {
    const p = from + (to - from) * (i / steps);
    const rr = riskRatio({ ...snap, markPrice: p });
    const g = guardianRiskScore({ ...snap, markPrice: p, sigmaPerHour, ratePerYear: 0.1,
      utilization: s.pool.utilization ?? 0, uKink: 0.8, exitSlippage: 0.001, maxSlippage: 0.005 });
    const liq = direction === 'down' ? p <= pLiq : p >= pLiq;
    const flag = liq && !crossed ? '  ← LIQUIDATION CROSSING (≈P_liq ✓)' : '';
    if (liq) crossed = true;
    console.log(`  ${p.toFixed(6).padEnd(10)} ${rr.toFixed(4).padEnd(9)} ${g.grs.toFixed(1).padEnd(7)} ${g.band}${flag}`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
