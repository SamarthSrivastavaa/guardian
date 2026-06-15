type Nav = (v: string) => void;

export function Landing({ go }: { go: Nav }) {
  return (
    <div className="lp">
      {/* HERO */}
      <section className="hero">
        <span className="lp-eyebrow">Sui Overflow 2026 · DeepBook track</span>
        <h1 className="hero-title">The protocol cancels your stop-loss <span className="hl">before it liquidates you.</span></h1>
        <p className="hero-sub">
          Guardian is a non-custodial liquidation-defense layer for DeepBook Margin. It watches the variable the protocol
          actually liquidates on — your <b style={{ color: 'var(--ink)' }}>risk ratio</b>, which decays with interest even at a
          flat price — deleverages your position before liquidation, and if a crash wins anyway, captures the liquidation
          reward for <i>you</i> instead of an MEV bot.
        </p>
        <div className="hero-cta">
          <button className="btn btn-primary btn-lg" onClick={() => go('theater')}>▶ Watch the Rescue Theater</button>
          <button className="btn btn-ink btn-lg" onClick={() => go('dashboard')}>Launch app →</button>
          <button className="btn btn-ghost btn-lg" onClick={() => go('docs')}>Read the docs</button>
        </div>
        <div className="proof-strip">
          <div className="proof-item"><b>1.10000000</b><span>RR(P_liq) — backtest exact</span></div>
          <div className="proof-item"><b>48</b><span>tests · 15 Move + 33 TS</span></div>
          <div className="proof-item"><b>4</b><span>real testnet txs</span></div>
          <div className="proof-item"><b>live</b><span>Walrus receipts</span></div>
          <div className="proof-item"><b>0%</b><span>custody · reduce-only</span></div>
        </div>
      </section>

      {/* THE PROBLEM (R1) */}
      <section className="lp-section">
        <h2>A stop-loss is provably insufficient — and it’s in the docs.</h2>
        <p className="lead">Guardian didn’t invent the problem. DeepBook Margin’s own liquidation flow makes ordinary
          self-protection fail at exactly the moment you need it.</p>
        <div className="r1">
          <div className="r1-card"><b>It can’t repay debt</b><p>Deleveraging needs <code>repay()</code>. No order type can call it, so your debt — and the interest on it — keeps growing.</p></div>
          <div className="r1-card"><b>It targets the wrong thing</b><p>Liquidation triggers on risk ratio, not price. Interest accrual breaches you even when price never moves — a price stop can’t see that.</p></div>
          <div className="r1-card"><b>It’s cancelled first</b><p>Liquidation step 1 is “cancel all open orders.” Your protective order is gone the instant liquidation begins.</p></div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-section">
        <h2>The deterministic protection ladder.</h2>
        <p className="lead">When your risk ratio crosses your trigger, Guardian acts on-chain — every step strictly reduces
          debt or exposure, enforced by a reduce-only postcondition in Move.</p>
        <div className="flow">
          <div className="flow-step"><div className="n">01</div><h3>Cancel orders</h3><p>Free locked collateral back into the manager. Costs ~0, unsandwichable.</p></div>
          <div className="flow-step"><div className="n">02</div><h3>Repay from idle</h3><p>Repay debt with idle balance — the only action that actually deleverages.</p></div>
          <div className="flow-step"><div className="n">03</div><h3>Reduce-only</h3><p>Sell collateral in reduce-only tranches and repay the proceeds (roadmap on-chain).</p></div>
          <div className="flow-step"><div className="n">04</div><h3>White-knight</h3><p>If the crash wins, Guardian self-liquidates and returns the reward to you, not a bot.</p></div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="lp-section">
        <h2>Built like infrastructure.</h2>
        <div className="feat-grid">
          <Feat ico="∑" title="Real risk engine" text="Closed-form liquidation price (both directions), interest-drift breach probability, EWMA volatility, orderbook exit-cost, and a 0–100 Guardian Risk Score. 16 tests + a backtest." />
          <Feat ico="🛡" title="Custody-free by construction" text="The executor has no code path that sends your collateral anywhere but to you. The reduce-only invariant is enforced and tested in Move." />
          <Feat ico="♞" title="White-knight reward capture" text="When liquidation is inevitable, Guardian is the liquidator — and the ~5% an MEV bot would keep is returned to your wallet." />
          <Feat ico="◇" title="Verifiable receipts" text="Every rescue is published as a tamper-evident, versioned receipt on Walrus. Anyone can independently verify a protection fired." />
          <Feat ico="⌘" title="No AI hand-waving" text="Execution is 100% deterministic math. The policy composer maps plain English to schema-validated parameters you sign — no model in the loop." />
          <Feat ico="⊕" title="Both sides of the market" text="Borrowers avoid liquidation; lenders earn more because Guardian deleverages borrowers before bad debt reaches the pool." />
        </div>
      </section>

      {/* CTA */}
      <section className="lp-foot">
        <h2>See it survive a crash.</h2>
        <p className="hero-sub" style={{ margin: '14px auto 28px' }}>Two identical longs, one naked, one protected. Same crash. Watch the risk ratios diverge in real time.</p>
        <div className="hero-cta" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary btn-lg" onClick={() => go('theater')}>▶ Run the Rescue Theater</button>
          <button className="btn btn-ghost btn-lg" onClick={() => go('docs')}>Read the docs</button>
        </div>
      </section>
    </div>
  );
}

function Feat({ ico, title, text }: { ico: string; title: string; text: string }) {
  return (
    <div className="feat">
      <div className="ico">{ico}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
