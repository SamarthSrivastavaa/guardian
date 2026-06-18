// Live Guardian testnet deployment (mirrors deployment.testnet.json). Linked against the
// margin version the live pools accept — policy::create AND execute_protection both run on-chain.
export const DEPLOYMENT = {
  network: 'testnet' as const,
  packageId: '0xed5f648eaac50297498883a2c4939d399959494c3981e806a10b8962b446d7fe',
  guardianRegistryId: '0x112d5e90e443ca0c23b9ca3d6ab06ea079104b68727c8996b97e511c5c6458f9',
  guardianVaultId: '0xc3d55f58d1d93a02bf080335afa5aeddfcf4c40488265ee85e572d4134b99fd2',
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
