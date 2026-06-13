import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  liquidationPrice, riskRatio, normCdf, ewmaVol, kinkedRate,
  breachProbability, exitCost, quantityToRestore, guardianRiskScore,
} from '../src/risk.mjs';

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (Δ ${Math.abs(a - b)})`);

// ── 6.2 P_liq ─────────────────────────────────────────────────────────────
test('P_liq quote-debt long matches closed form', () => {
  // Qb=10 base, Qq=5 quote, Dq=100 quote, RR_liq=1.10 → (1.10·100−5)/10 = 10.5
  const { pLiq, direction } = liquidationPrice({ side: 'quote', baseAsset: 10, quoteAsset: 5, debt: 100, rrLiq: 1.10 });
  approx(pLiq, 10.5); assert.equal(direction, 'down');
});

test('P_liq base-debt short matches closed form', () => {
  // Qb=3.385, Qq=1.5, Db=3.405, RR_liq=1.10 → 1.5/(1.10·3.405−3.385)=1.5/0.3605=4.1609…
  const { pLiq, direction } = liquidationPrice({ side: 'base', baseAsset: 3.385, quoteAsset: 1.5, debt: 3.405, rrLiq: 1.10 });
  approx(pLiq, 1.5 / (1.10 * 3.405 - 3.385), 1e-9); assert.equal(direction, 'up');
});

test('P_liq null when same-asset (no quote collateral on base debt)', () => {
  const { pLiq, note } = liquidationPrice({ side: 'base', baseAsset: 0.6, quoteAsset: 0, debt: 0.4, rrLiq: 1.10 });
  assert.equal(pLiq, null); assert.match(note, /price-independent/);
});

test('riskRatio matches a real testnet manager (0x429b: long, RR≈2.87)', () => {
  // base 0.5 SUI, quote 0.2 DBUSDC, quote debt 0.202997, mark 0.766129
  const rr = riskRatio({ side: 'quote', baseAsset: 0.5, quoteAsset: 0.2, debt: 0.202997, markPrice: 0.766129 });
  approx(rr, (0.2 + 0.5 * 0.766129) / 0.202997, 1e-6);
  assert.ok(rr > 2.8 && rr < 2.95, `rr ${rr}`);
});

// ── normCdf ─────────────────────────────────────────────────────────────────
test('normCdf known points', () => {
  approx(normCdf(0), 0.5, 1e-6);
  approx(normCdf(1.645), 0.95, 2e-3);   // 95th percentile
  approx(normCdf(-1.645), 0.05, 2e-3);
});

// ── 6.4 EWMA vol ─────────────────────────────────────────────────────────────
test('ewmaVol is zero for flat series and positive for volatile', () => {
  approx(ewmaVol([10, 10, 10, 10]), 0, 1e-12);
  assert.ok(ewmaVol([10, 11, 9, 12, 8]) > 0);
});

// ── kinked rate ──────────────────────────────────────────────────────────────
test('kinkedRate steepens past the kink', () => {
  const p = { base: 0, slope1: 0.08, slope2: 1.0, uKink: 0.8 };
  approx(kinkedRate(0.4, p), 0.032);                       // 0.4·0.08
  approx(kinkedRate(0.9, p), 0.8 * 0.08 + 0.1 * 1.0);      // past kink, steep
  assert.ok(kinkedRate(0.95, p) > kinkedRate(0.85, p));
});

// ── 6.3 interest-adjusted breach probability ─────────────────────────────────
test('breach probability rises with interest drift (long), zero vol', () => {
  // At zero vol, breach is 0 unless drifted P_liq crosses mark. Heavy interest pushes P_liq up.
  const base = { side: 'quote', baseAsset: 10, quoteAsset: 0, debt: 7, rrLiq: 1.10, markPrice: 1.0, sigmaPerHour: 0, horizonHours: 24 };
  const noInterest = breachProbability({ ...base, ratePerYear: 0 });
  assert.equal(noInterest.pBreach, 0); // P_liq=0.77 < mark 1.0, no vol → safe
  // crank rate so debt grows enough that drifted P_liq > mark within 24h → breach=1
  const huge = breachProbability({ ...base, ratePerYear: 50 });
  assert.ok(huge.pLiqDrifted > noInterest.pLiqDrifted, 'interest drifts P_liq upward');
});

test('breach probability increases with volatility (long)', () => {
  const base = { side: 'quote', baseAsset: 10, quoteAsset: 0, debt: 8, rrLiq: 1.10, markPrice: 1.0, horizonHours: 24, ratePerYear: 0 };
  const lo = breachProbability({ ...base, sigmaPerHour: 0.005 }).pBreach;
  const hi = breachProbability({ ...base, sigmaPerHour: 0.05 }).pBreach;
  assert.ok(hi > lo, `hi ${hi} > lo ${lo}`);
});

// ── 6.4 exit cost ─────────────────────────────────────────────────────────────
test('exitCost VWAP walk and slippage', () => {
  // sell 15 base into book [10@1.00, 10@0.98]; fill 10@1.00 + 5@0.98 → vwap (10+4.9)/15=0.9933
  const r = exitCost({ levels: [{ price: 1.0, quantity: 10 }, { price: 0.98, quantity: 10 }], baseToSell: 15, markPrice: 1.0 });
  approx(r.vwap, (10 * 1.0 + 5 * 0.98) / 15, 1e-9);
  approx(r.slippage, 1 - r.vwap, 1e-9);
  assert.equal(r.shortfall, 0);
});

test('exitCost reports shortfall when book too thin', () => {
  const r = exitCost({ levels: [{ price: 1.0, quantity: 3 }], baseToSell: 10, markPrice: 1.0 });
  assert.equal(r.fillable, 3); assert.equal(r.shortfall, 7);
});

test('quantityToRestore is zero when already above target', () => {
  const q = quantityToRestore({ side: 'quote', baseAsset: 10, quoteAsset: 0, debt: 1, markPrice: 1.0, rrTarget: 1.25 });
  assert.equal(q, 0);
});

// ── 6.5 GRS bands ─────────────────────────────────────────────────────────────
test('GRS: healthy position scores SAFE', () => {
  const r = guardianRiskScore({ side: 'quote', baseAsset: 10, quoteAsset: 5, debt: 3, rrLiq: 1.10, markPrice: 1.0,
    sigmaPerHour: 0.01, ratePerYear: 0.1, utilization: 0.5, exitSlippage: 0.0005, maxSlippage: 0.005 });
  assert.equal(r.band, 'SAFE'); assert.ok(r.grs < 30, `grs ${r.grs}`);
});

test('GRS: near-liquidation position scores high (PROTECT/EMERGENCY)', () => {
  // RR just above liq, high vol, high utilization, thin book
  const r = guardianRiskScore({ side: 'quote', baseAsset: 10, quoteAsset: 0, debt: 8.5, rrLiq: 1.10, markPrice: 1.0,
    sigmaPerHour: 0.06, ratePerYear: 0.8, utilization: 0.95, uKink: 0.8, exitSlippage: 0.006, maxSlippage: 0.005 });
  assert.ok(r.grs >= 60, `grs ${r.grs}`);
  assert.ok(['PROTECT', 'EMERGENCY'].includes(r.band), r.band);
});

test('GRS monotonic in risk ratio (lower RR → higher score)', () => {
  const mk = (debt) => guardianRiskScore({ side: 'quote', baseAsset: 10, quoteAsset: 0, debt, rrLiq: 1.10, markPrice: 1.0,
    sigmaPerHour: 0.02, ratePerYear: 0.2, utilization: 0.7, exitSlippage: 0.001, maxSlippage: 0.005 }).grs;
  assert.ok(mk(8.5) > mk(5) && mk(5) > mk(2), 'score rises as debt (risk) rises');
});

test('GRS components are individually bounded [0,1]', () => {
  const r = guardianRiskScore({ side: 'quote', baseAsset: 10, quoteAsset: 0, debt: 8.5, rrLiq: 1.10, markPrice: 1.0,
    sigmaPerHour: 0.06, ratePerYear: 0.8, utilization: 0.95, exitSlippage: 0.006, maxSlippage: 0.005 });
  for (const [k, v] of Object.entries(r.components)) assert.ok(v >= 0 && v <= 1, `${k}=${v}`);
});
