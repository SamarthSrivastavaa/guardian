// In-app "Enable autopilot" — the browser builds an EXECUTE-ONLY execute_protection envelope,
// pins a dedicated gas coin, has the wallet sign it (sign-only), and POSTs it to the keeper, which
// verifies and stores it. The owner's key never leaves the wallet; the keeper relays it later when
// the trigger hits. Mirrors src/envelopes.mjs (the proven CLI path).
import { testnetCoins, testnetPools, testnetMarginPools, testnetPackageIds } from '@mysten/deepbook-v3';
import { Transaction } from '@mysten/sui/transactions';
import { DEPLOYMENT, SUI_TYPE, DBUSDC_TYPE } from './deployment';

export const KEEPER_URL = (import.meta.env.VITE_KEEPER_URL as string | undefined) ?? 'http://localhost:8787';
export const RESERVE_GAS_MIST = 80_000_000; // dedicated 0.08-SUI coin pinned as the envelope's gas
const POOL = 'SUI_DBUSDC';
const MARGIN_REGISTRY = (testnetPackageIds as Record<string, string>).MARGIN_REGISTRY_ID;
const COINS = testnetCoins as Record<string, { type: string; address: string; priceInfoObjectId: string }>;
const POOLS = testnetPools as Record<string, { address: string; baseCoin: string; quoteCoin: string }>;
const MARGIN_POOLS = testnetMarginPools as Record<string, { address: string }>;

export interface GasRef { objectId: string; version: string; digest: string }

/** A tx that splits off a dedicated coin (reserved as the envelope's pinned gas) back to the owner. */
export function buildReserveGasTx(owner: string, amountMist = RESERVE_GAS_MIST): Transaction {
  const tx = new Transaction();
  const [c] = tx.splitCoins(tx.gas, [amountMist]);
  tx.transferObjects([c], owner);
  return tx;
}

/** The execute-only execute_protection tx (no Pyth refresh; keeper refreshes just-in-time). */
export function buildEnvelopeTx({ owner, policyId, managerId, gas }: { owner: string; policyId: string; managerId: string; gas: GasRef }): Transaction {
  const pool = POOLS[POOL];
  const baseCoin = COINS[pool.baseCoin], quoteCoin = COINS[pool.quoteCoin];
  const baseMP = MARGIN_POOLS[pool.baseCoin], quoteMP = MARGIN_POOLS[pool.quoteCoin];
  const tx = new Transaction();
  tx.setSender(owner);
  tx.setGasPayment([gas]);
  tx.setGasBudget(50_000_000);
  tx.moveCall({
    target: `${DEPLOYMENT.packageId}::executor::execute_protection`,
    typeArguments: [SUI_TYPE, DBUSDC_TYPE],
    arguments: [
      tx.object(policyId), tx.object(managerId), tx.object(pool.address),
      tx.object(baseMP.address), tx.object(quoteMP.address),
      tx.object(MARGIN_REGISTRY), tx.object(DEPLOYMENT.guardianRegistryId),
      tx.object(baseCoin.priceInfoObjectId), tx.object(quoteCoin.priceInfoObjectId),
      tx.object.clock(),
    ],
  });
  return tx;
}

/** POST a signed envelope to the keeper intake server; it verifies before storing. */
export async function postEnvelope(rec: {
  policyId: string; owner: string; gasObjectId: string; txBytes: string; signature: string; expiresAt: number;
}): Promise<{ ok: boolean; error?: string; expiresAt?: number }> {
  try {
    const res = await fetch(`${KEEPER_URL}/envelopes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec),
    });
    return await res.json();
  } catch (e: unknown) {
    return { ok: false, error: `keeper unreachable at ${KEEPER_URL} (${e instanceof Error ? e.message : 'network error'})` };
  }
}
