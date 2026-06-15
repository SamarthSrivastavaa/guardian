/// Honest data-provenance banner. Dashboard / Saves Wall / Lenders render curated demo data; the
/// numbers are computed by Guardian's real risk engine, but the *positions* are samples, not live
/// chain reads. We state that plainly rather than imply live data.
export function DemoBanner({ text }: { text: string }) {
  return (
    <div className="demo-banner">
      <span className="demo-dot" />
      {text}
    </div>
  );
}
