import type { Snapshot } from './guardian';

// Position fixtures seeded from REAL testnet managers read in Phase B (ids preserved), plus one
// manufactured near-trigger position for the dashboard. σ and utilization are realistic so the
// GRS bands emerge from the engine, not hardcoding.
export interface Position extends Snapshot {
  id: string;
  pair: string;
  protected: boolean;
}

export const POSITIONS: Position[] = [
  {
    id: '0x429b61f6cb…36009e', pair: 'SUI / DBUSDC', protected: true,
    side: 'quote', baseAsset: 0.5, quoteAsset: 0.2, debt: 0.202998, markPrice: 0.7665,
    rrLiq: 1.10, sigmaPerHour: 0.018, ratePerYear: 0.05, utilization: 0.011, uKink: 0.8,
    exitSlippage: 0.0004, maxSlippage: 0.005,
  },
  {
    id: '0xa8a3c7e765…18742c', pair: 'SUI / DBUSDC', protected: true,
    side: 'base', baseAsset: 3.385, quoteAsset: 1.5, debt: 3.4054, markPrice: 0.7665,
    rrLiq: 1.10, sigmaPerHour: 0.026, ratePerYear: 0.12, utilization: 0.776, uKink: 0.8,
    exitSlippage: 0.0011, maxSlippage: 0.005,
  },
  {
    id: '0x6f12be40a1…9c33d2', pair: 'SUI / DBUSDC', protected: true,
    side: 'quote', baseAsset: 9.0, quoteAsset: 0, debt: 6.35, markPrice: 0.7665,
    rrLiq: 1.10, sigmaPerHour: 0.052, ratePerYear: 0.22, utilization: 0.93, uKink: 0.8,
    exitSlippage: 0.0034, maxSlippage: 0.005,
  },
  {
    id: '0x0f48bd265e…536371', pair: 'DEEP / SUI', protected: true,
    side: 'base', baseAsset: 420, quoteAsset: 38, debt: 300, markPrice: 0.0512,
    rrLiq: 1.10, sigmaPerHour: 0.041, ratePerYear: 0.18, utilization: 0.64, uKink: 0.8,
    exitSlippage: 0.0019, maxSlippage: 0.005,
  },
];
