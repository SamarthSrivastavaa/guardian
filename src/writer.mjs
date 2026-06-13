// Guardian write path (Phase B): create a manager we control, set up a borrow position,
// then prove the two rescue primitives Guardian relies on — repay (deleverage) and
// cancel_orders. repay/cancel are oracle-free; deposit/borrow need a Pyth refresh prepended
// (src/oracle.mjs). Signing uses the throwaway dev keypair from .env (testnet only).
import { Transaction } from '@mysten/sui/transactions';
import { makeSuiClient, makeDeepBookClient, loadKeypair, MARGIN_PKG_ORIGINAL } from './config.mjs';
import { refreshPyth } from './oracle.mjs';

const kp = loadKeypair();
const SENDER = kp.toSuiAddress();

async function signAndRun(tx, label) {
  const client = makeSuiClient();
  tx.setSender(SENDER);
  const res = await client.signAndExecuteTransaction({
    signer: kp,
    transaction: tx,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  });
  const status = res.effects?.status?.status ?? res.effects?.status;
  console.log(`  [${label}] ${res.digest}  status=${JSON.stringify(status)}`);
  if (status !== 'success' && status?.status !== 'success') {
    throw new Error(`${label} failed: ${JSON.stringify(res.effects?.status)}`);
  }
  return res;
}

/** Create + share a new MarginManager on `poolKey`; returns its ID (from the created event). */
export async function createManager(poolKey = 'SUI_DBUSDC') {
  const dbc = makeDeepBookClient({ address: SENDER });
  const tx = new Transaction();
  tx.add(dbc.marginManager.newMarginManager(poolKey));
  const res = await signAndRun(tx, 'create-manager');
  const ev = (res.events ?? []).find((e) => e.type.endsWith('::margin_manager::MarginManagerCreatedEvent'));
  const id = ev?.parsedJson?.margin_manager_id;
  if (!id) throw new Error('no MarginManagerCreatedEvent in result');
  console.log(`  -> manager ${id}`);
  return id;
}

/** Deposit base (SUI) collateral and borrow base (SUI) in one Pyth-refreshed tx. */
export async function depositAndBorrowBase(managerId, { poolKey = 'SUI_DBUSDC', depositSui, borrowSui }) {
  const client = makeSuiClient();
  const dbc = makeDeepBookClient({ address: SENDER, marginManagers: { M: { address: managerId, poolKey } } });
  const tx = new Transaction();
  await refreshPyth(tx, client, ['SUI', 'DBUSDC']);
  tx.add(dbc.marginManager.depositBase({ managerKey: 'M', amount: depositSui }));
  tx.add(dbc.marginManager.borrowBase('M', borrowSui));
  return signAndRun(tx, `deposit ${depositSui} + borrow ${borrowSui} SUI`);
}

/** Repay base (SUI) debt. Oracle-free. amount omitted = repay min(idle, debt). */
export async function repayBase(managerId, { poolKey = 'SUI_DBUSDC', amount } = {}) {
  const dbc = makeDeepBookClient({ address: SENDER, marginManagers: { M: { address: managerId, poolKey } } });
  const tx = new Transaction();
  tx.add(dbc.marginManager.repayBase('M', amount));
  return signAndRun(tx, `repay ${amount ?? '(all idle)'} SUI`);
}

/** Place a resting limit ask ABOVE market (locks base SUI, won't fill) so we have an order to cancel.
 *  Needs Pyth refresh (place_limit_order_v2 reads risk_ratio). */
export async function placeLimitAsk(managerId, { poolKey = 'SUI_DBUSDC', price, quantity }) {
  const client = makeSuiClient();
  const dbc = makeDeepBookClient({ address: SENDER, marginManagers: { M: { address: managerId, poolKey } } });
  const tx = new Transaction();
  await refreshPyth(tx, client, ['SUI', 'DBUSDC']);
  tx.add(dbc.poolProxy.placeLimitOrder({
    marginManagerKey: 'M', poolKey, clientOrderId: Date.now() % 1_000_000,
    price, quantity, isBid: false, payWithDeep: false,
  }));
  return signAndRun(tx, `place limit ask ${quantity}@${price}`);
}

/** Cancel all open orders. Oracle-free. */
export async function cancelAll(managerId, { poolKey = 'SUI_DBUSDC' } = {}) {
  const dbc = makeDeepBookClient({ address: SENDER, marginManagers: { M: { address: managerId, poolKey } } });
  const tx = new Transaction();
  tx.add(dbc.poolProxy.cancelAllOrders('M'));
  return signAndRun(tx, 'cancel-all-orders');
}

export { SENDER };
