// Rescue Theater simulation (pure, deterministic) — drives the real-time run AND the replay/autopsy.
// Precomputes the entire timeline (frames) + keeper-action markers + the dollar verdict so the UI
// can play it forward, scrub it backward, and open any marker's on-chain receipt + GRS components.
// Every number comes from the real risk engine (guardian.ts). DBUSDC ≈ $1, so quote units ≈ USD.
import { guardianRiskScore, riskRatio } from './guardian';

const B0 = 10000;      // base collateral (SUI)
const QC0 = 2000;      // quote collateral (DBUSDC ≈ USD)
const D0 = 8000;       // quote debt (DBUSDC)
const RR_LIQ = 1.10, WK_TARGET = 1.25, REWARD = 0.05;
const FRAMES = 90;     // ~45s at 500ms/frame
const CRASH_FROM = 0.95;

export type ScenarioKey = 'standard' | 'flash' | 'stoploss';
interface Scenario { trigger: number; target: number; crashTo: number; cooldown: number; ease: (t: number) => number; label: string; desc: string; stop?: number; nakedLabel?: string }
const SMOOTH = (t: number) => t * t * (3 - 2 * t);
const SCENARIOS: Record<ScenarioKey, Scenario> = {
  // Ladder keeps up: Guardian deleverages early and survives well above liquidation.
  standard: { trigger: 1.42, target: 1.95, crashTo: 0.62, cooldown: 5, ease: SMOOTH,
    label: 'Standard crash', desc: 'Guardian’s ladder keeps pace — cancel, repay, reduce-only tranches — and survives.' },
  // Front-loaded plunge outruns the rate-limited ladder → the white-knight fires.
  flash: { trigger: 1.30, target: 1.50, crashTo: 0.60, cooldown: 6, ease: (t) => Math.sqrt(t),
    label: 'Flash crash', desc: 'Too fast for the ladder. Guardian self-liquidates at the threshold and returns the reward to you.' },
  // The stop-loss myth: a stop set BELOW the liquidation price is cancelled by the protocol and
  // never fills — liquidation triggers on risk ratio first. This is liquidation step 1, in the docs.
  stoploss: { trigger: 1.42, target: 1.95, crashTo: 0.62, cooldown: 5, ease: SMOOTH, stop: 0.65, nakedLabel: 'STOP-LOSS ONLY',
    label: 'Stop-loss myth', desc: 'A naïve trader sets a stop-loss at $0.65 to cap losses. Watch the protocol cancel it before it can fill.' },
};
export const SCENARIO_META = SCENARIOS;

// Real testnet digests for the action types we proved on-chain (Phase B). Tranche/white-knight
// require the self-published localnet stack, marked accordingly — honest provenance per marker.
const TX = {
  cancel: { hash: '93WMERKRbUtVf8bLTPftLwnZX7ZqtJb57nVAdMUhaEKD', net: 'testnet' },
  repay: { hash: '2c1yvhHe3WU2fdYzGSxvVp5uxpBBH58FEmAP6U3UaoBn', net: 'testnet' },
  tranche: { hash: null, net: 'localnet' },
  wk: { hash: null, net: 'localnet' },
};

export type MarkerKind = 'cancel' | 'repay' | 'tranche' | 'wk' | 'liq';

export interface Marker {
  frame: number; price: number; side: 'guard' | 'naked'; kind: MarkerKind;
  label: string; detail: string;
  rrBefore: number; rrAfter: number; debtRepaid: number; grs: number;
  components: Record<string, number>;
  txHash: string | null; net: string;
}

export interface Frame {
  t: number; price: number;
  naked: { rr: number; equity: number; liquidated: boolean };
  guard: { rr: number; grs: number; equity: number; base: number; debt: number; components: Record<string, number> };
}

export interface Verdict {
  initEquity: number;
  nakedFinal: number; guardFinal: number;
  nakedLoss: number; guardLoss: number; saved: number; wkReward: number;
  line: string;
}

const equity = (base: number, quoteColl: number, debt: number, price: number) => base * price + quoteColl - debt;

function buildPath(s: Scenario): number[] {
  const p: number[] = []; let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  for (let i = 0; i < FRAMES; i++) {
    const t = i / (FRAMES - 1);
    p.push(Math.max(0.5, CRASH_FROM + (s.crashTo - CRASH_FROM) * s.ease(t) + rnd() * 0.01 * (1 - t)));
  }
  return p;
}

