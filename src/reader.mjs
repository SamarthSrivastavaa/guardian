// Guardian ground-truth reader (Phase B).
//
// Given a MarginManager ID, fetch the FULL live state Guardian's risk engine needs and
// compute risk ratio, P_liq, and distance-to-liquidation. Design choice (verified Phase B):
// the protocol's RR read (`manager_state`) aborts unless Pyth feeds are refreshed in the
// same PTB, which only matters at EXECUTION time. For MONITORING we do what a real keeper
// does — read the oracle-FREE on-chain components (`calculate_assets`, `calculate_debts`,
// which never touch Pyth) and price the cross-rate with FRESH Hermes data. On-chain Pyth
// staleness is reported separately as an execution-readiness signal.
//
// Every number is a real on-chain read or a live Hermes quote — no mocks.
import { makeSuiClient, makeDeepBookClient, testnetCoins, testnetPools } from './config.mjs';

const READER_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000001';
const HERMES_BETA = 'https://hermes-beta.pyth.network';

/** Fetch fresh parsed prices from Hermes-beta for a set of feed IDs. Returns {feedId: {price, ageSec}}. */
async function fetchHermesPrices(feedIds) {
  const qs = feedIds.map((f) => `ids[]=${f}`).join('&');
  const res = await fetch(`${HERMES_BETA}/v2/updates/price/latest?${qs}&parsed=true`);
  if (!res.ok) throw new Error(`Hermes ${res.status}`);
  const body = await res.json();
  const out = {};
  for (const p of body.parsed ?? []) {
    const id = p.id.startsWith('0x') ? p.id : `0x${p.id}`;
    const value = Number(p.price.price) * Math.pow(10, p.price.expo);
    out[id] = { value, conf: Number(p.price.conf) * Math.pow(10, p.price.expo),
      publishTime: p.price.publish_time, ageSec: Math.floor(Date.now() / 1000) - p.price.publish_time };
  }
  return out;
}

/** On-chain Pyth PriceInfoObject age (execution-readiness: the rescue PTB must refresh if stale). */
async function onchainPythAge(client, priceInfoObjectId) {
  const o = await client.getObject({ id: priceInfoObjectId, options: { showContent: true } });
  const p = o.data?.content?.fields?.price_info?.fields?.price_feed?.fields?.price?.fields;
  if (!p) return null;
  return Math.floor(Date.now() / 1000) - Number(p.timestamp);
}

/** Margin pool State → utilization + last update. */
async function readMarginPoolState(client, marginPoolId) {
  const o = await client.getObject({ id: marginPoolId, options: { showContent: true } });
  const s = o.data?.content?.fields?.state?.fields;
  if (!s) return null;
  const totalSupply = BigInt(s.total_supply);
  const totalBorrow = BigInt(s.total_borrow);
  return {
    totalSupply, totalBorrow,
    utilization: totalSupply === 0n ? 0 : Number(totalBorrow) / Number(totalSupply),
    lastUpdateMs: Number(s.last_update_timestamp),
  };
}

