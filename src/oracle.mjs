// Guardian Pyth oracle refresh (Phase B).
//
// Any margin call that reads the SAFE oracle path (deposit, borrow, risk_ratio, liquidate,
// our executor) aborts if the on-chain Pyth PriceInfoObject is older than the pool's
// max_age_secs. On testnet nobody pushes these feeds continuously, so EVERY such tx must
// refresh them in the same PTB. `update_price_feeds` mutates the SAME shared
// PriceInfoObjects the SDK builders reference by static ID — so we just prepend the refresh
// to the tx and the later margin call reads them fresh. No object-ID swapping needed.
import { SuiPriceServiceConnection, SuiPythClient } from '@mysten/deepbook-v3';
import { testnetCoins, testnetPythConfigs } from './config.mjs';

const HERMES_BETA = 'https://hermes-beta.pyth.network';

/**
 * Prepend Pyth price-feed updates for the given coin keys to `tx`.
 * @returns {Promise<string[]>} the refreshed PriceInfoObject IDs (in feed order)
 */
export async function refreshPyth(tx, client, coinKeys) {
  const feedIds = coinKeys.map((k) => {
    const f = testnetCoins[k].feed;
    if (!f) throw new Error(`no Pyth feed for ${k}`);
    return f;
  });
  const connection = new SuiPriceServiceConnection(HERMES_BETA);
  const updateData = await connection.getPriceFeedsUpdateData(feedIds);
  const pyth = new SuiPythClient(client, testnetPythConfigs.pythStateId, testnetPythConfigs.wormholeStateId);
  return pyth.updatePriceFeeds(tx, updateData, feedIds);
}
