# Guardian — Production-Readiness Gap Report

Audit date: 2026-06-16. Method: full read of `contracts/sources/*`, `src/*`, `frontend/src/*`,
`scripts/*`, and the docs. Contracts live under `contracts/` (not `move/`). This report describes
what is **actually wired into the runtime**, which in several places differs sharply from the
blueprint and the demo narrative.

---

## Resolutions (honest-demo session, 2026-06-16)

The ~4–6h honest-demo pass closed the items below. The body of this report is left **unchanged** on
purpose — to show the audit existed, was taken seriously, and was acted on. The remaining critical
gaps (C2 keeper loop, C3 contract deployment, C4 live on-chain executor) are untouched: they are the
40–60h "make it run for users" path, explicitly out of scope for this session.

- **C5 (white-knight vault drain) — FIXED** (commit `1cfdfe2`). `executor::whiteknight_rescue` now
  splits seized collateral by `owner_reward_fraction = user_reward/(1+user_reward+pool_reward)`: only
  the user-reward slice (~2%) goes to the owner; the rest (= the vault's `repay·(1+pool_reward)`
  outlay) plus the unused input returns to the vault. New Move test
  **`whiteknight_float_preserved_across_n_rescues`** asserts the float is unchanged across 10
  consecutive rescues. Full Move suite green (15/15).
- **I1 / I2 (dead policy params) — REMOVED** (commit `3c4e26e`). `whiteknight_rr`,
  `max_slippage_bps`, `tranche_bps` deleted from `ProtectionPolicy`, `assert_thresholds`, and the
  frontend; the ladder check is now `1.0 < trigger_rr < target_rr`. (`target_rr` is also unread
  on-chain — logged in `KNOWN_ISSUES.md`, kept per scope.)
- **C1 / I5 / C4 / I6 (honest labeling) — DONE** (commit `be0245d`). Fixture screens carry a visible
  `DemoBanner`; the hardcoded "$2,184" is replaced by a derived stat; the Rescue Theater is captioned
  as a simulation; "AI policy composer" → "Structured policy composer" (no LLM in the loop); the
  "every rescue on Walrus" claim is softened to the true state; the misleading "keeper tx" link is
  retitled "testnet tx" (a DeepBook SDK tx, not a guardian-package call).
- **Build Status page — ADDED** (commit `0722bc3`). In-app "What's live, what's next"
  (Live / Simulated / Roadmap) so the gaps are visible and owned.
- **README — ADDED** (commit `5e14f43`). Root README with architecture, run instructions, and the
  build-status table.

---

## TL;DR

1. **Can we run this for 15 real testnet users for two weeks starting tomorrow? — NO.** The product
   is a polished *simulation*. The frontend performs **zero live chain reads** (its only chain
   interaction is wallet connect/sign); the keeper has **no running loop**; the Guardian contracts
   are **not deployed anywhere**. A real user cannot create, monitor, or rescue a position from the
   app. The on-chain steps that genuinely work (create/deposit/borrow/repay/cancel) are **CLI-only
   and bypass the Guardian contracts entirely** — they call Mysten's margin SDK directly.

2. **Single biggest gap:** there is no live system behind the screens. Dashboard, Saves Wall, and
   For-Lenders all render hardcoded fixtures; "keeper live · non-custodial" in the header is not
   backed by any process. The pieces are individually real (risk math, reader, contracts compile +
   18 tests) but they are **not connected to each other or to the UI**.

3. **Most likely demo-day failure:** a judge connects a wallet expecting to see *their* position and
   instead sees the same three fixed positions everyone sees, and the composer's "Confirm & sign"
   pops a **personal-message signature, not a policy transaction**. One probing question — "is this
   my real data?" — collapses the illusion. (The Rescue Theater itself will NOT fail: it's a
   deterministic client-side sim with a reset path and no network dependency.)

---

## CRITICAL GAPS

