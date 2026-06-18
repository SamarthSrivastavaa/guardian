// Live Guardian testnet deployment (mirrors deployment.testnet.json). The policy + registry
// modules are live and functional; policy::create has been exercised on-chain.
export const DEPLOYMENT = {
  network: 'testnet' as const,
  packageId: '0x16ba4b3cbe87719eceb465b6b69488c924c4526d5d02e5df7691a9732fdffdfb',
  guardianRegistryId: '0xc54ecddad290b49cbb9efd4fbefd9375929e01dbb373a8fd9f63a3e5d9e551fc',
  guardianVaultId: '0x3611792cc17755286297e1f727948062e20d403f633604a9232371bd63ee85df',
};

// SUI/DBUSDC is the demo pool. policy::create is generic over <Base, Quote> = the manager's pool.
export const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
export const DBUSDC_TYPE = '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC';

// A real SUI/DBUSDC MarginManager owned by the dev wallet — the default target for the composer.
// To create a policy you must connect a wallet that OWNS the manager you enter.
export const DEMO_MANAGER = '0x3a209d3a12e3d44f62d048579ef73b0a82dc05d2687f2311f4c70750ed5812d5';

export const TIP_MIST = 20_000_000; // 0.02 SUI keeper-tip pot, split from gas
export const toFixedRr = (decimal: number) => Math.round(decimal * 1_000_000_000); // → 9-dec fixed point
export const suiscanTx = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
export const suiscanObj = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;
