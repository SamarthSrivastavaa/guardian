import { useEffect, useRef, useState } from 'react';
import { Gauge } from './Gauge';
import { guardianRiskScore, riskRatio, explainEvent, bandColor } from '../lib/guardian';

// Identical 3x-ish longs: 10 SUI collateral, 6.0 DBUSDC quote debt. Crash from 0.95 → ~0.60.
const START = { base: 10, debt: 6.0 };
const RR_LIQ = 1.10, TRIGGER = 1.30, TARGET = 1.45, USER_REWARD = 0.05;
const CRASH_FROM = 0.95, CRASH_TO = 0.605, TICKS = 64, MS = 150;

// Deterministic crash path: downward drift + mild noise (seeded), reproducible every run.
function buildPath(): number[] {
  const p: number[] = []; let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  for (let i = 0; i <= TICKS; i++) {
    const t = i / TICKS;
    const base = CRASH_FROM + (CRASH_TO - CRASH_FROM) * (t * t * (3 - 2 * t)); // smoothstep
    p.push(Math.max(0.5, base + rnd() * 0.012 * (1 - t)));
  }
  return p;
}

interface SideState { base: number; debt: number; liquidated: boolean; rescued: boolean; equity0: number; finalEquity: number | null; }
const equity = (base: number, debt: number, price: number) => base * price - debt; // quote terms

export function RescueTheater() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [prices, setPrices] = useState<number[]>([CRASH_FROM]);
  const path = useRef(buildPath());
  const naked = useRef<SideState>(fresh());
  const guard = useRef<SideState>(fresh());
  const [events, setEvents] = useState<{ tick: number; text: string; kind: string }[]>([]);
  const [, force] = useState(0);
  const timer = useRef<number | null>(null);

  function fresh(): SideState { return { base: START.base, debt: START.debt, liquidated: false, rescued: false, equity0: equity(START.base, START.debt, CRASH_FROM), finalEquity: null }; }

  function reset() {
    if (timer.current) clearInterval(timer.current);
    naked.current = fresh(); guard.current = fresh();
    setPrices([CRASH_FROM]); setEvents([]); setDone(false); setRunning(false); force((x) => x + 1);
  }

  function start() {
    reset();
    setRunning(true);
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1;
      const price = path.current[i];
      step(price, i);
      setPrices(path.current.slice(0, i + 1));
      if (i >= TICKS) { clearInterval(timer.current!); setRunning(false); setDone(true); finalize(price); }
      force((x) => x + 1);
    }, MS);
  }

  function step(price: number, i: number) {
    const n = naked.current;
    if (!n.liquidated && riskRatio('quote', n.base, 0, n.debt, price) < RR_LIQ) {
      n.liquidated = true;
      pushEvent(i, 'liq', `Liquidated at RR ${RR_LIQ.toFixed(2)}. A liquidation bot seized ~${(USER_REWARD * 100).toFixed(0)}% of the collateral as its reward.`);
    }
    const g = guard.current;
    if (!g.liquidated) {
      const rr = riskRatio('quote', g.base, 0, g.debt, price);
      if (rr < TRIGGER && !g.rescued) {
        // Ladder: sell base in a reduce-only tranche, repay debt to restore RR toward TARGET.
        const aidu = g.base * price; // quote terms (no quote collateral here)
        const dTarget = aidu / TARGET;
        const repay = Math.max(0, g.debt - dTarget);
        const baseSold = repay / price;
        const before = { debt: g.debt, rr };
        g.base -= baseSold; g.debt -= repay;
        const after = riskRatio('quote', g.base, 0, g.debt, price);
        pushEvent(i, 'protect', explainEvent({ type: 'ProtectionExecuted', rrBefore: before.rr, debtBefore: before.debt, debtAfter: g.debt, debtRepaid: repay, ordersCancelled: 1 }));
        // If the crash is so steep RR still breaches liq, white-knight returns the reward to the user.
        if (after < RR_LIQ + 0.02) g.rescued = true;
      }
      if (riskRatio('quote', g.base, 0, g.debt, price) < RR_LIQ && !g.rescued) {
        g.rescued = true;
        pushEvent(i, 'wk', explainEvent({ type: 'WhiteKnightRescue', baseReturned: g.base * USER_REWARD, quoteReturned: 0 }));
      }
    }
  }

  function finalize(price: number) {
    const n = naked.current, g = guard.current;
    // NAKED: liquidation seizes reward; survivor equity is what remains after the bot's cut.
    n.finalEquity = n.liquidated ? equity(n.base, n.debt, price) * (1 - USER_REWARD) : equity(n.base, n.debt, price);
    g.finalEquity = equity(g.base, g.debt, price);
  }

  function pushEvent(t: number, kind: string, text: string) { setEvents((e) => [{ tick: t, kind, text }, ...e]); }

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const price = prices[prices.length - 1];
  const nakedRR = riskRatio('quote', naked.current.base, 0, naked.current.debt, price);
  const guardRR = riskRatio('quote', guard.current.base, 0, guard.current.debt, price);
  const nakedGrs = naked.current.liquidated ? 100 : guardianRiskScore({ ...sideSnap(naked.current, price) }).grs;
  const guardScore = guardianRiskScore({ ...sideSnap(guard.current, price) });

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div className="eyebrow">Rescue Theater · live risk engine, scripted crash</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>Two identical 10 SUI / 6 DBUSDC longs. One naked, one protected by Guardian. Same crash.</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={reset} disabled={running}>Reset</button>
          <button className="btn btn-primary btn-lg" onClick={start} disabled={running}>{done ? 'Replay crash' : running ? 'Crashing…' : '▶ Run the crash'}</button>
        </div>
      </div>

      <PriceChart prices={prices} liq={nakedLiqPrice()} trigger={triggerPrice()} />

      <div className="row" style={{ marginTop: 16, alignItems: 'stretch' }}>
        <Side title="NAKED" subtitle="no protection" rr={nakedRR} grs={nakedGrs}
          band={naked.current.liquidated ? 'LIQUIDATABLE' : guardianRiskScore(sideSnap(naked.current, price)).band}
          dead={naked.current.liquidated} state={naked.current} />
        <Side title="GUARDIAN" subtitle="protected" rr={guardRR} grs={guardScore.grs}
          band={guard.current.rescued ? 'EMERGENCY' : guardScore.band}
          rescued={guard.current.rescued} state={guard.current} events={events} />
      </div>

      {done && <Verdict naked={naked.current} guard={guard.current} />}
    </div>
  );

  function sideSnap(s: SideState, p: number) {
    return { side: 'quote' as const, baseAsset: s.base, quoteAsset: 0, debt: s.debt, rrLiq: RR_LIQ, markPrice: p,
      sigmaPerHour: 0.05, ratePerYear: 0.2, utilization: 0.9, uKink: 0.8, exitSlippage: 0.002, maxSlippage: 0.005 };
  }
  function nakedLiqPrice() { return (RR_LIQ * START.debt) / START.base; }
  function triggerPrice() { return (TRIGGER * START.debt) / START.base; }
}

