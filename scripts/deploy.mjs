#!/usr/bin/env node
// Publish the guardian Move package to testnet and capture the object IDs Guardian needs at
// runtime (package id, GuardianRegistry, GuardianVault, GuardianAdminCap) into
// deployment.testnet.json. Runs the moment the dev wallet has gas.
//
// Usage: node scripts/deploy.mjs        (uses the active sui CLI env + address)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sui = join(homedir(), '.sui', 'bin', 'sui.exe');

function publish() {
  const out = execFileSync(sui, [
    'client', 'publish', join(root, 'contracts'),
    '--json', '--gas-budget', '500000000', '--skip-dependency-verification',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

function main() {
  console.log('Publishing guardian package to testnet…');
  const res = publish();

  const changes = res.objectChanges ?? [];
  const pkg = changes.find((c) => c.type === 'published')?.packageId;
  const find = (suffix) => changes.find((c) => c.type === 'created' && c.objectType?.endsWith(suffix))?.objectId;

  const deployment = {
    network: 'testnet',
    publishedAt: new Date().toISOString(),
    digest: res.digest,
    packageId: pkg,
    guardianRegistryId: find('::registry::GuardianRegistry'),
    guardianVaultId: find('::registry::GuardianVault'),
    guardianAdminCapId: find('::registry::GuardianAdminCap'),
  };

  const path = join(root, 'deployment.testnet.json');
  writeFileSync(path, JSON.stringify(deployment, null, 2));
  console.log('\nDeployment captured →', path);
  console.log(JSON.stringify(deployment, null, 2));
  if (!pkg) { console.error('\nWARNING: no packageId found in objectChanges — inspect the publish output.'); process.exit(1); }
}

main();
