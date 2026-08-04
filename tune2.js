'use strict';
/* Tune costs against MARGINAL value — "is this the right buy for my next 1300 credits" — rather
   than mono-army duels. The duel matrix said the roster was balanced to 18 points while the
   marginal test said 69, and the marginal one is what a player feels. */
const fs = require('fs');
const A = require('./army.js'), B = require('./battle.js');
const PASSES = parseInt(process.argv[2] || '7', 10);
const SPENDS = [800, 1300, 2000];
const SEEDS = 18;
const BASES = [['line', 'line', 'skirm'], ['pods', 'pods', 'line', 'siege'], ['heavy', 'missile', 'line']];
const REFERENCE = ['line', 'skirm', 'missile', 'heavy', 'lancers'];
let costs = Object.fromEntries(A.UNITS.map(u => [u.id, u.cost]));
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

function spec(id) { const u = Object.assign({}, A.U[id]); u.br = u.br.slice(); return u; }
function refBuy(spend) {
  const out = []; let left = spend, i = 0, g = 0;
  while (g++ < 24) { const id = REFERENCE[i++ % REFERENCE.length];
    if (costs[id] > left) { if (REFERENCE.every(r => costs[r] > left)) break; continue; }
    out.push(spec(id)); left -= costs[id]; }
  return out;
}
function rate() {
  const out = {};
  for (const u of A.UNITS) {
    let w = 0, g = 0;
    for (const spend of SPENDS) {
      const k = Math.min(Math.floor(spend / costs[u.id]), Math.floor(A.SLOT_CAP / (A.U[u.id].slots || 1)));
      if (k < 1) { w += 0; g += BASES.length * SEEDS; continue; }
      const left = spend - k * costs[u.id];
      const slotsLeft = A.SLOT_CAP - k * (A.U[u.id].slots || 1);
      const filler = new Array(Math.max(0, Math.min(Math.floor(left / costs.pods), slotsLeft))).fill(0).map(() => spec('pods'));
      for (const base of BASES) {
        const mine = base.map(spec).concat(new Array(k).fill(0).map(() => spec(u.id))).concat(u.id === 'pods' ? [] : filler);
        const foe = base.map(spec).concat(refBuy(spend));
        for (let s = 1; s <= SEEDS; s++) { g++; if (B.simulateBattle(mine, foe, s, { noFrames: true }).won) w++; }
      }
    }
    out[u.id] = w / g;
  }
  return out;
}

for (let p = 1; p <= PASSES; p++) {
  const r = rate();
  const spread = Math.max(...Object.values(r)) - Math.min(...Object.values(r));
  console.log('pass ' + p + '  spread ' + Math.round(spread * 100) + '  ' +
    A.UNITS.map(u => u.name.split(' ')[0].slice(0, 5) + ' ' + Math.round(r[u.id] * 100)).join('  '));
  if (spread < 0.20) break;
  for (const id of Object.keys(costs)) {
    const d = r[id] - 0.5;
    if (Math.abs(d) < 0.06) continue;
    costs[id] = Math.max(80, Math.round(costs[id] * (1 + clamp(d, -0.4, 0.4) * 0.45) / 5) * 5);
  }
}
/* Tuning only cares about ratios, so the absolute scale drifts upward pass after pass until a
   starting budget buys one squad. Renormalise to a fixed mean before writing them out. */
// anchor on the cheapest squad, so a starting budget always buys a handful of them
const mean = Math.min(...Object.values(costs));
const norm = 140 / mean;
for (const id of Object.keys(costs)) costs[id] = Math.max(80, Math.round(costs[id] * norm / 5) * 5);
console.log('renormalised by ' + norm.toFixed(3) + ' (cheapest was ' + Math.round(mean) + ')');

console.log('\nfinal costs:');
for (const u of A.UNITS) console.log('  ' + u.name.padEnd(16) + String(u.cost).padStart(5) + ' -> ' + String(costs[u.id]).padStart(5));
let src = fs.readFileSync('army.js', 'utf8');
for (const u of A.UNITS) src = src.replace(new RegExp("(id: '" + u.id + "',[^\\n]*?cost: )\\d+"), '$1' + costs[u.id]);
fs.writeFileSync('army.js', src);
console.log('\narmy.js updated');
