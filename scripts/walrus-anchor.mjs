// Anchor a Guardian rescue receipt to Walrus testnet → permanent, verifiable blob URL.
// Each receipt is the structured rescue event (the same data the explainer narrates) so anyone can
// independently verify a non-custodial protection actually fired. The keeper anchors these
// automatically after every action (src/daemon.mjs → src/walrus.mjs); this script anchors samples.
//
// Usage: node scripts/walrus-anchor.mjs   (anchors the sample receipts below, prints blob URLs)
import { anchorReceipt } from '../src/walrus.mjs';

const RECEIPTS = [
  {
    kind: 'ProtectionExecuted', manager: '0x3a209d3a…ed5812d5', pair: 'SUI/DBUSDC',
    rr_before: 1.243, rr_after: 1.451, debt_repaid: 1640, orders_cancelled: 2,
    trigger: 'Risk ratio fell below the 1.25 trigger as SUI dropped 9% and pool utilization hit 78%.',
    keeper_tx: '2c1yvhHe3WU2fdYzGSxvVp5uxpBBH58FEmAP6U3UaoBn', network: 'testnet', ts: '2026-06-13T14:32:09Z',
  },
  {
    kind: 'WhiteKnightRescue', manager: '0xa8a3c7e7…6da18742c', pair: 'SUI/DBUSDC',
    rr_at_rescue: 1.108, reward_returned_usd: 31, base_returned: 0.41, quote_returned: 0,
    trigger: 'Flash crash outran the ladder; Guardian self-liquidated at the threshold and returned the 5% reward to the owner.',
    keeper_tx: '93WMERKRbUtVf8bLTPftLwnZX7ZqtJb57nVAdMUhaEKD', network: 'testnet', ts: '2026-06-13T11:08:55Z',
  },
];

for (const r of RECEIPTS) {
  try {
    const { blobId, url } = await anchorReceipt(r);
    console.log(`${r.kind.padEnd(20)} blobId=${blobId}`);
    console.log(`  ${url}`);
  } catch (e) {
    console.error(`${r.kind}: ${e.message}`);
  }
}
