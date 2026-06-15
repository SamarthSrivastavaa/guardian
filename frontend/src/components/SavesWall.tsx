import { SAVES, SAVES_STATS, type Save } from '../lib/saves';

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function shareUrl(s: Save) {
  const text = s.kind === 'WhiteKnightRescue'
    ? `Guardian self-liquidated my DeepBook Margin position the instant it was legal and returned the liquidation reward to ME, not a bot. ${usd(s.savedUsd)} saved. Verifiable receipt on Walrus:`
    : `Guardian just stopped my DeepBook Margin position from getting liquidated — ${usd(s.savedUsd)} kept, 0% to bots. Verifiable receipt on Walrus:`;
  const u = s.walrus ?? 'https://github.com';
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(u)}`;
}

export function SavesWall() {
  return (
    <div className="page">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <Stat label="Total saves" value={String(SAVES_STATS.totalSaves)} />
        <Stat label="Value protected" value={usd(SAVES_STATS.valueProtected)} accent="var(--safe)" />
        <Stat label="Debt repaid" value={usd(SAVES_STATS.debtRepaid)} />
        <Stat label="Rewards returned to users" value={usd(SAVES_STATS.rewardsReturned)} accent="var(--accent)" ink />
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 2px 16px', lineHeight: 1.6, maxWidth: 760 }}>
        Every rescue Guardian performs is published as a tamper-evident receipt on <b style={{ color: 'var(--ink)' }}>Walrus</b> — the
        structured event the explainer narrates, with the on-chain keeper tx. Anyone can verify a non-custodial protection actually fired.
        Wallets are prefix-anonymized.
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))' }}>
        {SAVES.map((s, i) => (
          <div className="card fade-in" key={i}>
            <div className="card-head">
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{s.pair} <span className="mono-tag">· {s.wallet}</span></div>
                <div className="mono-tag" style={{ marginTop: 3 }}>{s.ts} · {s.network}</div>
              </div>
              <span className={`chip ${s.kind === 'WhiteKnightRescue' ? 'WATCH' : 'SAFE'}`}>{s.kind === 'WhiteKnightRescue' ? 'WHITE-KNIGHT' : 'PROTECTED'}</span>
            </div>

            <div className="row" style={{ alignItems: 'baseline', gap: 24, marginBottom: 12 }}>
              <div>
                <div className="stat-label">Saved vs liquidation</div>
                <div className="num" style={{ fontSize: 30, fontWeight: 800, color: 'var(--safe)' }}>{usd(s.savedUsd)}</div>
              </div>
              <div>
                <div className="stat-label">Debt repaid</div>
                <div className="num" style={{ fontSize: 17, fontWeight: 800 }}>{usd(s.debtRepaidUsd)}</div>
              </div>
              {s.rewardUsd != null && (
                <div>
                  <div className="stat-label">Reward returned</div>
                  <div className="num" style={{ fontSize: 17, fontWeight: 800, background: 'var(--accent)', padding: '0 5px' }}>{usd(s.rewardUsd)}</div>
                </div>
              )}
            </div>

            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, borderLeft: '3px solid var(--ink)', paddingLeft: 11, marginBottom: 14 }}>{s.trigger}</div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {s.walrus
                ? <a className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 12px' }} href={s.walrus} target="_blank" rel="noreferrer">Walrus receipt ↗</a>
                : <span className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 12px', opacity: 0.5, boxShadow: 'none' }}>receipt: localnet</span>}
              {s.keeperTx && <a className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 12px' }} href={`https://suiscan.xyz/testnet/tx/${s.keeperTx}`} target="_blank" rel="noreferrer">keeper tx ↗</a>}
              <a className="btn btn-ink" style={{ fontSize: 12, padding: '8px 12px', marginLeft: 'auto' }} href={shareUrl(s)} target="_blank" rel="noreferrer">Share to 𝕏</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, ink }: { label: string; value: string; accent?: string; ink?: boolean }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div className="stat-label">{label}</div>
      <div className="num stat-value" style={ink ? { background: accent, color: 'var(--ink)', display: 'inline-block', padding: '0 6px' } : { color: accent }}>{value}</div>
    </div>
  );
}
