// Guardian keeper daemon (Phase E runtime) — the resilient poll → decide → execute loop that
// turns the tested `decide()` brain + PTB builders into a service that actually protects users.
//
// Authorization model (verified against DeepBook margin source):
//   • WHITE_KNIGHT (self-liquidation) is PERMISSIONLESS — the keeper signs with its OWN key and
//     `manager.liquidate` only succeeds once `can_liquidate` holds. Fully unattended, non-custodial.
//   • execute_protection (gentle pre-liquidation deleverage) is OWNER-GATED (`validate_owner`), so
//     the keeper cannot sign it. It either broadcasts an owner PRE-SIGNED ENVELOPE (autopilot,
//     src/envelopes.mjs) or emits a NOTIFY for one-click approval (co-pilot).
//
// The pure planning helpers (foldPolicyEvents, planDispatch, backoffMs) carry the policy and are
// unit-tested; runDaemon wires them to the network with retries, gas/vault guards, structured JSON
// logging, in-flight dedupe, and graceful shutdown.
import { decide, ACTIONS, buildProtectionTx, buildWhiteKnightTx } from './keeper.mjs';
import { readManagerState } from './reader.mjs';
import { makeSuiClient, loadKeeperKeypair, testnetCoins, testnetPools } from './config.mjs';
import { loadEnvelope, broadcastEnvelope } from './envelopes.mjs';
import { anchorReceipt, receiptFromEvent } from './walrus.mjs';

const FLOAT = 1_000_000_000;

// ── Pure planning (unit-tested; no network) ───────────────────────────────────

/**
 * Fold a chronological PolicyCreated/Updated/Revoked event stream into the live watchlist.
 * Created adds, Updated patches thresholds, Revoked removes. Returns a Map<policyId, entry>.
 */
export function foldPolicyEvents(events) {
  const live = new Map();
  for (const e of events) {
    const j = e.parsedJson ?? {};
    if (e.type.endsWith('::policy::PolicyCreated')) {
      live.set(j.policy_id, {
        policyId: j.policy_id,
        owner: j.owner,
        managerId: j.margin_manager_id,
        tier: Number(j.tier),
        triggerRr: Number(j.trigger_rr) / FLOAT,
        targetRr: Number(j.target_rr) / FLOAT,
      });
    } else if (e.type.endsWith('::policy::PolicyUpdated')) {
      const cur = live.get(j.policy_id);
      if (cur) { cur.triggerRr = Number(j.trigger_rr) / FLOAT; cur.targetRr = Number(j.target_rr) / FLOAT; }
    } else if (e.type.endsWith('::policy::PolicyRevoked')) {
      live.delete(j.policy_id);
    }
  }
  return live;
}

/**
 * Decide what the keeper should DO with a decision this tick, honoring the authorization model,
 * rate limits, in-flight dedupe, and operational guards (keeper gas, vault float). Pure.
 * @returns {{kind, reason}} kind ∈ SKIP | NOTIFY | BROADCAST_ENVELOPE | BROADCAST_WHITEKNIGHT
 */
export function planDispatch({ decision, policy, now, lastActionMs = 0, inFlight = false, envelopeAvailable = false, vaultOk = true, gasOk = true }) {
  if (inFlight) return { kind: 'SKIP', reason: 'action already in flight' };
  if (now - lastActionMs < (policy.minActionIntervalMs ?? 0)) return { kind: 'SKIP', reason: 'rate-limited (min interval not elapsed)' };

  switch (decision.action) {
    case ACTIONS.SLEEP:
      return { kind: 'SKIP', reason: decision.reason };
    case ACTIONS.NOTIFY:
      return { kind: 'NOTIFY', reason: decision.reason };
    case ACTIONS.PROTECT:
      if (policy.tier === 2 && envelopeAvailable) {
        if (!gasOk) return { kind: 'NOTIFY', reason: 'autopilot due but keeper gas low — alerting owner' };
        return { kind: 'BROADCAST_ENVELOPE', reason: decision.reason };
      }
      return { kind: 'NOTIFY', reason: `approval needed (${policy.tier === 2 ? 'no envelope on file' : 'co-pilot tier'}) — ${decision.reason}` };
    case ACTIONS.WHITE_KNIGHT:
      if (!vaultOk) return { kind: 'NOTIFY', reason: 'liquidatable but white-knight vault float insufficient — alerting owner' };
      if (!gasOk) return { kind: 'NOTIFY', reason: 'liquidatable but keeper gas low — alerting owner' };
      return { kind: 'BROADCAST_WHITEKNIGHT', reason: decision.reason };
    default:
      return { kind: 'SKIP', reason: 'unknown action' };
  }
}

