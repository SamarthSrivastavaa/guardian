import { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge } from './Gauge';
import { bandColor } from '../lib/guardian';
import { simulate, MARKER_META, FRAME_MS, SCENARIO_META, type Marker, type ScenarioKey } from '../lib/sim';

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const bandOf = (g: number) => (g < 30 ? 'SAFE' : g < 60 ? 'WATCH' : g < 80 ? 'PROTECT' : 'EMERGENCY');

export function RescueTheater() {
  const [scenario, setScenario] = useState<ScenarioKey>('standard');
  const sim = useMemo(() => simulate(scenario), [scenario]);
  const last = sim.frameCount - 1;
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<Marker | null>(null);
  const timer = useRef<number | null>(null);

  const pickScenario = (k: ScenarioKey) => { stop(); setScenario(k); setIdx(0); setSelected(null); };

  const play = (from = 0) => {
    stop(); setSelected(null); setIdx(from); setPlaying(true);
    timer.current = window.setInterval(() => {
      setIdx((i) => { if (i >= last) { stop(); return last; } return i + 1; });
    }, FRAME_MS);
  };
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setPlaying(false); };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const f = sim.frames[idx];
  const done = idx >= last;
  const visibleMarkers = sim.markers.filter((m) => m.frame <= idx);

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div className="sim-caption">
        Live simulation of Guardian's risk engine, executor logic, and white-knight flow, run against a scripted price path.
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div className="eyebrow">Rescue Theater · live risk engine · autopsy replay</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6, maxWidth: 560 }}>
            Two identical $11.5k longs (10,000 SUI / 8,000 DBUSDC debt), one naked, one Guardian-protected. {SCENARIO_META[scenario].desc}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => { stop(); setIdx(0); setSelected(null); }} disabled={playing}>Reset</button>
          <button className="btn btn-primary btn-lg" onClick={() => play(0)} disabled={playing}>{done ? '↻ Replay' : playing ? 'Crashing…' : '▶ Run the crash'}</button>
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 14 }}>
        {(Object.keys(SCENARIO_META) as ScenarioKey[]).map((k) => (
          <button key={k} className={`seg-btn ${scenario === k ? 'active' : ''}`} onClick={() => pickScenario(k)} disabled={playing}>
            {SCENARIO_META[k].label}
          </button>
        ))}
      </div>

      <Chart sim={sim} idx={idx} selected={selected} onPick={(m) => { stop(); setIdx(m.frame); setSelected(m); }} />

      {/* scrubber */}
      <div className="card card-flat" style={{ padding: '12px 16px', marginTop: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="mono-tag" style={{ minWidth: 64 }}>t {idx}/{last}</span>
        <input type="range" min={0} max={last} value={idx} onChange={(e) => { stop(); setIdx(Number(e.target.value)); setSelected(null); }}
          style={{ flex: 1, accentColor: 'var(--ink)' }} />
        <span className="mono-tag">${f.price.toFixed(4)}</span>
      </div>

      <div className="row" style={{ marginTop: 16, alignItems: 'stretch' }}>
        <SideCard title={sim.nakedLabel} sub={sim.stopPrice != null ? 'stop-loss @ $' + sim.stopPrice.toFixed(2) : 'no protection'} rr={f.naked.rr} grs={f.naked.liquidated ? 100 : 0}
          dead={f.naked.liquidated} equity={f.naked.equity} />
        <SideCard title="GUARDIAN" sub="protected" rr={f.guard.rr} grs={f.guard.grs}
          equity={f.guard.equity} base={f.guard.base} debt={f.guard.debt}
          rescued={sim.markers.some((m) => m.kind === 'wk' && m.frame <= idx)} components={f.guard.components} />
      </div>

      {selected && <Autopsy m={selected} onClose={() => setSelected(null)} />}
      {done && !selected && <Verdict v={sim.verdict} />}

      <Timeline markers={visibleMarkers} selected={selected} onPick={(m) => { stop(); setIdx(m.frame); setSelected(m); }} />
    </div>
  );
}

