# Known Issues (triage queue)

Issues discovered during the honest-demo session that are **out of scope** for it (per rules of
engagement: log, don't fix). Triage after.

## From Step 2 (dead-param removal)
- **`target_rr` is stored but not read on-chain.** The implemented executor ladder is cancel +
  `repay_from_idle` (`repay(option::none())` = repay `min(idle, debt)`); it does not size a repay or
  tranche to reach `target_rr`. So `policy.target_rr` is currently advisory, like the params removed
  in Step 2. It was **kept** (not removed) because (a) the work order scoped removal to exactly
  `whiteknight_rr` / `max_slippage_bps` / `tranche_bps`, and (b) `trigger_rr < target_rr` is a
  meaningful, validated invariant and `target_rr` documents the ladder's intent. Decide later:
  either wire a target-aware repay/tranche step, or drop `target_rr` too for a minimal struct.
