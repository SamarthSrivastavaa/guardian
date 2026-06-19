import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldPolicyEvents, planDispatch, backoffMs } from '../src/daemon.mjs';
import { ACTIONS } from '../src/keeper.mjs';

const FLOAT = 1_000_000_000;
const ev = (mod, j, ts) => ({ type: `0xpkg::policy::${mod}`, parsedJson: j, timestampMs: ts });

test('foldPolicyEvents: create adds an entry with decimal thresholds', () => {
  const live = foldPolicyEvents([
    ev('PolicyCreated', { policy_id: 'P1', owner: 'O1', margin_manager_id: 'M1', tier: '2', trigger_rr: String(1.25 * FLOAT), target_rr: String(1.6 * FLOAT) }, 1),
  ]);
  assert.equal(live.size, 1);
  const e = live.get('P1');
  assert.equal(e.managerId, 'M1');
  assert.equal(e.tier, 2);
  assert.equal(e.triggerRr, 1.25);
  assert.equal(e.targetRr, 1.6);
});

test('foldPolicyEvents: update patches thresholds, revoke removes', () => {
  const live = foldPolicyEvents([
    ev('PolicyCreated', { policy_id: 'P1', owner: 'O', margin_manager_id: 'M', tier: '2', trigger_rr: String(1.25 * FLOAT), target_rr: String(1.6 * FLOAT) }, 1),
    ev('PolicyUpdated', { policy_id: 'P1', trigger_rr: String(1.3 * FLOAT), target_rr: String(1.7 * FLOAT) }, 2),
    ev('PolicyCreated', { policy_id: 'P2', owner: 'O', margin_manager_id: 'M2', tier: '1', trigger_rr: String(1.2 * FLOAT), target_rr: String(1.5 * FLOAT) }, 3),
    ev('PolicyRevoked', { policy_id: 'P2', owner: 'O' }, 4),
  ]);
  assert.equal(live.size, 1);
  assert.equal(live.get('P1').triggerRr, 1.3);
  assert.equal(live.get('P1').targetRr, 1.7);
  assert.equal(live.has('P2'), false);
});

const D = (action, extra = {}) => ({ action, reason: `r:${action}`, grs: 50, band: 'WATCH', ...extra });
const base = { now: 1000, lastActionMs: 0 };

test('planDispatch: SLEEP → SKIP, NOTIFY → NOTIFY', () => {
  assert.equal(planDispatch({ ...base, decision: D(ACTIONS.SLEEP), policy: { tier: 2 } }).kind, 'SKIP');
  assert.equal(planDispatch({ ...base, decision: D(ACTIONS.NOTIFY), policy: { tier: 2 } }).kind, 'NOTIFY');
});

test('planDispatch: tier-2 PROTECT with envelope + gas → BROADCAST_ENVELOPE', () => {
  const p = planDispatch({ ...base, decision: D(ACTIONS.PROTECT), policy: { tier: 2 }, envelopeAvailable: true, gasOk: true });
  assert.equal(p.kind, 'BROADCAST_ENVELOPE');
});

test('planDispatch: tier-2 PROTECT without an envelope → NOTIFY (co-pilot fallback)', () => {
  const p = planDispatch({ ...base, decision: D(ACTIONS.PROTECT), policy: { tier: 2 }, envelopeAvailable: false });
  assert.equal(p.kind, 'NOTIFY');
});

test('planDispatch: tier-1 PROTECT → NOTIFY even with an envelope', () => {
  const p = planDispatch({ ...base, decision: D(ACTIONS.PROTECT), policy: { tier: 1 }, envelopeAvailable: true, gasOk: true });
  assert.equal(p.kind, 'NOTIFY');
});

test('planDispatch: tier-2 PROTECT, envelope present but keeper gas low → NOTIFY', () => {
  const p = planDispatch({ ...base, decision: D(ACTIONS.PROTECT), policy: { tier: 2 }, envelopeAvailable: true, gasOk: false });
  assert.equal(p.kind, 'NOTIFY');
});

test('planDispatch: WHITE_KNIGHT with vault + gas → BROADCAST_WHITEKNIGHT', () => {
  const p = planDispatch({ ...base, decision: D(ACTIONS.WHITE_KNIGHT), policy: { tier: 2 }, vaultOk: true, gasOk: true });
  assert.equal(p.kind, 'BROADCAST_WHITEKNIGHT');
});

test('planDispatch: WHITE_KNIGHT without vault float → NOTIFY', () => {
  const p = planDispatch({ ...base, decision: D(ACTIONS.WHITE_KNIGHT), policy: { tier: 2 }, vaultOk: false, gasOk: true });
  assert.equal(p.kind, 'NOTIFY');
});

test('planDispatch: in-flight and rate-limit both force SKIP', () => {
  assert.equal(planDispatch({ ...base, decision: D(ACTIONS.WHITE_KNIGHT), policy: { tier: 2 }, vaultOk: true, gasOk: true, inFlight: true }).kind, 'SKIP');
  assert.equal(planDispatch({ now: 1000, lastActionMs: 900, decision: D(ACTIONS.PROTECT), policy: { tier: 2, minActionIntervalMs: 500 }, envelopeAvailable: true, gasOk: true }).kind, 'SKIP');
});

test('backoffMs is bounded by the cap and non-negative', () => {
  for (let a = 0; a < 12; a++) {
    const b = backoffMs(a, 1000, 30_000);
    assert.ok(b >= 0 && b <= 30_000);
  }
});
