// Guardian shared config — testnet ground truth (verified Phase A, 2026-06-13).
// All on-chain IDs here were confirmed against live testnet RPC; see GUARDIAN_BLUEPRINT.md §0.
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  DeepBookClient,
  testnetPackageIds,
  testnetCoins,
  testnetPools,
  testnetMarginPools,
  testnetPythConfigs,
} from '@mysten/deepbook-v3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const NETWORK = 'testnet';
export const RPC_URL = 'https://fullnode.testnet.sui.io:443';

// Verified live testnet IDs (Phase A §0.3).
export const MARGIN_REGISTRY_ID = '0x48d7640dfae2c6e9ceeada197a7a1643984b5a24c55a0c6c023dac77e0339f75';
export const MARGIN_PKG_ORIGINAL = '0xb8620c24c9ea1a4a41e79613d2b3d1d93648d1bb6f6b789a7c8f261c94110e4b';

// The pool Guardian targets first: SUI/DBUSDC (most live managers, §B find-manager probe).
export const TARGET_POOL_KEY = 'SUI_DBUSDC';

export const FLOAT_SCALAR = 1_000_000_000; // protocol RR fixed-point (9 decimals)

/** Load the throwaway dev keypair from .env (testnet only). */
export function loadKeypair() {
  const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  const m = env.match(/GUARDIAN_DEV_MNEMONIC="([^"]+)"/);
  if (!m) throw new Error('GUARDIAN_DEV_MNEMONIC not found in .env');
  return Ed25519Keypair.deriveKeypair(m[1]);
}

/**
 * Load the KEEPER keypair (the bot that broadcasts permissionless white-knight rescues + relays
 * envelopes). Prefers GUARDIAN_KEEPER_MNEMONIC so the keeper is a distinct, least-privilege wallet;
 * falls back to the dev key for local demos. The keeper never holds user funds or owner authority.
 */
export function loadKeeperKeypair() {
  const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  const secret = env.match(/GUARDIAN_KEEPER_SECRET="([^"]+)"/);
  if (secret) return Ed25519Keypair.fromSecretKey(secret[1]);
  const mn = env.match(/GUARDIAN_KEEPER_MNEMONIC="([^"]+)"/);
  return mn ? Ed25519Keypair.deriveKeypair(mn[1]) : loadKeypair();
}

export function makeSuiClient() {
  return new SuiJsonRpcClient({ url: RPC_URL, network: NETWORK });
}

/**
 * Build a DeepBookClient with one or more margin managers registered under keys.
 * @param {object} opts
 * @param {string} opts.address  sender address (read paths can use any valid address)
 * @param {Record<string,{address:string, poolKey:string}>} [opts.marginManagers]
 */
export function makeDeepBookClient({ address, marginManagers = {} } = {}) {
  const client = makeSuiClient();
  // Pass ONLY network + managers: the SDK loads all testnet defaults (coins, pools,
  // marginPools, packageIds, pyth). Passing packageIds takes a custom branch that
  // silently drops marginPools (constructor doesn't forward it) — verified Phase B.
  return new DeepBookClient({
    client,
    address,
    network: NETWORK,
    marginManagers,
  });
}

export { testnetCoins, testnetPools, testnetMarginPools, testnetPackageIds, testnetPythConfigs };
