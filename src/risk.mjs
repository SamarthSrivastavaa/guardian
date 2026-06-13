// Guardian risk engine (Phase C) — implements GUARDIAN_BLUEPRINT.md §6 exactly.
//
// Pure functions over a manager+pool snapshot. Every output traces to a documented formula;
// no hidden constants. Operates on the protocol's real RR definition: RR = assets_in_debt_unit / debt
// (verified Phase A), isolated margin (one borrow side), kinked interest (RR decays at constant price).

// ── 6.2 Closed-form liquidation price ────────────────────────────────────────
// Long  (quote debt): RR(P) = (Qb·P + Qq)/Dq            → P_liq = (RR_liq·Dq − Qq)/Qb
// Short (base  debt): RR(P) = (Qb·P + Qq)/(Db·P)        → P_liq = Qq/(RR_liq·Db − Qb)
// where P is base priced in quote, Qb/Qq are base/quote collateral, Dq/Db are debts.
export function liquidationPrice({ side, baseAsset, quoteAsset, debt, rrLiq }) {
  if (side === 'quote') {
    if (baseAsset <= 0) return { pLiq: null, direction: 'down', note: 'no base collateral' };
    return { pLiq: (rrLiq * debt - quoteAsset) / baseAsset, direction: 'down' };
  }
  if (side === 'base') {
    const denom = rrLiq * debt - baseAsset;
    if (quoteAsset <= 0) return { pLiq: null, direction: 'up', note: 'price-independent (same-asset)' };
    if (denom <= 0) return { pLiq: null, direction: 'up', note: 'already over-collateralized in base' };
    return { pLiq: quoteAsset / denom, direction: 'up' };
  }
  return { pLiq: null, direction: null, note: 'no debt' };
}

/** Current risk ratio from a snapshot, matching the protocol's assets_in_debt_unit/debt. */
export function riskRatio({ side, baseAsset, quoteAsset, debt, markPrice }) {
  if (side === 'none' || debt <= 0) return Infinity;
  const aidu = side === 'quote' ? quoteAsset + baseAsset * markPrice
                                : baseAsset + quoteAsset / markPrice;
  return aidu / debt;
}

// ── normal CDF via erf (Abramowitz & Stegun 7.1.26) ──────────────────────────
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

// ── 6.4 EWMA volatility (RiskMetrics, λ=0.94) ────────────────────────────────
// Returns per-period σ from a price series. Caller scales by √(periodsPerHorizon).
export function ewmaVol(prices, lambda = 0.94) {
  if (prices.length < 2) return 0;
  const r = [];
  for (let i = 1; i < prices.length; i++) r.push(Math.log(prices[i] / prices[i - 1]));
  let v = r[0] * r[0];
  for (let i = 1; i < r.length; i++) v = lambda * v + (1 - lambda) * r[i] * r[i];
  return Math.sqrt(v);
}

// ── kinked utilization-rate model (per-year), §6.3 / interest curve ──────────
// r(u) = base + u·slope1                              for u <  u_kink
//      = base + u_kink·slope1 + (u−u_kink)·slope2     for u >= u_kink
export function kinkedRate(u, { base = 0, slope1 = 0.08, slope2 = 1.0, uKink = 0.8 } = {}) {
  return u < uKink ? base + u * slope1
                   : base + uKink * slope1 + (u - uKink) * slope2;
}

// ── 6.3 Interest-adjusted breach probability over horizon T (hours) ──────────
// Debt drifts up as D(T) = D·(1+r_year)^(T/8760), moving P_liq adversely. We solve the
// lognormal breach against the DRIFTED P_liq — Guardian predicts liquidations that occur
// with zero price movement (pure interest), which no price-alert tool can represent.
export function breachProbability({
  side, baseAsset, quoteAsset, debt, rrLiq, markPrice,
  sigmaPerHour, horizonHours, ratePerYear = 0,
}) {
  const driftedDebt = debt * Math.pow(1 + ratePerYear, horizonHours / 8760);
  const { pLiq, direction } = liquidationPrice({ side, baseAsset, quoteAsset, debt: driftedDebt, rrLiq });
  if (pLiq == null || pLiq <= 0) {
    // No reachable liq price in this direction → ~0 breach (unless already past it).
    return { pBreach: 0, pLiqDrifted: pLiq, direction };
  }
  const sigmaT = sigmaPerHour * Math.sqrt(horizonHours);
  if (sigmaT === 0) {
    const breached = direction === 'down' ? markPrice <= pLiq : markPrice >= pLiq;
    return { pBreach: breached ? 1 : 0, pLiqDrifted: pLiq, direction };
  }
  // down-breach (long): P(P_T <= P_liq) = Φ(ln(P_liq/P)/σ√T)
  // up-breach   (short): P(P_T >= P_liq) = Φ(ln(P/P_liq)/σ√T)
  const z = direction === 'down'
    ? Math.log(pLiq / markPrice) / sigmaT
    : Math.log(markPrice / pLiq) / sigmaT;
  return { pBreach: normCdf(z), pLiqDrifted: pLiq, direction };
}