### C1 — The entire frontend is fixtures; nothing on screen is live chain state
**Evidence:** `frontend/src/components/Dashboard.tsx:2` imports `POSITIONS` from
`lib/positions.ts` (hardcoded snapshots); `:7–12` the activity `FEED` is hardcoded; `:31` "Value
protected" is the literal string `"$2,184"`. `SavesWall.tsx` renders `lib/saves.ts` fixtures;
`Lenders.tsx` renders `lib/lenders.ts` fixtures. A grep of `frontend/src` for
`getObject|simulateTransaction|JsonRpc|fetch(|reader` returns **only** the wallet
`SuiClientProvider` in `main.tsx` — there is no read path anywhere in the UI.
**Failure scenario:** every user, connected or not, sees the same three fake managers and the same
fake feed/saves/pools. Connecting a wallet changes nothing on any data screen.
**Smallest patch to stop embarrassment (≈1h):** label these three screens "sample data" (a chip in
the page header) so you're not *claiming* live data. **Real fix (≈10–14h):** add a read path that
takes the connected address, queries its `MarginManager`s (the logic already exists in
`src/reader.mjs`), and renders real RR/debt/P_liq with empty + loading + error states.

### C2 — There is no keeper. `decide()` and the PTB builders exist; nothing runs them.
**Evidence:** `src/keeper.mjs` contains only the pure `decide()` (`:28`) and two transaction
builders (`buildProtectionTx :77`, `buildWhiteKnightTx :102`). There is **no loop, no polling, no
scheduler, no retry, no process, no signer wiring.** None of the keeper-resilience questions
(RPC-failure retry, two policies firing at once, surviving a 30s outage, in-memory state on
restart, duplicate-tx race) are answerable because the orchestration does not exist.
**Failure scenario:** no protection ever fires for a real user; the header pill "keeper live" is
false; the white-knight never triggers.
**Patch:** this is real work, not a one-liner — a minimum viable single-manager poller
(poll → `decide` → build → sign → submit → `try/catch` retry, with the on-chain rate-limit as the
dedupe) is ~12–16h to something runnable (not HA). Note the on-chain rate-limit (C-checklist) does
correctly catch a duplicate fire, so the dedupe story is sound *once a loop exists*.

### C3 — The Guardian contracts are not deployed and cannot be on testnet; the entire contract layer is inert
**Evidence:** `NOTES_REMAINING.md` records the testnet publish failing with
`VMVerificationOrDeserializationError` (vendored deepbookv3 `main` ≠ deployed `0xd6a4` margin). No
`deployment.testnet.json` exists. `frontend/src/components/Composer.tsx` `authorize()` calls
`useSignPersonalMessage` — it signs a JSON envelope, **not** `guardian::policy::create`.
**Failure scenario:** there is no on-chain Guardian. `policy`, `executor`, `registry` are compiled
and unit-tested but unreachable by any user. "Confirm & sign policy" produces a signature that does
nothing on chain.
**Patch:** localnet full-stack publish (deepbook + deepbook_margin + pyth + guardian together,
~12–20h, high uncertainty) is the only path that makes the contracts reachable, OR scope honestly
as "contracts compiled + tested, not deployed."