function Chart({ sim, idx, selected, onPick }: { sim: ReturnType<typeof simulate>; idx: number; selected: Marker | null; onPick: (m: Marker) => void }) {
  const W = 1240, H = 230, pad = 10;
  const prices = sim.frames.map((fr) => fr.price);
  const all = [...prices, sim.nakedLiqPrice, sim.triggerPrice];
  const min = Math.min(...all) * 0.99, max = Math.max(...all) * 1.005;
  const x = (i: number) => pad + (i / (sim.frameCount - 1)) * (W - pad * 2);
  const y = (p: number) => pad + (1 - (p - min) / (max - min)) * (H - pad * 2);
  const revealed = prices.slice(0, idx + 1);
  const path = (arr: number[]) => arr.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');

  return (
    <div className="card" style={{ padding: 14 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
        <line x1={pad} x2={W - pad} y1={y(sim.triggerPrice)} y2={y(sim.triggerPrice)} stroke="var(--protect)" strokeWidth={1} strokeDasharray="3 5" opacity={0.65} />
        <line x1={pad} x2={W - pad} y1={y(sim.nakedLiqPrice)} y2={y(sim.nakedLiqPrice)} stroke="var(--danger)" strokeWidth={1} strokeDasharray="3 5" opacity={0.75} />
        {sim.stopPrice != null && (
          <g>
            <line x1={pad} x2={W - pad} y1={y(sim.stopPrice)} y2={y(sim.stopPrice)} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="6 3" opacity={0.5} />
            <text x={W - pad - 4} y={y(sim.stopPrice) - 5} textAnchor="end" fontSize="10" fontWeight="700" fill="var(--ink)" opacity={0.6}>stop-loss (never fills)</text>
          </g>
        )}
        <path d={path(prices)} fill="none" stroke="var(--panel-3)" strokeWidth={1.5} />
        <path d={path(revealed)} fill="none" stroke="var(--ink)" strokeWidth={2.5} strokeLinejoin="round" />
        {revealed.length > 0 && <circle cx={x(idx)} cy={y(prices[idx])} r={4.5} fill="var(--ink)" />}
        {sim.markers.filter((m) => m.frame <= idx).map((m, i) => {
          const meta = MARKER_META[m.kind]; const sel = selected === m;
          return (
            <g key={i} transform={`translate(${x(m.frame)}, ${y(m.price)})`} style={{ cursor: 'pointer' }} onClick={() => onPick(m)}>
              <line x1={0} y1={0} x2={0} y2={H - pad - y(m.price)} stroke={meta.color} strokeWidth={sel ? 1.5 : 1} strokeDasharray="2 3" opacity={0.5} />
              <circle r={sel ? 11 : 9} fill="var(--panel)" stroke={meta.color} strokeWidth={2.5} />
              <text textAnchor="middle" dy="4" fontSize="11" fontWeight="800" fill={meta.color}>{meta.glyph}</text>
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
        <span className="mono-tag">SUI/DBUSDC</span>
        <span style={{ display: 'flex', gap: 16 }}>
          <span style={{ color: 'var(--protect)' }}>— Guardian trigger ${sim.triggerPrice.toFixed(3)}</span>
          <span style={{ color: 'var(--danger)' }}>— liquidation ${sim.nakedLiqPrice.toFixed(3)}</span>
        </span>
      </div>
    </div>
  );
}

function SideCard({ title, sub, rr, grs, dead, rescued, equity, base, debt, components }:
  { title: string; sub: string; rr: number; grs: number; dead?: boolean; rescued?: boolean; equity: number; base?: number; debt?: number; components?: Record<string, number> }) {
  const band = dead ? 'LIQUIDATABLE' : rescued ? 'EMERGENCY' : bandOf(grs);
  return (
    <div className="card" style={{ flex: 1, position: 'relative', overflow: 'hidden',
      borderColor: dead ? 'var(--danger)' : title === 'GUARDIAN' ? 'var(--safe)' : 'var(--ink)',
      boxShadow: dead ? '4px 4px 0 var(--danger)' : title === 'GUARDIAN' ? '4px 4px 0 var(--safe)' : 'var(--shadow)' }}>
      {dead && <div style={{ position: 'absolute', inset: 0, background: 'var(--danger-dim)', pointerEvents: 'none' }} />}
      <div className="card-head" style={{ position: 'relative' }}>
        <div><div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div><div className="mono-tag" style={{ marginTop: 2 }}>{sub}</div></div>
        <span className={`chip ${band}`}>{dead ? 'LIQUIDATED' : rescued ? 'WHITE-KNIGHT' : band}</span>
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 18, position: 'relative' }}>
        {title === 'GUARDIAN' ? <Gauge value={grs} band={band} size={108} /> : <DeadGauge dead={!!dead} />}
        <div style={{ flex: 1 }}>
          <div className="stat-label">Risk ratio</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800, color: dead ? 'var(--danger)' : bandColor[band] }}>{isFinite(rr) ? rr.toFixed(3) : '—'}</div>
          <div className="metrics" style={{ marginTop: 12 }}>
            <div><div className="stat-label">Equity</div><div className="num" style={{ fontSize: 15, fontWeight: 800 }}>{usd(equity)}</div></div>
            {base != null
              ? <div><div className="stat-label">Position</div><div className="num" style={{ fontSize: 12 }}>{Math.round(base)} SUI · {Math.round(debt!)} debt</div></div>
              : <div><div className="stat-label">Exposure</div><div className="num" style={{ fontSize: 12 }}>full · unhedged</div></div>}
          </div>
        </div>
      </div>
      {components && (
        <div style={{ marginTop: 14, display: 'flex', gap: 6, position: 'relative' }}>
          {Object.entries(components).map(([k, v]) => (
            <div key={k} style={{ flex: 1, textAlign: 'center' }} title={`${k}: ${(v * 100).toFixed(0)}%`}>
              <div className="bar" style={{ height: 4 }}><span style={{ width: `${v * 100}%`, background: 'var(--ink)' }} /></div>
              <div style={{ fontSize: 8.5, color: 'var(--muted)', marginTop: 4, fontWeight: 700, textTransform: 'uppercase' }}>{k.replace('s', '')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeadGauge({ dead }: { dead: boolean }) {
  return <div style={{ width: 108, height: 108, display: 'grid', placeItems: 'center', border: '2px dashed var(--panel-3)', borderRadius: '50%' }}>
    <span style={{ fontSize: 24, color: dead ? 'var(--danger)' : 'var(--faint)' }}>{dead ? '✕' : '—'}</span>
  </div>;
}

function Autopsy({ m, onClose }: { m: Marker; onClose: () => void }) {
  const meta = MARKER_META[m.kind];
  return (
    <div className="card fade-in" style={{ marginTop: 16, borderColor: meta.color, boxShadow: `4px 4px 0 ${meta.color}` }}>
      <div className="card-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span className="feed-ico" style={{ background: meta.color, color: 'var(--ink)', borderColor: 'var(--ink)' }}>{meta.glyph}</span>
          <div><div style={{ fontWeight: 800, fontSize: 15 }}>{m.label}</div><div className="mono-tag" style={{ marginTop: 2 }}>autopsy · frame {m.frame} · ${m.price.toFixed(4)}</div></div>
        </div>
        <button className="btn btn-ghost" style={{ padding: '6px 12px', boxShadow: 'none' }} onClick={onClose}>Close</button>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 14 }}>{m.detail}</div>
      <div className="metrics" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <KV label="RR before → after" value={`${m.rrBefore.toFixed(3)} → ${m.rrAfter.toFixed(3)}`} />
        <KV label="Debt repaid" value={m.debtRepaid > 0 ? usd(m.debtRepaid) : '—'} />
        <KV label="GRS at fire" value={String(Math.round(m.grs))} />
        <KV label="Receipt" value={m.txHash ? `${m.net} ✓` : m.net} />
      </div>
      {Object.keys(m.components).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="stat-label">GRS components at this moment</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {Object.entries(m.components).map(([k, v]) => (
              <div key={k} style={{ flex: 1 }}>
                <div className="bar" style={{ height: 6 }}><span style={{ width: `${v * 100}%`, background: meta.color }} /></div>
                <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 5, fontWeight: 700, textTransform: 'uppercase' }}>{k.replace('s', '')} {(v * 100).toFixed(0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {m.txHash && (
        <a className="mono-tag" href={`https://suiscan.xyz/testnet/tx/${m.txHash}`} target="_blank" rel="noreferrer"
          style={{ display: 'block', marginTop: 14, wordBreak: 'break-all', border: '1.5px solid var(--ink)', padding: '9px 11px', fontSize: 11 }}>
          <b>on-chain receipt ({m.net})</b> · {m.txHash} ↗
        </a>
      )}
      {!m.txHash && <div className="mono-tag" style={{ marginTop: 14, fontSize: 11, color: 'var(--faint)' }}>receipt: runs on the self-published localnet stack (reduce-only / white-knight require the local oracle — §0.5)</div>}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return <div><div className="stat-label">{label}</div><div className="num" style={{ fontSize: 14, fontWeight: 800 }}>{value}</div></div>;
}

function Verdict({ v }: { v: ReturnType<typeof simulate>['verdict'] }) {
  return (
    <div className="card fade-in" style={{ marginTop: 16, borderColor: 'var(--safe)', boxShadow: '4px 4px 0 var(--safe)' }}>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-around', textAlign: 'center', marginBottom: 14 }}>
        <div><div className="stat-label">Naked — lost</div><div className="num" style={{ fontSize: 27, fontWeight: 800, color: 'var(--danger)' }}>−{usd(v.nakedLoss)}</div></div>
        <div style={{ fontSize: 20, color: 'var(--faint)' }}>vs</div>
        <div><div className="stat-label">Guardian — lost</div><div className="num" style={{ fontSize: 27, fontWeight: 800, color: 'var(--watch)' }}>−{usd(v.guardLoss)}</div></div>
        <div style={{ width: 2, alignSelf: 'stretch', background: 'var(--ink)' }} />
        <div><div className="stat-label">Equity saved</div><div className="num" style={{ fontSize: 27, fontWeight: 800, color: 'var(--safe)' }}>+{usd(v.saved)}</div></div>
        {v.wkReward > 0 && <div><div className="stat-label">Reward returned</div><div className="num" style={{ fontSize: 27, fontWeight: 800, background: 'var(--accent)', color: 'var(--ink)', padding: '0 6px' }}>{usd(v.wkReward)}</div></div>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, textAlign: 'center', lineHeight: 1.5 }}>{v.line}</div>
    </div>
  );
}

function Timeline({ markers, selected, onPick }: { markers: Marker[]; selected: Marker | null; onPick: (m: Marker) => void }) {
  if (markers.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><span className="card-title">Keeper actions</span><span className="mono-tag">click to inspect</span></div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {markers.map((m, i) => {
          const meta = MARKER_META[m.kind];
          return (
            <button key={i} className="feed-item" onClick={() => onPick(m)}
              style={{ textAlign: 'left', background: selected === m ? 'var(--accent)' : 'transparent', padding: '11px 8px' }}>
              <span className="feed-ico" style={{ background: meta.color, color: 'var(--ink)', borderColor: 'var(--ink)' }}>{meta.glyph}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{m.label}</span>
                  <span className="mono-tag">${m.price.toFixed(3)} · RR {m.rrAfter.toFixed(2)}{m.txHash ? ' · ✓' : ''}</span>
                </div>
                <div className="feed-text" style={{ marginTop: 2 }}>{m.detail}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
