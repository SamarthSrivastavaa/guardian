# Guardian — Demo Script ("The Rescue Theater")

Target: ~3 minutes. Everything shown is backed by the real risk engine, real contracts, and real
on-chain transactions. Numbers are computed from formulas (`src/risk.mjs`), never hardcoded —
the only scripted part is the crash price path (which is fine and expected; we own the market).

Backup video: record one clean run of the Rescue Theater + the testnet tx proofs before demo day.

---

## 0:00 — Hook (one stat, one structural claim)

> "Last cycle, liquidation bots extracted billions from leveraged traders. On DeepBook Margin,
> the protocol **cancels your stop-loss before it liquidates you** — it's step one of the
> liquidation flow, in the code. Stop-losses are provably insufficient here. We fixed the whole
> category."

Show: the landing/dashboard header. One line: *non-custodial liquidation defense for DeepBook Margin.*

Why it lands: this is R1 from the blueprint — a *structural* argument, verified in
`margin_manager::liquidate` (it calls `cancel_all_orders` before touching debt). Not rhetoric.

## 0:25 — Setup (non-custodial onboarding)

- Open **Policy composer**. Type one English sentence: *"Protect this conservatively — I sleep 11pm–7am."*
- Click **Compose policy**. The structured params appear (trigger 1.40 / target 1.60 / white-knight 1.13),
  a green **"passes the on-chain safety envelope"** check, and a plain-English **"What Guardian may do / may not do"** list.
- Connect wallet → **Confirm & sign policy**. A real wallet signature over the policy envelope appears.

Say: *"The AI only proposes parameters you confirm — it never touches execution. Same bounds the
contract enforces, so a bad prompt can't make an unsafe policy. You sign; Guardian never has custody."*

## 0:50 — The crash begins

- Open **Rescue Theater**. Two identical 10 SUI / 6 DBUSDC longs — one **naked**, one **Guardian-protected**.
- Hit **Run the crash**. Price bleeds from 0.95 toward 0.60. Watch both **GRS gauges climb** with the
  live component breakdown (margin / prob / interest / exit / pool).

Say: *"This is the live risk engine — closed-form liquidation price, interest-drift-adjusted breach
probability, EWMA volatility, orderbook exit-cost. Not a gauge sticker."*

## 1:20 — Intervention (the deterministic ladder)

- The GUARDIAN side trips its trigger first. The ladder fires: **cancel orders → repay from idle → reduce-only tranche**.
  Each action narrates in plain English (the action explainer), debt drops, RR recovers.
- The NAKED side keeps falling.

Say: *"Guardian acts on the variable the protocol actually enforces — risk ratio, not price — using
the only action that deleverages: repaying debt. Every step strictly reduces debt; the contract
asserts that as a postcondition."*

## 1:50 — The kill shot

- NAKED hits **RR 1.10** → external liquidation fires; **−5% of collateral gone** (2% user + 3% pool
  reward, the verified testnet params); the panel flashes red, "LIQUIDATED."
- GUARDIAN side: green, smaller, **alive**. Side-by-side **P&L verdict** in quote terms.

Say: *"Same crash. One trader paid the bot 5%. The other is still in the game."*

## 2:20 — White-knight encore

- Reset, run a steeper crash where even the ladder can't keep up. As RR crosses the liquidation
  threshold, **Guardian self-liquidates the user's own position** and the collateral (incl. the reward)
  flows **back to the user's wallet**, not a bot.

Say: *"Even our failure mode pays you. The 5% a MEV bot would take — we capture it for you. Nobody
else offers 'lose 0% to liquidators.'"*

## 2:45 — Proof + close

- Flip to the **testnet tx receipts** (below). These are real, on Sui testnet, today:
  - create manager · `BrCVCXQbpSt1e5YuUWqTgZccXj52PLwDAm9sCoDAYKop`
  - deposit + borrow (Pyth-refreshed) · `7WssiTcY7aD2vXQdf7f2RbML1t5wTLcjvVdjpRYNNpLb`
  - **repay** (debt 0.15→0.10) · `2c1yvhHe3WU2fdYzGSxvVp5uxpBBH58FEmAP6U3UaoBn`
  - **cancel_orders** · `93WMERKRbUtVf8bLTPftLwnZX7ZqtJb57nVAdMUhaEKD`
- Contracts: `guardian::policy / executor / registry`, 18/18 guard tests green, reduce-only invariant
  enforced in Move.

Say: *"Read path live on testnet against Mysten's deployed margin. Deterministic execution, custody-free,
auditable. The risk layer for leveraged anything on Sui."*

---

## Scripted crash trigger (Rescue Theater)

The crash is deterministic (seeded path in `RescueTheater.tsx`, `buildPath()`), so every run is
identical and rehearsable. The "Run the crash" button is the only trigger — no external bot needed
for the on-screen demo. The price *path* is scripted (testnet Pyth feeds are real + admin-gated, so
we can't manufacture a breach), but the **executor itself runs on testnet** — see the live-executor
beat below.

## Live on-chain executor (testnet ground truth)

```
node scripts/protect.mjs    # creates a real ProtectionPolicy, then fires execute_protection
                            # against the live margin manager — Pyth-refreshed, deleverages on-chain,
                            # ProtectionExecuted emitted. (Re-borrow first if the manager's debt is 0.)
```
Proven tx: `6j2q7XiMY6TMEfdJhX5oLZad7JfQTUxar9iTFpE8GE8x` (debt 0.10→0.00 SUI, reduce-only held).

## Live testnet commands (ground truth, run beforehand to refresh receipts)

```
node scripts/guardian.mjs read   <managerId>          # live RR / debt / oracle / P_liq
node scripts/guardian.mjs setup  0.3 0.15             # create + deposit + borrow
node scripts/guardian.mjs repay  <managerId> 0.05     # real deleverage
node scripts/guardian.mjs cancel <managerId>          # real cancel_orders
node scripts/backtest.mjs        <managerId>          # P_liq invariant + GRS ladder
```

## Pre-demo checklist
- [ ] `npm test` (33/33) and `sui move test` (18/18) green.
- [ ] Dev wallet funded; refresh the four testnet receipts; copy digests into the deck.
- [ ] Frontend `npm run build` clean; dev server warm; wallet extension installed + on testnet.
- [ ] Backup video recorded (full Rescue Theater + receipts).
- [ ] Demo manager carries debt (`node scripts/guardian.mjs read <managerId>`); re-borrow if 0 so `protect.mjs` fires.