### C4 — The "we ran it on testnet" proof bypasses Guardian's own contracts
**Evidence:** `src/writer.mjs` uses `dbc.marginManager.*` and `dbc.poolProxy.*` (the DeepBook SDK,
hitting Mysten's `0xd6a4` margin package) — **not** the `guardian` package. The four testnet
digests (create/deposit/borrow/repay/cancel) exercise *DeepBook margin*, not
`guardian::executor::execute_protection`.
**Failure scenario:** "Guardian works on testnet" is true for the underlying margin ops and **false
for Guardian's logic**. If a judge inspects the digests on Suiscan, none call the guardian package.
**Patch:** framing — say "we proved the read/write integration against live margin; the Guardian
contracts run on localnet." Do not imply the executor ran on testnet.

### C5 — White-knight vault economics are wrong: the vault is fully drained to the user each rescue
**Evidence:** `contracts/sources/executor.move:152–158`. `liquidate` returns collateral worth
`repay·1.05` as `(base_coin, quote_coin)` plus `change` (unused repay). The code transfers **both
collateral coins in full to `owner`** and returns only `change` to the vault. The vault paid
`repay` (its principal) and receives back ≈0 — the user receives ~**105%** of repay, not the
intended ~**5%** reward.
**Failure scenario:** the `GuardianVault` float is depleted by ~`repay` on every white-knight; after
a handful of rescues the vault is empty and `take_float` aborts `ENotEnoughFloat`. Economically the
vault is giving its principal away. (This matches the blueprint's §5.3/§8.2 wording "forwards ALL
proceeds to the user" — so it's a **design flaw inherited from the spec**, not a typo.)
**Patch (≈2–3h):** retain `repay`-worth of collateral in the vault (its principal back) and forward
only the reward portion (`repay · reward`) to the owner; or swap the seized collateral back to the
debt asset and return principal to the vault. Either way the invariant must be "vault is made
whole; user nets the reward," not "user nets 105%."

---

## IMPORTANT GAPS (erode credibility under scrutiny; won't break the happy-path demo)

### I1 — Ladder step 3 (reduce-only tranches) is not implemented on-chain; slippage cap is unenforced
`execute_protection` does only **cancel + repay** (`executor.move:89–97`). `policy.max_slippage_bps`
and `policy.tranche_bps` are validated at creation (`policy.move:181–184`) and exposed via getters,
but **no executor path ever reads them** — they are dead params. There is no order placement, so
"capped at X% slippage" (shown in the composer's permission list) is not enforced anywhere on chain.
The blueprint flagged "cut to steps 1–2" as an option, but the policy still advertises the tranche.

### I2 — `whiteknight_rr` gate is not enforced on-chain
`whiteknight_rescue` (`executor.move:138–139`) checks only `active` + manager binding. The
`rr < whiteknight_rr` gate is absent; it relies on margin's `can_liquidate` (rr below the *pool's*
liquidation threshold). So `policy.whiteknight_rr` is advisory, not enforced. (Documented in the
comment, but it means a policy field the UI shows as a guarantee is inert.)

### I3 — Oracle staleness is inherited, not asserted
`execute_protection` has no explicit staleness check; it depends on `manager.risk_ratio()`
(`executor.move:76`) using the *safe* Pyth path. This is correct today, but a one-line refactor to
`risk_ratio_unsafe` would silently delete the guard. The blueprint §8.2 lists an explicit
`assert price fresh` — it isn't present.

### I4 — GRS live inputs are ~60% placeholder; only RR/P_liq/utilization are real
`ewmaVol` and `exitCost` in `src/risk.mjs` are **real, correct functions**, but they are never fed
live data in the monitoring path: `sigmaPerHour` and `exitSlippage` are hardcoded in
`frontend/src/lib/positions.ts` and default to `0` in `keeper.decide` (`keeper.mjs:42,44`);
`ratePerYear` is a hardcoded `0.1`/policy default, **not** read from the pool's on-chain
`ProtocolConfig`. `utilization` *is* real (the reader reads pool state). So in any live GRS, the
S_prob (via σ), S_exit, and S_interest components are not from live market data. The backtest
(`scripts/backtest.mjs`) *does* feed real σ from Hermes — that path is honest; the dashboard/keeper
path is not.

### I5 — There is no AI. The "AI layer" is deterministic code.
No LLM/Claude call exists anywhere. `src/ai.mjs` / `frontend/src/lib/guardian.ts`:
`composePolicyFromIntent` is keyword regex; `explainEvent` is a string template. This is **safer and
better** than an LLM in the loop (and the code is honest), but the UI says "AI policy composer." A
careful judge will ask "where is the AI?" — you need the §7 honest-scoping answer ready, or relabel.
(Positive: this means the audit question "can the AI reach the signer?" is trivially *no* — there is
no AI and no signer wired to the frontend.)

### I6 — Walrus is real but manual, and only 2 of 5 wall entries are anchored
`scripts/walrus-anchor.mjs` genuinely writes to Walrus testnet; the two URLs in `lib/saves.ts`
resolve and the schema is versioned (`"schema":"guardian.rescue.v1"`). But anchoring is a one-shot
manual script, **not** wired to any rescue, and 3 of 5 Saves Wall cards are synthetic (no Walrus,
"localnet"). The page copy "Every rescue Guardian performs is published… on Walrus" overstates a
manual, partial integration.

### I7 — `execute_protection` is not permissionless (the inner repay is owner-gated)
Worth stating precisely: `repay_base`/`cancel_all_orders` assert `sender == manager.owner`
internally, so `execute_protection` **can only be broadcast in an owner-signed transaction**. The
"any keeper can execute" story applies to `whiteknight_rescue` (liquidate is permissionless) but
**not** to the ladder. This matches the §0.6 "pre-signed envelope" model but contradicts looser
"permissionless keeper" phrasing elsewhere.

---

## COSMETIC

- `min_action_interval_ms` has no lower bound (`policy.move:assert_thresholds`), so a policy can set
  `0` → rate-limit no-op. User's own policy; low risk.
- `now_ms - last_action_ms` underflows on clock skew (`executor.move:200`) → abort, not exploitable.
- `fund_tip` emits no event (`policy.move:138`).
- Composer "What Guardian may do" reflects the composed params (good); "cannot do" is static copy.
- `frontend/README.md` is the untouched Vite boilerplate.
- `*.md` is now git-ignored (`.gitignore`), so `DEMO_SCRIPT.md`, `JUDGE_FAQ.md`, `NOTES_REMAINING.md`
  (created after the rule) and this audit will **not be committed** unless force-added. There is no
  root `README.md` at all.

---

## WHAT'S ACTUALLY WELL-BUILT (calibration)

These are genuinely solid — the report above is not "everything is broken," it's "the real parts
aren't connected."

- **Risk-engine math (`src/risk.mjs`).** Production-grade and correct: closed-form P_liq for **both**
  borrow directions (`liquidationPrice`), interest-drift-adjusted breach probability (drift **is**
  applied: `driftedDebt = debt·(1+r)^(T/8760)`, not cosmetic), EWMA σ (λ=0.94), an actual orderbook
  VWAP walk in `exitCost`, and the 5-component GRS. 16 unit tests + a backtest that confirms
  `RR(P_liq)=1.10000000` exactly. The math is real; the *live input wiring* (I4) is the only gap.
- **The Move guards that exist are clean and correctly tested.** `assert_execution_allowed` and
  `assert_reduce_only` are extracted as pure, single-source-of-truth predicates
  (`executor.move:187–208`) with 18/18 negative tests on named abort codes; owner-gating on
  policy create/update/revoke is correct (`policy.move:77,118,130`); the segregated tip pot is real.
- **The reader (`src/reader.mjs`) is real and validated** against three live testnet managers —
  oracle-free on-chain reads + fresh Hermes pricing + correct P_liq. It is simply not wired into
  the frontend.
- **The Rescue Theater is genuinely demo-robust** (`frontend/src/lib/sim.ts`): deterministic seeded
  sim, no network dependency after page load, reproducible 3×, with a reset path. It survives a
  10-second internet drop because it runs entirely client-side. This screen is production-grade *for
  its purpose* (a demo).
- **Walrus integration is real, not stubbed** — live, verifiable, versioned blobs.

---

## MOVE CONTRACT CHECKLIST

### `guardian::policy`
| Function | Expected guards (blueprint) | Actual | Gap |
|---|---|---|---|
| `create` | sender == manager.owner; ladder + envelope bounds | `sender==owner` (`:77`), `assert_thresholds` (`:78`) | none |
| `update` | owner-only; revalidate bounds | `sender==self.owner` (`:118`), `assert_thresholds` | none |
| `revoke` | owner-only; instant; return tip | `sender==self.owner` (`:130`) | none |
| `fund_tip` | — | permissionless join | no event (cosmetic) |
| `assert_thresholds` | 1.0<wk<trigger<target; slippage≤200bps; tranche bounds | all present (`:179+`) | no lower bound on `min_action_interval_ms` |

### `guardian::executor`
| Function | Expected guards | Actual | Gap |
|---|---|---|---|
| `execute_protection` | active+tier2; policy↔manager bind; rate-limit; rr<trigger; oracle fresh; reduce-only postcondition; slippage cap; event | active/tier/bind/rate/rr (`:80`), reduce-only (`:102`), event (`:108`) | **oracle staleness inherited not asserted (I3); no tranche/slippage path (I1)** |
| `whiteknight_rescue` | active; bind; rr<wk_rr; reduce-only; forward to owner; event | active+bind (`:138`), reduce-only (`:165`), event (`:171`) | **wk_rr gate missing (I2); vault economics wrong (C5)** |
| guards | pure, tested | `assert_execution_allowed`/`assert_reduce_only` (`:187–208`) | none |

### `guardian::registry`
| Function | Expected | Actual | Gap |
|---|---|---|---|
| `fund_vault` | accept float | permissionless join | fine (donation) |
| `take_float`/`return_float` | package-only | `public(package)` | fine |
| `record_protection`/`record_rescue` | executor-only stats + event | `public(package)` + event | fine |
| stats | aggregate | present | drained by C5 in practice |

---

## REDUCE-ONLY INVARIANT — HONEST ASSESSMENT

The doc comment (`executor.move:8–9`) claims the module "contains no path that sends a manager's
collateral to any address other than the manager owner." **This is asserted + code-review-true, not
structurally impossible.** The module *does* contain `transfer::public_transfer` at three sites:
`:156` and `:157` (collateral → `policy.owner()`) and `:230` (tip → `ctx.sender()`). Safety rests
on two facts a reviewer must verify, not on the absence of transfer code:
1. `policy.owner` cannot drift from `manager.owner` — true, because `MarginManager` has **no** owner
   transfer (verified Phase A), and `policy.owner` is bound to `manager.owner()` at creation.
2. The keeper tip comes only from the segregated `keeper_tip` pot (`take_tip` on `policy.keeper_tip`),
   never collateral — true by construction.
The debt-monotonicity postcondition (`assert_reduce_only`) is genuinely enforced. **Path to
structural enforcement:** make the collateral-forwarding destination unspendable-except-to-owner by
construction (e.g., return coins to the caller and let a thin entry transfer to a hard-coded
`manager.owner()` with no address parameter — already the case), and add a unit/property test that
asserts the only `public_transfer` destinations are `policy.owner()` and `ctx.sender()` for the tip.
Today it is "safe if you read the two transfer sites," which is acceptable for a hackathon but is
**not** the "structurally impossible" claim the comment makes.

---

## ONBOARDING-FLOW GAP LIST (fresh wallet → protected position)

1. **Get testnet SUI** — the CLI faucet redirects to the web UI; the HTTP endpoint hard
   IP-rate-limits. No in-app faucet guidance. *User stuck without external knowledge.*
2. **Get DBUSDC** (needed for DBUSDC-quote pools) — **no faucet path documented or in-app.** *Dead end
   for any pool needing quote collateral.*
3. **Create a `MarginManager` + deposit + borrow** — **CLI-only** (`scripts/guardian.mjs setup`).
   The frontend has **no** create-position flow. *A real user cannot open a position from the app.*
4. **Return to Guardian and create a policy** — the composer **signs a personal message, not a
   policy tx** (C3). No policy is created on chain. *The core action does nothing on chain.*
5. **See the position protected** — the dashboard shows fixtures (C1), never the user's manager.
   *The user never sees their own position.*

Net: **the in-app onboarding path does not exist.** Every on-chain step is CLI; the app guides none
of them.

---

## ESTIMATED TIME TO CLOSE ALL CRITICAL GAPS

- **C1** label-as-sample = **1h**; wire real connected-wallet manager reads into the dashboard
  (reuse `reader.mjs`, add empty/loading/error states) = **10–14h**.
- **C2** minimal single-manager keeper loop (poll → decide → build → sign → submit → retry; on-chain
  rate-limit as dedupe; restart-safe because policies are on-chain) = **12–16h**.
- **C3** localnet full-stack deploy so the contracts are reachable = **12–20h**, high uncertainty
  (multi-package localnet bring-up with the Pyth/Wormhole manifest patching).
- **C4** is framing only once C3 lands (wire composer → real `policy::create`) = **4–6h after C3**.
- **C5** fix white-knight vault economics (retain principal, forward only reward) + test = **2–3h**.

**To make it genuinely runnable for 15 users for two weeks: ~40–60h, dominated by C2 + C3.** The
work is real-systems plumbing and a fragile localnet deploy, not polish.

**To make the demo bulletproof *and honest* (label fixtures as sample, fix the C5 economics, correct
the "ran on testnet" / "AI" / "every rescue on Walrus" claims, add a root README): ~4–6h.** This is
the higher-leverage path before judging — the Rescue Theater, risk math, contracts-with-tests,
reader, and Walrus receipts are all real and demo-ready; the liability is *claiming live/automated
behavior that isn't wired*, and one economic bug.

---
*End of report. No fixes applied — awaiting prioritization.*
