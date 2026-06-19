import { useEffect, useState } from 'react';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { Gauge } from './Gauge';
import { DemoBanner } from './DemoBanner';
import { POSITIONS, type Position } from '../lib/positions';
import { readLivePositions } from '../lib/liveReader';
import { guardianRiskScore, liquidationPrice, riskRatio, bandColor, explainEvent } from '../lib/guardian';

const f = (n: number, d = 4) => (isFinite(n) ? n.toFixed(d) : '∞');

const FEED = [
  { t: '14:32:09', kind: 'protect', text: explainEvent({ type: 'ProtectionExecuted', rrBefore: 1.243, debtBefore: 6.35, debtAfter: 4.71, debtRepaid: 1.64, ordersCancelled: 2 }) },
  { t: '11:08:55', kind: 'wk', text: explainEvent({ type: 'WhiteKnightRescue', baseReturned: 0.41, quoteReturned: 0 }) },
  { t: '09:14:20', kind: 'notify', text: 'SUI/DBUSDC risk climbing on rising pool utilization (93%). Interest drift would breach in ~31h at flat price — watching.' },
  { t: '02:47:01', kind: 'protect', text: explainEvent({ type: 'ProtectionExecuted', rrBefore: 1.281, debtBefore: 3.41, debtAfter: 2.98, debtRepaid: 0.43, ordersCancelled: 1 }) },
];