// ── 6.4 Orderbook exit cost (can you actually get out?) ──────────────────────
// Walk live book levels [{price, quantity}] selling `baseToSell` of base; slippage =
// (mark − VWAP_fill)/mark. levels must be sorted best-first for the side being hit.
export function exitCost({ levels, baseToSell, markPrice }) {
  let remaining = baseToSell, cost = 0, filled = 0;
  for (const lvl of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lvl.quantity);
    cost += take * lvl.price; filled += take; remaining -= take;
  }
  if (filled === 0) return { slippage: 1, vwap: null, fillable: 0, shortfall: baseToSell };
  const vwap = cost / filled;
  return { slippage: (markPrice - vwap) / markPrice, vwap, fillable: filled, shortfall: Math.max(0, remaining) };
}

/** Base quantity to sell to restore RR_target (long case): solve target = (Qq + (Qb−x)·P_eff)/(Dq − x·P_eff)… */
// Simplified planner estimate: sell enough base so repay closes the gap to RR_target at mark.
export function quantityToRestore({ side, baseAsset, quoteAsset, debt, markPrice, rrTarget }) {
  // D_target = assets_in_debt_unit / RR_target ; gap repaid by selling base→debt asset.
  const aidu = side === 'quote' ? quoteAsset + baseAsset * markPrice : baseAsset + quoteAsset / markPrice;
  const dTarget = aidu / rrTarget;
  const gap = Math.max(0, debt - dTarget); // in debt units
  // base needed ≈ gap converted to base (long: gap is quote → /P; short: gap is base)
  return side === 'quote' ? gap / markPrice : gap;
}

// ── 6.5 Guardian Risk Score (0–100) ──────────────────────────────────────────
export const GRS_WEIGHTS = { margin: 0.35, prob: 0.30, interest: 0.10, exit: 0.15, pool: 0.10 };
export const RR_SAFE = 1.6;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function guardianRiskScore(snap) {
  const {
    side, baseAsset, quoteAsset, debt, rrLiq, markPrice,
    sigmaPerHour, ratePerYear = 0, utilization = 0, uKink = 0.8,
    exitSlippage = 0, maxSlippage = 0.005, weights = GRS_WEIGHTS,
  } = snap;

  const rr = riskRatio({ side, baseAsset, quoteAsset, debt, markPrice });

  const sMargin = 1 - clamp01((rr - rrLiq) / (RR_SAFE - rrLiq));

  const { pBreach } = breachProbability({
    side, baseAsset, quoteAsset, debt, rrLiq, markPrice,
    sigmaPerHour, horizonHours: 24, ratePerYear,
  });
  const sProb = clamp01(pBreach);

  // ΔRR over 24h from interest alone (constant price).
  const rr24 = isFinite(rr) ? riskRatio({ side, baseAsset, quoteAsset,
    debt: debt * Math.pow(1 + ratePerYear, 24 / 8760), markPrice }) : Infinity;
  const dRRinterest = isFinite(rr) ? rr - rr24 : 0;
  const sInterest = isFinite(rr) && rr > rrLiq ? clamp01(dRRinterest / (rr - rrLiq)) : 0;

  const sExit = clamp01(exitSlippage / maxSlippage);
  const sPool = clamp01((utilization - uKink) / (1 - uKink));

  const raw = weights.margin * sMargin + weights.prob * sProb + weights.interest * sInterest
            + weights.exit * sExit + weights.pool * sPool;
  const grs = 100 * clamp01(raw);

  const band = grs < 30 ? 'SAFE' : grs < 60 ? 'WATCH' : grs < 80 ? 'PROTECT' : 'EMERGENCY';
  return {
    grs, band, riskRatio: rr,
    components: { sMargin, sProb, sInterest, sExit, sPool },
    weighted: {
      margin: weights.margin * sMargin, prob: weights.prob * sProb,
      interest: weights.interest * sInterest, exit: weights.exit * sExit, pool: weights.pool * sPool,
    },
    detail: { pBreach24h: pBreach, dRRinterest24h: dRRinterest },
  };
}
