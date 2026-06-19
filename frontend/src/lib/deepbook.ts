// Thin browser wrapper over @mysten/deepbook-v3 for the one thing the app needs the SDK for:
// minting a MarginManager the connected wallet owns, so a policy can be bound to it.
// newMarginManager() is a pure PTB builder (margin_manager::new<Base,Quote> against the
// margin version the live pools accept — MARGIN_PACKAGE_ID = 0xd6a4); the wallet signs it.
import { DeepBookClient } from '@mysten/deepbook-v3';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';

// SUI/DBUSDC is the demo pool the composer + executor target.
export const DEMO_POOL_KEY = 'SUI_DBUSDC';
export const MANAGER_CREATED_EVENT = '::margin_manager::MarginManagerCreatedEvent';

function makeDbc(client: SuiJsonRpcClient, address: string) {
  // Network defaults only (coins/pools/marginPools/packageIds) — same call the keeper uses.
  return new DeepBookClient({ client: client as never, address, network: 'testnet' });
}

/** A transaction that creates + shares a new MarginManager owned by `address`. */
export function buildCreateManagerTx(client: SuiJsonRpcClient, address: string): Transaction {
  const tx = new Transaction();
  tx.add(makeDbc(client, address).marginManager.newMarginManager(DEMO_POOL_KEY));
  return tx;
}

/** Pull the new manager id out of the MarginManagerCreatedEvent in a tx result. */
export function managerIdFromEvents(events: { type: string; parsedJson?: unknown }[] | undefined): string | null {
  const ev = (events ?? []).find((e) => e.type.endsWith(MANAGER_CREATED_EVENT));
  const j = ev?.parsedJson as { margin_manager_id?: string } | undefined;
  return j?.margin_manager_id ?? null;
}
