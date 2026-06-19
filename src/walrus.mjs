// Walrus receipt anchoring — tamper-evident, off-chain proof of a non-custodial protection action.
// Each receipt is the structured rescue event (versioned schema guardian.rescue.v1) stored on
// Walrus testnet with a stable aggregator URL anyone can fetch to verify the action independently.
const PUBLISHER = 'https://publisher.walrus-testnet.walrus.space/v1/blobs?epochs=10';
const AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space/v1/blobs';

/** PUT a receipt to Walrus; returns { blobId, url }. Throws on non-2xx. */
export async function anchorReceipt(receipt) {
  const body = JSON.stringify({ schema: 'guardian.rescue.v1', ...receipt });
  const res = await fetch(PUBLISHER, { method: 'PUT', body });
  if (!res.ok) throw new Error(`Walrus ${res.status}: ${await res.text()}`);
  const out = await res.json();
  const blobId = out.newlyCreated?.blobObject?.blobId ?? out.alreadyCertified?.blobId;
  return { blobId, url: `${AGGREGATOR}/${blobId}` };
}

/** Build a receipt from an executor event emitted in a keeper transaction. */
export function receiptFromEvent({ policyId, managerId, owner, network = 'testnet', digest, event }) {
  const j = event?.parsedJson ?? {};
  if (event?.type?.endsWith('::executor::ProtectionExecuted')) {
    return {
      kind: 'ProtectionExecuted', policy: policyId, manager: managerId, owner, network, keeper_tx: digest,
      rr_before: Number(j.rr_before) / 1e9, debt_before: Number(j.debt_before), debt_after: Number(j.debt_after),
      debt_repaid: Number(j.debt_repaid), orders_cancelled: Number(j.orders_cancelled), ts: new Date().toISOString(),
    };
  }
  if (event?.type?.endsWith('::executor::WhiteKnightRescue')) {
    return {
      kind: 'WhiteKnightRescue', policy: policyId, manager: managerId, owner, network, keeper_tx: digest,
      debt_before: Number(j.debt_before), debt_after: Number(j.debt_after),
      reward_to_owner_base: Number(j.reward_to_owner_base), reward_to_owner_quote: Number(j.reward_to_owner_quote),
      ts: new Date().toISOString(),
    };
  }
  return { kind: 'GuardianAction', policy: policyId, manager: managerId, owner, network, keeper_tx: digest, ts: new Date().toISOString() };
}
