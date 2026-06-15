// Guardian documentation — single-page, sticky-TOC reference. Content is drawn from the real
// blueprint, contracts, and risk engine; kept precise and honest (matches the Build Status page).

const TOC = [
  { grp: 'Concepts', items: [['overview', 'Overview'], ['insight', 'The core insight'], ['architecture', 'Architecture']] },
  { grp: 'Risk engine', items: [['risk-engine', 'Risk engine'], ['ladder', 'Protection ladder'], ['white-knight', 'White-knight economics']] },
  { grp: 'On-chain', items: [['contracts', 'Move contracts'], ['reduce-only', 'Reduce-only invariant'], ['security', 'Security model']] },
  { grp: 'Off-chain', items: [['composer', 'Composer & explainer'], ['walrus', 'Walrus receipts'], ['custody', 'Non-custodial model']] },
  { grp: 'Reference', items: [['running', 'Running locally'], ['status', 'Build status'], ['glossary', 'Glossary']] },
];

export function Docs() {
  return (
    <div className="docs-layout">
      <nav className="docs-toc">
        {TOC.map((g) => (
          <div key={g.grp}>
            <div className="grp">{g.grp}</div>
            {g.items.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
          </div>
        ))}
      </nav>

      <article className="prose">
        <h1>Guardian documentation</h1>
        <p className="sub">A non-custodial liquidation-defense layer for DeepBook Margin on Sui. This page documents the
          system as it is actually built — concepts, the risk math, the Move contracts, the security model, and how to run it.</p>

        <section id="overview">
          <h2>Overview</h2>
          <p>On DeepBook Margin a position's survival depends on a continuously decaying <b>risk ratio</b>
            (<code>assets_in_debt_unit / debt</code>). It falls as price moves against you <i>and</i> as interest accrues on your
            debt — so you can be liquidated with the price unchanged. Enforcement is a permissionless race in which a liquidator
            pays your debt and seizes your collateral plus a reward (≈5%), and the protocol cancels your open orders before it
            liquidates you.</p>
          <p>Guardian operates on that same variable. It predicts liquidation with a deterministic risk engine, deleverages the
            position with the only actions that work on-chain (cancel orders, repay debt), and — when rescue is impossible —
            self-liquidates the position itself so the liquidation reward returns to you rather than a bot. It never takes
            custody: no code path moves your collateral anywhere but back to you.</p>
        </section>

        <section id="insight">
          <h2>The core insight</h2>
          <p>Every ordinary self-protection tool fails on DeepBook Margin, and the reason is structural, not a UX gap:</p>
          <ul>
            <li>A stop-loss is a resting order. It cannot call <code>repay()</code>, so it can never reduce your debt or the
              interest compounding on it.</li>
            <li>Liquidation triggers on <b>risk ratio</b>, not price. Interest drift breaches the threshold even at a flat price —
              something a price-based stop cannot represent.</li>
            <li>The documented first step of liquidation is "cancel all open orders." Your protective order is removed the moment
              liquidation begins.</li>
          </ul>
          <p>Guardian's answer is to act on the risk ratio, with debt repayment, under a contract that can only ever reduce your
            exposure — and to make the unavoidable case (liquidation) pay you instead of a bot.</p>
        </section>

        <section id="architecture">
          <h2>Architecture</h2>
          <p>Five layers, each independently testable:</p>
          <table>
            <thead><tr><th>Layer</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td><code>src/risk.mjs</code></td><td>Pure risk engine — P_liq, breach probability, EWMA σ, exit-cost, GRS.</td></tr>
              <tr><td><code>contracts/sources/</code></td><td><code>guardian::policy / executor / registry</code> — the on-chain authority, ladder, and white-knight.</td></tr>
              <tr><td><code>src/reader.mjs</code></td><td>Oracle-free on-chain reads + fresh Hermes pricing → live RR / debt / P_liq.</td></tr>
              <tr><td><code>src/keeper.mjs</code></td><td>Deterministic <code>decide()</code> + PTB builders wiring the engine to the executor.</td></tr>
              <tr><td><code>frontend/</code></td><td>React/Vite app: dashboard, composer, Rescue Theater, Saves Wall, Lenders, Build status.</td></tr>
            </tbody>
          </table>
        </section>

        <section id="risk-engine">
          <h2>Risk engine</h2>
          <p>All math operates on the protocol's documented mechanics: <code>RR = assets/debt</code>, isolated margin (one borrow
            side), kinked interest, and per-pool registry thresholds. Every output traces to a formula — there are no fitted
            constants.</p>

          <h3>Closed-form liquidation price</h3>
          <p>For a quote-borrow long (base collateral, quote debt):</p>
          <div className="formula">RR(P) = (Q_b · P + Q_q) / D_q     →     P_liq = (RR_liq · D_q − Q_q) / Q_b</div>
          <p>For a base-borrow short the debt is in base units and the symmetric solution is:</p>
          <div className="formula">RR(P) = (Q_b · P + Q_q) / (D_b · P)     →     P_liq = Q_q / (RR_liq · D_b − Q_b)</div>
          <p>Both directions are implemented and unit-tested. A backtest sweeps price and confirms the invariant
            <code>RR(P_liq) = RR_liq</code> holds to <code>1.10000000</code> exactly.</p>

          <h3>Interest-adjusted breach probability</h3>
          <p>Debt grows as <code>D(t) = D · (1 + r(u))^t</code>, so <code>P_liq</code> itself drifts upward over the horizon.
            Guardian solves the lognormal breach against the drifted liquidation price:</p>
          <div className="formula">z = ln(P_liq(T) / P) / (σ · √T)     P_breach(T) = Φ(z)   for the adverse direction</div>
          <p>This lets Guardian predict liquidations that occur with <i>zero</i> price movement — pure interest drift — which no
            price-alert tool can express.</p>

          <h3>Volatility & exit cost</h3>
          <ul>
            <li><b>EWMA volatility</b> (RiskMetrics, λ = 0.94) computed from a real price stream.</li>
            <li><b>Exit cost</b> walks the live orderbook: <code>slippage(q) = (P − VWAP_fill(q)) / P</code> for the quantity
              needed to restore the target ratio — so protection timing is coupled to liquidity, not just price.</li>
          </ul>

          <h3>Guardian Risk Score (0–100)</h3>
          <div className="formula">{`GRS = 100 · clamp( w₁·S_margin + w₂·S_prob + w₃·S_interest + w₄·S_exit + w₅·S_pool , 0, 1)
w = { margin .35, prob .30, interest .10, exit .15, pool .10 }`}</div>
          <p>Bands: <code>&lt;30 SAFE</code> · <code>30–60 WATCH</code> · <code>60–80 PROTECT</code> · <code>&gt;80 EMERGENCY</code>.
            Weights are config, shown in the UI, and every component traces to a real input.</p>
        </section>

        <section id="ladder">
          <h2>Protection ladder</h2>
          <p>When <code>RR &lt; trigger_rr</code>, the executor runs a deterministic ladder. Each step strictly decreases debt or
            order exposure — the invariant the contract enforces.</p>
          <ul>
            <li><b>Cancel</b> non-protective open orders (frees locked balance, ~0 cost, unsandwichable).</li>
            <li><b>Repay from idle</b>: <code>repay(min(idle, debt))</code> — the only on-chain action that deleverages.</li>
            <li><b>Reduce-only tranches</b>: sell collateral via reduce-only orders and repay the proceeds (the protocol enforces
              a monotonic-RR postcondition on these). <i>Roadmap on-chain.</i></li>
            <li><b>White-knight</b> if the crash outruns the ladder (see below).</li>
          </ul>
          <div className="note">The implemented on-chain executor runs steps 1–2 (cancel + repay-from-idle). Reduce-only tranches
            are specified and present in the protocol, scheduled for the executor on the roadmap — see the Build Status page.</div>
        </section>

        <section id="white-knight">
          <h2>White-knight economics</h2>
          <p>Liquidation is permissionless and pays the caller a reward. When a position must be liquidated, Guardian is the
            caller — and returns the reward to the user. The math is exact and the vault is made whole each rescue:</p>
          <p>The liquidator pays <code>repay · (1 + pool_reward)</code> and receives collateral worth
            <code>repay · (1 + user_reward + pool_reward)</code>. Guardian forwards only the user-reward slice to the owner and
            retains the rest (its outlay) in the float vault:</p>
          <div className="formula">owner_fraction = user_reward / (1 + user_reward + pool_reward)
owner receives  = owner_fraction · collateral   ( = repay · user_reward )
vault retains   = collateral − owner_share       ( = its outlay )</div>
          <div className="callout">The user nets the ~2–5% reward an MEV bot would otherwise keep, and the float is preserved
            across rescues. This is verified by the Move test <code>whiteknight_float_preserved_across_n_rescues</code>, which runs
            10 consecutive rescues and asserts the starting float is unchanged.</div>
        </section>

        <section id="contracts">
          <h2>Move contracts</h2>
          <p>Three small, auditable modules. Every threshold uses the protocol's 9-decimal fixed-point convention.</p>
          <h3>guardian::policy</h3>
          <p>A <code>ProtectionPolicy</code> is an owned object bound at creation to the manager's owner, id, and pool. It stores
            only what the executor enforces: <code>trigger_rr</code>, <code>target_rr</code>, the rate limit, and a segregated
            <code>keeper_tip</code> balance. Create / update / revoke are owner-only; <code>assert_thresholds</code> enforces
            <code>1.0 &lt; trigger_rr &lt; target_rr</code>.</p>
          <h3>guardian::executor</h3>
          <p><code>execute_protection</code> runs the cancel → repay ladder under on-chain guards that are revalidated even though
            the owner pre-signed the envelope (the keeper cannot fire it early): policy active &amp; Tier-2, policy↔manager binding,
            rate limit, and <code>RR &lt; trigger_rr</code>. It ends in the reduce-only postcondition.
            <code>whiteknight_rescue</code> composes <code>margin::liquidate</code> and distributes proceeds as above.</p>
          <h3>guardian::registry</h3>
          <p>Shared object holding aggregate stats and the <code>GuardianVault</code> white-knight float (a multi-asset bag).</p>
        </section>

        <section id="reduce-only">
          <h2>Reduce-only invariant</h2>
          <p>The executor's safety rests on two enforced facts plus a structural one:</p>
          <ul>
            <li><b>Debt is monotonic.</b> <code>assert_reduce_only</code> asserts <code>debt_after ≤ debt_before</code> and that the
              action made progress. Verified by negative tests (S6).</li>
            <li><b>Collateral only ever goes to the owner.</b> The two collateral-forwarding sites send to
              <code>policy.owner()</code>, which is bound to <code>manager.owner()</code> at creation and cannot drift (the
              MarginManager has no owner transfer). The keeper tip comes only from the segregated tip pot.</li>
          </ul>
          <div className="note">Honest scope: this is enforced by assertion + a verified-destination review, not by the absence of
            transfer code (the module does contain transfers — to the owner and the tip recipient). A property test pinning the
            only transfer destinations is on the roadmap.</div>
        </section>

        <section id="security">
          <h2>Security model</h2>
          <p>Threats and mitigations (the on-chain guards are exercised as negative unit tests — each attack aborts on a named
            code):</p>
          <table>
            <thead><tr><th>#</th><th>Attack</th><th>Mitigation</th></tr></thead>
            <tbody>
              <tr><td>S1</td><td>Malicious/buggy keeper fires at the wrong time</td><td>Trigger + rate-limit revalidated on-chain; worst case bounded to "slightly conservative".</td></tr>
              <tr><td>S2</td><td>Oracle manipulation</td><td>Inherits the protocol's safe-oracle path (staleness + confidence + EWMA) via <code>risk_ratio</code>.</td></tr>
              <tr><td>S3</td><td>MEV front-running of predictable sells</td><td>Reduce-only orders bounded by max slippage; repay-from-idle is unsandwichable and runs first.</td></tr>
              <tr><td>S4</td><td>Tip-drain griefing</td><td>Tips paid only on successful, condition-verified execution from a segregated pot.</td></tr>
              <tr><td>S5</td><td>Fake policy referencing a victim's manager</td><td>Policy↔manager binding checked on creation and on every execute.</td></tr>
              <tr><td>S6</td><td>State confusion / debt increase</td><td>Reduce-only postcondition asserts debt never increases.</td></tr>
              <tr><td>S7</td><td>Param injection via the composer</td><td>Schema + bounds validation mirrors <code>assert_thresholds</code>; the contract is the final gate.</td></tr>
              <tr><td>S8</td><td>Keeper liveness</td><td>Policies are on-chain and permissionless; the white-knight is callable by anyone, late.</td></tr>
              <tr><td>S9</td><td>White-knight abuse</td><td>Only fires when the protocol's own <code>can_liquidate</code> holds; 100% of the reward returns to the user.</td></tr>
            </tbody>
          </table>
        </section>

        <section id="composer">
          <h2>Composer &amp; explainer</h2>
          <p>The execution path is 100% deterministic. Two off-chain helpers add value where they cannot cause harm:</p>
          <ul>
            <li><b>Policy composer</b> — maps a plain-English request to structured parameters, deterministically (keyword
              routing, no model in the loop). Output is re-validated against the same envelope the contract enforces and must be
              user-signed, so a malformed or injected request can never produce an unsafe policy.</li>
            <li><b>Action explainer</b> — turns a structured event into plain English. It is a pure function of the event log, so
              the same event always yields the same explanation.</li>
          </ul>
          <p>There is intentionally no LLM in the runtime. If a model is added later it can only refine phrasing on top of this
            deterministic spine.</p>
        </section>

        <section id="walrus">
          <h2>Walrus receipts</h2>
          <p>Each rescue is designed to publish a tamper-evident receipt — the structured event plus the on-chain transaction —
            to Walrus, so anyone can independently verify that a non-custodial protection actually fired. The schema is versioned:</p>
          <pre><code>{`{ "schema": "guardian.rescue.v1",
  "kind": "ProtectionExecuted" | "WhiteKnightRescue",
  "manager": "0x…", "pair": "SUI/DBUSDC",
  "rr_before": 1.243, "rr_after": 1.451,
  "debt_repaid": 1640, "trigger": "…plain English…",
  "keeper_tx": "…", "network": "testnet", "ts": "…" }`}</code></pre>
          <p>The receipt format and anchoring are live and verifiable today — open any Walrus receipt on the Saves Wall.
            Automatic anchoring on every rescue ships with the keeper loop.</p>
        </section>

        <section id="custody">
          <h2>Non-custodial model</h2>
          <p>Guardian never holds your keys or your collateral. Two tiers cover the spectrum:</p>
          <ul>
            <li><b>Co-pilot</b> — the composer proposes parameters; you sign. The wallet signature you produce is a real
              non-custodial authorization, never a transfer of authority.</li>
            <li><b>Autopilot</b> — you pre-sign a scoped rescue envelope; any keeper may broadcast it, but the executor's on-chain
              guards make premature broadcast abort. The white-knight is fully permissionless and returns proceeds to you.</li>
          </ul>
        </section>

        <section id="running">
          <h2>Running locally</h2>
          <h3>Frontend + Rescue Theater (under 5 minutes, no Sui CLI)</h3>
          <pre><code>{`cd frontend
npm install
npm run dev      # → http://localhost:5173`}</code></pre>
          <h3>Risk-engine &amp; keeper tests</h3>
          <pre><code>{`npm install      # repo root
npm test         # 33 tests
node scripts/backtest.mjs`}</code></pre>
          <h3>Move contract tests</h3>
          <pre><code>{`cd contracts
sui move test --gas-limit 100000000000   # 15 tests`}</code></pre>
          <div className="note">The Move deps (Pyth, Wormhole) ship <code>Move.&lt;network&gt;.toml</code> with a placeholder
            <code>Move.toml</code>. On a fresh machine, if the build errors parsing a placeholder manifest, copy the testnet
            flavor over it in the <code>~/.move/git</code> cache. See <code>AUDIT_PROD_READINESS.md</code> for the full note.</div>
        </section>

        <section id="status">
          <h2>Build status</h2>
          <p>Guardian is precise about its surface. The in-app <b>Build status</b> page lists every component as Live (shipped and
            verifiable), Simulated (real logic over a scripted environment), or Roadmap. In short: the risk engine, contracts +
            tests, reduce-only invariant, composer/explainer, and Walrus receipt format are <b>Live</b>; the Rescue Theater, Saves
            Wall, and Lenders are <b>Simulated</b>; live dashboard reads, the keeper loop, and contract deployment are
            <b>Roadmap</b>. A full production-readiness audit lives at <code>AUDIT_PROD_READINESS.md</code>.</p>
        </section>

        <section id="glossary">
          <h2>Glossary</h2>
          <table>
            <thead><tr><th>Term</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td>Risk ratio (RR)</td><td><code>assets_in_debt_unit / debt</code>. The variable liquidation triggers on. Decays with price and interest.</td></tr>
              <tr><td>P_liq</td><td>The mark price at which RR reaches the pool's liquidation threshold.</td></tr>
              <tr><td>GRS</td><td>Guardian Risk Score, 0–100, a weighted blend of five risk components.</td></tr>
              <tr><td>Trigger / target RR</td><td>Act below <code>trigger_rr</code>; the ladder aims to restore toward <code>target_rr</code>.</td></tr>
              <tr><td>White-knight</td><td>Guardian self-liquidating a doomed position to capture the reward for the user.</td></tr>
              <tr><td>Reduce-only invariant</td><td>The guarantee that the executor can only ever decrease debt/exposure.</td></tr>
            </tbody>
          </table>
        </section>
      </article>
    </div>
  );
}
