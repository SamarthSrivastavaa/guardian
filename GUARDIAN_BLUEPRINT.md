# GUARDIAN — Deep Research & Architecture Blueprint
### Liquidation prevention and autonomous risk management for DeepBook Margin · Sui Overflow 2026

Document status: build-ready blueprint, **updated with Phase A verification results (2026-06-13)**. Every design decision is traced to documentation or — where marked ✅ — to the actual Move source in `vendor/deepbookv3` and live testnet RPC reads. Facts are separated from assumptions throughout.

---

# 0. PHASE A VERIFICATION RESULTS (2026-06-13) — ground truth

Source: full clone of `github.com/MystenLabs/deepbookv3` (packages `deepbook_margin`, `margin_liquidation`), live testnet RPC against `MarginRegistry 0x48d7…9f75`.

## 0.1 Real `MarginManager` struct (verified, `margin_manager.move`)

```move
public struct MarginManager<phantom BaseAsset, phantom QuoteAsset> has key {
    id: UID,
    owner: address,                       // set to ctx.sender() at creation; NO transfer/delegation path
    deepbook_pool: ID,
    margin_pool_id: Option<ID>,           // none = no loan
    balance_manager: BalanceManager,      // EMBEDDED, with all three caps below
    deposit_cap: DepositCap,
    withdraw_cap: WithdrawCap,
    trade_cap: TradeCap,
    borrowed_base_shares: u64,
    borrowed_quote_shares: u64,
    take_profit_stop_loss: TakeProfitStopLoss,   // native conditional-order book (see 0.4)
    extra_fields: VecMap<String, u64>,
}
```

**There is no `TradeCap`-equivalent for the MarginManager itself.** The BalanceManager's caps are sealed inside the struct. Every mutating user function (`deposit`, `withdraw`, `borrow_*`, `repay_*`, all `pool_proxy` order functions, TPSL add/cancel) asserts `ctx.sender() == self.owner`. The struct is `key`-only (cannot be wrapped) and shared at creation.

## 0.2 Key real signatures (verified)

```move
// Owner-gated repay (margin_manager.move). amount: none = repay min(balance, debt) — adaptive.
public fun repay_quote<B,Q>(self: &mut MarginManager<B,Q>, registry: &MarginRegistry,
    margin_pool: &mut MarginPool<Q>, amount: Option<u64>, clock: &Clock, ctx: &mut TxContext): u64
// repay_base symmetric.

// PERMISSIONLESS liquidation (margin_manager.move). Caller supplies repay capital,
// receives collateral worth repay × (1 + user_reward + pool_reward); orders cancelled first.
public fun liquidate<B,Q,DebtAsset>(self: &mut MarginManager<B,Q>, registry: &MarginRegistry,
    base_oracle: &PriceInfoObject, quote_oracle: &PriceInfoObject,
    margin_pool: &mut MarginPool<DebtAsset>, pool: &mut Pool<B,Q>,
    repay_coin: Coin<DebtAsset>, clock: &Clock, ctx: &mut TxContext,
): (Coin<B>, Coin<Q>, Coin<DebtAsset>)

// Owner-gated order ops (pool_proxy.move): place_limit_order_v2, place_market_order_v2,
// place_reduce_only_{limit,market}_order_v2, cancel_order/cancel_orders/cancel_all_orders.
// Reduce-only v2 entries enforce a MONOTONIC risk-ratio postcondition on-chain
// (EReduceOnlyMustImproveRiskRatio) — the protocol itself ships our reduce-only invariant for trades.

// PERMISSIONLESS TPSL execution (margin_manager.move): anyone can fire owner-registered
// conditional orders; post-fill RR >= min_borrow_risk_ratio enforced or whole txn aborts.
public fun execute_conditional_orders_v2<B,Q>(... , max_orders_to_execute: u64, ...): vector<OrderInfo>

// Read-only one-call state (margin_manager.move) — Guardian's monitoring primitive:
public fun manager_state<B,Q>(...): (ID, ID, u64 /*risk_ratio*/, u64, u64, u64, u64, u64, u8, u64, u8, u64, u64, u64)
// risk_ratio_unsafe variant skips staleness checks for read paths.
```

`margin_liquidation::liquidation_vault` (same repo) is Mysten's own example of a third-party Move module composing `margin_manager.liquidate()` from vault funds — proving the exact composition pattern Guardian's white-knight needs compiles, deploys, and runs on mainnet.

## 0.3 Live testnet state (RPC, 2026-06-13)

Testnet margin package `0xe52c…6580` (v14, original `0xb862…0e4b`); registry `0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75`. Four DeepBook pools enabled for margin, all sharing these **verified** risk params (9-dec fixed point):

| DeepBook pool | Pair | RR_liq | RR_borrow | RR_withdraw | RR_target | user reward | pool reward |
|---|---|---|---|---|---|---|---|
| `0x1c19…63a5` | SUI/DBUSDC | **1.10** | 1.2499 | 2.00 | 1.25 | 2% | 3% |
| `0xe86b…b622` | DEEP/DBUSDC | 1.10 | 1.2499 | 2.00 | 1.25 | 2% | 3% |
| `0x48c9…ae9f` | DEEP/SUI | 1.10 | 1.2499 | 2.00 | 1.25 | 2% | 3% |
| `0x0dce…34de` | DBTC/DBUSDC | 1.10 | 1.2499 | 2.00 | 1.25 | 3% | 2% |

