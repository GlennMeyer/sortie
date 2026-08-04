'use strict';
/* Cost is the cleanest balance lever: it changes what you can afford, not how a unit behaves.
   This walks every unit's price until its average win rate across several budgets sits near 50%. */
const fs = require('fs');
const A0 = require('./army.js'), B = require('./battle.js');
// Integer division makes a single budget a step function — one price tick can drop a whole
// squad and flip a matchup. Averaging across many budgets cancels that quantization noise.
const BUDGETS = [];
for (let b = 1200; b <= 4000; b += 200) BUDGETS.push(b);
const SEEDS = 6;
const PASSES = parseInt(process.argv[2] || '8', 10);

let costs = Object.fromEntries(A0.UNITS.map(u => [u.id, u.cost]));

function rate(costs) {
  const st = A0.newGame(1);
  const spec = id => { const u = Object.assign({}, A0.U[id]); u.br = u.br.slice(); return u; };
  const ids = A0.UNITS.map(u => u.id);
  const out = {};
  for (const a of ids) {
    let w = 0, g = 0;
    for (const b of ids) {
      if (a === b) continue;
      for (const bud of BUDGETS) {
        const ka = Math.max(1, Math.floor(bud / costs[a])), kb = Math.max(1, Math.floor(bud / costs[b]));
        const fa = new Array(ka).fill(0).map(() => spec(a)), fb = new Array(kb).fill(0).map(() => spec(b));
        for (let s = 1; s <= SEEDS; s++) { g++; if (B.simulateBattle(fa, fb, s, { noFrames: true }).won) w++; }
      }
    }
    out[a] = w / g;
  }
  return out;
}

for (let pass = 1; pass <= PASSES; pass++) {
  const r = rate(costs);
  const spread = Math.max(...Object.values(r)) - Math.min(...Object.values(r));
  console.log('pass ' + pass + '  spread ' + Math.round(spread * 100) + '%  ' +
    A0.UNITS.map(u => u.name.split(' ')[0].slice(0, 5) + ' ' + Math.round(r[u.id] * 100)).join('  '));
  if (spread < 0.16) break;
  for (const id of Object.keys(costs)) {
    const d = r[id] - 0.5;
    if (Math.abs(d) < 0.05) continue;
    costs[id] = Math.max(80, Math.round(costs[id] * (1 + clamp(d, -0.30, 0.30) * 0.35) / 5) * 5);
  }
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

console.log('\nfinal costs:');
for (const u of A0.UNITS) console.log('  ' + u.name.padEnd(16) + String(u.cost).padStart(5) + '  ->  ' + String(costs[u.id]).padStart(5));

let src = fs.readFileSync('army.js', 'utf8');
for (const u of A0.UNITS) {
  const re = new RegExp("(id: '" + u.id + "',[^\\n]*?cost: )\\d+");
  src = src.replace(re, '$1' + costs[u.id]);
}
fs.writeFileSync('army.js', src);
console.log('\narmy.js updated');