export async function readManagerState(managerId, { poolKey = 'SUI_DBUSDC' } = {}) {
  const client = makeSuiClient();
  const dbc = makeDeepBookClient({
    address: READER_ADDRESS,
    marginManagers: { TARGET: { address: managerId, poolKey } },
  });
  const pool = testnetPools[poolKey];
  const baseCoin = testnetCoins[pool.baseCoin];
  const quoteCoin = testnetCoins[pool.quoteCoin];

  // 1) Oracle-free on-chain reads (no Pyth dependency). `calculate_debts` aborts for a manager
  //    with no active loan (margin_pool_id cleared, e.g. fully deleveraged), so gate the debt read
  //    on there being a margin pool — a no-debt manager reads cleanly as debtSide 'none'.
  const [assets, hasBaseDebt, marginPoolId] = await Promise.all([
    dbc.getMarginManagerAssets('TARGET', 9),
    dbc.getMarginManagerHasBaseDebt('TARGET'),
    dbc.getMarginManagerMarginPoolId('TARGET'),
  ]);
  let baseDebt = 0, quoteDebt = 0;
  if (marginPoolId != null) {
    const debts = await dbc.getMarginManagerDebts('TARGET', 9).catch(() => ({ baseDebt: 0, quoteDebt: 0 }));
    baseDebt = Number(debts.baseDebt);
    quoteDebt = Number(debts.quoteDebt);
  }
  const baseAsset = Number(assets.baseAsset);
  const quoteAsset = Number(assets.quoteAsset);
  const debtSide = marginPoolId == null ? 'none' : hasBaseDebt ? 'base' : 'quote';

  // 2) Fresh prices (Hermes-beta) + on-chain Pyth ages (execution readiness).
  const hermes = await fetchHermesPrices([baseCoin.feed, quoteCoin.feed]).catch((e) => ({ error: String(e) }));
  const basePx = hermes[baseCoin.feed.startsWith('0x') ? baseCoin.feed : `0x${baseCoin.feed}`];
  const quotePx = hermes[quoteCoin.feed.startsWith('0x') ? quoteCoin.feed : `0x${quoteCoin.feed}`];
  const baseUsd = basePx?.value ?? null;
  const quoteUsd = quotePx?.value ?? null;
  const markPrice = baseUsd != null && quoteUsd != null ? baseUsd / quoteUsd : null; // base priced in quote

  const [baseOnchainAge, quoteOnchainAge, poolState] = await Promise.all([
    onchainPythAge(client, baseCoin.priceInfoObjectId).catch(() => null),
    onchainPythAge(client, quoteCoin.priceInfoObjectId).catch(() => null),
    marginPoolId ? readMarginPoolState(client, marginPoolId).catch(() => null) : Promise.resolve(null),
  ]);

  // 3) RR + P_liq off-chain, matching the protocol's assets_in_debt_unit / debt definition.
  let riskRatio = null, pLiq = null, distanceToLiq = null;
  if (debtSide !== 'none' && markPrice != null) {
    if (debtSide === 'quote' && quoteDebt > 0) {
      // long: assets_in_debt_unit = quote + base·P ; RR = that / quoteDebt
      const aidu = quoteAsset + baseAsset * markPrice;
      riskRatio = aidu / quoteDebt;
      // P_liq solves RR_liq = (quote + base·P)/quoteDebt  →  P_liq = (RR_liq·quoteDebt − quote)/base
      if (baseAsset > 0) pLiq = (1.10 * quoteDebt - quoteAsset) / baseAsset;
      if (pLiq != null) distanceToLiq = (markPrice - pLiq) / markPrice; // price falls toward liq
    } else if (debtSide === 'base' && baseDebt > 0) {
      // short: assets_in_debt_unit = base + quote/P ; RR = that / baseDebt
      const aidu = baseAsset + quoteAsset / markPrice;
      riskRatio = aidu / baseDebt;
      // P_liq solves RR_liq = (base + quote/P)/baseDebt  →  P_liq = quote/(RR_liq·baseDebt − base)
      const denom = 1.10 * baseDebt - baseAsset;
      if (quoteAsset > 0 && denom > 0) { pLiq = quoteAsset / denom; distanceToLiq = (pLiq - markPrice) / markPrice; }
      else if (quoteAsset === 0) { riskRatio = baseAsset / baseDebt; } // price-independent (same-asset)
    }
  }

  return {
    managerId, poolKey, debtSide, riskRatio,
    collateral: { base: baseAsset, quote: quoteAsset },
    debt: { base: baseDebt, quote: quoteDebt },
    price: {
      source: 'hermes-beta',
      baseUsd, quoteUsd, markPrice,
      hermesAgeSec: basePx?.ageSec ?? null,
      onchainPythAgeSec: { base: baseOnchainAge, quote: quoteOnchainAge },
    },
    pool: { marginPoolId, ...(poolState ?? {}) },
    guardian: { rrLiq: 1.10, pLiq, distanceToLiq },
  };
}
