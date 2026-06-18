// Prove the deployed Guardian executor runs on testnet:
//  1) create a ProtectionPolicy bound to our manager
//  2) fire execute_protection (Pyth-refreshed) and watch it deleverage on-chain.
// Trigger is set ABOVE the manager's current RR so the on-chain guard passes for the demo proof.
import { Transaction } from '@mysten/sui/transactions';
import { readFileSync } from 'node:fs';
import { makeSuiClient, loadKeypair, MARGIN_REGISTRY_ID, testnetCoins } from '../src/config.mjs';
import { buildProtectionTx } from '../src/keeper.mjs';

const D = JSON.parse(readFileSync(new URL('../deployment.testnet.json', import.meta.url)));
const PKG = D.packageId;
const GREG = D.guardianRegistryId;
const MANAGER = '0x3a209d3a12e3d44f62d048579ef73b0a82dc05d2687f2311f4c70750ed5812d5';
const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const DBUSDC = testnetCoins.DBUSDC.type;

const kp = loadKeypair();
const SENDER = kp.toSuiAddress();
const client = makeSuiClient();

async function run(tx, label) {
  tx.setSender(SENDER);
  const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx,
    options: { showEffects: true, showObjectChanges: true, showEvents: true } });
  const status = res.effects?.status?.status;
  console.log(`  [${label}] ${res.digest}  status=${status}`);
  if (status !== 'success') throw new Error(`${label}: ${JSON.stringify(res.effects?.status)}`);
  return res;
}

async function createPolicy() {
  const tx = new Transaction();
  const [tip] = tx.splitCoins(tx.gas, [20_000_000]); // 0.02 SUI keeper-tip pot
  const tipBal = tx.moveCall({ target: '0x2::coin::into_balance', typeArguments: [SUI], arguments: [tip] });
  const policy = tx.moveCall({
    target: `${PKG}::policy::create`,
    typeArguments: [SUI, DBUSDC],
    arguments: [
      tx.object(MANAGER),
      tx.pure.u8(2),                 // tier 2 autopilot
      tx.pure.u64(5_000_000_000),    // trigger_rr 5.0 (above current RR ~4.0 so the proof fires)
      tx.pure.u64(6_000_000_000),    // target_rr 6.0
      tx.pure.u64(0),                // min_action_interval_ms
      tipBal,
    ],
  });
  tx.transferObjects([policy], SENDER);
  const res = await run(tx, 'create-policy');
  const created = (res.objectChanges ?? []).find((c) => c.type === 'created' && c.objectType?.endsWith('::policy::ProtectionPolicy'));
  console.log(`  -> policy ${created.objectId}`);
  return created.objectId;
}

async function main() {
  console.log(`package ${PKG}`);
  const policyId = await createPolicy();
  const tx = await buildProtectionTx({ pkg: PKG, policyId, managerId: MANAGER, guardianRegistryId: GREG });
  const res = await run(tx, 'execute_protection');
  const ev = (res.events ?? []).find((e) => e.type.endsWith('::executor::ProtectionExecuted'));
  if (ev) {
    const j = ev.parsedJson;
    console.log(`\n  ProtectionExecuted on testnet:`);
    console.log(`    rr_before=${(Number(j.rr_before) / 1e9).toFixed(3)}  debt ${j.debt_before} -> ${j.debt_after}  repaid=${j.debt_repaid}  orders_cancelled=${j.orders_cancelled}`);
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
