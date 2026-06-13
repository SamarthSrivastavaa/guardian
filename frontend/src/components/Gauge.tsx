import { bandColor, type Band } from '../lib/guardian';

/** GRS ring — a 270° arc, stroke colored by band, big tabular number in the well. */
export function Gauge({ value, band, size = 132, label = 'GRS' }: { value: number; band: Band | string; size?: number; label?: string }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const sweep = 270; // degrees
  const start = 135; // start angle (bottom-left)
  const circ = 2 * Math.PI * r;
  const arcLen = (sweep / 360) * circ;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const color = bandColor[band] ?? 'var(--accent)';

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: `rotate(${start}deg)` }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={stroke}
          strokeLinecap="butt" strokeDasharray={`${arcLen} ${circ}`} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="butt" strokeDasharray={`${arcLen * pct} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.5s cubic-bezier(.4,0,.2,1), stroke 0.4s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="num" style={{ fontSize: size * 0.31, fontWeight: 600, color, lineHeight: 1 }}>{Math.round(value)}</div>
        <div style={{ fontSize: 10.5, color: 'var(--muted)', letterSpacing: '0.14em', marginTop: 5, textTransform: 'uppercase' }}>{label}</div>
      </div>
    </div>
  );
}
