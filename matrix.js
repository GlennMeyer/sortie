'use strict';
/* Counter matrix at equal spend. An auto-battler is only as good as this table:
   every unit should beat something and lose to something. */
const A = require('./army.js'), B = require('./battle.js');
const st = A.newGame(1);
const BUDGET = parseInt(process.argv[2] || '900', 10);
const SEEDS = parseInt(process.argv[3] || '14', 10);

const ids = A.UNITS.map(u => u.id);
function force(id) {                       // buy as many of one type as the budget allows
  const u = A.U[id], k = Math.max(1, Math.floor(BUDGET / u.cost));
  return new Array(k).fill(0).map(() => A.spec(st, id));
}
const spendOf = id => { const u = A.U[id]; return Math.max(1, Math.floor(BUDGET / u.cost)) * u.cost; };
const pad = (s, n) => String(s).padEnd(n);
console.log(`\ncounter matrix — ${BUDGET} credits a side, ${SEEDS} seeds (row wins % vs column)\n`);
console.log(pad('', 14) + ids.map(i => pad(A.U[i].name.split(' ')[0].slice(0, 6), 7)).join(''));
const winRates = {};
for (const a of ids) {
  const row = [];
  for (const b of ids) {
    if (a === b) { row.push(pad('—', 7)); continue; }
    let w = 0;
    for (let s = 1; s <= SEEDS; s++) if (B.simulateBattle(force(a), force(b), s, { noFrames: true }).won) w++;
    const r = Math.round(w / SEEDS * 100);
    (winRates[a] = winRates[a] || []).push(r);
    row.push(pad(r + '%', 7));
  }
  console.log(pad(A.U[a].name.split(' ')[0].slice(0, 12), 14) + row.join(''));
}
console.log('\naverage win rate, and how many matchups each unit loses:');
for (const a of ids) {
  const r = winRates[a], avg = Math.round(r.reduce((x, y) => x + y, 0) / r.length);
  const loses = r.filter(x => x < 45).length, beats = r.filter(x => x > 55).length;
  const n = Math.max(1, Math.floor(BUDGET / A.U[a].cost));
  console.log('  ' + pad(A.U[a].name, 15) + pad(n + '× @' + A.U[a].cost, 11) +
    pad('spends ' + spendOf(a), 14) + 'avg ' + pad(avg + '%', 6) + 'beats ' + beats + ', loses to ' + loses);
}
