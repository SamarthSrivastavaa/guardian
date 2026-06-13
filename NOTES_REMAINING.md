# Guardian — remaining work (living checklist)

## On-chain status (wallet funded 2026-06-13)
- [x] **Phase B on-chain** DONE on testnet against live margin: create `BrCVCXQ…`, deposit+borrow `7WssiTc…`, repay `2c1yvhHe…` (debt 0.15→0.10), cancel_all_orders `93WMERK…`. Manager we control: `0x3a209d3a…`.
- [ ] **Localnet full-stack publish** (the real path for the executor + crash, §0.5/§0.6): start localnet, publish deepbook + deepbook_margin + pyth + guardian together (no version drift), set up a pool/oracle/manager, then run executor rescues. Testnet publish fails `VMVerificationOrDeserializationError` because vendored `main` ≠ deployed `0xd6a4` margin — do NOT keep trying testnet publish.
- [ ] **Phase E on-chain**: 10/10 unattended ladder rescues on localnet (reduce-only tranche step needs the self-published margin since live testnet lacks `place_limit_order_v2`).
- Note: reduce-only order placement via SDK fails on live testnet (`place_limit_order_v2` absent on `0xd6a4`); repay-from-idle works.

## Gas-free, not yet done
- [ ] **Phase F frontend** (IN PROGRESS): dashboard, policy composer UI, activity feed, Rescue Theater (§11).
- [ ] **Phase F AI live layer**: optional Claude API wrapper on top of the deterministic core in `src/ai.mjs` (composer refine + narration). Core is done + tested.
- [ ] **Phase G**: S1–S9 as live integration tests (S2/S3/S8/S9 need localnet), crash counterparty bot, DEMO_SCRIPT.md, JUDGE_FAQ.md, backup video, 3× live runs, Overflow submission package.
- [ ] Wire keeper to read real interest-curve params (`u_kink`, slopes) from each pool's on-chain `ProtocolConfig` (currently standard defaults).

## Done (gas-free cores, committed through 0a095ff + uncommitted keeper/ai)
- Phase A verification; Phase B reader; Phase C risk engine (33 JS tests); Phase D contracts (18 Move tests); Phase E keeper brain; Phase F AI deterministic core.
