# Guardian — remaining work (living checklist)

## On-chain status (wallet funded 2026-06-13)
- [x] **Phase B on-chain** DONE on testnet against live margin: create `BrCVCXQ…`, deposit+borrow `7WssiTc…`, repay `2c1yvhHe…` (debt 0.15→0.10), cancel_all_orders `93WMERK…`. Manager we control: `0x3a209d3a…`.
- [ ] **Localnet full-stack publish** (the real path for the executor + crash, §0.5/§0.6): start localnet, publish deepbook + deepbook_margin + pyth + guardian together (no version drift), set up a pool/oracle/manager, then run executor rescues. Testnet publish fails `VMVerificationOrDeserializationError` because vendored `main` ≠ deployed `0xd6a4` margin — do NOT keep trying testnet publish.
- [ ] **Phase E on-chain**: 10/10 unattended ladder rescues on localnet (reduce-only tranche step needs the self-published margin since live testnet lacks `place_limit_order_v2`).
- Note: reduce-only order placement via SDK fails on live testnet (`place_limit_order_v2` absent on `0xd6a4`); repay-from-idle works.

## Gas-free, done since
- [x] **Phase F frontend**: 5 screens, neo-brutalist theme.
- [x] **Wallet connect**: @mysten/dapp-kit providers + custom theme-matched WalletButton; composer "Confirm & sign" → real non-custodial signature over the policy envelope (`useSignPersonalMessage`).
- [x] **Phase G docs**: DEMO_SCRIPT.md + JUDGE_FAQ.md.
- [x] **Rescue Theater (real-time + autopsy)**: `src/lib/sim.ts` deterministic timeline; plays over ~45s, keeper-action markers pinned to the exact crash moment, dollar P&L verdict, scrub-back replay, per-marker autopsy (RR before→after, GRS components, on-chain receipt). 3 scenarios: standard (ladder saves), flash (white-knight fires), **stop-loss myth** (#4 — stop @ $0.65 cancelled by the protocol before it fills; liquidated anyway).
- [x] **Saves Wall + Walrus** (#2): public anonymized rescue feed with **REAL Walrus-testnet receipts** (anchored via `scripts/walrus-anchor.mjs`; live blob URLs in `src/lib/saves.ts`) + real testnet keeper-tx links + Share-to-𝕏.
- [x] **For Lenders** (#3): margin-pool health (real IDs/utilization), Guardian rescue rate, bad-debt-drag-avoided, and a supply yield projector (base + Guardian bonus).

## Walrus receipts (live, verifiable)
- ProtectionExecuted: https://aggregator.walrus-testnet.walrus.space/v1/blobs/KAUNqIdnaxsRbRY0Lhc12NRvIag4VM0_Zpqj38EVgGM
- WhiteKnightRescue: https://aggregator.walrus-testnet.walrus.space/v1/blobs/Uj3zBk5HbP5vyLbYL79_2GLnxLyS2guK_Joypu6GVEQ
- Re-anchor / add more: `node scripts/walrus-anchor.mjs`

## Gas-free, not yet done
- [ ] **Phase F AI live layer**: optional Claude API wrapper on top of the deterministic core in `src/ai.mjs` (composer refine + narration). Core is done + tested.
- [ ] **Phase G**: S1–S9 as live integration tests (S2/S3/S8/S9 need localnet), crash counterparty bot, backup video, 3× live runs, Overflow submission package (read the handbook).
- [ ] Wire keeper to read real interest-curve params (`u_kink`, slopes) from each pool's on-chain `ProtocolConfig` (currently standard defaults).
- [ ] Make the composer's "Confirm & sign" build the real `guardian::policy::create` tx once the package is published on localnet (currently signs the envelope; ready to swap to `useSignAndExecuteTransaction` + the deployed package id).

## Done (gas-free cores, committed through 0a095ff + uncommitted keeper/ai)
- Phase A verification; Phase B reader; Phase C risk engine (33 JS tests); Phase D contracts (18 Move tests); Phase E keeper brain; Phase F AI deterministic core.
