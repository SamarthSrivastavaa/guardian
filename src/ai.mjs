// Guardian AI layer (Phase F) — the DETERMINISTIC core of §7's strict split.
//
// The AI never touches execution. Its only outputs are (a) a policy-parameter PROPOSAL that must
// pass `validatePolicyParams` (the same envelope the Move contract enforces) and be user-confirmed,
// and (b) plain-English explanations that are 100% reproducible from a structured event log. This
// file is that deterministic spine: a keyword intent-composer (works with no LLM), the schema/bounds
// validator that gates every proposal, and a template explainer. An LLM may refine phrasing on top,
// but substance and safety live here — so prompt injection is inert and explanations are stable.

// ── Safety envelope — MUST mirror guardian::policy::assert_thresholds exactly ──
export const ENVELOPE = Object.freeze({
  FLOAT: 1.0, // RR fixed-point 1.0
  MAX_SLIPPAGE_BPS: 200, // hard ceiling (contract: MAX_SLIPPAGE_BPS)
  MAX_TRANCHE_BPS: 10_000,
  MAX_TIER: 2,
});

/**
 * Gate every proposed policy. Returns { valid, errors }. Mirrors the on-chain ladder:
 * 1.0 < whiteknightRr < triggerRr < targetRr, 0 < slippage ≤ 200bps, 0 < tranche ≤ 100%.
 * Decimal RR inputs (e.g. 1.25), bps as integers.
 */
export function validatePolicyParams(p) {
  const errors = [];
  if (!(Number.isInteger(p.tier) && p.tier >= 0 && p.tier <= ENVELOPE.MAX_TIER))
    errors.push(`tier must be 0..${ENVELOPE.MAX_TIER}`);
  if (!(p.whiteknightRr > ENVELOPE.FLOAT)) errors.push('whiteknightRr must be > 1.0');
  if (!(p.whiteknightRr < p.triggerRr)) errors.push('whiteknightRr must be < triggerRr');
  if (!(p.targetRr > p.triggerRr)) errors.push('targetRr must be > triggerRr');
  if (!(p.maxSlippageBps > 0 && p.maxSlippageBps <= ENVELOPE.MAX_SLIPPAGE_BPS))
    errors.push(`maxSlippageBps must be 1..${ENVELOPE.MAX_SLIPPAGE_BPS}`);
  if (!(p.trancheBps > 0 && p.trancheBps <= ENVELOPE.MAX_TRANCHE_BPS))
    errors.push(`trancheBps must be 1..${ENVELOPE.MAX_TRANCHE_BPS}`);
  if (!(Number.isFinite(p.minActionIntervalMs) && p.minActionIntervalMs >= 0))
    errors.push('minActionIntervalMs must be ≥ 0');
  return { valid: errors.length === 0, errors };
}

// ── Deterministic intent composer (LLM-free baseline) ─────────────────────────
const PRESETS = {
  conservative: { triggerRr: 1.40, targetRr: 1.60, whiteknightRr: 1.13, maxSlippageBps: 30, trancheBps: 2_000 },
  balanced: { triggerRr: 1.30, targetRr: 1.45, whiteknightRr: 1.13, maxSlippageBps: 50, trancheBps: 2_500 },
  aggressive: { triggerRr: 1.20, targetRr: 1.30, whiteknightRr: 1.12, maxSlippageBps: 100, trancheBps: 4_000 },
};

/**
 * Map a natural-language request to structured, VALIDATED policy params. Deterministic keyword
 * routing so it works without any model; an LLM wrapper may pre-fill the same shape, but the
 * result always passes back through validatePolicyParams. Returns { params, preset, tier, valid, errors }.
 */
export function composePolicyFromIntent(text) {
  const t = (text || '').toLowerCase();
  const preset = /conservativ|safe|cautious|protect.*most|sleep/.test(t) ? 'conservative'
    : /aggressiv|max.*leverage|risky|tight/.test(t) ? 'aggressive'
    : 'balanced';
  const tier = /alert.*only|notify.*only|just.*alert|tier ?0/.test(t) ? 0
    : /ask me|approve|copilot|confirm|tier ?1/.test(t) ? 1
    : 2; // default autopilot
  // Rate limit: default 30s; "every few minutes" → 180s.
  const minActionIntervalMs = /minute|slow|few min/.test(t) ? 180_000 : 30_000;

  const params = { tier, minActionIntervalMs, ...PRESETS[preset] };
  const { valid, errors } = validatePolicyParams(params);
  return { params, preset, tier, valid, errors };
}

// ── Action explainer — reproducible from the structured event alone ───────────
const fmt = (n, d = 4) => Number(n).toFixed(d);

/** Plain-English, grounded explanation of a Guardian event. Pure function of the event. */
export function explainEvent(ev) {
  switch (ev.type) {
    case 'ProtectionExecuted': {
      const parts = [];
      if (ev.ordersCancelled > 0) parts.push(`cancelled ${ev.ordersCancelled} open order${ev.ordersCancelled === 1 ? '' : 's'}`);
      if (ev.debtRepaid > 0) parts.push(`repaid ${fmt(ev.debtRepaid)} of debt`);
      const did = parts.length ? parts.join(' and ') : 'rebalanced your position';
      return `Guardian ${did} because your risk ratio had fallen to ${fmt(ev.rrBefore)} — below your trigger. `
        + `Debt went from ${fmt(ev.debtBefore)} to ${fmt(ev.debtAfter)}, pulling you back from liquidation. `
        + `No funds left your manager.`;
    }
    case 'WhiteKnightRescue':
      return `Your position crossed the liquidation threshold, so Guardian liquidated it itself the instant that became legal `
        + `and returned ${fmt(ev.baseReturned)} base + ${fmt(ev.quoteReturned)} quote straight to your wallet. `
        + `The ~5% reward a liquidation bot would have taken went to you instead.`;
    case 'Decision':
      return ev.action === 'PROTECT' ? `Risk ratio ${fmt(ev.riskRatio)} is below your trigger (GRS ${Math.round(ev.grs)}); running the deleverage ladder.`
        : ev.action === 'WHITE_KNIGHT' ? `Risk ratio ${fmt(ev.riskRatio)} is below the pool's liquidation threshold; capturing the liquidation reward for you.`
        : ev.action === 'NOTIFY' ? `Risk is elevated (GRS ${Math.round(ev.grs)}, ${ev.band}) but still above your trigger — watching closely, no action yet.`
        : `Position is healthy (GRS ${Math.round(ev.grs)}). Nothing to do.`;
    default:
      return `Guardian event: ${ev.type}`;
  }
}
