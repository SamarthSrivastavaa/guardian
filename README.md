# Guardian

Guardian is a **non-custodial liquidation-prevention layer for DeepBook Margin on Sui**. It watches
a margin position's *risk ratio* (the variable the protocol actually liquidates on — which decays
with interest even at constant price), and before liquidation it deleverages the position with the
only actions that work on-chain: cancel open orders and repay debt. If a crash outruns that ladder,
a **white-knight** module self-liquidates the position the instant the protocol allows it and
returns the liquidation reward to the user instead of an MEV bot. Execution is 100% deterministic
and custody-free — Guardian can never move a manager's collateral anywhere but to its owner.

Built for Sui Overflow 2026 (DeepBook track).

## Architecture

- **Risk engine** (`src/risk.mjs`) — closed-form liquidation price for both borrow directions,
  interest-drift-adjusted breach probability, EWMA volatility, orderbook exit-cost walk, and the
  0–100 Guardian Risk Score. Pure, unit-tested, with a backtest proving `RR(P_liq) = 1.10` exactly.
- **Move contracts** (`contracts/sources/`) — `guardian::policy` (owner-bound protection policies),
  `guardian::executor` (the cancel→repay ladder + white-knight, with a reduce-only postcondition),
  `guardian::registry` (stats + the white-knight float vault). Compiled against the real DeepBook
  Margin API; 15 Move tests.
- **Reader** (`src/reader.mjs`) — oracle-free on-chain reads + fresh Hermes pricing → live RR / debt
  / P_liq, validated against real testnet managers.
- **Keeper brain** (`src/keeper.mjs`) — the deterministic `decide()` policy + PTB builders that wire
  the risk engine to the executor. (The resilient runtime loop is on the roadmap.)
- **Frontend** (`frontend/`) — React + Vite. Positions dashboard, structured policy composer (with
  non-custodial wallet signing), Rescue Theater (a live simulation of the engine + executor + white-
  knight over a scripted crash), Saves Wall (with real Walrus-anchored receipts), For Lenders, and a
  Build Status page.

## Run it locally

### Frontend + Rescue Theater (the demo — under 5 minutes, no Sui CLI needed)
```bash
cd frontend
npm install
npm run dev          # → http://localhost:5173
```
Open the app and click **Rescue Theater → Run the crash**. It runs entirely client-side (deterministic,
offline-safe), so it's reproducible every time. Connect a Sui wallet (testnet) to exercise the policy
composer's non-custodial signature.

### Risk-engine + keeper tests
```bash
npm install          # repo root
npm test             # 33 tests (risk engine, keeper decisions, composer/explainer)
node scripts/backtest.mjs   # P_liq invariant + GRS ladder over recorded prices
```

### Move contract tests
Requires the Sui CLI (`sui` 1.73+).
```bash
cd contracts
sui move test --gas-limit 100000000000   # 15 tests
```
> Note: the Move deps (Pyth, Wormhole) ship `Move.<network>.toml` with a placeholder `Move.toml`.
> On a fresh machine, if the build errors parsing a `Move.toml` that just contains `Move.mainnet.toml`,
> copy the testnet flavor over it in the `~/.move/git` cache (one-time). See `AUDIT_PROD_READINESS.md`
> for the full toolchain note.

## Build status

| Component | Status | Notes |
|---|---|---|
| Risk engine (P_liq, GRS, breach prob) | **Live** | 16 unit tests + backtest (`RR(P_liq)=1.10` exact) |
| Smart contracts (policy/executor/registry) | **Live** | 15 Move tests incl. white-knight float-preservation invariant |
| Reduce-only invariant | **Live** | Debt-monotonic postcondition; collateral only ever to owner |
| Policy composer / action explainer | **Live** | Deterministic; validated against the on-chain envelope; no LLM by design |
| Walrus receipt format | **Live** | Versioned `guardian.rescue.v1`; receipts anchored + readable today |
| Rescue Theater | **Simulated** | Real engine + executor logic over a scripted price path |
| Saves Wall / For Lenders | **Simulated** | Sample data; real Walrus + testnet txs on two Saves cards; real pool IDs/utilization |
| Dashboard live data | **Roadmap** | Currently sample positions; connected-wallet reads next |
| Keeper loop | **Roadmap** | `decide()` + PTB builders exist + tested; resilient loop not built |
| Guardian contract deployment | **Roadmap** | Localnet full-stack publish (testnet blocked by margin version drift) |

The in-app **Build status** page mirrors this table.

## Audit

A brutally honest production-readiness gap report lives at
[`AUDIT_PROD_READINESS.md`](./AUDIT_PROD_READINESS.md), with a `Resolutions` section tracking what's
been closed. `KNOWN_ISSUES.md` is the triage queue for items found but intentionally deferred.
