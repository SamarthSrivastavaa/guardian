#!/usr/bin/env node
// Guardian CLI. Usage:
//   node scripts/guardian.mjs read <managerId> [poolKey]
import { readManagerState } from '../src/reader.mjs';

const fmtRR = (r) => (r == null ? 'n/a' : r >= 1000 ? '∞ (no debt)' : r.toFixed(4));
const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(2)}%`);
const band = (rr) => rr == null ? 'NO DEBT'
  : rr >= 2 ? 'SAFE' : rr >= 1.25 ? 'WATCH' : rr >= 1.10 ? 'PROTECT' : 'LIQUIDATABLE';

async function cmdRead(managerId, poolKey) {
  const s = await readManagerState(managerId, poolKey ? { poolKey } : {});
  const [bSym, qSym] = s.poolKey.split('_');
  console.log(`\n  GUARDIAN — manager ${managerId.slice(0, 12)}…  (${s.poolKey})`);
  console.log(`  ${'─'.repeat(60)}`);
  console.log(`  Risk ratio        ${fmtRR(s.riskRatio)}   [${band(s.riskRatio)}]   liq < ${s.guardian.rrLiq.toFixed(2)}`);
  console.log(`  Debt side         ${s.debtSide}`);
  console.log(`  Collateral        ${s.collateral.base} ${bSym} / ${s.collateral.quote} ${qSym}`);
  console.log(`  Debt              ${s.debt.base} ${bSym} / ${s.debt.quote} ${qSym}`);
  console.log(`  ${'─'.repeat(60)}`);
  console.log(`  Price source      ${s.price.source}  (age ${s.price.hermesAgeSec ?? '?'}s)`);
  console.log(`  ${bSym} / ${qSym}        $${s.price.baseUsd?.toFixed(6) ?? '?'} / $${s.price.quoteUsd?.toFixed(6) ?? '?'}  → mark ${s.price.markPrice?.toFixed(6) ?? 'n/a'}`);
  console.log(`  On-chain Pyth age ${bSym}=${s.price.onchainPythAgeSec.base ?? '?'}s  ${qSym}=${s.price.onchainPythAgeSec.quote ?? '?'}s  ${stale(s.price.onchainPythAgeSec)}`);
  console.log(`  ${'─'.repeat(60)}`);
  if (s.pool.marginPoolId) {
    console.log(`  Margin pool       ${s.pool.marginPoolId.slice(0, 12)}…`);
    console.log(`  Utilization       ${pct(s.pool.utilization)}   (borrow ${s.pool.totalBorrow} / supply ${s.pool.totalSupply})`);
  } else {
    console.log(`  Margin pool       none (no active loan)`);
  }
  console.log(`  ${'─'.repeat(60)}`);
  console.log(`  P_liq (Guardian)  ${s.guardian.pLiq != null ? s.guardian.pLiq.toFixed(6) + ' ' + qSym + '/' + bSym : 'n/a (price-independent or no debt)'}`);
  console.log(`  Distance to liq   ${pct(s.guardian.distanceToLiq)}`);
  console.log('');
}

const stale = (ages) => {
  const max = Math.max(ages.base ?? 0, ages.quote ?? 0);
  return max > 60 ? `⚠ STALE for execution (rescue PTB must refresh)` : `✓ fresh enough`;
};

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'read') {
  if (!args[0]) { console.error('usage: guardian read <managerId> [poolKey]'); process.exit(1); }
  await cmdRead(args[0], args[1]);
} else {
  console.error('commands: read <managerId> [poolKey]');
  process.exit(1);
}
