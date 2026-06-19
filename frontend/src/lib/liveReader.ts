// Live dashboard reads — the connected wallet's REAL margin managers on testnet.
// Balances, debt, and risk ratio are live chain + oracle reads; the GRS soft inputs (vol, rate)
// use modeled defaults (a keeper would seed these from history). Mirrors src/reader.mjs.
import { DeepBookClient, testnetCoins } from '@mysten/deepbook-v3';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type { Snapshot } from './guardian';
import { DEPLOYMENT } from './deployment';

const HERMES = 'https://hermes-beta.pyth.network';
const POOL = 'SUI_DBUSDC';
const norm = (f: string) => (f.startsWith('0x') ? f : `0x${f}`);
const SUI_FEED = norm(testnetCoins.SUI.feed ?? '');
const DBUSDC_FEED = norm(testnetCoins.DBUSDC.feed ?? '');

export interface LivePosition extends Snapshot { id: string; pair: string; protected: boolean }

/** Fresh SUI & DBUSDC USD prices from Hermes-beta → cross rate (base priced in quote). */
async function markPriceSuiDbusdc(): Promise<number | null> {
  try {
    const qs = [SUI_FEED, DBUSDC_FEED].map((f) => `ids[]=${f}`).join('&');
    const res = await fetch(`${HERMES}/v2/updates/price/latest?${qs}&parsed=true`);
    if (!res.ok) return null;
    const body = await res.json();
    const px: Record<string, number> = {};
    for (const p of body.parsed ?? []) px[norm(p.id)] = Number(p.price.price) * 10 ** Number(p.price.expo);
    const base = px[SUI_FEED], quote = px[DBUSDC_FEED];
    return base && quote ? base / quote : null;
  } catch { return null; }
}

/** Manager ids (this owner) that carry a live Guardian policy → mark them "protected". */
async function protectedManagerIds(client: SuiJsonRpcClient, owner: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    let cursor: any = null;
    do {
      const page = await client.queryEvents({
        query: { MoveEventType: `${DEPLOYMENT.packageId}::policy::PolicyCreated` },
        cursor, order: 'descending', limit: 50,
      });
      for (const e of page.data) {
        const j: any = e.parsedJson;
        if (j?.owner === owner && j?.margin_manager_id) ids.add(j.margin_manager_id);
      }
      cursor = page.hasNextPage ? page.nextCursor : null;
    } while (cursor);
  } catch { /* best-effort */ }
  return ids;
}

/** Read every SUI/DBUSDC margin manager owned by `owner` into engine-ready snapshots. */
export async function readLivePositions(client: SuiJsonRpcClient, owner: string): Promise<LivePosition[]> {
  let ids: string[] = [];
  try { ids = await new DeepBookClient({ client: client as never, address: owner, network: 'testnet' }).getMarginManagerIdsForOwner(owner); }
  catch { return []; }
  if (!ids.length) return [];

  const managers = Object.fromEntries(ids.map((address, i) => [`M${i}`, { address, poolKey: POOL }]));
  const dbc = new DeepBookClient({ client: client as never, address: owner, network: 'testnet', marginManagers: managers });
  const [markPrice, protectedSet] = await Promise.all([markPriceSuiDbusdc(), protectedManagerIds(client, owner)]);

  const out: LivePosition[] = [];
  for (let i = 0; i < ids.length; i++) {
    const key = `M${i}`;
    try {
      const [assets, hasBaseDebt, marginPoolId] = await Promise.all([
        dbc.getMarginManagerAssets(key, 9), dbc.getMarginManagerHasBaseDebt(key), dbc.getMarginManagerMarginPoolId(key),
      ]);
      let baseDebt = 0, quoteDebt = 0;
      if (marginPoolId != null) {
        const d = await dbc.getMarginManagerDebts(key, 9).catch(() => ({ baseDebt: 0, quoteDebt: 0 }));
        baseDebt = Number(d.baseDebt); quoteDebt = Number(d.quoteDebt);
      }
      const side = (marginPoolId != null && hasBaseDebt ? 'base' : 'quote') as Snapshot['side'];
      out.push({
        id: ids[i], pair: 'SUI / DBUSDC', protected: protectedSet.has(ids[i]),
        side, baseAsset: Number(assets.baseAsset), quoteAsset: Number(assets.quoteAsset),
        debt: side === 'base' ? baseDebt : quoteDebt,
        markPrice: markPrice ?? 0, rrLiq: 1.10,
        sigmaPerHour: 0.02, ratePerYear: 0.1, utilization: 0, uKink: 0.8, exitSlippage: 0, maxSlippage: 0.005,
      });
    } catch { /* skip managers on other pools / unreadable */ }
  }
  return out;
}

export { POOL };
