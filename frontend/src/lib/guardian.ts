// Guardian shared logic for the UI — a faithful TS port of the project's pure modules
// (src/risk.mjs §6 risk engine, src/ai.mjs §7 deterministic AI core). Kept in sync by hand;
// every number the UI shows traces to a formula here, not a hardcoded demo value.

export type Side = 'base' | 'quote' | 'none';
export type Band = 'SAFE' | 'WATCH' | 'PROTECT' | 'EMERGENCY';

// ── §6.2 closed-form liquidation price ───────────────────────────────────────
export function liquidationPrice(side: Side, baseAsset: number, quoteAsset: number, debt: number, rrLiq: number) {
  if (side === 'quote') {
    if (baseAsset <= 0) return null;
    return (rrLiq * debt - quoteAsset) / baseAsset; // price falls toward this
  }
  if (side === 'base') {
    const denom = rrLiq * debt - baseAsset;
    if (quoteAsset <= 0 || denom <= 0) return null;
    return quoteAsset / denom; // price rises toward this (short)
  }
  return null;
}

export function riskRatio(side: Side, baseAsset: number, quoteAsset: number, debt: number, markPrice: number) {
  if (side === 'none' || debt <= 0) return Infinity;
  const aidu = side === 'quote' ? quoteAsset + baseAsset * markPrice : baseAsset + quoteAsset / markPrice;
  return aidu / debt;
}

// normal CDF via erf (A&S 7.1.26)
function erf(x: number) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

