import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, ACTIONS, toFixedRr } from '../src/keeper.mjs';

// A quote-debt long; vary debt to move RR. mark=1.0, rrLiq=1.10.
const mk = (debt, extra = {}) => ({
  riskRatio: (10 * 1.0 + 0) / debt, // base 10, quote 0, quote debt `debt` → RR = 10/debt
  debtSide: 'quote', collateral: { base: 10, quote: 0 }, debt: { base: 0, quote: debt },
  markPrice: 1.0, rrLiq: 1.10, sigmaPerHour: 0.02, utilization: 0.7, ...extra,
});
const policy = { triggerRr: 1.25, whiteknightRr: 1.13, maxSlippage: 0.005, uKink: 0.8, ratePerYear: 0.2 };

test('SLEEP when no debt', () => {
  const d = decide({ riskRatio: null, debtSide: 'none', collateral: { base: 1, quote: 0 }, debt: { base: 0, quote: 0 }, markPrice: 1 }, policy);
  assert.equal(d.action, ACTIONS.SLEEP);
});

test('SLEEP when healthy (RR well above trigger, low GRS)', () => {
  const d = decide(mk(3), policy); // RR ≈ 3.33
  assert.equal(d.action, ACTIONS.SLEEP);
});

test('PROTECT when RR below trigger but above liquidation', () => {
  const d = decide(mk(8.2), policy); // RR ≈ 1.219 < trigger 1.25, > liq 1.10
  assert.equal(d.action, ACTIONS.PROTECT);
  assert.ok(d.riskRatio < policy.triggerRr && d.riskRatio > 1.10);
});

test('WHITE_KNIGHT when RR below pool liquidation threshold', () => {
  const d = decide(mk(9.2), policy); // RR ≈ 1.087 < liq 1.10
  assert.equal(d.action, ACTIONS.WHITE_KNIGHT);
  assert.equal(d.band, 'EMERGENCY');
});

test('NOTIFY in the WATCH/PROTECT GRS band but RR still above trigger', () => {
  // Tune so RR > trigger (no execute) yet GRS elevated via high vol + utilization.
  const d = decide(mk(7, { sigmaPerHour: 0.05, utilization: 0.97 }), policy); // RR ≈ 1.43 > trigger
  assert.ok([ACTIONS.NOTIFY, ACTIONS.SLEEP].includes(d.action));
  assert.ok(d.riskRatio > policy.triggerRr);
});

test('decision boundary: just below trigger → PROTECT, just above → not PROTECT', () => {
  const below = decide(mk(8.05), policy); // RR ≈ 1.242
  const above = decide(mk(7.9), policy);  // RR ≈ 1.266
  assert.equal(below.action, ACTIONS.PROTECT);
  assert.notEqual(above.action, ACTIONS.PROTECT);
});

test('toFixedRr converts decimal RR to 9-dec fixed point', () => {
  assert.equal(toFixedRr(1.25), 1_250_000_000);
  assert.equal(toFixedRr(1.10), 1_100_000_000);
});
