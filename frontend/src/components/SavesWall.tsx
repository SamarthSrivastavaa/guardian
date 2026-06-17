import { SAVES, SAVES_STATS, type Save } from '../lib/saves';
import { DemoBanner } from './DemoBanner';

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
      <DemoBanner text="Sample feed. The first two rows carry real Walrus-testnet receipts and real testnet transactions; the rest illustrate the format the keeper will publish automatically." />

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <Stat label="Total saves" value={String(SAVES_STATS.totalSaves)} />
        <Stat label="Value protected" value={usd(SAVES_STATS.valueProtected)} accent="var(--safe)" />
        <Stat label="Debt repaid" value={usd(SAVES_STATS.debtRepaid)} />
        <Stat label="Rewards returned to users" value={usd(SAVES_STATS.rewardsReturned)} accent="var(--accent)" ink />
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 2px 16px', lineHeight: 1.6, maxWidth: 820 }}>
        Each rescue publishes a tamper-evident receipt on <b style={{ color: 'var(--ink)' }}>Walrus</b> — the structured event plus
        the on-chain tx — so anyone can verify a non-custodial protection fired. Receipt format + anchoring are
        <b style={{ color: 'var(--ink)' }}> live and verifiable today</b> (open a receipt below). Wallets are prefix-anonymized.
      </div>

      <div className="ledger">
        <div className="ledger-head">
          <span>Time</span><span>Position</span><span>Type</span>
          <span className="r">Saved</span><span className="r">Debt repaid</span><span className="r">Reward</span>
          <span className="r">Receipt</span>
        </div>
        {SAVES.map((s, i) => <Row key={i} s={s} />)}
      </div>
    </div>
  );
}

function Row({ s }: { s: Save }) {
  const [date, time] = s.ts.split(' ');
  const wk = s.kind === 'WhiteKnightRescue';
  return (
    <div className="ledger-row">
      <div className="ledger-line">
        <div className="ledger-time">{time}</div>
        <div className="ledger-pos"><b>{s.pair}</b> <span className="mono-tag">{s.wallet}</span></div>
        <div><span className={`chip ${wk ? 'WATCH' : 'SAFE'}`}>{wk ? 'WHITE-KNIGHT' : 'PROTECTED'}</span></div>
        <div className="ledger-num saved">+{usd(s.savedUsd)}</div>
        <div className="ledger-num">{usd(s.debtRepaidUsd)}</div>
        <div className="ledger-num">{s.rewardUsd != null
          ? <span style={{ background: 'var(--accent)', color: 'var(--ink)', padding: '1px 5px' }}>{usd(s.rewardUsd)}</span>
          : <span className="muted">—</span>}</div>
        <div className="ledger-actions">
          {s.walrus
            ? <a className="ledger-link" href={s.walrus} target="_blank" rel="noreferrer">Walrus ↗</a>
            : <span className="ledger-link off">localnet</span>}
          {s.keeperTx
            ? <a className="ledger-link" href={`https://suiscan.xyz/testnet/tx/${s.keeperTx}`} target="_blank" rel="noreferrer" title="Real testnet DeepBook Margin tx (repay/cancel) — the same op a rescue performs">tx ↗</a>
            : <span className="ledger-link off">—</span>}
          <a className="ledger-link ink" href={shareUrl(s)} target="_blank" rel="noreferrer">𝕏</a>
        </div>
      </div>
      <div className="ledger-memo"><span className="ts">{date} · {s.network}</span> &nbsp;—&nbsp; {s.trigger}</div>
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