export function breachProbability(opts: {
  side: Side; baseAsset: number; quoteAsset: number; debt: number; rrLiq: number;
  markPrice: number; sigmaPerHour: number; horizonHours: number; ratePerYear?: number;
}) {
  const { side, baseAsset, quoteAsset, debt, rrLiq, markPrice, sigmaPerHour, horizonHours, ratePerYear = 0 } = opts;
  const driftedDebt = debt * Math.pow(1 + ratePerYear, horizonHours / 8760);
  const pLiq = liquidationPrice(side, baseAsset, quoteAsset, driftedDebt, rrLiq);
  if (pLiq == null || pLiq <= 0) return 0;
  const direction = side === 'quote' ? 'down' : 'up';
  const sigmaT = sigmaPerHour * Math.sqrt(horizonHours);
  if (sigmaT === 0) return (direction === 'down' ? markPrice <= pLiq : markPrice >= pLiq) ? 1 : 0;
  const z = direction === 'down' ? Math.log(pLiq / markPrice) / sigmaT : Math.log(markPrice / pLiq) / sigmaT;
  return normCdf(z);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const RR_SAFE = 1.6;
const W = { margin: 0.35, prob: 0.30, interest: 0.10, exit: 0.15, pool: 0.10 };

export interface Snapshot {
  side: Side; baseAsset: number; quoteAsset: number; debt: number; rrLiq: number; markPrice: number;
  sigmaPerHour: number; ratePerYear?: number; utilization?: number; uKink?: number;
  exitSlippage?: number; maxSlippage?: number;
}

export function guardianRiskScore(s: Snapshot) {
  const { side, baseAsset, quoteAsset, debt, rrLiq, markPrice, sigmaPerHour,
    ratePerYear = 0, utilization = 0, uKink = 0.8, exitSlippage = 0, maxSlippage = 0.005 } = s;
  const rr = riskRatio(side, baseAsset, quoteAsset, debt, markPrice);
  const sMargin = 1 - clamp01((rr - rrLiq) / (RR_SAFE - rrLiq));
  const pBreach = breachProbability({ side, baseAsset, quoteAsset, debt, rrLiq, markPrice, sigmaPerHour, horizonHours: 24, ratePerYear });
  const sProb = clamp01(pBreach);
  const rr24 = isFinite(rr) ? riskRatio(side, baseAsset, quoteAsset, debt * Math.pow(1 + ratePerYear, 24 / 8760), markPrice) : Infinity;
  const dRR = isFinite(rr) ? rr - rr24 : 0;
  const sInterest = isFinite(rr) && rr > rrLiq ? clamp01(dRR / (rr - rrLiq)) : 0;
  const sExit = clamp01(exitSlippage / maxSlippage);
  const sPool = clamp01((utilization - uKink) / (1 - uKink));
  const raw = W.margin * sMargin + W.prob * sProb + W.interest * sInterest + W.exit * sExit + W.pool * sPool;
  const grs = 100 * clamp01(raw);
  const band: Band = grs < 30 ? 'SAFE' : grs < 60 ? 'WATCH' : grs < 80 ? 'PROTECT' : 'EMERGENCY';
  return { grs, band, riskRatio: rr, components: { sMargin, sProb, sInterest, sExit, sPool }, pBreach24h: pBreach };
}

// ── §7 deterministic AI core (composer + validator + explainer) ──────────────
export const ENVELOPE = { FLOAT: 1.0, MAX_SLIPPAGE_BPS: 200, MAX_TRANCHE_BPS: 10_000, MAX_TIER: 2 };

export interface PolicyParams {
  tier: number; triggerRr: number; targetRr: number; minActionIntervalMs: number;
}

// Mirrors guardian::policy::assert_thresholds exactly: 1.0 < triggerRr < targetRr, tier in range.
// (white-knight / slippage / tranche thresholds are not stored on-chain — see policy.move.)
export function validatePolicyParams(p: PolicyParams) {
  const errors: string[] = [];
  if (!(Number.isInteger(p.tier) && p.tier >= 0 && p.tier <= ENVELOPE.MAX_TIER)) errors.push(`tier must be 0..${ENVELOPE.MAX_TIER}`);
  if (!(p.triggerRr > ENVELOPE.FLOAT)) errors.push('triggerRr must be > 1.0');
  if (!(p.targetRr > p.triggerRr)) errors.push('targetRr must be > triggerRr');
  return { valid: errors.length === 0, errors };
}

const PRESETS: Record<string, Omit<PolicyParams, 'tier' | 'minActionIntervalMs'>> = {
  conservative: { triggerRr: 1.40, targetRr: 1.60 },
  balanced: { triggerRr: 1.30, targetRr: 1.45 },
  aggressive: { triggerRr: 1.20, targetRr: 1.30 },
};

export function composePolicyFromIntent(text: string) {
  const t = (text || '').toLowerCase();
  const preset = /conservativ|safe|cautious|protect.*most|sleep/.test(t) ? 'conservative'
    : /aggressiv|max.*leverage|risky|tight/.test(t) ? 'aggressive' : 'balanced';
  const tier = /alert.*only|notify.*only|just.*alert|tier ?0/.test(t) ? 0
    : /ask me|approve|copilot|confirm|tier ?1/.test(t) ? 1 : 2;
  const minActionIntervalMs = /minute|slow|few min/.test(t) ? 180_000 : 30_000;
  const params: PolicyParams = { tier, minActionIntervalMs, ...PRESETS[preset] };
  return { params, preset, ...validatePolicyParams(params) };
}

const f = (n: number, d = 4) => Number(n).toFixed(d);
export function explainEvent(ev: any): string {
  switch (ev.type) {
    case 'ProtectionExecuted': {
      const parts: string[] = [];
      if (ev.ordersCancelled > 0) parts.push(`cancelled ${ev.ordersCancelled} open order${ev.ordersCancelled === 1 ? '' : 's'}`);
      if (ev.debtRepaid > 0) parts.push(`repaid ${f(ev.debtRepaid)} of debt`);
      const did = parts.length ? parts.join(' and ') : 'rebalanced your position';
      return `Guardian ${did} because your risk ratio had fallen to ${f(ev.rrBefore)} — below your trigger. Debt went from ${f(ev.debtBefore)} to ${f(ev.debtAfter)}, pulling you back from liquidation. No funds left your manager.`;
    }
    case 'WhiteKnightRescue':
      return `Your position crossed the liquidation threshold, so Guardian liquidated it itself the instant that became legal and returned ${f(ev.baseReturned)} base + ${f(ev.quoteReturned)} quote straight to your wallet. The ~5% reward a liquidation bot would have taken went to you instead.`;
    default: return `Guardian event: ${ev.type}`;
  }
}

export const bandColor: Record<string, string> = {
  SAFE: 'var(--safe)', WATCH: 'var(--watch)', PROTECT: 'var(--protect)', EMERGENCY: 'var(--danger)', LIQUIDATABLE: 'var(--danger)',
};
