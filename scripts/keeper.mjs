// Run the Guardian keeper daemon against the live testnet deployment.
//   node scripts/keeper.mjs            # poll every 15s
//   GUARDIAN_POLL_MS=5000 node scripts/keeper.mjs
import { readFileSync } from 'node:fs';
import { runDaemon } from '../src/daemon.mjs';

const D = JSON.parse(readFileSync(new URL('../deployment.testnet.json', import.meta.url)));

runDaemon({
  pkg: D.packageId,
  guardianRegistryId: D.guardianRegistryId,
  vaultId: D.guardianVaultId,
  pollMs: Number(process.env.GUARDIAN_POLL_MS ?? 15_000),
  minKeeperSui: Number(process.env.GUARDIAN_MIN_KEEPER_SUI ?? 0.05),
  vaultFloatOk: false, // white-knight requires a funded float vault; off until seeded (see registry)
}).catch((e) => { console.error(e); process.exit(1); });
