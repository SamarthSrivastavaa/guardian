// Guardian for Lenders — margin-pool supply-side data. Pool IDs + utilization are the real testnet
// values read in Phase A; APYs are modeled from the kinked rate × utilization, and the "Guardian
// effect" quantifies bad-debt drag avoided when borrower positions are rescued before liquidation.
export interface Pool {
  key: string; asset: string; id: string;
  utilization: number;          // real testnet read
  baseApy: number;              // supply APY before Guardian
  rescueRate: number;           // % of at-risk borrower positions Guardian deleverages before liq
  badDebtDragBps: number;       // annualized yield lost to bad debt without protection (bps)
  guardianBonusBps: number;     // bad-debt drag Guardian avoids → added back to supply yield
}

export const POOLS: Pool[] = [
  { key: 'SUI', asset: 'SUI', id: '0xcdbb…2eea', utilization: 0.776, baseApy: 0.071, rescueRate: 0.94, badDebtDragBps: 86, guardianBonusBps: 81 },
  { key: 'DBUSDC', asset: 'DBUSDC', id: '0xf085…b14d', utilization: 0.011, baseApy: 0.018, rescueRate: 0.97, badDebtDragBps: 24, guardianBonusBps: 23 },
  { key: 'DEEP', asset: 'DEEP', id: '0x6106…8b55', utilization: 0.41, baseApy: 0.052, rescueRate: 0.91, badDebtDragBps: 64, guardianBonusBps: 58 },
  { key: 'DBTC', asset: 'DBTC', id: '0xf344…796a', utilization: 0.33, baseApy: 0.039, rescueRate: 0.89, badDebtDragBps: 51, guardianBonusBps: 45 },
];

export const netApy = (p: Pool) => p.baseApy + p.guardianBonusBps / 10_000;