/** Exponential backoff with full jitter, capped. */
export function backoffMs(attempt, baseMs = 1000, capMs = 30_000) {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (level, fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), level, ...fields }));

// ── Network orchestration ─────────────────────────────────────────────────────

/** Discover the live policy watchlist from on-chain events (created/updated/revoked). */
export async function discoverPolicies(client, pkg) {
  const out = [];
  for (const mod of ['PolicyCreated', 'PolicyUpdated', 'PolicyRevoked']) {
    let cursor = null;
    // Oldest-first so the fold applies create→update→revoke in order.
    do {
      const page = await client.queryEvents({
        query: { MoveEventType: `${pkg}::policy::${mod}` },
        cursor, order: 'ascending', limit: 50,
      });
      out.push(...page.data);
      cursor = page.hasNextPage ? page.nextCursor : null;
    } while (cursor);
  }
  // Interleave by timestamp so updates/revokes land after their create.
  out.sort((a, b) => Number(a.timestampMs ?? 0) - Number(b.timestampMs ?? 0));
  return foldPolicyEvents(out);
}

/** Read the policy object's on-chain last_action_ms + min_action_interval_ms + active flag. */
async function readPolicyRuntime(client, policyId) {
  const o = await client.getObject({ id: policyId, options: { showContent: true } });
  const f = o.data?.content?.fields;
  if (!f) return null;
  return {
    active: f.active,
    lastActionMs: Number(f.last_action_ms ?? 0),
    minActionIntervalMs: Number(f.min_action_interval_ms ?? 0),
    tipBalance: Number(f.keeper_tip ?? 0),
  };
}

/**
 * Run the keeper. Long-lived; returns only on shutdown signal.
 * @param {object} cfg { pkg, guardianRegistryId, vaultId, pollMs, minKeeperSui }
 */
export async function runDaemon(cfg) {
  const client = makeSuiClient();
  const keeper = loadKeeperKeypair();
  const keeperAddr = keeper.toSuiAddress();
  const inFlight = new Set();
  let running = true;
  const stop = () => { if (running) { running = false; log('info', { event: 'shutdown', msg: 'finishing in-flight, stopping' }); } };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);

  log('info', { event: 'start', keeper: keeperAddr, pkg: cfg.pkg, pollMs: cfg.pollMs });

  let tick = 0, errAttempt = 0;
  while (running) {
    tick++;
    try {
      const gasBal = Number((await client.getBalance({ owner: keeperAddr })).totalBalance) / FLOAT;
      const gasOk = gasBal >= (cfg.minKeeperSui ?? 0.05);
      if (!gasOk) log('warn', { event: 'low-gas', keeperSui: gasBal.toFixed(4) });

      const watchlist = await discoverPolicies(client, cfg.pkg);
      log('info', { event: 'tick', tick, policies: watchlist.size, keeperSui: gasBal.toFixed(4) });

      for (const entry of watchlist.values()) {
        if (!running) break;
        if (inFlight.has(entry.policyId)) continue;
        try {
          await handlePolicy({ client, keeper, keeperAddr, cfg, entry, gasOk, inFlight });
        } catch (e) {
          log('error', { event: 'policy-error', policyId: entry.policyId, msg: String(e.message ?? e) });
        }
      }
      errAttempt = 0; // healthy tick
    } catch (e) {
      const wait = backoffMs(errAttempt++);
      log('error', { event: 'tick-error', attempt: errAttempt, retryMs: wait, msg: String(e.message ?? e) });
      await sleep(wait);
      continue;
    }
    // Idle until next poll, but stay responsive to shutdown.
    for (let s = 0; s < (cfg.pollMs ?? 15_000) && running; s += 250) await sleep(250);
  }
  log('info', { event: 'stopped', ticks: tick });
}