Margin pools: SUI `0xcdbb…2eea`, DBUSDC `0xf085…b14d`, DEEP `0x6106…8b55`, DBTC `0xf344…796a`. (Docs' example liq threshold of 1.15 was wrong for testnet — it is **1.10** everywhere; demo numbers updated accordingly.)

**Mainnet bad-debt evidence for the pitch:** `scripts/transactions/adminInjectCapital.ts` in the official repo documents an admin injection of **≈283,604.87 USDC** to cover `pool_default` across five `MarginManagerLiquidated` events (digest `2e6RkQYWrhtKxRArGWUXGXQHreqr9GLfkxwJamvXmomw`) — late/underwater liquidations already cost real money on mainnet, 5 months after launch.

## 0.4 Competitive fact: native TP/SL exists (`tpsl.move`)

The margin package ships conditional orders: owner registers `Condition{trigger_below_price, trigger_price}` + `PendingOrder` (limit/market); **anyone executes them permissionlessly** when the oracle price crosses. This partially materializes §13.1. What TPSL still cannot do (verified in code):
- trigger on **risk ratio** (only oracle price) — blind to interest drift;
- **repay debt** (a `PendingOrder` only places DeepBook orders — there is no repay variant);
- size/restage itself as conditions change (static once registered);
- do anything for the user once liquidation starts.
Guardian's reframe: **we orchestrate the protocol's own primitives** (TPSL, reduce-only v2, permissionless liquidate) under a risk-ratio brain that none of them have.

## 0.5 Oracle decision (final)

Margin pricing requires Pyth `PriceInfoObject`s whose feed IDs must match the admin-registered `PythConfig` per coin type (staleness `max_age_secs`, confidence `max_conf_bps`, EWMA-deviation checks — all verified in `helper/oracle.move`). Testnet prices therefore track real Pyth feeds and **cannot be moved by us**, and feed registration is admin-gated. **Decision: the crash demo runs on a local Sui network where we publish deepbookv3 + deepbook_margin + the Pyth package ourselves and control the price objects. Testnet is used for the live monitoring/integration proof (real pools, real managers, real RR reads).** This was blueprint assumption #3's fallback; it is now the plan of record.

## 0.6 GO/NO-GO: delegated execution

**NO-GO on classic full Autopilot** (a keeper directly calling `repay`/`cancel` on the user's manager): impossible at the Move level — owner-only, no delegation cap, struct not wrappable. **GO on a three-layer hybrid** that preserves the demo and most of the autonomy story:

1. **Pre-authorized rescue envelopes (Tier 2).** At policy creation the user pre-signs `guardian::executor` PTB(s) (sender = owner) that cancel orders + `repay_*(amount: none)`. `repay(none)` repays `min(idle balance, debt)`, so a static envelope is adaptive. The executor's on-chain guards (trigger RR, oracle freshness, rate limit) make premature broadcast abort — the keeper holds the envelope and can only fire it when the chain itself agrees the trigger is real. Gas: dedicated user gas coin reserved per envelope (untouched so the pinned version stays valid).
2. **Native TPSL pre-positioning (Tier 2 support).** Guardian's risk engine computes interest-drift-adjusted trigger prices and registers protocol-native conditional orders (owner-signed at creation/update); any keeper executes them permissionlessly. Converts collateral into the debt asset, freezing RR against further price moves.
3. **White-knight self-liquidation (fully autonomous, permissionless).** Guardian's funded vault module calls `liquidate()` when RR < wk threshold and forwards 100% of proceeds minus keeper tip to the manager owner. Zero signatures needed at rescue time. Implementable exactly as designed (0.2). Requires repay-side float in the vault (or a DeepBook flash loan — stretch).

Tier 1 (one-click co-sign of a freshly built PTB) remains as the interactive fallback. §8 has been rewritten against the real API below.

---

# 1. RESEARCH REPORT & KNOWLEDGE BASE (Phase 0)

## 1.1 Sources studied

| Source | URL | Category | Importance | Key findings |
|---|---|---|---|---|
| DeepBook Margin overview | docs.sui.io/standards/deepbook-margin | Protocol docs | Critical | Margin capabilities, liquidation purpose, isolated-margin collateral model |
| DeepBook Margin design | docs.sui.io/onchain-finance/deepbook-margin/design | Protocol docs | **Critical — Guardian's foundation** | Full object model (MarginPool / MarginManager / MarginRegistry), risk-ratio formula, threshold ladder, permissionless liquidation flow, interest model |
| DeepBook Margin SDK (marginManager) | docs.sui.io/standards/deepbook-margin-sdk/margin-manager | SDK docs | Critical | TS SDK has `newMarginManager`, `liquidate`, referral functions; all return Transaction builders |
| DeepBookV3 docs | docs.sui.io/standards/deepbook | Protocol docs | High | CLOB design, DEEP fee model, SDK abstracts PTB construction, open transparency for dashboards |
| DeepBookV3 repo | github.com/MystenLabs/deepbookv3 | Code | High | BalanceManager: shared object, 1 owner + up to 1000 authorized traders; owner-only deposit/withdraw; traders can place orders. Flash loans exist |
| DeepBook Margin Indexer | docs.sui.io/onchain-finance/deepbook-margin (nav) | Infra | High | A dedicated margin indexer exists — monitoring layer doesn't need to be built from raw events |
| Margin launch announcement | blog.sui.io/deepbook-margin-liquidity-layer-evolution | Sponsor strategy | High | Margin launched ~Jan 22 2026; explicit pitch: "apps can natively embed margin, rewards, and liquidation logic"; Liquidity Points program where deeply integrated projects may get multipliers |
| Margin risks page | docs.sui.io/onchain-finance/deepbook-margin/margin-risks | Protocol docs | Medium | Liquidation framed as lender protection; onchain liquidation engine |
| Pyth best practices | docs.pyth.network/price-feeds/core/best-practices | Oracle | Medium | Confidence intervals, staleness thresholds, conservative-side pricing — patterns Guardian's risk engine adopts |
| DeepBook commit activity (secondary) | coinmarketcap CMC-AI digest | Code signals | Low-med | DeepBook maintains its own oracle layer with EWMA sanity checks + rate limiters; DeepBook Predict (binary markets) on testnet |
| Overflow 2025 winners | blog.sui.io/2025-sui-overflow-hackathon-winners | Judging history | High | Demo days + community voting folded proportionally into rankings; winner archetypes |
| Sui mainnet incident report | blog.sui.io (May 31 2026) | Ecosystem context | Medium | Three mainnet outages May 28–29, 2026 — network churn is real; demo must not depend on perfect infra |
| Sui Agent Skills | docs.sui.io/skills | Tooling | Medium | Pre-built Sui skills for Claude Code/Cursor — direct build-speed multiplier for the team |

## 1.2 Known facts (directly documented)

1. **Object model.** Four shared objects: `MarginPool` (per-asset lending pool), `MarginManager` (wraps a DeepBookV3 `BalanceManager`, bound to exactly one DeepBook pool), `MarginRegistry` (per-pool risk parameters, enabled pools, manager tracking), `BalanceManager` (funds; 1 owner, up to 1000 authorized traders).
2. **Risk ratio.** `RR = assets_in_debt_unit / debt` (✅ verified in `risk_ratio_int`; debt = `borrow_shares_to_amount(shares)`, interest-accruing). **Verified live testnet thresholds (§0.3): withdraw ≥ 2.0, borrow ≥ 1.2499, liquidation < 1.10, post-partial-liquidation target = 1.25.** Values per pool live in `MarginRegistry.pool_registry`.
3. **Isolated margin.** A `MarginManager` borrows from exactly one margin pool at a time (base **or** quote). No cross-collateral. This makes closed-form risk math possible.
4. **Permissionless liquidation.** Anyone can call `liquidate()` on a manager below threshold; the liquidator receives collateral plus a reward (e.g., 5%), the pool may take e.g. 3%, partial liquidations restore RR to the target ratio, and **all open orders are cancelled first**.
5. **Interest.** Kinked utilization-rate model; interest accrues/compounds on every pool state update — meaning **RR decays over time even at constant price**.
6. **SDK.** `@mysten/deepbook-v3` includes margin-manager transaction builders including `liquidate`. A margin indexer is documented.
7. **Sponsor incentive.** DeepBook runs a Liquidity Points program rewarding integrated protocols, with multipliers for deep integrations.
8. **Judging mechanics (2025, likely carried to 2026).** Shortlist → demo days → expert judging + community voting blended proportionally into final rank.

## 1.3 Formerly "likely facts" — all resolved in Phase A (✅ = verified, see §0)

- ✅ **Known fact.** Four margin-enabled pools live on testnet (SUI/DBUSDC, DEEP/DBUSDC, DEEP/SUI, DBTC/DBUSDC) with funded margin pools. IDs + params in §0.3.
- ✅ **Known fact.** Margin uses Pyth `PriceInfoObject`s gated by an admin `PythConfig` (per-type feed ID, staleness, confidence, EWMA-deviation bps) plus a registry-stored `CurrentPriceData` with tolerance bounds used by `assert_price` on every order. Verified in `helper/oracle.move` + `margin_registry.move`.
- ✅ **Known fact.** Full state is readable in one call: `manager_state()` returns RR, assets, debts, prices, and TPSL trigger bounds; `risk_ratio_unsafe` for stale-tolerant reads. A dedicated margin indexer also exists (`crates/`).
- ✅ **Known fact (resolved NEGATIVE).** **No delegation mechanism exists for `MarginManager`** — owner-only on every mutating function, caps sealed inside the struct, no owner transfer. The single most important day-1 question is answered: see §0.6 GO/NO-GO (hybrid mode chosen).

## 1.4 Assumptions — resolved (decisions of record)

| Was assumed | Resolution |
|---|---|
| Third-party Move package can compose margin functions on behalf of a consenting owner | **Partially true.** Composition works (Mysten's own `liquidation_vault` wraps `liquidate`), but owner-gated calls require sender = owner. → **Hybrid mode (§0.6): pre-authorized rescue envelopes + native TPSL pre-positioning + fully-permissionless white-knight.** |
| A testnet pair exists where we can move price | **False** — prices are real Pyth feeds. → Crash demo on localnet with self-published packages (§0.5). |
| Oracle price movable on testnet | **False.** → Localnet, we are the oracle admin (§0.5). Decision final. |

## 1.5 Unknowns — updated

- Exact 2026 Overflow handbook rules and DeepBook-track judging rubric (Notion JS-gated). **Still open — read before Phase F.**
- ~~Exact `MarginManager` signatures / delegation~~ ✅ Resolved (§0.1–0.2).
- ~~Native stop-loss plans~~ ✅ **Materialized**: native TP/SL shipped (`tpsl.move`, §0.4). Pitch reframed: Guardian orchestrates protocol primitives under a risk-ratio brain; TPSL cannot repay, cannot see interest drift, cannot act post-liquidation-start.
- ~~Per-pool live threshold values~~ ✅ Resolved (§0.3): liq 1.10 / borrow 1.25 / withdraw 2.0 / target 1.25.
- Residual: whether pre-signed envelope txs hold up operationally (gas-coin pinning, expiry) — Phase D/E acceptance test; fallback is one-click co-sign (Tier 1).

---

# 2. ADVERSARIAL REVIEW & GUARDIAN V2 (Phase 1)

## 2.1 Attacks on Guardian-as-defined, ranked by severity

**R1 — "Why isn't this just a stop-loss?" (judge-killer question, certainty: will be asked). UPDATED post-Phase A: the protocol *itself* now ships TP/SL (`tpsl.move`), so this question is sharper and the answer must be precise.**
The structural argument survives, verified in code: (a) a TPSL `PendingOrder` can only place DeepBook orders — **no order type can call `repay()`**, so debt and interest accrual continue untouched; (b) TPSL triggers on *oracle price* while liquidation triggers on *risk ratio*, which decays with **interest accrual even at constant price** (and `liquidate()` reads `borrow_shares_to_amount`, which compounds per pool update); (c) resting book orders are **cancelled as liquidation step 1** — verified: `liquidate()` calls `cancel_all_orders` before touching debt; (d) TPSL orders are static — nothing re-sizes or re-stages them as volatility, book depth, or utilization change. Guardian's position: **we orchestrate the protocol's own primitives** — TPSL for pre-positioned de-risking, reduce-only v2 (whose monotonic-RR postcondition the protocol already enforces), repay envelopes for true deleveraging, and permissionless `liquidate()` for reward-capture — under a risk-ratio engine none of those primitives have. "DeepBook gave traders the limbs; Guardian is the nervous system."

**R2 — "DeepBook will build this natively" (sponsor/competitive risk, medium likelihood).**
Mitigation: position Guardian as the *programmable policy layer* on top of margin (custom risk appetites, portfolio-level logic, AI explanations, third-party keeper network) — the part a protocol team deliberately leaves to ecosystem builders, exactly as their launch post invites: apps embedding "margin, rewards, and liquidation logic." Cannot be fully eliminated; tracked as residual risk.

**R3 — "The AI is decorative" (judge skepticism, high likelihood).**
Accepted and embraced: the execution path is 100% deterministic (§6). AI survives only where it demonstrably adds value: natural-language policy creation, action explanation, and risk narration. Saying this *explicitly on stage* converts a weakness into a credibility signal — judges in 2026 are fatigued by AI-washing.

**R4 — "Who gets custody?" (security, high judge attention).**
Resolved by the **reduce-only invariant**: Guardian's contract can cancel orders, repay debt, and place risk-*reducing* orders — it has no code path that moves assets to any address other than the user's own manager. Enforced in Move, verified on-chain per action (§7, §8).

**R5 — Keeper liveness ("what if Guardian's bot is down during the crash?").**
Mitigated three ways: anyone can run a keeper (permissionless execution of *user-authorized* policies, with a tip), policies are on-chain so any keeper can serve them, and the white-knight module (below) degrades harm even when late.

**R6 — Demo dependence on market chaos.** Solved by owning both sides of a testnet market (§11, Phase G).

## 2.2 Guardian V2 — the strongest version

> **Guardian is a non-custodial protection layer for DeepBook Margin: on-chain protection policies, a deterministic risk engine that predicts liquidation before it happens, scoped reduce-only execution that can never steal funds, and a white-knight module that — if rescue is impossible — self-liquidates the user's position so the liquidation reward goes back to the user instead of a MEV bot.**

The **white-knight self-liquidation** is V2's signature feature and emerged directly from research: liquidation is permissionless and pays the caller ~5%; partial liquidation restores RR to target. Therefore, when rescue fails, Guardian itself calls `liquidate()` on the user's own position, capturing the reward *for the user* and stopping at the partial-liquidation target instead of letting an external bot take maximum extraction. No participant we can find offers "lose 0% to liquidators" as a guarantee. It is also the demo's emotional peak: *even Guardian's failure mode saves you money.*

Three protection tiers (user-selected per policy):
- **Tier 0 — Sentinel (alerts only):** risk scoring + notifications. Zero authority granted.
- **Tier 1 — Co-pilot:** Guardian proposes; user one-click approves pre-built PTBs.
- **Tier 2 — Autopilot:** scoped on-chain policy; any keeper may execute when on-chain trigger conditions verify.

---

# 3. PRODUCT DEFINITION (Phase 2)

## 3.1 Personas

| Persona | Pain | Current workflow | Existing alternative | Why it fails them |
|---|---|---|---|---|
| Retail margin trader | Gets liquidated while asleep; doesn't understand risk ratio | Checks position on phone, panic-closes | Price alerts; CEX-style stop orders via frontends | Alerts ≠ action; stop orders die on liquidation (R1); no debt repayment |
| Active trader | Manages 2–5 margin managers across pools; interest drag surprises them | Spreadsheets + manual repays | None on Sui | No portfolio risk view; no automation |
| Professional / fund | Needs policy-driven risk mandates and audit trails | Custom bots (CEX heritage) | Self-built keepers | Cost; no on-chain enforcement; key risk |
| Market maker | Quotes through MarginManagers; liquidation = cancelled quotes + reputational loss | Internal risk systems | Internal only | Wants standardized, composable protection it can plug in |
| Lender (MarginPool supplier) | Bad debt erodes yield | None | Protocol's liquidation engine | Late liquidations in fast markets → bad debt; *prevention* protects them too — a second sponsor-aligned story |

## 3.2 Problem, alternatives, why Guardian wins

**Core problem:** On DeepBook Margin, a position's survival depends on a continuously decaying risk ratio (price moves + interest accrual), enforcement is a permissionless liquidation race that pays outsiders ~5–8% of your collateral, and the protocol cancels your protective orders before liquidating you. Every existing self-protection tool (alerts, stop orders, manual monitoring) fails at exactly the moment it's needed.

**Why Guardian wins:** it is the only design that operates on the same variable the protocol enforces (risk ratio, not price), via the only action that actually deleverages (debt repayment, not orders), with custody-free authority (reduce-only invariant), and a bounded worst case (white-knight reward capture).

## 3.3 Scope ladder

- **Hackathon MVP:** one margin pool, single-manager policies, Tiers 0–2, white-knight module, risk dashboard, live crash demo, Move contracts on testnet, AI policy-composer + explainer.
- **Production V1:** multi-pool portfolio view, keeper network with tips, mobile push, policy templates, audited contracts (OtterSec/OpenZeppelin credits from the prize package — deliberate narrative loop).
- **Production V2:** protection-as-a-service SDK for other Sui frontends/wallets; lender-side hedging products; insurance pool capitalized by white-knight rewards.
- **Long-term:** the default risk layer for leveraged anything on Sui (margin, perps, Predict markets) — "OpenZeppelin Defender for trading."

---

# 4. SYSTEM ARCHITECTURE (Phase 3)

## 4.1 High-level diagram

```
                            ┌────────────────────────────────────────────────┐
                            │                  FRONTEND (Next.js)            │
                            │  Dashboard · Policy Composer (AI) · Risk Feed  │
                            │  Rescue Theater (demo mode) · Wallet connect   │
                            └────────────▲───────────────────┬───────────────┘
                                         │ WebSocket/REST    │ wallet-signed PTBs
                                         │                   ▼
┌──────────────────────┐      ┌──────────┴───────────┐   ┌────────────────────────┐
│   AI LAYER (Claude)  │◄────►│  GUARDIAN BACKEND     │   │        SUI CHAIN       │
│ policy composer      │      │  (Node/TS)            │   │ ┌────────────────────┐ │
│ action explainer     │      │ ┌───────────────────┐ │   │ │ guardian::policy   │ │
│ risk narrator        │      │ │ MONITORING ENGINE │◄┼───┼─┤ guardian::executor │ │
│ (zero tx authority)  │      │ │ indexer+RPC poll  │ │   │ │ guardian::registry │ │
└──────────────────────┘      │ ├───────────────────┤ │   │ └─────────▲──────────┘ │
                              │ │ RISK ENGINE       │ │   │           │ PTB calls   │
                              │ │ GRS, P(liq), TTL  │ │   │ ┌─────────┴──────────┐ │
                              │ ├───────────────────┤ │   │ │ DeepBook Margin    │ │
                              │ │ PROTECTION ENGINE │─┼───┼►│ MarginManager      │ │
                              │ │ ladder planner    │ │   │ │ MarginPool         │ │
                              │ ├───────────────────┤ │   │ │ MarginRegistry     │ │
                              │ │ KEEPER (signer)   │ │   │ ├────────────────────┤ │
                              │ ├───────────────────┤ │   │ │ DeepBookV3 CLOB    │ │
                              │ │ NOTIFIER          │ │   │ │ BalanceManager     │ │
                              │ └───────────────────┘ │   │ │ Oracle (DB/Pyth)   │ │
                              │  Postgres + Redis     │   │ └────────────────────┘ │
                              └───────────────────────┘   └────────────────────────┘
```

Layer mapping requested in the brief: Frontend = dashboard/composer; Backend = Node service; AI layer = Claude API (advisory only); Risk/Monitoring/Protection/Notification engines = backend modules above; Indexing = DeepBook margin indexer + Sui RPC event subscription; Analytics = Postgres (positions, GRS history, saves) feeding the dashboard; DeepBook integration = `@mysten/deepbook-v3` SDK + direct Move calls in PTBs; Smart contracts = three Guardian modules; Storage = Postgres (off-chain), on-chain objects (policies, registry), optional Walrus checkpoint of action logs (one-day stretch feature for auditability).

## 4.2 Core data flow (steady state)

```
Indexer/RPC ──► MONITOR: fetch MarginManager state (assets, debt, orders)
                + pool oracle price, utilization, interest params  (every 2-5s)
   │
   ▼
RISK ENGINE: compute RR, P_liq price, σ (EWMA), TTL, GRS  ──► Postgres + WS feed
   │
   ├─ GRS < watch threshold ──► sleep
   ├─ watch ≤ GRS < act ─────► NOTIFIER (push/telegram) + AI narration
   └─ GRS ≥ act & Tier 2 ────► PROTECTION ENGINE: plan ladder step
                                  │
                                  ▼
                       KEEPER: build PTB → guardian::executor::execute_protection
                                  │
                                  ▼
                  ON-CHAIN: executor REVALIDATES trigger from oracle + manager state
                  → enforces reduce-only invariant → cancel/repay/reduce → events
                                  │
                                  ▼
                  MONITOR observes events → updates GRS → loop or stand down
```

## 4.3 Failure flow

```
Keeper offline ─────────► policies are on-chain; ANY keeper can execute (tip incentive);
                          user receives Tier-0 alerts from independent notifier path
Oracle stale/diverged ──► executor aborts (staleness check); risk engine falls back to
                          Pyth secondary; widens GRS uncertainty band; alert-only mode
RPC degraded ───────────► monitor degrades to longer polling; never guesses state
Protection tx fails ────► retry with wider slippage within policy cap; if RR < whiteknight
                          trigger → self-liquidation path; else escalate notification
Network outage ─────────► nothing executes (chain down for everyone, incl. liquidators);
                          on resume, executor trigger re-validation prevents stale actions
```

---

# 5. DEEPBOOK INTEGRATION (Phase 4)

## 5.1 Objects Guardian touches

| Object | Access | Guardian's use |
|---|---|---|
| `MarginManager` (shared) | via user authorization | read assets/debt/orders; repay; place reduce-only orders; cancel orders; (white-knight) liquidate |
| `MarginPool` (shared) | public reads + repay path | utilization, interest params, supply/borrow state |
| `MarginRegistry` (shared) | public reads | per-pool thresholds (liquidation/target/borrow/withdraw), enabled pools |
| DeepBook `Pool` (shared) | public reads + orders | orderbook depth (exit-cost model), order placement/cancel |
| `BalanceManager` (shared) | wrapped by manager | idle balances usable for repayment |
| Oracle price object | public reads | mark price + staleness for trigger validation |

## 5.2 Protection sequence (Tier 2, happy path)

```
Keeper          guardian::executor        MarginManager         MarginPool      DeepBook Pool
  │ execute_protection(policy,…) │                │                 │                │
  ├──────────────────────────────►                │                 │                │
  │                              │ read RR, price, staleness        │                │
  │                              ├────────────────►                 │                │
  │                              │ assert RR < policy.trigger_rr    │                │
  │                              │ assert oracle fresh              │                │
  │                              │ assert rate-limit ok             │                │
  │                              │ 1) cancel_orders                 │                │
  │                              ├────────────────►                 │                │
  │                              │ 2) repay(min(idle_quote, debt_gap))               │
  │                              ├────────────────┼────────────────►│                │
  │                              │ 3) if RR still < target:         │                │
  │                              │    place reduce-only IOC sell    │                │
  │                              │    (tranche_bps, max_slippage)   │                │
  │                              ├────────────────┼─────────────────┼───────────────►│
  │                              │ 4) repay proceeds                │                │
  │                              │ assert debt_after < debt_before  │  ◄─ REDUCE-ONLY │
  │                              │ assert no external transfers     │     INVARIANT   │
  │                              │ emit ProtectionExecuted{...}     │                │
  │◄─────────────────────────────┤                │                 │                │
```

## 5.3 White-knight sequence (rescue impossible)

```
Trigger: RR < whiteknight_rr (e.g., 1.13, just above verified pool liq threshold 1.10)
AND ladder steps exhausted/failed

executor: liquidate(user_manager) — permissionless call, Guardian is the liquidator
  → protocol cancels orders, computes max repayable debt
  → collateral + liquidation reward (~5%) flow to the LIQUIDATOR = guardian::executor
  → executor forwards 100% of net proceeds to the USER's address (minus optional keeper tip)
  → partial liquidation restores RR to pool target (1.25) — position survives smaller
Judge takeaway: the 5% that a MEV bot would extract is returned to the victim.
```

## 5.4 Position state machine

```
        ┌─────────┐   GRS↑    ┌─────────┐   GRS↑    ┌──────────┐  RR<wk  ┌──────────────┐
        │  SAFE   ├──────────►│  WATCH  ├──────────►│ PROTECT  ├────────►│ WHITE-KNIGHT │
        │ GRS<30  │           │ 30–60   │  alerts   │ 60–80:   │ ladder  │ self-liq,    │
        └────▲────┘           └────▲────┘  +advice  │ ladder   │ failed  │ reward→user  │
             │   deleveraged       │   restored     │ executes │         └──────┬───────┘
             └─────────────────────┴────────────────┴──────────┘                │
                                   ▲                                            │
                                   └────────────── smaller, healthy position ◄──┘
   (terminal bad state — external liquidation — only reachable if Guardian AND
    every public keeper are simultaneously offline through the entire decline)
```

---

# 6. RISK ENGINE (Phase 5) — the technical centerpiece

All math operates on documented protocol mechanics: `RR = assets/debt`, isolated margin (one borrow pool), kinked interest, registry thresholds.

## 6.1 Inputs

Per manager: base quantity `Q_b`, quote balance `Q_q`, debt `D` (+ accruing interest), borrow side (base|quote), open orders. Per pool: oracle price `P` (+staleness, confidence), EWMA volatility `σ` (computed from price stream, λ=0.94 RiskMetrics-style), orderbook depth ladder, utilization `u`, interest curve params, registry thresholds `RR_liq`, `RR_target`.

## 6.2 Closed-form liquidation price (quote-borrow long, the common case)

```
RR(P) = (Q_b · P + Q_q) / D          →   P_liq = (RR_liq · D − Q_q) / Q_b
distance d = (P − P_liq) / P
```
Base-borrow (short) case is symmetric with debt in base units: `RR(P) = (Q_b·P + Q_q)/(D_b·P)`; solve for `P_liq` accordingly. (Both derivations implemented and unit-tested against simulated manager states.)

## 6.3 Probability of liquidation within horizon T (lognormal approximation)

```
z = ln(P_liq / P) / (σ · √T)
P_breach(T) = Φ(z)            for the adverse direction; T ∈ {1h, 8h, 24h}
```
**Interest-adjusted refinement** (the detail that wins technical points): debt grows as `D(t) = D·(1+r(u))^t` with `r(u)` from the pool's kinked curve, so `P_liq` itself drifts upward over the horizon. We solve `P_breach` against the drifted `P_liq(T)` — i.e., Guardian predicts liquidations that happen *with zero price movement*, which no price-alert tool can even represent.

## 6.4 Exit cost (can you even get out?)

Walk the live orderbook: `slippage(q) = (P − VWAP_fill(q)) / P` for the quantity needed to restore `RR_target`. If book depth cannot absorb the tranche within `max_slippage_bps`, the planner shrinks tranches and starts earlier (raises GRS preemptively). This couples protection timing to *liquidity reality*, not just price — the judge-visible difference between a risk engine and an if-statement.

## 6.5 Guardian Risk Score (0–100)

```
GRS = 100 · clamp( w₁·S_margin + w₂·S_prob + w₃·S_interest + w₄·S_exit + w₅·S_pool , 0, 1)

S_margin   = 1 − clamp((RR − RR_liq)/(RR_safe − RR_liq), 0, 1)     RR_safe = 1.6   w₁=.35
S_prob     = P_breach(24h, interest-adjusted)                                       w₂=.30
S_interest = clamp(ΔRR_interest_24h / (RR − RR_liq), 0, 1)                          w₃=.10
S_exit     = clamp(slippage(q_restore)/max_slippage, 0, 1)                          w₄=.15
S_pool     = clamp((u − u_kink)/(1 − u_kink), 0, 1)   (rate-spike risk)             w₅=.10
```
Thresholds: <30 SAFE · 30–60 WATCH (notify) · 60–80 PROTECT (ladder, Tier 2) · >80 + RR<wk EMERGENCY (white-knight eligible). Weights are config, stored with the policy, shown in the UI — judges can interrogate every number.

## 6.6 Protection ladder (deterministic planner)

1. **Cancel** non-protective open orders (frees locked balance, costs ~0).
2. **Repay from idle**: `repay(min(idle_quote, D − D_target))` where `D_target = assets/RR_target`.
3. **Reduce-only tranches**: sell `tranche_bps` (default 25%) of the gap via IOC limit at `P·(1−max_slippage)`, repay proceeds, re-measure, repeat (rate-limited).
4. **White-knight** if `RR < wk_rr` and steps 1–3 cannot restore target.

Every step strictly decreases debt or order exposure — the invariant the contract enforces.

---

# 7. AI SYSTEM (Phase 6) — every component justified or deleted

| Component | AI or deterministic? | Justification |
|---|---|---|
| Trigger evaluation | **Deterministic** | Safety-critical, on-chain revalidated. An LLM here is a liability, full stop |
| Ladder planning | **Deterministic** | Closed-form math (§6); auditable; judges trust formulas over vibes |
| Tranche sizing / slippage | **Deterministic** | Orderbook arithmetic |
| Policy composer | **AI** | "Protect this position conservatively, I sleep 11pm–7am IST" → structured policy params + plain-English contract of what Guardian may do. Genuine UX value; output is *parameters the user confirms*, never actions |
| Action explainer | **AI** | Post-hoc: "Guardian sold 0.8 SUI at 3.41 because your liquidation price had drifted to 3.28 from interest accrual" — generated from structured event data, grounded, no decision authority |
| Risk narrator | **AI** | Daily digest + WATCH-state explanations; retention feature |
| Market regime classifier | **Cut** | Tempting, unverifiable in demo timeframe, invites "AI-washing" critique. Deleted per Phase 9 discipline |

**Architecture:** Claude API; context = structured JSON (position state, GRS components, policy, recent events) — never raw user text concatenated with state; tool calling limited to `propose_policy_params` (returns JSON schema-validated params) and `explain_event`. **Guardrails:** AI output cannot reach the keeper's signer; policy params pass schema + bounds validation + explicit user confirmation; prompt-injection is inert because the AI's only outputs are display text and a parameter proposal the user must sign. Failure handling: AI down → product fully functional minus narration (and we say so in the pitch — it proves the AI is honest, not decorative).

---

# 8. MOVE CONTRACT DESIGN (Phase 7) — **rewritten post-Phase A against the real margin API (§0)**

Three modules, deliberately small (auditability is a judging asset given OtterSec/OpenZeppelin sponsor presence). Design constraint discovered in Phase A: owner-gated margin calls (`repay_*`, `cancel_*`, `place_*`) only succeed when `ctx.sender() == manager.owner`, so `execute_protection` is **carried inside a pre-signed owner envelope** (§0.6) — the keeper broadcasts it, the chain enforces that it was the owner who authorized it. `whiteknight_rescue` is callable by anyone.

## 8.1 `guardian::policy`

```
public struct ProtectionPolicy has key, store {
    id: UID,
    owner: address,                // must equal manager.owner (checked at creation against
                                   //   margin_manager::owner(manager))
    margin_manager_id: ID,
    deepbook_pool_id: ID,          // manager.deepbook_pool — binding checked at creation
    tier: u8,                      // 0 alert, 1 copilot, 2 autopilot(envelopes)
    trigger_rr: u64,               // 9-dec fixed point like the protocol, e.g. 1_250_000_000 (1.25)
    target_rr: u64,                // e.g. 1_400_000_000
    whiteknight_rr: u64,           // e.g. 1_130_000_000 (above pool liq 1.10)
    max_slippage_bps: u64,
    tranche_bps: u64,
    min_action_interval_ms: u64,
    last_action_ms: u64,
    keeper_tip: Balance<SUI>,      // user-funded tip pot, segregated from collateral (S4)
    active: bool,
}
Events: PolicyCreated, PolicyUpdated, PolicyRevoked
Access: create/update/revoke = owner only (assert!(ctx.sender() == manager.owner) at creation,
        policy.owner thereafter). Revoke is instant and unconditional.
```

Note: protocol RR values are 9-decimal fixed point (`constants::float_scaling()`), not bps — Guardian matches the protocol convention everywhere to avoid conversion bugs.

## 8.2 `guardian::executor` (real types; quote-debt variant shown, base-debt symmetric)

```
/// Broadcast by any keeper, but signed by the OWNER (pre-authorized envelope):
/// every inner margin call (cancel_all_orders, repay_quote) requires sender == owner.
public fun execute_protection<B, Q>(
    policy: &mut ProtectionPolicy,
    manager: &mut MarginManager<B, Q>,
    pool: &mut Pool<B, Q>,
    base_margin_pool: &MarginPool<B>,
    quote_margin_pool: &mut MarginPool<Q>,     // debt side; &mut for repay
    registry: &MarginRegistry,
    base_oracle: &PriceInfoObject,             // Pyth, validated by margin's own oracle config
    quote_oracle: &PriceInfoObject,
    clock: &Clock,
    ctx: &mut TxContext,
)
ON-CHAIN GUARDS (revalidated even though the owner signed — protects against
premature/replayed broadcast by the keeper):
  assert!(policy.active && policy.tier == 2 && policy.margin_manager_id == manager.id())
  assert!(clock.timestamp_ms() − policy.last_action_ms ≥ policy.min_action_interval_ms)
  let rr = manager.risk_ratio(registry, base_oracle, quote_oracle, pool,
                              base_margin_pool, quote_margin_pool, clock);
      // risk_ratio() internally enforces Pyth staleness/confidence/feed-id — we inherit
      // the protocol's own oracle guards instead of reimplementing them
  assert!(rr < policy.trigger_rr)
  let (debt_b0, debt_q0) = manager.calculate_debts(quote_margin_pool, clock)
  1) pool_proxy::cancel_all_orders(registry, manager, pool, clock, ctx)
  2) manager.repay_quote(registry, quote_margin_pool, option::none(), clock, ctx)
     // none ⇒ repay min(idle, debt): adaptive inside a static envelope
  REDUCE-ONLY INVARIANT (postconditions):
  assert!(debt_after < debt_q0 || orders_cancelled > 0)   // strict improvement
  // module contains NO call path that returns a Coin to anyone: repay proceeds go to the
  // margin pool, cancel refunds stay in the manager's BalanceManager. Structural invariant.
  policy.last_action_ms = clock.timestamp_ms()
  emit ProtectionExecuted{policy_id, rr_before, rr_after, debt_repaid, keeper}
  pay keeper tip from policy.keeper_tip (never from collateral)

/// PERMISSIONLESS — any keeper, any time the on-chain conditions hold.
public fun whiteknight_rescue<B, Q, DebtAsset>(
    policy: &mut ProtectionPolicy,
    manager: &mut MarginManager<B, Q>,
    vault: &mut GuardianVault,                 // holds repay-side float (DebtAsset)
    margin_pool: &mut MarginPool<DebtAsset>,
    pool: &mut Pool<B, Q>,
    registry: &MarginRegistry,
    base_oracle: &PriceInfoObject,
    quote_oracle: &PriceInfoObject,
    clock: &Clock,
    ctx: &mut TxContext,
)
  assert!(rr < policy.whiteknight_rr)          // and registry.can_liquidate must hold or
                                               // margin's own ECannotLiquidate aborts anyway
  let repay = vault.withdraw<DebtAsset>(…)
  let (base_coin, quote_coin, change) = manager.liquidate(registry, base_oracle,
        quote_oracle, margin_pool, pool, repay, clock, ctx)
  // forward ALL collateral proceeds to policy.owner; vault keeps only its principal back
  // (reconciled via change + swap); keeper tip from policy.keeper_tip
  emit Rescue{policy_id, rr_at_rescue, proceeds_to_owner, reward_captured}
```

Reduce-only order tranches (ladder step 3) reuse the protocol's own `pool_proxy::place_reduce_only_*_v2`, which already enforce monotonic-RR on-chain — Guardian doesn't reimplement that invariant for trades, it composes it (and says so to judges).

## 8.3 `guardian::registry`

Shared object tracking protected managers + aggregate stats (`total_saves`, `value_protected_usd`, `rewards_returned`) — powers the live demo metrics panel. Also hosts `GuardianVault` (white-knight float, admin-funded for the MVP, flash-loan upgrade as stretch).

**Storage layout note:** policies are owned objects (cheap, parallel); registry uses dynamic fields keyed by manager ID; no global mutable hot-spot beyond registry stats (contention-safe under Sui's object model).

---

# 9. SECURITY REVIEW (Phase 8) — OtterSec/OpenZeppelin hat on

| # | Attack | Vector | Impact | Likelihood | Mitigation (designed in) |
|---|---|---|---|---|---|
| S1 | Malicious/buggy keeper | Calls executor at wrong time | Early deleveraging only — funds untouchable | Med | All triggers revalidated on-chain from oracle+manager state; worst case bounded to "slightly conservative" |
| S2 | Oracle manipulation | Push price to trip Guardian sells | Forced selling cascade | Med | Staleness + confidence checks; EWMA-smoothed trigger price; per-policy rate limit; tranche caps bound per-action size |
| S3 | Guardian-cascade MEV | Attacker knows policies on-chain → front-runs predictable sells | Sandwich extraction | Med-high | IOC limit orders bounded by `max_slippage_bps` (sandwich profit capped at user-chosen bps); tranche jitter (±20% size, randomness from on-chain source); repay-from-idle step happens first and is unsandwichable |
| S4 | Griefing via tip drain | Spam executor to drain keeper-tip balance | Loss of prepaid tips | Low | Tips paid only on *successful, condition-verified* execution; rate limit |
| S5 | Privilege escalation | Fake policy referencing victim's manager | Unauthorized deleveraging | Low | Policy creation requires tx sender == manager-authorization proof (verified against the margin delegation mechanism confirmed in week 1); executor checks policy↔manager binding |
| S6 | Reentrancy/PTB ordering | Hostile composition around executor call | State confusion | Low | Move's object model + hot-potato-free design; postcondition asserts on final state |
| S7 | AI manipulation | Prompt-inject the composer ("set slippage to 100%") | Bad params proposed | Med | Schema + hard bounds validation (slippage ≤ 200bps etc.) + mandatory human confirmation; AI cannot touch execution |
| S8 | DoS on keeper infra | Take Guardian's keeper offline pre-attack | Missed protections | Med | Permissionless keeper set with tips; Tier-0 alert path on separate infra; white-knight callable by anyone late |
| S9 | Economic: white-knight abuse | Guardian liquidates positions that could've been saved (reward harvesting) | User value loss | Low | wk only fires below `whiteknight_rr` AND after ladder failure, both verified on-chain; 100% of reward minus fixed tip returns to user — Guardian has no profit motive in the MVP |

Redesigns applied from this review: tip balance segregated from collateral (S4), tranche jitter added (S3), confidence-interval gating adopted from Pyth best practices (S2), market-regime AI deleted (S7 surface reduction).

---

# 10. WINNING STRATEGY (Phase 9)

**Why DeepBook cares:** Guardian de-risks their newest product (margin, live ~5 months) at the exact layer their launch post invites builders into ("embed margin… and liquidation logic"); every protection action is DeepBook order flow; prevented bad debt directly protects their MarginPool lenders; and it plugs into their Liquidity Points integration incentive. This is the most literal possible answer to "what does the sponsor want."

**Why Sui cares:** showcases object-model composability (shared-object policies composing with a live protocol's shared objects in single PTBs) and the safety-forward narrative the ecosystem is pushing.

**Why judges care:** R1's structural argument (stop-losses are protocol-provably insufficient) is a 30-second intellectual hook; the white-knight is the memorable feature; honest AI scoping is a differentiator in a flooded agent field.

**Why users/investors care:** liquidations are a universally felt loss; protection-as-a-service has clean fee economics (bps on protected notional + white-knight tip share) and an SDK distribution path through wallets/frontends.

**Score-maximizing features kept:** white-knight; interest-drift liquidation prediction; reduce-only invariant; live dual-account demo; AI policy composer.
**Cut as confusion-risk:** market-regime AI, cross-chain anything, perps integration, token design, portfolio correlation analytics (post-hackathon), Walrus action-log checkpointing demoted to stretch (one day max, only if Phase F finishes early).

---

# 11. DEMO DESIGN (Phase 10) — "The Rescue Theater"

Format: split screen, two identical margin positions, one protected. We control the market (our own testnet pool + scripted counterparty flow), so the crash is reliable and rehearsable.

| t | Beat | Screen | Action | Judge takeaway |
|---|---|---|---|---|
| 0:00 | Hook | Title + one stat | "Liquidations paid out ~$X to bots on margin venues last year. The protocol cancels your stop-loss before it liquidates you — it's in the docs. We fixed the whole category." | Problem is structural, not UX |
| 0:25 | Setup | Split screen: NAKED vs GUARDIAN, identical 3x longs, RR 1.45 | AI composer creates the policy from one English sentence; user signs | Non-custodial, instant onboarding |
| 0:50 | Crash begins | Price chart bleeding; GRS climbing 28→55→70 with component breakdown visible | Scripted sell flow hits the book | Risk engine is live math, not a gauge sticker |
| 1:20 | Intervention | GUARDIAN side: orders cancelled → idle repay → two reduce-only tranches; RR 1.19→1.41. Explainer narrates each action in English | Keeper tx hashes flash on screen | Deterministic ladder, on-chain verified |
| 1:50 | The kill shot | NAKED side hits 1.10 — external liquidation fires; −5% of collateral gone (2% user + 3% pool reward, verified params); red. GUARDIAN side: green, smaller, alive | Side-by-side P&L delta in USD | Visceral, quantified, unforgettable |
| 2:20 | White-knight encore | Third account, crash too fast to ladder: Guardian self-liquidates at 1.16, reward flows BACK to user wallet on-screen | "Even our failure mode pays you" | The feature nobody else will have |
| 2:45 | Close | Registry stats: value protected, DeepBook volume generated, lender bad-debt avoided; roadmap slide: SDK + audit (OtterSec credits) | — | Sponsor flywheel + startup path |

---

# 12. EXECUTION PHASES (Phase 11)

**Phase A — Foundation & verification (the truth-finding phase).**
Goals: verify every "likely fact." Deliverables: testnet margin pool inventory; confirmed MarginManager function signatures + delegation mechanism; local-network fallback environment with deepbookv3 published; repo, CI, wallets. Dependencies: none. Success: a script that reads a real MarginManager's RR from chain, and a written go/no-go on the delegation model (if delegation is absent → co-signing mode per §1.4, decided here, not discovered in week 4).

**Phase B — DeepBook integration.**
Goals: full read/write path. Deliverables: monitoring service streaming manager state + oracle + book depth into Postgres; manual repay/cancel/reduce PTBs working end-to-end from CLI. Depends on A. Success: CLI can rescue a manually-endangered test position.

**Phase C — Risk engine.**
Goals: §6 implemented + tested. Deliverables: GRS service with unit tests against simulated states (incl. interest-drift cases); backtest harness replaying recorded testnet price paths. Depends on B (data). Success: predicted `P_liq` matches protocol liquidation behavior in forced tests within tolerance.

**Phase D — Smart contracts.**
Goals: §8 modules. Deliverables: policy/executor/registry deployed to testnet; Move unit tests for every guard + invariant; revocation path. Depends on A (signatures). Success: keeper-triggered protection executes only under valid conditions; every negative test (stale oracle, early trigger, rate-limit, debt-increase attempt) aborts.

**Phase E — Protection engine + keeper + white-knight.**
Goals: close the loop. Deliverables: ladder planner, keeper signer, white-knight path, tip flow. Depends on C+D. Success: unattended end-to-end rescue during a scripted crash, 10/10 runs.

**Phase F — AI layer + frontend.**
Goals: §7 composer/explainer + dashboard + Rescue Theater UI. Depends on E (event schema). Success: a non-crypto person can create a policy from one sentence; explainer narrates a real rescue accurately.

**Phase G — Security hardening + demo.**
Goals: §9 adversarial tests as code; demo choreography. Deliverables: attack-test suite (S1–S9), crash-script counterparty bot, recorded backup video, pitch deck, X account + landing page (community-vote infrastructure), submission package. Success: demo runs 3× consecutively without intervention; backup video exists; handbook compliance checklist complete.

Sequencing: A→B→{C,D in parallel}→E→F→G. The schedule's only hard gate is A — every catastrophic unknown is resolved there by design.

---

# 13. REASONS GUARDIAN COULD STILL LOSE (Phase 12.14 — no varnish)

1. **DeepBook ships native protection mid-hackathon.** ⚠️ **PARTIALLY MATERIALIZED (found in Phase A):** native TP/SL conditional orders exist (`tpsl.move`), with permissionless keeper execution and price bounds. The pivot is already executed in this doc (§0.4, R1): Guardian orchestrates TPSL + reduce-only + repay + liquidate under a risk-ratio engine; TPSL alone cannot repay debt, cannot see interest drift, and is static. Monitor repo weekly for a native *repay-on-trigger* feature — that would be the true existential event.
2. **MarginManager delegation doesn't exist in any usable form.** ✅ **MATERIALIZED & HANDLED (Phase A):** confirmed owner-only. Mode of record = pre-authorized rescue envelopes + permissionless white-knight (§0.6). "Autonomous" claim survives for white-knight fully and for the ladder via envelopes; honest framing in pitch: "the chain checks the trigger, the user pre-authorizes the medicine."
3. **Track field surprise:** the $70K pool draws 8–10 elite DeFi teams; prior simulation showed Guardian's EV halving in that world. Uncontrollable; mitigated only by execution quality.
4. **A judge dismisses it as "a feature, not a product."** Counter is the SDK/keeper-network vision + lender-protection second story; will not convince everyone.
5. **Demo theater fails live** (testnet outage during demo days — the network had three halts in May). Backup video + local-network recording mandatory, not optional.
6. **Community vote underperformance** vs consumer-flashy rivals. Partially mitigated by the visceral split-screen demo and early X presence; structurally, a risk-management tool will never out-meme a meme.
7. **Rubric mismatch:** if DeepBook's hidden rubric weights "novel trading products" over "risk infrastructure," Guardian reads as adjacent rather than central. Unverifiable until the handbook/track brief is read — do that before writing a line of code.

---

# 14. BUILD LOG

## Phase A — Foundation & verification (2026-06-13) — COMPLETE

**What changed vs. spec:** §0 added (ground truth); §1.2–1.5 assumptions resolved; R1 rewritten for native TPSL; §8 rewritten against real signatures (9-dec fixed point, Pyth `PriceInfoObject` pairs, owner-envelope carrier for `execute_protection`, permissionless `whiteknight_rescue`, `GuardianVault` repay float); §13.1/13.2 updated with materialized risks; demo numbers corrected (liq 1.10, liquidation cost 5%).

**Learned (now Known):** full margin Move source vendored at `vendor/deepbookv3`; no delegation cap — hybrid mode chosen; native TP/SL exists with permissionless execution; reduce-only v2 entries already enforce monotonic-RR on-chain; `repay(none)` is adaptive (min(idle, debt)); liquidation cancels all orders first and pays caller from supplied repay capital (white-knight needs float); 4 live testnet pools with verified params; testnet Pyth prices immovable → crash demo on localnet; mainnet bad-debt evidence ≈ $283.6K admin injection (pitch stat).

**Still Unknown / carried:** Overflow 2026 handbook rubric (read before Phase F); operational soundness of pre-signed envelopes (gas-coin pinning) — acceptance-tested in Phase D/E, fallback Tier-1 co-sign; whether localnet Pyth package publish is straightforward (Phase B spike, fallback = test-helper price objects on localnet).

**Tooling:** Sui Agent Skills installed (`.agents/skills`, 21 skills, symlinked for Claude Code); Sui CLI v1.73.1 installed to `~/.sui/bin`; `@mysten/sui` v2.17 + `@mysten/deepbook-v3` v1.4.1 installed (note: SDK v2 uses `SuiJsonRpcClient` from `@mysten/sui/jsonRpc`); probe script at `scripts/probe-testnet.mjs`.

*Phase A verification checklist closed. Next: Phase B — ground-truth CLI (read manager state, then live repay + cancel on a manager we control).*

## Phase B — DeepBook read/write integration (2026-06-13) — reader DONE, write proof pending gas

**Built & verified:** `guardian read <managerId>` (`src/reader.mjs`, `scripts/guardian.mjs`) prints fully real state — RR, collateral, debt, fresh Hermes-beta price, on-chain Pyth staleness, margin-pool utilization, and Guardian's own P_liq + distance-to-liq. Validated against hand-computation on three live testnet managers (price-independent base-borrow, quote-debt long, base-debt short). Write path coded (`src/writer.mjs`: create/deposit/borrow/repay/cancel) + `src/oracle.mjs` Pyth refresh.

**Learned (now Known):**
- **SDK is v2** (`@mysten/sui` 2.x): use `SuiJsonRpcClient` from `@mysten/sui/jsonRpc`; it exposes `.core.*` (simulate/execute) which `DeepBookClient` consumes. Passing `packageIds` to `DeepBookClient` takes a branch that **drops `marginPools`** — rely on `network:'testnet'` defaults instead.
- **Pyth feeds on testnet are not continuously pushed** (~25 min stale when observed). Any SAFE-oracle margin call (deposit, borrow, `risk_ratio`, `liquidate`, our executor) aborts on `check_price_is_fresh` unless the PTB **refreshes the feeds first** via Hermes-beta (`https://hermes-beta.pyth.network`) + `SuiPythClient.updatePriceFeeds` (mutates the same shared `PriceInfoObject`s in place). **This is core to the keeper and demo, not a side quest.**
- **`repay_*` and `cancel_orders` are oracle-FREE** (no Pyth params) — Guardian's two most important rescue primitives need no oracle refresh. `deposit`/`borrow` are freshness-checked.
- **Monitoring design (decision):** Guardian reads oracle-FREE on-chain components (`calculate_assets`/`calculate_debts`) and prices the cross-rate with fresh Hermes data, computing RR/P_liq off-chain — exactly what a real keeper does. The protocol's exact on-chain RR (via `manager_state`) is reconciled at execution time (Pyth-refreshed). On-chain Pyth staleness is surfaced as an execution-readiness flag.

**Still Unknown / residual:** live on-chain `repay` + `cancel` proof is blocked on **testnet gas** — the faucet HTTP endpoint (`faucet.testnet.sui.io/v2/gas`) hard IP-rate-limits this host. Write-path code is complete and validated by construction against the real signatures + SDK builders; a background faucet retry is running and the proofs execute automatically on funding. Dev wallet: `0x6111…dbaa`.

## Phase C — Risk engine (2026-06-13) — DONE (gas-free, ran in parallel with B's write proof)

**Built & verified:** `src/risk.mjs` implements §6 exactly — closed-form P_liq (both borrow directions), `riskRatio` matching the protocol's `assets_in_debt_unit/debt`, normal CDF (erf), EWMA vol (λ=0.94), kinked rate model, **interest-drift-adjusted breach probability** (debt drifts P_liq adversely over T), orderbook exit-cost VWAP walk, `quantityToRestore`, and the 5-component weighted **GRS** with SAFE/WATCH/PROTECT/EMERGENCY bands. 16 unit tests pass (`test/risk.test.mjs`), including real-testnet-state cases and GRS monotonicity. Backtest harness (`scripts/backtest.mjs`) pulls a real manager, **confirms the P_liq invariant `RR(P_liq) = rrLiq` exactly (1.10000000)**, seeds σ from 12 live-recorded SUI samples, and replays a crash showing the GRS ladder with the liquidation crossing landing on P_liq.

**Learned (now Known):** the blueprint's §6.2 base-borrow form `(Qb·P+Qq)/(Db·P)` is algebraically identical to the protocol's `assets_in_debt_unit/debt` with debt-unit = base — both implemented and cross-checked. Real testnet RR_liq is **1.10** everywhere, so RR_safe=1.6 gives the sMargin ramp [1.10→1.60]. Interest-curve params (`u_kink`, slopes) still need to be read from each pool's on-chain `ProtocolConfig` (currently parameterized with standard defaults) — Phase D/E will wire the real values.
