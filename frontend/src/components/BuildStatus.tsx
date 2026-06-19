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
  { component: 'Policy composer + self-serve onboarding', status: 'Live',
    notes: 'Deterministic NL → parameters, re-validated against the on-chain envelope (assert_thresholds). Connect any wallet, mint your own SUI/DBUSDC margin manager in-app (DeepBook margin_manager::new), and "Confirm" binds a REAL policy to it (guardian::policy::create). Ownership is pre-checked so you never hit an opaque wallet abort. No LLM in the loop, by design.' },
  { component: 'Action explainer', status: 'Live',
    notes: 'Pure template over the structured event log — reproducible from the event alone.' },
  { component: 'Walrus receipt format', status: 'Live',
    notes: 'Versioned schema guardian.rescue.v1; receipts anchored and readable today — click a Walrus receipt on the Saves Wall.' },
  { component: 'Rescue Theater', status: 'Simulated',
    notes: 'The real risk engine + executor ladder + white-knight flow, run deterministically over a scripted price path. Reproducible, offline.' },
  { component: 'Saves Wall feed', status: 'Simulated',
    notes: 'Sample feed; two cards carry real Walrus receipts + real testnet transactions. The keeper now anchors a guardian.rescue.v1 receipt to Walrus automatically after every action (src/walrus.mjs).' },
  { component: 'For Lenders', status: 'Simulated',
    notes: 'Real margin-pool IDs and utilization (testnet reads); APYs and rescue-rate are modeled, not yet measured.' },
  { component: 'Dashboard live data', status: 'Live',
    notes: 'Connect a wallet and the dashboard reads your real margin managers from testnet (getMarginManagerIdsForOwner → live balances, debt, RR + Pyth price); sample positions only when no wallet/managers. Vol/rate soft inputs use modeled defaults.' },
  { component: 'Keeper loop (poll → decide → execute)', status: 'Live',
    notes: 'Resilient daemon (src/daemon.mjs, npm run keeper): event-based policy discovery, the unit-tested decide()/dispatch, retry+backoff, gas/vault guards, structured logging, graceful shutdown. 44/44 JS tests. Runs against live testnet.' },
  { component: 'Autopilot — in-app, non-custodial pre-signed envelopes', status: 'Live',
    notes: 'One-click "Enable autopilot" on any tier-2 policy: the wallet signs an execute-only envelope (dedicated gas coin pinned, no baked VAA) and POSTs it to the keeper intake server, which VERIFIES it (signature + intent + on-chain policy) before storing. The keeper refreshes Pyth just-in-time and relays; sender stays the owner → validate_owner passes, keeper holds no authority. Full loop proven on testnet: forged envelope rejected, valid one enrolled → auto-relayed → deleveraged → Walrus-anchored.' },
  { component: 'Guardian package + policy + registry', status: 'Live',
    notes: 'Deployed on testnet (package 0xed5f64…), linked against the margin version the live pools accept. policy::create executed on-chain — real ProtectionPolicy bound to a real manager. Registry + vault shared objects live.' },
  { component: 'Executor on testnet', status: 'Live',
    notes: 'execute_protection runs against a real DeepBook margin manager on testnet — Pyth-refreshed, deleveraged debt 0.10→0.00 SUI, reduce-only invariant held, ProtectionExecuted emitted (tx 6j2q7X…). Permissionless and non-custodial: the reward returns to the position owner.' },
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
