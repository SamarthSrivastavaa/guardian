// "What's live, what's next" — a status report, not a confession. Tone: confident, technical.
// Every row is defensible against the code; this page is the honest answer to "what actually runs?"
type Status = 'Live' | 'Simulated' | 'Roadmap';

const ROWS: { component: string; status: Status; notes: string }[] = [
  { component: 'Risk engine — P_liq, GRS, interest-drift breach prob, EWMA, exit-cost', status: 'Live',
    notes: '16 unit tests + a backtest that proves the closed-form invariant RR(P_liq) = 1.10000000 exactly. P_liq for both borrow directions.' },
  { component: 'Smart contracts — guardian::policy / executor / registry', status: 'Live',
    notes: '15/15 Move tests, compiled against the real DeepBook Margin API. Includes whiteknight_float_preserved_across_n_rescues.' },
  { component: 'Reduce-only invariant', status: 'Live',
    notes: 'Debt-monotonic postcondition enforced + tested; collateral is only ever forwarded to the manager owner.' },
  { component: 'Policy composer', status: 'Live',
    notes: 'Deterministic NL → parameters, re-validated against the on-chain envelope (assert_thresholds). Non-custodial wallet signature today. No LLM in the loop, by design.' },
  { component: 'Action explainer', status: 'Live',
    notes: 'Pure template over the structured event log — reproducible from the event alone.' },
  { component: 'Walrus receipt format', status: 'Live',
    notes: 'Versioned schema guardian.rescue.v1; receipts anchored and readable today — click a Walrus receipt on the Saves Wall.' },
  { component: 'Rescue Theater', status: 'Simulated',
    notes: 'The real risk engine + executor ladder + white-knight flow, run deterministically over a scripted price path. Reproducible, offline.' },
  { component: 'Saves Wall feed', status: 'Simulated',
    notes: 'Sample feed; two cards carry real Walrus receipts + real testnet transactions. Automatic anchoring on every rescue ships with the keeper.' },
  { component: 'For Lenders', status: 'Simulated',
    notes: 'Real margin-pool IDs and utilization (testnet reads); APYs and rescue-rate are modeled, not yet measured.' },
  { component: 'Dashboard live data', status: 'Roadmap',
    notes: 'Currently sample positions. Reading the connected wallet’s margin managers (logic exists in src/reader.mjs) is the next build.' },
  { component: 'Keeper loop (poll → decide → execute)', status: 'Roadmap',
    notes: 'decide() and the PTB builders exist and are unit-tested; the resilient runtime loop (polling, retry, scheduling) is not built yet.' },
  { component: 'Guardian contract deployment', status: 'Roadmap',
    notes: 'Localnet full-stack publish. Testnet publish is blocked by margin-package version drift (documented in the audit).' },
];

const order: Record<Status, number> = { Live: 0, Simulated: 1, Roadmap: 2 };

export function BuildStatus() {
  const live = ROWS.filter((r) => r.status === 'Live').length;
  const sim = ROWS.filter((r) => r.status === 'Simulated').length;
  const road = ROWS.filter((r) => r.status === 'Roadmap').length;

  return (
    <div className="page" style={{ maxWidth: 1040 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>What's live, what's next</div>
      <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6, maxWidth: 760 }}>
        Guardian is precise about its surface. Below is exactly what runs today, what is the real logic running against a
        scripted environment, and what is on the roadmap. The genuinely finished parts — risk engine, contracts + tests,
        Walrus receipts — are presented with full confidence.
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <Tally n={live} label="Live" cls="Live" />
        <Tally n={sim} label="Simulated" cls="Simulated" />
        <Tally n={road} label="Roadmap" cls="Roadmap" />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="bs-row bs-head">
          <div>Component</div><div>Status</div><div>Notes</div>
        </div>
        {[...ROWS].sort((a, b) => order[a.status] - order[b.status]).map((r, i) => (
          <div className="bs-row" key={i}>
            <div style={{ fontWeight: 600 }}>{r.component}</div>
            <div><span className={`bs-pill ${r.status}`}>{r.status}</span></div>
            <div style={{ color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.5 }}>{r.notes}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tally({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div className="card" style={{ flex: 1, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className={`bs-pill ${cls}`}>{label}</span>
        <span className="num" style={{ fontSize: 22, fontWeight: 800 }}>{n}</span>
      </div>
    </div>
  );
}
