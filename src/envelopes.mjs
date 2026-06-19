// Guardian pre-signed envelopes (Phase 2 — opt-in autopilot, fully non-custodial).
//
// execute_protection is owner-gated (DeepBook's `validate_owner`), so a keeper can't sign it. But
// the OWNER can sign it ahead of time and hand the keeper the signed bytes. On broadcast the tx's
// sender IS the owner, so `validate_owner` passes — the keeper only relays. No custody, no owner key
// at the keeper, and the on-chain guards (trigger/rate-limit/reduce-only) still gate execution, so
// the keeper can't fire it early.
//
// Two robustness details:
//  • Gas pinning — the tx pins ONE owner-owned gas coin (its version+digest). Everything else the
//    call touches (manager, pools, registries, oracles) is SHARED, so versions resolve at execution.
//    The envelope stays valid until that gas coin is spent or `expiresAt` passes → re-sign.
//  • No baked oracle — the envelope is EXECUTE-ONLY (withRefresh:false). The keeper refreshes Pyth
//    just-in-time in a separate tx immediately before relaying, so a long-lived owner signature
//    never carries a stale VAA.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Transaction } from '@mysten/sui/transactions';
import { makeSuiClient, MARGIN_REGISTRY_ID, testnetCoins, testnetPools, testnetMarginPools } from './config.mjs';
import { buildRefreshTx } from './keeper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE = join(__dirname, '..', 'envelopes');
const envPath = (policyId) => join(STORE, `${policyId}.json`);

/**
 * Build the EXECUTE-ONLY execute_protection tx for an envelope, with gas pinned to `gasObjectId`.
 * The owner signs the bytes this returns; nothing here touches a key.
 */
export async function buildEnvelopeTx({ pkg, policyId, managerId, guardianRegistryId, owner, gasObjectId, gasBudgetMist = 50_000_000, poolKey = 'SUI_DBUSDC' }) {
  const client = makeSuiClient();
  const pool = testnetPools[poolKey];
  const baseCoin = testnetCoins[pool.baseCoin];
  const quoteCoin = testnetCoins[pool.quoteCoin];
  const baseMarginPool = testnetMarginPools[pool.baseCoin];
  const quoteMarginPool = testnetMarginPools[pool.quoteCoin];

  const gas = await client.getObject({ id: gasObjectId, options: { showOwner: true } });
  if (!gas.data) throw new Error(`gas coin ${gasObjectId} not found`);

  const tx = new Transaction();
  tx.setSender(owner);
  tx.setGasPayment([{ objectId: gas.data.objectId, version: gas.data.version, digest: gas.data.digest }]);
  tx.setGasBudget(gasBudgetMist);
  tx.moveCall({
    target: `${pkg}::executor::execute_protection`,
    typeArguments: [baseCoin.type, quoteCoin.type],
    arguments: [
      tx.object(policyId), tx.object(managerId), tx.object(pool.address),
      tx.object(baseMarginPool.address), tx.object(quoteMarginPool.address),
      tx.object(MARGIN_REGISTRY_ID), tx.object(guardianRegistryId),
      tx.object(baseCoin.priceInfoObjectId), tx.object(quoteCoin.priceInfoObjectId),
      tx.object.clock(),
    ],
  });
  return tx;
}

/**
 * Owner-side: build, sign (sign-only, NOT execute), and store an envelope for `policyId`.
 * In the product the owner signs in their browser wallet (signTransaction) and POSTs the result;
 * here `ownerKeypair` stands in for that. Returns the stored envelope record.
 */
export async function signAndStoreEnvelope(ownerKeypair, meta, { expiresInMs = 24 * 3600_000 } = {}) {
  const client = makeSuiClient();
  const tx = await buildEnvelopeTx({ ...meta, owner: ownerKeypair.toSuiAddress() });
  const bytes = await tx.build({ client });
  const { signature } = await ownerKeypair.signTransaction(bytes);
  if (!existsSync(STORE)) mkdirSync(STORE, { recursive: true });
  const rec = {
    version: 'guardian.envelope.v1',
    policyId: meta.policyId,
    owner: ownerKeypair.toSuiAddress(),
    gasObjectId: meta.gasObjectId,
    txBytes: Buffer.from(bytes).toString('base64'),
    signature,
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresInMs,
  };
  writeFileSync(envPath(meta.policyId), JSON.stringify(rec, null, 2));
  return rec;
}

/** Load a live (non-expired) envelope for a policy, or null. */
export function loadEnvelope(policyId) {
  const p = envPath(policyId);
  if (!existsSync(p)) return null;
  try {
    const rec = JSON.parse(readFileSync(p, 'utf8'));
    if (rec.expiresAt && Date.now() > rec.expiresAt) return null;
    return rec;
  } catch { return null; }
}

export function deleteEnvelope(policyId) {
  const p = envPath(policyId);
  if (existsSync(p)) rmSync(p);
}

export function listEnvelopes() {
  if (!existsSync(STORE)) return [];
  return readdirSync(STORE).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
}

/**
 * Keeper-side: refresh Pyth just-in-time (keeper-signed), then relay the owner-signed envelope.
 * The envelope's sender is the owner, so `validate_owner` passes — the keeper supplies no authority.
 * Single-use: the pinned gas coin is consumed on success, so the envelope is deleted.
 * @param keeperKeypair  signs ONLY the refresh tx (cheap, keeper-funded); never the envelope.
 */
export async function broadcastEnvelope(client, policyId, keeperKeypair) {
  const rec = loadEnvelope(policyId);
  if (!rec) throw new Error(`no live envelope for ${policyId}`);

  // 1) Just-in-time Pyth refresh so execute_protection reads a fresh on-chain price.
  if (keeperKeypair) {
    const refresh = await buildRefreshTx();
    refresh.setSender(keeperKeypair.toSuiAddress());
    const r = await client.signAndExecuteTransaction({ signer: keeperKeypair, transaction: refresh, options: { showEffects: true } });
    if (r.effects?.status?.status !== 'success') throw new Error(`pyth refresh failed: ${JSON.stringify(r.effects?.status)}`);
  }

  // 2) Relay the owner-signed envelope.
  const res = await client.executeTransactionBlock({
    transactionBlock: rec.txBytes,
    signature: rec.signature,
    options: { showEffects: true, showEvents: true },
  });
  const status = res.effects?.status?.status;
  if (status !== 'success') throw new Error(`envelope execution aborted: ${JSON.stringify(res.effects?.status)}`);
  deleteEnvelope(policyId); // gas coin consumed → single-use; owner re-signs for next time
  return res.digest;
}
