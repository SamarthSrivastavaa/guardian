// Prove the Phase-2 autopilot path end-to-end on testnet, fully non-custodially:
//   1) OWNER (dev wallet) creates a tier-2 policy + signs a pre-signed envelope (sign-only).
//   2) KEEPER (separate wallet, no owner authority) refreshes Pyth + relays the owner-signed bytes.
//   3) execute_protection runs — sender is the owner, validate_owner passes, debt deleverages.
import { Transaction } from '@mysten/sui/transactions';
import { readFileSync } from 'node:fs';
import { makeSuiClient, loadKeypair, loadKeeperKeypair, testnetCoins } from '../src/config.mjs';
import { readManagerState } from '../src/reader.mjs';
import { signAndStoreEnvelope, broadcastEnvelope } from '../src/envelopes.mjs';

const D = JSON.parse(readFileSync(new URL('../deployment.testnet.json', import.meta.url)));
const MANAGER = '0x3a209d3a12e3d44f62d048579ef73b0a82dc05d2687f2311f4c70750ed5812d5';
const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const DBUSDC = testnetCoins.DBUSDC.type;

const owner = loadKeypair(); const keeper = loadKeeperKeypair();
const OWNER = owner.toSuiAddress();
const client = makeSuiClient();

const run = async (tx, signer, label) => {
  tx.setSender(signer.toSuiAddress());
  const res = await client.signAndExecuteTransaction({ signer, transaction: tx, options: { showEffects: true, showObjectChanges: true } });
  const st = res.effects?.status?.status;
  console.log(`  [${label}] ${res.digest} ${st}`);
  if (st !== 'success') throw new Error(JSON.stringify(res.effects?.status));
  return res;
};

async function main() {
  console.log(`owner ${OWNER}\nkeeper ${keeper.toSuiAddress()}\npackage ${D.packageId}\n`);

  // Ensure the manager carries debt so there is something to deleverage.
  let st = await readManagerState(MANAGER);
  if (st.debtSide === 'none' || (st.debt.base + st.debt.quote) < 1e-6) {
    console.log('  manager has no debt — borrowing 0.1 SUI first');
    const { depositAndBorrowBase } = await import('../src/writer.mjs');
    await depositAndBorrowBase(MANAGER, { depositSui: 0.1, borrowSui: 0.1 });
    st = await readManagerState(MANAGER);
  }
  console.log(`  manager RR ${st.riskRatio?.toFixed(3)} debt(base) ${st.debt.base}\n`);

  // 1) OWNER creates a tier-2 policy (trigger 5.0 > current RR so the guard fires for the proof)
  //    AND splits off a DEDICATED gas coin reserved solely for the envelope — a fresh object
  //    nothing else consumes, so its version stays stable until the keeper relays.
  const tx = new Transaction();
  const [tip, envGas] = tx.splitCoins(tx.gas, [20_000_000, 80_000_000]);
  const tipBal = tx.moveCall({ target: '0x2::coin::into_balance', typeArguments: [SUI], arguments: [tip] });
  const policy = tx.moveCall({ target: `${D.packageId}::policy::create`, typeArguments: [SUI, DBUSDC],
    arguments: [tx.object(MANAGER), tx.pure.u8(2), tx.pure.u64(5_000_000_000), tx.pure.u64(6_000_000_000), tx.pure.u64(0), tipBal] });
  tx.transferObjects([policy, envGas], OWNER);
  const r1 = await run(tx, owner, 'owner: create tier-2 policy + reserve envelope gas');
  const policyId = r1.objectChanges.find((c) => c.type === 'created' && c.objectType?.endsWith('::policy::ProtectionPolicy')).objectId;
  const gasObjectId = r1.objectChanges.find((c) => c.type === 'created' && c.objectType?.endsWith('::sui::SUI>')).objectId;
  await client.waitForTransaction({ digest: r1.digest });
  console.log(`  -> policy ${policyId}\n  -> reserved gas coin ${gasObjectId.slice(0, 12)}…\n`);

  // 2) OWNER signs a pre-signed envelope (sign-only), gas pinned to the reserved coin.
  const env = await signAndStoreEnvelope(owner, {
    pkg: D.packageId, policyId, managerId: MANAGER, guardianRegistryId: D.guardianRegistryId, gasObjectId,
  });
  console.log(`  owner signed envelope (gas-pinned ${gasObjectId.slice(0, 10)}…, expires ${new Date(env.expiresAt).toISOString()})\n`);

  // 3) KEEPER relays it (refresh Pyth with keeper's gas, then broadcast the owner-signed bytes).
  console.log('  keeper relaying (just-in-time Pyth refresh + execute owner envelope)…');
  const digest = await broadcastEnvelope(client, policyId, keeper);
  const res = await client.waitForTransaction({ digest, options: { showEvents: true, showEffects: true } });
  const ev = (res.events ?? []).find((e) => e.type.endsWith('::executor::ProtectionExecuted'));
  console.log(`  [keeper: relay envelope] ${digest} ${res.effects?.status?.status}`);
  if (ev) {
    const j = ev.parsedJson;
    console.log(`\n  AUTOPILOT PROVEN — keeper broadcast an owner-signed envelope, execute_protection ran:`);
    console.log(`    rr_before=${(Number(j.rr_before) / 1e9).toFixed(3)} debt ${j.debt_before}->${j.debt_after} repaid=${j.debt_repaid} keeper=${j.keeper.slice(0, 10)}…`);
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
