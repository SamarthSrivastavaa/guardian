// Phase A probe: enumerate live margin-enabled pools + risk params from testnet MarginRegistry.
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

const MARGIN_REGISTRY_ID = '0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75';
const client = new SuiJsonRpcClient({ url: 'https://fullnode.testnet.sui.io:443', network: 'testnet' });

const fmtRatio = (v) => (Number(v) / 1e9).toFixed(4);

async function main() {
  const reg = await client.getObject({ id: MARGIN_REGISTRY_ID, options: { showContent: true } });
  const versionedId = reg.data?.content?.fields?.inner?.fields?.id?.id;
  if (!versionedId) throw new Error('Unexpected registry layout: ' + JSON.stringify(reg.data?.content).slice(0, 500));
  const versionedFields = await client.getDynamicFields({ parentId: versionedId });
  const innerObj = await client.getObject({ id: versionedFields.data[0].objectId, options: { showContent: true } });
  const inner = innerObj.data?.content?.fields?.value?.fields;
  if (!inner) throw new Error('Unexpected inner layout: ' + JSON.stringify(innerObj.data?.content).slice(0, 500));

  console.log('MarginRegistry inner fields:', Object.keys(inner));
  console.log('allowed_versions:', JSON.stringify(inner.allowed_versions));

  const poolTableId = inner.pool_registry.fields.id.id;
  const marginPoolsTableId = inner.margin_pools.fields.id.id;
  console.log('pool_registry table:', poolTableId);

  // margin_pools: TypeName -> margin pool ID
  let cursor = null;
  console.log('\n=== margin_pools (asset -> MarginPool ID) ===');
  do {
    const page = await client.getDynamicFields({ parentId: marginPoolsTableId, cursor });
    for (const f of page.data) {
      const obj = await client.getObject({ id: f.objectId, options: { showContent: true } });
      const fields = obj.data.content.fields;
      console.log(`  ${JSON.stringify(fields.name?.fields?.name ?? fields.name)} -> ${fields.value}`);
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  // pool_registry: deepbook pool ID -> PoolConfig
  cursor = null;
  console.log('\n=== pool_registry (DeepBook pool -> PoolConfig) ===');
  do {
    const page = await client.getDynamicFields({ parentId: poolTableId, cursor });
    for (const f of page.data) {
      const obj = await client.getObject({ id: f.objectId, options: { showContent: true } });
      const fields = obj.data.content.fields;
      const cfg = fields.value.fields;
      const rr = cfg.risk_ratios.fields;
      console.log(`\nDeepBook pool: ${fields.name}`);
      console.log(`  enabled:                      ${cfg.enabled}`);
      console.log(`  base_margin_pool_id:          ${cfg.base_margin_pool_id}`);
      console.log(`  quote_margin_pool_id:         ${cfg.quote_margin_pool_id}`);
      console.log(`  min_withdraw_risk_ratio:      ${fmtRatio(rr.min_withdraw_risk_ratio)}`);
      console.log(`  min_borrow_risk_ratio:        ${fmtRatio(rr.min_borrow_risk_ratio)}`);
      console.log(`  liquidation_risk_ratio:       ${fmtRatio(rr.liquidation_risk_ratio)}`);
      console.log(`  target_liquidation_risk_ratio:${fmtRatio(rr.target_liquidation_risk_ratio)}`);
      console.log(`  user_liquidation_reward:      ${fmtRatio(cfg.user_liquidation_reward)}`);
      console.log(`  pool_liquidation_reward:      ${fmtRatio(cfg.pool_liquidation_reward)}`);
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
}

main().catch((e) => { console.error(e); process.exit(1); });
