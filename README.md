<div align="center">

# 🛡 Guardian

### Non-custodial liquidation defense for DeepBook Margin on Sui

Guardian watches your leveraged position around the clock, **deleverages it before it can be liquidated**, and when a crash is unavoidable it **liquidates the position for you**, returning the reward to your wallet instead of an MEV bot. Your keys and collateral never leave your control.

![Sui](https://img.shields.io/badge/Sui-testnet-6FBCF0?logo=sui&logoColor=white)
![Move](https://img.shields.io/badge/Move-2024-000000)
![DeepBook](https://img.shields.io/badge/DeepBook-Margin-FFE500?labelColor=000000)
![Tests](https://img.shields.io/badge/tests-15%20Move%20%2B%2044%20JS-brightgreen)
![Non-custodial](https://img.shields.io/badge/non--custodial-by%20design-success)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

**[▶ Live App](https://guardian-beige.vercel.app) · [🎬 Demo Video](#) · [⛓ Deployed Package](https://suiscan.xyz/testnet/object/0xed5f648eaac50297498883a2c4939d399959494c3981e806a10b8962b446d7fe) · [📄 Docs](https://guardian-beige.vercel.app/#docs)**

*Built for Sui Overflow 2026 · DeepBook track*

</div>

---

## The problem

On DeepBook Margin, your position lives or dies by one number: the **risk ratio** (assets ÷ debt). If it falls far enough, *anyone* can liquidate you: they repay your debt, seize your collateral, and keep a ~5% reward. And the usual safety net doesn't work here, for reasons that are structural, not cosmetic:

- **A stop-loss can only sell; it can never `repay()` your loan.** Reducing the debt (and the interest compounding on it) is the only thing that durably restores safety, and no order type can do it.
- **Liquidation triggers on the risk ratio, not on price.** Interest accrues every block, so the ratio decays **even when the market is flat**: you can be liquidated with zero price movement. A price alarm can't even see it coming.
- **Liquidation cancels your orders first.** The documented first step of liquidation wipes every resting order on your account, so a protective order that fires too late is removed at the exact moment you need it.

> A stop-loss is the wrong tool twice over: it can't repay your debt, and it can't see the interest-driven liquidation coming.

## What Guardian does

Guardian acts on the **risk ratio**, with **debt repayment**, through a contract that can **only ever reduce your exposure**:

| | |
|---|---|
| 🔭 **Predicts** | A transparent risk engine computes your true distance to liquidation, including breaches driven by interest alone, and scores it 0–100. |
| 🪜 **Deleverages** | When you cross your trigger, a deterministic ladder runs on-chain: cancel orders, repay from idle, reduce-only tranches. |
| ♞ **White-knight** | If a crash outruns the ladder, Guardian self-liquidates the instant it's legal and **returns the 5% reward to you**, not a bot. |
| 🔒 **Never custodies** | Every path sends collateral only to the position's owner. Guardian cannot move your funds anywhere else, enforced by the chain. |
| 🤖 **Runs unattended** | A keeper service protects you while you sleep via a **non-custodial pre-signed envelope**: you sign once, and your key never leaves your wallet. |

## Live on testnet, verify it yourself

Everything below is real and on-chain. Click through:

| | Address / Transaction |
|---|---|
| **Guardian package** | [`0xed5f648e…`](https://suiscan.xyz/testnet/object/0xed5f648eaac50297498883a2c4939d399959494c3981e806a10b8962b446d7fe) |
| **Registry** | `0x112d5e90e443ca0c23b9ca3d6ab06ea079104b68727c8996b97e511c5c6458f9` |
| **White-knight vault** | `0xc3d55f58d1d93a02bf080335afa5aeddfcf4c40488265ee85e572d4134b99fd2` |
| **`execute_protection` deleveraged a real manager** | [`6j2q7X…`](https://suiscan.xyz/testnet/tx/6j2q7XiMY6TMEfdJhX5oLZad7JfQTUxar9iTFpE8GE8x): Pyth-refreshed, debt 0.10 → 0.00 SUI, reduce-only held |
| **Autopilot: keeper relayed an owner-signed envelope** | [`831h4dc…`](https://suiscan.xyz/testnet/tx/831h4dcqaqPUuw1myfnr2HoonPPzJtBcmZLushe9eDuP): non-custodial, sender stays the owner |
| **Tamper-evident rescue receipt (Walrus)** | versioned `guardian.rescue.v1`, anchored automatically by the keeper |

## How it works

```
                            ┌─────────────────────────────────────────┐
   Live market + position → │  RISK ENGINE   P_liq · breach prob · GRS │
                            └───────────────┬─────────────────────────┘
                                            │  risk crosses your trigger
                                            ▼
   You sign a POLICY  ─────────────►   KEEPER  (poll → decide → act, 24/7)
   (scope + thresholds)                      │
        non-custodial                        ▼
                            ┌─────────────────────────────────────────┐
                            │  EXECUTOR (Move)                          │
                            │   cancel → repay → reduce-only            │  reduce-only
                            │   ↘ white-knight self-liquidation         │  invariant,
                            │   collateral only ever → you              │  enforced
                            └───────────────┬─────────────────────────┘
                                            ▼
                              Walrus receipt  ·  on-chain proof
```

- **Risk engine:** closed-form liquidation price (both borrow directions), interest-drift-adjusted breach probability, EWMA volatility, an order-book exit-cost walk, and the 0–100 Guardian Risk Score. Pure and unit-tested, with a backtest proving `RR(P_liq) = 1.10` exactly.
- **Move contracts:** `guardian::policy` (owner-bound policies), `guardian::executor` (the ladder + white-knight under a reduce-only postcondition), `guardian::registry` (stats + the white-knight float vault). Compiled and run against the live DeepBook Margin API.
- **Keeper:** a resilient `poll → decide → execute` daemon with event-based policy discovery, retry/backoff, gas/vault guards, an envelope-intake server for in-app autopilot, and automatic Walrus anchoring after every action.
- **App:** Positions dashboard (live testnet reads), a structured natural-language policy composer, the Rescue Theater (the real engine + executor over a scripted crash), the Saves Wall (with real Walrus receipts), and a Lenders view.

## The risk engine

Every decision traces to a published formula, with no opaque models and no fitted constants.

```
Liquidation price   RR(P) = (collateral priced at P) / debt   →   P_liq solves RR(P_liq) = 1.10
Breach probability  P_breach(T) = Φ( ln(P_liq(T) / P) / (σ·√T) )      ← P_liq(T) drifts up with interest
Guardian Risk Score GRS = 100·clamp( wₘ·margin + wₚ·prob + wᵢ·interest + wₑ·exit + w𝒻·pool )
Bands               <30 Safe · 30–60 Watch · 60–80 Protect · >80 Emergency
```

The breach term is the differentiator: it predicts liquidations that happen with **zero price movement**, from interest drift alone, which no price-based tool can express.

## Build status

Guardian is precise about its surface. *Live* = shipped and verifiable, *Simulated* = real logic over a scripted environment, *Roadmap* = next.

| Component | Status | Notes |
|---|---|---|
| Risk engine (P_liq, GRS, breach prob) | **Live** | Unit-tested + backtest (`RR(P_liq)=1.10` exact) |
| Smart contracts (policy/executor/registry) | **Live** | 15 Move tests incl. white-knight float-preservation invariant |
| Reduce-only invariant | **Live** | Debt-monotonic postcondition; collateral only ever to owner |
| Guardian deployment (package/registry/vault) | **Live** | Published on testnet; `policy::create` exercised on-chain |
| Executor on testnet | **Live** | `execute_protection` deleveraged a real manager (tx `6j2q7X…`) |
| Keeper daemon | **Live** | Resilient poll→decide→execute loop; 44/44 JS tests |
| Autopilot (pre-signed envelopes) | **Live** | Non-custodial; owner signs once, keeper relays (tx `831h4dc…`) |
| Dashboard live data | **Live** | Connected wallet's real managers read from testnet |
| Auto-Walrus receipts | **Live** | Keeper anchors a `guardian.rescue.v1` receipt after every action |
| Policy composer / action explainer | **Live** | Deterministic; validated against the on-chain envelope; no LLM by design |
| Rescue Theater · Saves Wall · Lenders | **Simulated** | Real engine/logic + real Walrus receipts & testnet txs on sample data |
| Independent security audit | **Roadmap** | Threat model + invariants scoped; required before mainnet |
| Mainnet | **Roadmap** | Mainnet-capable; gated on the audit + funded keeper + mainnet margin link |

## Why DeepBook

- **Borrowers stay safer** → retention. **Lenders take less bad debt** → protected yield. Guardian is aligned with *both* sides of the market, not just volume.
- **Every action is real DeepBook order flow** (cancel, repay, reduce-only, liquidate), not a side-system bolted on.
- **The white-knight** (liquidation rewards returning to users instead of bots) is a primitive worth becoming standard across Sui.

## Tech stack

**Move 2024** (Sui) · **DeepBook v3 + DeepBook Margin** · **Pyth** (oracle) · **Walrus** (receipts) · **@mysten/sui**, **@mysten/dapp-kit**, **@mysten/deepbook-v3** · **React + Vite + TypeScript** · Node keeper service.

## Run it

```bash
# The app + Rescue Theater (no Sui CLI needed)
cd frontend && npm install && npm run dev

# Risk engine + keeper tests
npm install && npm test            # 44 tests

# Move contract tests (Sui CLI 1.73+)
cd contracts && sui move test

# Keeper service (daemon + autopilot intake)
npm run keeper
```

## Project structure

```
contracts/      Move package: policy · executor · registry  (deployed on testnet)
src/            risk engine · reader · keeper daemon · envelopes · walrus
frontend/       React app: dashboard · composer · Rescue Theater · Saves Wall
scripts/        deploy · protect (live proof) · keeper runner
```

## Security & trust

- **Non-custodial.** Guardian never holds your keys or funds; you authorize a precise, revocable scope and nothing more.
- **Reduce-only, enforced on-chain.** The executor's debt-monotonic postcondition rejects any action that increases your debt, and collateral is only ever forwarded to the owner.
- **Adversarial by design.** The keeper and network are assumed hostile; on-chain guards (trigger, rate-limit, policy↔manager binding) gate every action regardless of who broadcasts it.
- **Honest about scope.** A documented threat model and invariant set defines the surface for a third-party audit, with deferred items tracked separately.

## License

Apache-2.0.
