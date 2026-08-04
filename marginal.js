'use strict';
/* Marginal value: given an army you already have, what is the best use of the next N credits?
   This is the question a player actually asks, and the unit-vs-unit matrix never asks it. */
const A = require('./army.js'), B = require('./battle.js');
const SPENDS = (process.argv[2] || '800,1300,2000').split(',').map(Number);   // one spend level is too noisy to read
const SEEDS = parseInt(process.argv[3] || '30', 10);
const st = A.newGame(1);

/* Both sides start from the same army and both get the same credits to spend. The enemy spends
   theirs on a balanced mix; you spend yours all on one thing. Anything that wins well above 50%
   is the obvious buy — which is what "I just pick Ace every time" means. */
const BASES = [
  ['line', 'line', 'skirm'],
  ['pods', 'pods', 'line', 'siege'],
  ['heavy', 'missile', 'line'],
];
const REFERENCE = ['line', 'skirm', 'missile', 'heavy', 'lancers'];   // what a sensible mix looks like
function referenceBuy(spend) {
  const out = []; let left = spend, i = 0, guard = 0;
  while (guard++ < 20) {
    const id = REFERENCE[i++ % REFERENCE.length];
    if (A.U[id].cost > left) { if (REFERENCE.every(r => A.U[r].cost > left)) break; continue; }
    out.push(A.spec(st, id)); left -= A.U[id].cost;
  }
  return out;
}

const results = [];
for (const u of A.UNITS) {
  let w = 0, g = 0, kShown = 0, spentShown = 0;
  for (const SPEND of SPENDS) {
  // a slot has to cost what it is worth, so buying is capped by slots as well as credits
  const k = Math.min(Math.floor(SPEND / u.cost), Math.floor(A.SLOT_CAP / (u.slots || 1)));
  if (k < 1) { g += BASES.length * SEEDS; continue; }
  if (SPEND === SPENDS[1]) { kShown = k; spentShown = k * u.cost; }
  for (const base of BASES) {
    // spend the remainder on the cheapest filler, or a chunky unit looks bad purely for leaving change
    const left = SPEND - k * u.cost;
    const slotsLeft = A.SLOT_CAP - k * (u.slots || 1);
    const filler = new Array(Math.max(0, Math.min(Math.floor(left / A.U.pods.cost), slotsLeft))).fill(0).map(() => A.spec(st, 'pods'));
    const mine = base.map(id => A.spec(st, id))
      .concat(new Array(k).fill(0).map(() => A.spec(st, u.id))).concat(u.id === 'pods' ? [] : filler);
    const foe = base.map(id => A.spec(st, id)).concat(referenceBuy(SPEND));
    for (let s = 1; s <= SEEDS; s++) { g++; if (B.simulateBattle(mine, foe, s, { noFrames: true }).won) w++; }
  }
  }
  results.push({ u, k: kShown, wr: w / g, spent: spentShown });
}

// baseline: spend nothing
let bw = 0, bg = 0;
for (const SPEND of SPENDS) for (const base of BASES) {
  const mine = base.map(id => A.spec(st, id));
  const foe = base.map(id => A.spec(st, id)).concat(referenceBuy(SPEND));
  for (let s = 1; s <= SEEDS; s++) { bg++; if (B.simulateBattle(mine, foe, s, { noFrames: true }).won) bw++; }
}
const baseline = bw / bg;

console.log(`\nMARGINAL VALUE, averaged over ${SPENDS.join('/')} credits  (both sides matched, ${BASES.length} armies × ${SEEDS} seeds)`);
console.log('  spend nothing while they spend the same: ' + Math.round(baseline * 100) + '%   (50% = the buy is fairly priced)\n');
results.sort((a, b) => (b.wr || 0) - (a.wr || 0));
for (const r of results) {
  if (r.wr == null) { console.log('  ' + r.u.name.padEnd(15) + '  unaffordable'); continue; }
  const bar = '#'.repeat(Math.max(1, Math.round(r.wr * 44)));
  const flag = r.wr > 0.68 ? '  <-- auto-pick' : r.wr < 0.32 ? '  <-- never worth it' : '';
  console.log('  ' + r.u.name.padEnd(15) + String(r.k + '×').padStart(4) + ' ' + String(r.spent).padStart(5) + 'cr   ' +
    String(Math.round(r.wr * 100) + '%').padStart(5) + '  ' + bar + flag);
}
const wrs = results.filter(r => r.wr != null).map(r => r.wr);
console.log('\n  spread between best and worst buy: ' + Math.round((Math.max(...wrs) - Math.min(...wrs)) * 100) + ' points');