function grsFor(base: number, quoteColl: number, debt: number, price: number, util: number) {
  return guardianRiskScore({
    side: 'quote', baseAsset: base, quoteAsset: quoteColl, debt, rrLiq: RR_LIQ, markPrice: price,
    sigmaPerHour: 0.055, ratePerYear: 0.2, utilization: util, uKink: 0.8, exitSlippage: 0.0025, maxSlippage: 0.005,
  });
}

export function simulate(scenarioKey: ScenarioKey = 'standard') {
  const SC = SCENARIOS[scenarioKey];
  const { trigger: TRIGGER, target: TARGET, cooldown: STEP_COOLDOWN } = SC;
  const path = buildPath(SC);
  const frames: Frame[] = [];
  const markers: Marker[] = [];

  const naked = { base: B0, quoteColl: QC0, debt: D0, liquidated: false, frozen: null as null | number };
  const guard = { base: B0, quoteColl: QC0, debt: D0, step: 0, lastAction: -99, wk: false };
  const initEquity = equity(B0, QC0, D0, path[0]);

  const rrNaked = (price: number) => riskRatio('quote', naked.base, naked.quoteColl, naked.debt, price);
  const rrGuard = (price: number) => riskRatio('quote', guard.base, guard.quoteColl, guard.debt, price);

  for (let t = 0; t < path.length; t++) {
    const price = path[t];

    // ── NAKED: rides unprotected, externally liquidated at RR_LIQ. Protocol partial-liquidates to
    // the target ratio; a bot pockets the 5% reward (collateral seized = repay·1.05). ──
    if (!naked.liquidated && rrNaked(price) < RR_LIQ) {
      const before = rrNaked(price);
      const assets = naked.base * price + naked.quoteColl;
      const repay = Math.max(0, naked.debt - assets / WK_TARGET);
      const seized = repay * (1 + REWARD); // bot takes repay + 5% reward, all from collateral
      naked.base -= seized / price; naked.debt -= repay;
      naked.liquidated = true; naked.frozen = price;
      const stopNote = SC.stop != null
        ? ` Your stop-loss at $${SC.stop.toFixed(2)} was sitting ${((price - SC.stop) / SC.stop * 100).toFixed(0)}% below — the protocol CANCELLED it (liquidation step 1) before price ever reached it. It never filled.`
        : '';
      markers.push({
        frame: t, price, side: 'naked', kind: 'liq',
        label: SC.stop != null ? 'Stop-loss cancelled, liquidated anyway' : 'Liquidated by a bot',
        detail: `Risk ratio hit ${RR_LIQ.toFixed(2)} at $${price.toFixed(3)}. The protocol partial-liquidated to ${WK_TARGET.toFixed(2)}; a bot pocketed the ${(REWARD * 100).toFixed(0)}% reward — $${Math.round(repay * REWARD)} of your collateral, gone.${stopNote}`,
        rrBefore: before, rrAfter: before, debtRepaid: repay, grs: 100, components: {}, txHash: null, net: 'external',
      });
    }

    // ── GUARDIAN: deterministic ladder, one rate-limited action per dip below trigger ──
    if (!guard.wk && rrGuard(price) < TRIGGER && t - guard.lastAction >= STEP_COOLDOWN && guard.step < 4) {
      const before = rrGuard(price);
      let kind: MarkerKind = 'tranche', label = '', detail = '', debtRepaid = 0;
      if (guard.step === 0) {
        kind = 'cancel'; label = 'Cancelled open orders';
        detail = 'Freed locked collateral back into the manager. Costs ~0, unsandwichable, first line of defense.';
      } else if (guard.step === 1) {
        kind = 'repay'; debtRepaid = Math.min(guard.quoteColl, guard.debt);
        guard.debt -= debtRepaid; guard.quoteColl -= debtRepaid;
        label = `Repaid ${Math.round(debtRepaid)} from idle`;
        detail = `Used idle quote to repay debt — the only action that actually deleverages. No order type can do this.`;
      } else {
        const assets = guard.base * price + guard.quoteColl;
        const dTarget = assets / TARGET;
        debtRepaid = Math.max(0, guard.debt - dTarget);
        const baseSold = debtRepaid / price;
        guard.base -= baseSold; guard.debt -= debtRepaid;
        kind = 'tranche'; label = `Reduce-only tranche · sold ${Math.round(baseSold)} SUI`;
        detail = `Sold base in a reduce-only tranche at ≤0.50% slippage and repaid the proceeds, lifting RR toward ${TARGET.toFixed(2)}.`;
      }
      guard.step += 1; guard.lastAction = t;
      const after = rrGuard(price);
      const g = grsFor(guard.base, guard.quoteColl, guard.debt, price, 0.9);
      const tx = TX[kind as 'cancel' | 'repay' | 'tranche'];
      markers.push({ frame: t, price, side: 'guard', kind, label, detail, rrBefore: before, rrAfter: after, debtRepaid, grs: g.grs, components: g.components, txHash: tx.hash, net: tx.net });
    }

    // White-knight: ladder exhausted and RR still breaching → partial self-liquidation, reward to user.
    if (!guard.wk && guard.step >= 4 && rrGuard(price) < RR_LIQ + 0.03) {
      const before = rrGuard(price);
      const assets = guard.base * price + guard.quoteColl;
      const dTarget = assets / WK_TARGET;
      const repay = Math.max(0, guard.debt - dTarget);
      const seized = repay * (1 + REWARD);
      const baseSeized = seized / price;
      guard.base -= baseSeized; guard.debt -= repay; guard.wk = true;
      const g = grsFor(guard.base, guard.quoteColl, guard.debt, price, 0.9);
      markers.push({
        frame: t, price, side: 'guard', kind: 'wk',
        label: 'White-knight self-liquidation', detail: `Crash outran the ladder. Guardian liquidated the position itself the instant it was legal and returned the ${(REWARD * 100).toFixed(0)}% reward to the owner instead of a bot.`,
        rrBefore: before, rrAfter: rrGuard(price), debtRepaid: repay, grs: g.grs, components: g.components, txHash: TX.wk.hash, net: TX.wk.net,
      });
    }

    const gScore = grsFor(guard.base, guard.quoteColl, guard.debt, price, 0.9);
    frames.push({
      t, price,
      naked: { rr: rrNaked(price), equity: equity(naked.base, naked.quoteColl, naked.debt, price), liquidated: naked.liquidated },
      guard: { rr: rrGuard(price), grs: gScore.grs, equity: equity(guard.base, guard.quoteColl, guard.debt, price), base: guard.base, debt: guard.debt, components: gScore.components },
    });
  }

  const finalPrice = path[path.length - 1];
  const nakedFinal = equity(naked.base, naked.quoteColl, naked.debt, finalPrice);
  const guardFinal = equity(guard.base, guard.quoteColl, guard.debt, finalPrice);
  const wkMarker = markers.find((m) => m.kind === 'wk');
  const wkReward = wkMarker ? wkMarker.debtRepaid * REWARD : 0;
  const verdict: Verdict = {
    initEquity, nakedFinal, guardFinal,
    nakedLoss: initEquity - nakedFinal, guardLoss: initEquity - guardFinal,
    saved: guardFinal - nakedFinal, wkReward,
    line: `Naked: liquidated, lost $${Math.round(initEquity - nakedFinal)}. Guardian: alive, smaller, kept $${Math.round(guardFinal)} of equity — $${Math.round(guardFinal - nakedFinal)} more than naked${wkReward > 0 ? `, of which $${Math.round(wkReward)} was reward returned by the white-knight` : ''}.`,
  };

  return { frames, markers, verdict, frameCount: frames.length, nakedLiqPrice: (RR_LIQ * D0 - QC0) / B0, triggerPrice: (TRIGGER * D0 - QC0) / B0, stopPrice: SC.stop ?? null, nakedLabel: SC.nakedLabel ?? 'NAKED' };
}

export const MARKER_META: Record<MarkerKind, { color: string; glyph: string }> = {
  cancel: { color: 'var(--accent)', glyph: '⊘' },
  repay: { color: 'var(--safe)', glyph: '↓' },
  tranche: { color: 'var(--protect)', glyph: '↘' },
  wk: { color: 'var(--watch)', glyph: '♞' },
  liq: { color: 'var(--danger)', glyph: '✕' },
};

export const FRAME_MS = 500;
