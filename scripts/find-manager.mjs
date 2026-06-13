// Find an existing testnet MarginManager via MarginManagerCreatedEvent, to test the reader against.
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

const MARGIN_PKG = '0xb8620c24c9ea1a4a41e79613d2b3d1d93648d1bb6f6b789a7c8f261c94110e4b'; // testnet original-id
const client = new SuiJsonRpcClient({ url: 'https://fullnode.testnet.sui.io:443', network: 'testnet' });

const page = await client.queryEvents({
  query: { MoveEventType: `${MARGIN_PKG}::margin_manager::MarginManagerCreatedEvent` },
  limit: 25,
  order: 'descending',
});

console.log(`Found ${page.data.length} MarginManagerCreatedEvent(s):\n`);
for (const e of page.data) {
  const f = e.parsedJson;
  console.log(`manager=${f.margin_manager_id}  pool=${f.deepbook_pool_id}  owner=${f.owner}`);
}