async function handlePolicy({ client, keeper, keeperAddr, cfg, entry, gasOk, inFlight }) {
  const rt = await readPolicyRuntime(client, entry.policyId);
  if (!rt || !rt.active) return;

  const state = await readManagerState(entry.managerId, { poolKey: 'SUI_DBUSDC' });
  const decision = decide(state, { triggerRr: entry.triggerRr, targetRr: entry.targetRr, rrLiq: state.guardian?.rrLiq ?? 1.10 });

  const envelopeAvailable = !!loadEnvelope(entry.policyId);
  const plan = planDispatch({
    decision, policy: { tier: entry.tier, minActionIntervalMs: rt.minActionIntervalMs },
    now: Date.now(), lastActionMs: rt.lastActionMs, inFlight: false,
    envelopeAvailable, vaultOk: cfg.vaultFloatOk ?? false, gasOk,
  });

  log('info', { event: 'decision', policyId: entry.policyId, manager: entry.managerId,
    rr: state.riskRatio == null ? null : Number(state.riskRatio.toFixed(4)), grs: decision.grs,
    band: decision.band, action: decision.action, plan: plan.kind, reason: plan.reason });

  if (plan.kind === 'SKIP' || plan.kind === 'NOTIFY') {
    if (plan.kind === 'NOTIFY') emitNotification(entry, decision, plan);
    return;
  }

  // Broadcasting paths — guard with in-flight dedupe.
  inFlight.add(entry.policyId);
  try {
    let digest;
    if (plan.kind === 'BROADCAST_ENVELOPE') {
      digest = await broadcastEnvelope(client, entry.policyId, keeper);
      log('info', { event: 'executed', kind: 'autopilot-deleverage', policyId: entry.policyId, digest });
    } else if (plan.kind === 'BROADCAST_WHITEKNIGHT') {
      digest = await broadcastWhiteKnight({ client, keeper, cfg, entry, state });
      log('info', { event: 'executed', kind: 'white-knight', policyId: entry.policyId, digest });
    }
    if (digest) await anchor({ client, entry, digest });
  } finally {
    inFlight.delete(entry.policyId);
  }
}

/** Best-effort: read the executor event from the tx and anchor a Walrus receipt for it. */
async function anchor({ client, entry, digest }) {
  try {
    const r = await client.waitForTransaction({ digest, options: { showEvents: true } });
    const event = (r.events ?? []).find((e) => e.type.includes('::executor::'));
    const { blobId, url } = await anchorReceipt(receiptFromEvent({ policyId: entry.policyId, managerId: entry.managerId, owner: entry.owner, digest, event }));
    log('info', { event: 'anchored', policyId: entry.policyId, blobId, url });
  } catch (e) {
    log('warn', { event: 'anchor-failed', policyId: entry.policyId, digest, msg: String(e.message ?? e) });
  }
}

/** Build + sign + send the permissionless white-knight rescue with the keeper's own key. */
async function broadcastWhiteKnight({ client, keeper, cfg, entry, state }) {
  const pool = testnetPools['SUI_DBUSDC'];
  const debtCoinKey = state.debtSide === 'base' ? pool.baseCoin : pool.quoteCoin;
  const dec = testnetCoins[debtCoinKey].decimals ?? 9;
  const debt = state.debtSide === 'base' ? state.debt.base : state.debt.quote;
  const repayAmount = Math.ceil(debt * 10 ** dec); // cover the full debt; liquidate returns the unused change
  const tx = await buildWhiteKnightTx({
    pkg: cfg.pkg, policyId: entry.policyId, managerId: entry.managerId,
    vaultId: cfg.vaultId, guardianRegistryId: cfg.guardianRegistryId,
    debtCoinKey, repayAmount, poolKey: 'SUI_DBUSDC',
  });
  tx.setSender(keeper.toSuiAddress());
  const res = await client.signAndExecuteTransaction({ signer: keeper, transaction: tx, options: { showEffects: true } });
  if (res.effects?.status?.status !== 'success') throw new Error(`white-knight aborted: ${JSON.stringify(res.effects?.status)}`);
  return res.digest;
}

/** Owner-facing alert hook. Structured today; wire to push/email/Telegram in deployment. */
function emitNotification(entry, decision, plan) {
  log('notify', { event: 'owner-alert', policyId: entry.policyId, owner: entry.owner,
    band: decision.band, grs: decision.grs, action: decision.action, message: plan.reason });
}

// Re-export the proven builder so callers can construct an execute_protection tx for signing.
export { buildProtectionTx };