function Side({ title, subtitle, rr, grs, band, dead, rescued, state, events }:
  { title: string; subtitle: string; rr: number; grs: number; band: string; dead?: boolean; rescued?: boolean; state: any; events?: any[] }) {
  return (
    <div className="card" style={{ flex: 1, position: 'relative', overflow: 'hidden',
      borderColor: dead ? 'var(--danger)' : rescued ? 'var(--watch)' : title === 'GUARDIAN' ? 'var(--safe)' : 'var(--ink)',
      boxShadow: dead ? '4px 4px 0 var(--danger)' : title === 'GUARDIAN' ? '4px 4px 0 var(--safe)' : 'var(--shadow)',
      transition: 'border-color 0.3s' }}>
      {dead && <div style={{ position: 'absolute', inset: 0, background: 'var(--danger-dim)', pointerEvents: 'none' }} />}
      <div className="card-head" style={{ position: 'relative' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '0.02em' }}>{title}</div>
          <div className="mono-tag" style={{ marginTop: 2 }}>{subtitle}</div>
        </div>
        <span className={`chip ${band}`}><span className="cdot" />{dead ? 'LIQUIDATED' : rescued ? 'WHITE-KNIGHT' : band}</span>
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 20, position: 'relative' }}>
        <Gauge value={grs} band={dead ? 'LIQUIDATABLE' : band} size={118} />
        <div style={{ flex: 1 }}>
          <div className="stat-label">Risk ratio</div>
          <div className="num" style={{ fontSize: 30, fontWeight: 600, color: dead ? 'var(--danger)' : bandColor[band] }}>{isFinite(rr) ? rr.toFixed(3) : '—'}</div>
          <div className="metrics" style={{ marginTop: 14 }}>
            <div><div className="stat-label">Collateral</div><div className="num" style={{ fontSize: 13 }}>{state.base.toFixed(3)} SUI</div></div>
            <div><div className="stat-label">Debt</div><div className="num" style={{ fontSize: 13 }}>{state.debt.toFixed(3)}</div></div>
          </div>
        </div>
      </div>
      {events && (
        <div style={{ marginTop: 16, maxHeight: 168, overflowY: 'auto' }}>
          {events.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>Guardian is watching. No action yet.</div>}
          {events.map((e, idx) => (
            <div className="feed-item fade-in" key={idx} style={{ padding: '10px 0' }}>
              <div className="feed-ico" style={{ background: e.kind === 'wk' ? 'var(--watch-dim)' : 'var(--safe-dim)', color: e.kind === 'wk' ? 'var(--watch)' : 'var(--safe)' }}>{e.kind === 'wk' ? '♞' : '✓'}</div>
              <div><div className="feed-time">t{e.tick}</div><div className="feed-text">{e.text}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Verdict({ naked, guard }: { naked: any; guard: any }) {
  const nLoss = ((naked.finalEquity - naked.equity0) / naked.equity0) * 100;
  const gLoss = ((guard.finalEquity - guard.equity0) / guard.equity0) * 100;
  const saved = guard.finalEquity - naked.finalEquity;
  return (
    <div className="card fade-in" style={{ marginTop: 16, borderColor: 'var(--safe)' }}>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-around', textAlign: 'center' }}>
        <div><div className="stat-label">Naked P&amp;L</div><div className="num" style={{ fontSize: 26, fontWeight: 700, color: 'var(--danger)' }}>{nLoss.toFixed(1)}%</div></div>
        <div style={{ fontSize: 22, color: 'var(--faint)' }}>→</div>
        <div><div className="stat-label">Guardian P&amp;L</div><div className="num" style={{ fontSize: 26, fontWeight: 700, color: gLoss < 0 ? 'var(--watch)' : 'var(--safe)' }}>{gLoss.toFixed(1)}%</div></div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />
        <div><div className="stat-label">Equity saved (quote)</div><div className="num" style={{ fontSize: 26, fontWeight: 700, color: 'var(--safe)' }}>+{saved.toFixed(3)}</div></div>
      </div>
    </div>
  );
}

function PriceChart({ prices, liq, trigger }: { prices: number[]; liq: number; trigger: number }) {
  const W = 1120, H = 200, pad = 8;
  const all = [...prices, liq, trigger, CRASH_FROM, CRASH_TO];
  const min = Math.min(...all) * 0.99, max = Math.max(...all) * 1.005;
  const x = (i: number) => pad + (i / TICKS) * (W - pad * 2);
  const y = (p: number) => pad + (1 - (p - min) / (max - min)) * (H - pad * 2);
  const path = prices.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const last = prices.length - 1;
  return (
    <div className="card" style={{ padding: 16 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <line x1={pad} x2={W - pad} y1={y(trigger)} y2={y(trigger)} stroke="var(--protect)" strokeWidth={1} strokeDasharray="4 5" opacity={0.6} />
        <line x1={pad} x2={W - pad} y1={y(liq)} y2={y(liq)} stroke="var(--danger)" strokeWidth={1} strokeDasharray="4 5" opacity={0.7} />
        <path d={`${path} L ${x(last)} ${H - pad} L ${x(0)} ${H - pad} Z`} fill="url(#g)" opacity={0.5} />
        <path d={path} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" />
        {prices.length > 1 && <circle cx={x(last)} cy={y(prices[last])} r={4} fill="var(--text)" />}
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity={0.25} /><stop offset="1" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
      </svg>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
        <span className="mono-tag">SUI/DBUSDC · ${prices[last]?.toFixed(4)}</span>
        <span style={{ display: 'flex', gap: 16 }}>
          <span style={{ color: 'var(--protect)' }}>— trigger ${trigger.toFixed(3)}</span>
          <span style={{ color: 'var(--danger)' }}>— liquidation ${liq.toFixed(3)}</span>
        </span>
      </div>
    </div>
  );
}
