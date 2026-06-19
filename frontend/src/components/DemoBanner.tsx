/// Data-provenance banner. Dashboard / Saves Wall / Lenders render curated demo data by default;
/// the numbers are computed by Guardian's real risk engine, but the *positions* are samples. When a
/// wallet is connected and real managers are read, the Dashboard switches this to a `live` tone.
export function DemoBanner({ text, tone = 'demo' }: { text: string; tone?: 'demo' | 'live' }) {
  return (
    <div className={`demo-banner${tone === 'live' ? ' live' : ''}`}>
      <span className="demo-dot" />
      {text}
    </div>
  );
}
