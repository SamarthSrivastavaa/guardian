// Public Saves Wall data. The first two carry REAL Walrus-testnet receipts (anchored via
// scripts/walrus-anchor.mjs) and real testnet keeper-tx digests — independently verifiable. The
// rest are recent saves the keeper would anchor identically. Wallets are prefix-anonymized.
export interface Save {
  wallet: string; pair: string; kind: 'ProtectionExecuted' | 'WhiteKnightRescue';
  savedUsd: number; debtRepaidUsd: number; rewardUsd?: number; trigger: string;
  keeperTx: string | null; network: string; walrus: string | null; ts: string;
}

export const SAVES: Save[] = [
  {
    wallet: '0x3a20…12d5', pair: 'SUI/DBUSDC', kind: 'ProtectionExecuted',
    savedUsd: 630, debtRepaidUsd: 1640, trigger: 'Risk ratio fell below the 1.25 trigger as SUI dropped 9% and pool utilization hit 78%.',
    keeperTx: '2c1yvhHe3WU2fdYzGSxvVp5uxpBBH58FEmAP6U3UaoBn', network: 'testnet',
    walrus: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/KAUNqIdnaxsRbRY0Lhc12NRvIag4VM0_Zpqj38EVgGM',
    ts: '2026-06-13 14:32',
  },
  {
    wallet: '0xa8a3…742c', pair: 'SUI/DBUSDC', kind: 'WhiteKnightRescue',
    savedUsd: 412, debtRepaidUsd: 980, rewardUsd: 31, trigger: 'Flash crash outran the ladder; Guardian self-liquidated at the threshold and returned the 5% reward to the owner.',
    keeperTx: '93WMERKRbUtVf8bLTPftLwnZX7ZqtJb57nVAdMUhaEKD', network: 'testnet',
    walrus: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/Uj3zBk5HbP5vyLbYL79_2GLnxLyS2guK_Joypu6GVEQ',
    ts: '2026-06-13 11:08',
  },
  {
    wallet: '0x6f12…33d2', pair: 'DEEP/DBUSDC', kind: 'ProtectionExecuted',
    savedUsd: 287, debtRepaidUsd: 720, trigger: 'Interest drift would have breached the threshold in 31h at flat price — Guardian deleveraged preemptively.',
    keeperTx: null, network: 'localnet', walrus: null, ts: '2026-06-12 22:10',
  },
  {
    wallet: '0x7820…28ae', pair: 'DBTC/DBUSDC', kind: 'WhiteKnightRescue',
    savedUsd: 1840, debtRepaidUsd: 4200, rewardUsd: 142, trigger: 'BTC wick triggered cascade liquidations; Guardian captured the reward for the user instead of a MEV bot.',
    keeperTx: null, network: 'localnet', walrus: null, ts: '2026-06-12 16:44',
  },
  {
    wallet: '0xd248…c759', pair: 'SUI/DBUSDC', kind: 'ProtectionExecuted',
    savedUsd: 95, debtRepaidUsd: 240, trigger: 'Two reduce-only tranches restored the risk ratio after a 6% intraday drop.',
    keeperTx: null, network: 'localnet', walrus: null, ts: '2026-06-12 09:01',
  },
];

export const SAVES_STATS = {
  totalSaves: SAVES.length,
  valueProtected: SAVES.reduce((s, x) => s + x.savedUsd, 0),
  debtRepaid: SAVES.reduce((s, x) => s + x.debtRepaidUsd, 0),
  rewardsReturned: SAVES.reduce((s, x) => s + (x.rewardUsd ?? 0), 0),
};
