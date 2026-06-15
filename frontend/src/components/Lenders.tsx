import { useState } from 'react';
import { POOLS, netApy, type Pool } from '../lib/lenders';

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

export function Lenders() {
  const [sel, setSel] = useState<Pool>(POOLS[0]);
  const [amount, setAmount] = useState(10000);

  const base = sel.baseApy, bonus = sel.guardianBonusBps / 10_000, net = netApy(sel);
  const baseYield = amount * base, bonusYield = amount * bonus, totalYield = amount * net;

  return (
    <div className="page">
      <div style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 2px 18px', lineHeight: 1.6, maxWidth: 800 }}>
        Lenders supply the margin pools and earn yield — but lose it to <b style={{ color: 'var(--ink)' }}>bad debt</b> when borrower
        positions liquidate late in fast markets. Guardian deleverages those borrowers <i>before</i> liquidation, so less bad debt reaches
        the pool. That protected yield flows back to you.
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        {/* pool health */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', flex: 2 }}>
          {POOLS.map((p) => (
            <button key={p.key} className="card" onClick={() => setSel(p)}
              style={{ textAlign: 'left', cursor: 'pointer', borderColor: sel.key === p.key ? 'var(--accent)' : 'var(--ink)', boxShadow: sel.key === p.key ? '4px 4px 0 var(--accent)' : 'var(--shadow)' }}>
              <div className="card-head">
                <div style={{ fontWeight: 800, fontSize: 16 }}>{p.asset} pool</div>
                <span className="chip SAFE">{pct1(p.rescueRate)} rescued</span>
              </div>
              <div className="row" style={{ gap: 24, marginBottom: 12 }}>
                <div><div className="stat-label">Net APY</div><div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--safe)' }}>{pct(netApy(p))}</div></div>
                <div><div className="stat-label">Base · +Guardian</div><div className="num" style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>{pct(p.baseApy)} <span style={{ color: 'var(--safe)' }}>+{p.guardianBonusBps}bps</span></div></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span className="stat-label" style={{ margin: 0 }}>Utilization</span>
                <span className="num" style={{ fontSize: 11, fontWeight: 700 }}>{pct1(p.utilization)}</span>
              </div>
              <div className="bar"><span style={{ width: `${p.utilization * 100}%`, background: p.utilization > 0.8 ? 'var(--protect)' : 'var(--accent)' }} /></div>
              <div className="mono-tag" style={{ marginTop: 10 }}>{p.id} · bad-debt drag avoided {p.guardianBonusBps}/{p.badDebtDragBps} bps</div>
            </button>
          ))}
        </div>

        {/* deposit / yield projector */}
        <div className="card" style={{ flex: 1, minWidth: 320, position: 'sticky', top: 16 }}>
          <div className="card-head"><span className="card-title">Supply {sel.asset}</span><span className="chip SAFE">{pct1(sel.rescueRate)} rescued</span></div>

          <div className="stat-label">Amount ({sel.asset} ≈ USD)</div>
          <input className="field num" type="number" value={amount} min={0} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} style={{ marginBottom: 16 }} />

          <div className="kv"><span>Base supply yield</span><b className="num">${Math.round(baseYield).toLocaleString()}/yr</b></div>
          <div className="kv"><span>Guardian bad-debt protection</span><b className="num" style={{ color: 'var(--safe)' }}>+${Math.round(bonusYield).toLocaleString()}/yr</b></div>
          <div className="kv" style={{ borderTop: '2px solid var(--ink)', marginTop: 4, paddingTop: 12 }}>
            <span style={{ color: 'var(--ink)', fontWeight: 700 }}>Projected yield</span>
            <b className="num" style={{ fontSize: 16 }}>${Math.round(totalYield).toLocaleString()}/yr · {pct(net)}</b>
          </div>

          <div className="row" style={{ gap: 10, marginTop: 18 }}>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }}>Supply</button>
            <button className="btn btn-ghost btn-lg" style={{ flex: 1 }}>Withdraw</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--faint)', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
            Guardian rescues {pct1(sel.rescueRate)} of at-risk borrowers in this pool before liquidation, recovering {sel.guardianBonusBps} of {sel.badDebtDragBps} bps otherwise lost to bad debt.
          </div>
        </div>
      </div>
    </div>
  );
}
