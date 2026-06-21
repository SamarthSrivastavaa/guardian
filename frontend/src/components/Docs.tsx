// Guardian product documentation — a single-page, sticky-TOC explanation of the service:
// what it is, how it protects a position, and why it is safe. Written for users and partners,
// not developers — no setup, no commands, no file references.

const TOC = [
  { grp: 'Overview', items: [['overview', 'What Guardian is'], ['problem', 'Why positions die'], ['how', 'How it works']] },
  { grp: 'Protection', items: [['risk-engine', 'The risk engine'], ['ladder', 'The protection ladder'], ['white-knight', 'White-knight rescue']] },
  { grp: 'Trust', items: [['guarantees', 'On-chain guarantees'], ['reduce-only', 'The reduce-only guarantee'], ['custody', 'Non-custodial by design'], ['security', 'Security model']] },
  { grp: 'Using Guardian', items: [['tiers', 'Protection tiers'], ['receipts', 'Receipts & verification'], ['glossary', 'Glossary']] },
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
        <h1>Guardian</h1>
        <p className="sub">A non-custodial liquidation-defense layer for DeepBook Margin on Sui. Guardian watches a leveraged
          position around the clock, deleverages it before it can be liquidated, and — when a crash is unavoidable — liquidates the
          position itself so the reward goes back to you instead of a bot. It never takes custody of your funds.</p>

        <section id="overview">
          <h2>What Guardian is</h2>
          <p>When you borrow against collateral on DeepBook Margin, your position is governed by a single number — the
            <b> risk ratio</b> (the value of your assets measured against your debt). If it falls far enough, anyone may liquidate
            you: they repay your debt, seize your collateral, and keep a reward of roughly 5%. Liquidation is fast, public, and
            unforgiving.</p>
          <p>Guardian is the layer that stands between you and that outcome. It continuously measures your true distance to
            liquidation, acts early to pull you back to safety, and treats the worst case as a value to be recovered rather than
            lost. You stay in control of your wallet and your collateral the entire time.</p>
        </section>

        <section id="problem">
          <h2>Why positions die</h2>
          <p>The reason ordinary protection fails here is structural, not a matter of better alerts:</p>
          <ul>
            <li><b>Liquidation triggers on the risk ratio, not on price.</b> Interest accrues on your debt every block, so the
              ratio decays even when the market is perfectly flat — you can be liquidated without the price moving at all. A
              price alarm cannot see this coming.</li>
            <li><b>A stop-loss cannot repay debt.</b> It only sells — it can never reduce the loan or the interest compounding on
              it, which is the only thing that actually restores your safety on a margin position.</li>
            <li><b>Liquidation cancels your orders first.</b> The very first step of the liquidation process cancels every resting
              order on your account — so even a stop-loss that fires too late has the order it just placed wiped out before your
              collateral is touched.</li>
          </ul>
          <p>Guardian is built around these facts: it acts on the risk ratio, it repays debt, and it operates through a contract
            that is only ever allowed to reduce your exposure.</p>
        </section>

        <section id="how">
          <h2>How it works</h2>
          <p>Guardian is four cooperating parts working on one position:</p>
          <table>
            <thead><tr><th>Part</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td>Risk engine</td><td>Predicts liquidation from live market and position data — distance to liquidation, the probability of a breach, volatility, and exit cost — and rolls them into a single score.</td></tr>
              <tr><td>Policy</td><td>An on-chain rule you create that says exactly when and how Guardian may act on your position, and nothing more.</td></tr>
              <tr><td>Keeper</td><td>An always-on service that watches every protected position and triggers the agreed action the moment your policy's conditions are met.</td></tr>
              <tr><td>On-chain executor</td><td>The smart contract that performs the deleverage under guarantees it cannot violate — and self-liquidates for your benefit when rescue is no longer possible.</td></tr>
            </tbody>
          </table>
          <p>You connect a wallet, describe how you want to be protected, and confirm a policy. From then on Guardian monitors the
            position and acts within the limits you set.</p>
        </section>

        <section id="risk-engine">
          <h2>The risk engine</h2>
          <p>Every decision Guardian makes is driven by a transparent risk engine. There are no opaque models and no fitted
            constants — each number traces back to the protocol's own mechanics and a published formula.</p>

          <h3>Distance to liquidation</h3>
          <p>For any position Guardian solves, in closed form, the exact mark price at which liquidation would begin — the
            liquidation price <code>P_liq</code> — for both long and short borrows:</p>
          <div className="formula">RR(P) = (collateral priced at P) / debt     →     P_liq solves RR(P_liq) = liquidation threshold</div>
          <p>This is the honest distance to the edge, recomputed continuously as the market moves.</p>

          <h3>Breach probability — including pure interest drift</h3>
          <p>Because debt grows with interest, the liquidation price itself drifts upward over time. Guardian projects that drift
            and computes the probability of a breach over a chosen horizon:</p>
          <div className="formula">P_breach(T) = Φ( ln(P_liq(T) / P) / (σ · √T) )</div>
          <p>This lets Guardian foresee liquidations that would happen with <i>zero</i> price movement — driven by interest
            alone — something no price-based tool can express.</p>

          <h3>Volatility, exit cost, and the Guardian Risk Score</h3>
          <ul>
            <li><b>Volatility</b> is measured from a live price stream, weighting recent moves more heavily.</li>
            <li><b>Exit cost</b> is read from the live order book — how much slippage it would take to deleverage the position
              right now — so timing is tied to real liquidity, not just price.</li>
          </ul>
          <p>These combine into the <b>Guardian Risk Score</b> (0–100), a single, legible gauge of how close a position is to
            danger, banded into <b>Safe</b>, <b>Watch</b>, <b>Protect</b>, and <b>Emergency</b>. You see the same score Guardian
            acts on.</p>
        </section>

        <section id="ladder">
          <h2>The protection ladder</h2>
          <p>When a position crosses the trigger you set, Guardian works down a ladder of actions, each one strictly reducing your
            exposure:</p>
          <ul>
            <li><b>Cancel open orders</b> — frees balance locked in resting orders at effectively no cost.</li>
            <li><b>Repay debt from idle balance</b> — the one action that genuinely deleverages you and stops interest from
              compounding.</li>
            <li><b>Reduce-only deleverage</b> — sell collateral and repay the proceeds to climb back toward your target ratio.</li>
            <li><b>White-knight rescue</b> — if a crash outruns the ladder, Guardian liquidates the position for your benefit
              (below).</li>
          </ul>
          <p>The ladder is deterministic: the same conditions always produce the same response, and every step is bounded by the
            policy you signed.</p>
        </section>

        <section id="white-knight">
          <h2>White-knight rescue</h2>
          <p>Sometimes a position is already past saving — the market gapped through the liquidation point. In that case
            liquidation will happen no matter what, and someone will collect the reward. Guardian makes sure that someone is
            <b> you</b>.</p>
          <p>Liquidation is permissionless and pays the caller a reward on top of the debt repaid. When a position must be
            liquidated, Guardian races to be the liquidator and returns the reward to the position's owner:</p>
          <div className="formula">the liquidator earns ≈ 5% of the repaid value
Guardian forwards the owner's share back to you — not an MEV bot</div>
          <p>The economics are exact, and the funds Guardian uses to perform the rescue are fully recovered each time, so the
            service can keep doing it. An automated invariant check runs ten consecutive rescues and confirms the reserve is left
            whole — the reward genuinely reaches the user, every time.</p>
        </section>

        <section id="guarantees">
          <h2>On-chain guarantees</h2>
          <p>Guardian's authority lives in three small, auditable smart contracts, so its limits are enforced by the chain rather
            than promised by an app:</p>
          <ul>
            <li><b>Policy</b> — the rule you create. It is bound at birth to your wallet, your specific position, and your chosen
              thresholds. Only you can change or revoke it.</li>
            <li><b>Executor</b> — the only component that can act on a protected position, and only within the policy's guards:
              the action is checked against your trigger, a rate limit, and the correct position binding before anything happens,
              and it always ends by proving your debt did not increase.</li>
            <li><b>Registry &amp; reserve</b> — aggregate statistics and the segregated reserve that funds white-knight rescues.</li>
          </ul>
        </section>

        <section id="reduce-only">
          <h2>The reduce-only guarantee</h2>
          <p>The single most important property of Guardian is this: <b>the executor can only ever reduce your exposure.</b></p>
          <ul>
            <li><b>Your debt never increases.</b> Every action ends with an on-chain check that the debt afterwards is no greater
              than before, and that the action actually made progress.</li>
            <li><b>Collateral only ever returns to you.</b> Every path that moves collateral sends it to the position's owner —
              bound to your wallet when the policy is created and unable to change. Guardian cannot move your assets anywhere
              else.</li>
          </ul>
          <p>In practice this means the worst a misbehaving keeper can do is deleverage you slightly early — never take a position
            on, never increase your risk, and never move your funds off to a third party.</p>
        </section>

        <section id="custody">
          <h2>Non-custodial by design</h2>
          <p>Guardian never holds your keys or your collateral. You authorize a precise, revocable scope of action and nothing
            more. Two ways to grant it:</p>
          <ul>
            <li><b>Confirm each action</b> — Guardian alerts you and you approve the rescue with a single signature.</li>
            <li><b>Pre-authorize autopilot</b> — you sign one scoped rescue authorization in advance; the keeper can submit it,
              but the on-chain guards make any premature or out-of-policy use fail. Your key never leaves your wallet, and the
              keeper holds no standing authority over your funds.</li>
          </ul>
          <p>You can revoke a policy at any time, instantly and unconditionally.</p>
        </section>

        <section id="security">
          <h2>Security model</h2>
          <p>Guardian is designed adversarially — assume the keeper and the network are hostile, and let the chain enforce safety.
            The main threats and how they are contained:</p>
          <table>
            <thead><tr><th>Threat</th><th>How it is contained</th></tr></thead>
            <tbody>
              <tr><td>A malicious or buggy keeper acts at the wrong time</td><td>Your trigger and rate limit are re-checked on-chain at execution; the worst case is bounded to "slightly conservative".</td></tr>
              <tr><td>Oracle manipulation</td><td>Guardian inherits the protocol's safe-price path — staleness and confidence checks — and never reads an unrefreshed price.</td></tr>
              <tr><td>Front-running of a predictable sell</td><td>Repaying from idle balance runs first and cannot be sandwiched; market deleverages are bounded by a slippage limit.</td></tr>
              <tr><td>Someone points a fake policy at your position</td><td>The policy-to-position binding is verified when the policy is made and again on every action.</td></tr>
              <tr><td>An attempt to increase your debt</td><td>Impossible — the reduce-only check rejects any action that does not lower it.</td></tr>
              <tr><td>The keeper goes offline</td><td>Policies live on-chain and are permissionless; anyone can run a keeper, and the white-knight remains available even late.</td></tr>
              <tr><td>Abuse of the white-knight</td><td>It only fires when the protocol itself permits liquidation, and the reward is returned to the owner.</td></tr>
            </tbody>
          </table>
        </section>

        <section id="tiers">
          <h2>Protection tiers</h2>
          <p>You choose how much agency to give Guardian. Every tier is non-custodial and bounded by the policy you sign.</p>
          <table>
            <thead><tr><th>Tier</th><th>What Guardian does</th></tr></thead>
            <tbody>
              <tr><td><b>Sentinel</b></td><td>Watches and alerts. Guardian narrates the risk and tells you when to act — you do everything yourself.</td></tr>
              <tr><td><b>Co-pilot</b></td><td>Watches and proposes. When your trigger is hit, Guardian prepares the exact rescue and you approve it with one signature.</td></tr>
              <tr><td><b>Autopilot</b></td><td>Watches and acts. You pre-authorize a scoped rescue; Guardian deleverages you the instant your conditions are met, without waking you up — still entirely non-custodial.</td></tr>
            </tbody>
          </table>
        </section>

        <section id="receipts">
          <h2>Receipts &amp; verification</h2>
          <p>Every protection Guardian performs produces a tamper-evident <b>receipt</b>, published to decentralized storage so
            anyone can verify it independently. A receipt records what happened in plain terms:</p>
          <ul>
            <li>the kind of action — a deleverage or a white-knight rescue;</li>
            <li>the position and trading pair involved;</li>
            <li>the risk ratio before and after, and the amount of debt repaid;</li>
            <li>a plain-English reason the action fired;</li>
            <li>and a link to the on-chain transaction that proves it.</li>
          </ul>
          <p>Because the proof is anchored off the app, a rescue can be checked by anyone, forever — open one from the
            <b> Saves Wall</b> to see a real, verifiable receipt.</p>
        </section>

        <section id="glossary">
          <h2>Glossary</h2>
          <table>
            <thead><tr><th>Term</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td>Risk ratio</td><td>The value of your assets measured against your debt — the number liquidation triggers on. It decays with both price moves and interest.</td></tr>
              <tr><td>Liquidation price</td><td>The mark price at which your risk ratio reaches the threshold and liquidation can begin.</td></tr>
              <tr><td>Guardian Risk Score</td><td>A single 0–100 gauge of how close a position is to danger, banded Safe → Emergency.</td></tr>
              <tr><td>Trigger / target</td><td>Guardian acts when the risk ratio falls below your trigger and works to restore it toward your target.</td></tr>
              <tr><td>White-knight rescue</td><td>Guardian self-liquidating a doomed position so the liquidation reward returns to you instead of a bot.</td></tr>
              <tr><td>Reduce-only</td><td>The guarantee that Guardian can only ever decrease your debt and exposure — never increase it.</td></tr>
              <tr><td>Non-custodial</td><td>Guardian never holds your keys or funds; it acts only within a scope you sign and can revoke.</td></tr>
            </tbody>
          </table>
        </section>
      </article>
    </div>
  );
}