export function Dashboard() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const [live, setLive] = useState<Position[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!account) { setLive(null); return; }
    let cancelled = false;
    setLoading(true);
    readLivePositions(client, account.address)
      .then((ps) => { if (!cancelled) setLive(ps); })
      .catch(() => { if (!cancelled) setLive([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [account?.address, client]);

  const isLive = !!account && !!live && live.length > 0;
  const source = isLive ? (live as Position[]) : POSITIONS;
  const rows = source.map((p) => {
    const r = guardianRiskScore(p);
    const pLiq = liquidationPrice(p.side, p.baseAsset, p.quoteAsset, p.debt, p.rrLiq);
    const rr = riskRatio(p.side, p.baseAsset, p.quoteAsset, p.debt, p.markPrice);
    const dist = pLiq != null ? (p.side === 'quote' ? (p.markPrice - pLiq) / p.markPrice : (pLiq - p.markPrice) / p.markPrice) : null;
    return { p, r, pLiq, rr, dist };
  });
  const worst = rows.reduce((a, b) => (b.r.grs > a.r.grs ? b : a));

  return (
    <div className="page">
      {isLive ? (
        <DemoBanner tone="live" text={`Live testnet reads — ${source.length} margin manager${source.length === 1 ? '' : 's'} owned by your wallet. Balances, debt & risk ratio are live chain + oracle reads; vol/rate inputs use modeled defaults.`} />
      ) : (
        <DemoBanner text={loading ? 'Reading your wallet’s margin managers from testnet…' : account ? 'No margin managers on this wallet yet — showing sample positions. Create one in the composer to see it live here.' : 'Sample positions — every number is computed by Guardian’s real risk engine. Connect a wallet to read your live managers.'} />
      )}
      {/* stats strip */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 16 }}>
        <Stat label="Protected" value={String(source.length)} suffix="managers" />
        <Stat label="Portfolio risk" value={String(Math.round(worst.r.grs))} suffix={worst.r.band} accent={bandColor[worst.r.band]} />
        <Stat label="Lowest RR" value={f(Math.min(...rows.map((x) => x.rr)), 3)} mono />
        <Stat label="Worst 24h breach P" value={`${(Math.max(...rows.map((x) => x.r.pBreach24h)) * 100).toFixed(1)}%`} mono />
        <Stat label="Liq. threshold" value="1.10" mono suffix="pool" />
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        {/* positions */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', flex: 2.4 }}>
          {rows.map(({ p, r, pLiq, rr, dist }) => (
            <div className="card fade-in" key={p.id}>
              <div className="card-head">
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{p.pair}</div>
                  <div className="mono-tag" style={{ marginTop: 3 }}>{p.id}</div>
                </div>
                <span className={`chip ${r.band}`}>{r.band}</span>
              </div>

              <div className="row" style={{ alignItems: 'center', gap: 18 }}>
                <Gauge value={r.grs} band={r.band} size={120} />
                <div style={{ flex: 1 }}>
                  <div className="metrics">
                    <Metric label="Risk ratio" value={f(rr, 3)} color={bandColor[r.band]} big />
                    <Metric label="24h breach P" value={`${(r.pBreach24h * 100).toFixed(1)}%`} />
                    <Metric label="Liq. price" value={pLiq != null ? f(pLiq) : '—'} />
                    <Metric label="Distance" value={dist != null ? `${(dist * 100).toFixed(1)}%` : '—'} />
                  </div>
                </div>
              </div>

              <hr className="hr" />
              <div className="metrics">
                <div>
                  <div className="stat-label">Collateral</div>
                  <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>{f(p.baseAsset, 3)} base · {f(p.quoteAsset, 3)} quote</div>
                </div>
                <div>
                  <div className="stat-label">Debt · {p.side}</div>
                  <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>{f(p.debt, 4)}</div>
                </div>
              </div>

              <div style={{ marginTop: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="stat-label" style={{ margin: 0 }}>Pool utilization</span>
                  <span className="num" style={{ fontSize: 11, fontWeight: 700 }}>{(p.utilization! * 100).toFixed(1)}%</span>
                </div>
                <div className="bar"><span style={{ width: `${p.utilization! * 100}%`, background: p.utilization! > p.uKink! ? 'var(--protect)' : 'var(--accent)' }} /></div>
              </div>

              <GrsBreakdown components={r.components} />
            </div>
          ))}
        </div>

        {/* activity feed */}
        <div className="card" style={{ flex: 1, minWidth: 300, position: 'sticky', top: 16 }}>
          <div className="card-head"><span className="card-title">Activity</span><span className="mono-tag">last 24h</span></div>
          {FEED.map((e, i) => (
            <div className="feed-item" key={i}>
              <div className="feed-ico" style={{ background: e.kind === 'wk' ? 'var(--accent)' : e.kind === 'notify' ? 'var(--panel)' : 'var(--safe)', color: e.kind === 'protect' ? '#fff' : 'var(--ink)' }}>
                {e.kind === 'wk' ? '♞' : e.kind === 'notify' ? '!' : '✓'}
              </div>
              <div><div className="feed-time">{e.t}</div><div className="feed-text">{e.text}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, suffix, mono, accent }: { label: string; value: string; suffix?: string; mono?: boolean; accent?: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div className="stat-label">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span className={`stat-value ${mono ? 'num' : ''}`} style={{ color: accent }}>{value}</span>
        {suffix && <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Metric({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="num" style={{ fontSize: big ? 20 : 15, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

const COMPONENT_LABELS: Record<string, string> = { sMargin: 'margin', sProb: 'prob', sInterest: 'interest', sExit: 'exit', sPool: 'pool' };
function GrsBreakdown({ components }: { components: Record<string, number> }) {
  return (
    <div style={{ marginTop: 14, display: 'flex', gap: 7 }}>
      {Object.entries(components).map(([k, v]) => (
        <div key={k} style={{ flex: 1, textAlign: 'center' }} title={`${COMPONENT_LABELS[k]}: ${(v * 100).toFixed(0)}%`}>
          <div className="bar" style={{ height: 5 }}><span style={{ width: `${v * 100}%`, background: 'var(--ink)' }} /></div>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 5, letterSpacing: '0.04em', fontWeight: 700, textTransform: 'uppercase' }}>{COMPONENT_LABELS[k]}</div>
        </div>
      ))}
    </div>
  );
}
