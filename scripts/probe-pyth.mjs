import { makeSuiClient, testnetCoins } from '../src/config.mjs';
const client = makeSuiClient();
for (const key of ['SUI', 'DBUSDC', 'DEEP']) {
  const c = testnetCoins[key];
  const obj = await client.core.getObject({ objectId: c.priceInfoObjectId });
  const content = obj.object.content;
  const pf = content?.price_info?.fields?.price_feed?.fields ?? content?.price_info?.price_feed;
  const p = pf?.price?.fields ?? pf?.price;
  const ts = Number(p?.timestamp);
  const age = Math.floor(Date.now() / 1000) - ts;
  console.log(`${key}: feed=${c.feed?.slice(0,12)}… publishTime=${ts} age=${age}s`);
}
