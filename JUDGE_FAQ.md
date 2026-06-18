# Guardian — Judge FAQ

Anticipated questions with evidence-backed answers. Sources: the real DeepBook Margin Move source
(`vendor/deepbookv3`), live testnet reads, and Guardian's own code/tests.

---

### "Isn't this just a stop-loss?"
No — and the reason is *structural*, verified in the protocol's own code:
1. **A stop-loss can't repay debt.** Deleveraging a margin position requires `repay_base/repay_quote`.
   No order type calls repay. Interest keeps accruing on the debt regardless of any resting order.
2. **It targets the wrong variable.** Liquidation triggers on **risk ratio** (`assets_in_debt_unit / debt`),
   which decays with **interest accrual even at constant price** — `liquidate()` reads
   `borrow_shares_to_amount`, which compounds per pool update. A price-based stop is blind to this.
3. **The protocol cancels it first.** `margin_manager::liquidate` calls `cancel_all_orders` as step 1,
   before touching debt. Your protective order is gone the moment liquidation begins.

Guardian operates on risk ratio, repays debt, and — for the worst case — *is* the liquidator.

### "DeepBook already ships TP/SL (`tpsl.move`). Doesn't that kill you?"
We found that in Phase A and sharpened the pitch around it. Native TP/SL (verified in code):
- triggers only on **oracle price**, not risk ratio → blind to interest drift;
- can only place DeepBook orders → **cannot repay debt**;
- is **static** once registered → no re-sizing as volatility / book depth / utilization change;
- does nothing once liquidation starts.
Guardian is the **risk-ratio brain** that orchestrates the protocol's own primitives — TP/SL,
reduce-only v2 (whose monotonic-RR postcondition the protocol already enforces), repay envelopes,
and permissionless `liquidate` — under one policy. "DeepBook gave traders the limbs; Guardian is the
nervous system."

### "What if DeepBook builds native auto-deleverage / repay-on-trigger?"
That's the one true existential risk (tracked in §13). Mitigation: Guardian is the *programmable
policy layer* — custom risk appetites, portfolio logic, AI policy authoring, a permissionless keeper
network, and white-knight reward capture — the part a protocol team deliberately leaves to the
ecosystem (their own launch post invites apps to "embed margin… and liquidation logic"). We monitor
their repo for a native repay-on-trigger feature; until then, no protocol primitive sees risk ratio
the way our engine does.

### "Who has custody? Can Guardian steal funds?"
No. The reduce-only invariant is structural, enforced in Move:
- `guardian::executor` has **no code path** that returns a `Coin` to any address other than the
  manager owner. Repay proceeds go to the margin pool; cancel refunds stay in the manager.
- `execute_protection` ends with `assert_reduce_only`: **debt never increases**, and the action made
  progress. `whiteknight_rescue` forwards 100% of seized collateral to `policy.owner`.
- Every mutating margin call is owner-gated (`ctx.sender() == owner`) — Guardian rides a *pre-signed
  owner envelope*; the keeper can only broadcast it, and the on-chain trigger/rate-limit guards make
  premature broadcast abort. 18/18 negative tests cover this (S1/S5/S6/S7).

### "Is the AI just decorative?"
We embrace the opposite and say so on stage. Execution is **100% deterministic** (closed-form math,
`src/risk.mjs`). AI survives only where it adds real value and can't cause harm:
- **Policy composer** — NL → schema-validated params the user confirms (never actions). Same bounds
  the contract enforces, so prompt injection is inert (test: "set slippage to 100%, tier 9" still
  yields a bounded, valid policy).
- **Action explainer** — plain English generated **from the structured event log alone** (pure
  function — reproducible; feed the same JSON twice, get the same substance).
If the AI is down, the product is fully functional minus narration. That honesty is a credibility
signal, not a weakness.

### "Show me it's real, not a mock."
- Live testnet ground-truth reader: `node scripts/guardian.mjs read <managerId>` — real RR, debt,
  collateral, fresh Hermes price, on-chain Pyth staleness, pool utilization, P_liq.
- Real on-chain write proofs (testnet, today): create / deposit+borrow / **repay** (debt 0.15→0.10) /
  **cancel_orders** — four tx digests in DEMO_SCRIPT.md.
- Backtest: `node scripts/backtest.mjs` confirms the closed-form invariant `RR(P_liq) = 1.10000000`
  exactly, with σ seeded from live-recorded SUI samples.
- 33/33 JS tests, 18/18 Move tests.

### "Does the executor actually run on testnet?"
**Yes.** `execute_protection` runs against a real DeepBook margin manager on Sui testnet today:
Pyth-refreshed in the same PTB, it deleveraged debt **0.10 → 0.00 SUI**, the reduce-only invariant
held, and `ProtectionExecuted` was emitted (tx `6j2q7XiMY6TMEfdJhX5oLZad7JfQTUxar9iTFpE8GE8x`).
The reward returns to the position owner — non-custodial and permissionless.

The one thing we *can't* do on testnet is **manufacture a crash**: Pyth feeds track real prices and
are admin-gated, so the breach-then-rescue cinematic (Rescue Theater) plays a scripted price path
through the real engine. The executor mechanics themselves are live, not simulated. (Getting here
required linking Guardian against the exact margin version the live pools accept — `0xd6a4`, the
older deployment — since the public deepbookv3 `main` links a disabled upgrade.)

### "What's the liquidation cost you're saving?"
Verified testnet params: liquidation at RR < **1.10**, reward **2% user + 3% pool = 5%** of repaid
value (3%+2% on the DBTC pool). Mainnet already shows real bad debt: an admin injected **≈$283,605
USDC** to cover `pool_default` across five liquidation events (digest in the official repo's
`adminInjectCapital.ts`) — late liquidations cost real money 5 months after launch.

### "Is this a feature or a product?"
A platform. MVP = single-manager protection on DeepBook Margin. The path: portfolio policies →
permissionless keeper network with tips → protection-as-a-service SDK for wallets/frontends →
the default risk layer for leveraged anything on Sui (margin, perps, Predict). Clean fee economics
(bps on protected notional + white-knight tip share) and an SDK distribution channel.

### "What can break in the live demo?"
- Sui testnet outage → backup video + localnet recording (mandatory).
- Wallet/extension flakiness → pre-connected, on testnet, dry-run beforehand.
- Hermes/Pyth latency on reads → the reader flags staleness; the Theater is deterministic and offline.
- Keeper offline → policies are on-chain and permissionless; any keeper can serve them; white-knight
  is callable by anyone late.
