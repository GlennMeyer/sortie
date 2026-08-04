'use strict';
/* Headless balance runner. `node balance.js [seeds]`
   Question it exists to answer: does the power/heat/mass triangle have more than one viable corner? */

const { ARCHETYPES, buildStats, simulate, WAVES } = require('./sim.js');

const SEEDS = parseInt(process.argv[2] || '200', 10);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

const rows = [];
for (const a of ARCHETYPES) {
  const s = buildStats(a);
  const agg = { win: 0, ticks: 0, overheats: 0, peak: 0, armor: 0, prop: 0, ammo: 0, fails: {}, wipeWave: [0, 0, 0, 0] };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = simulate(a, seed);
    if (r.ok) agg.win++;
    else { agg.fails[r.reason] = (agg.fails[r.reason] || 0) + 1; agg.wipeWave[r.failedWave]++; }
    agg.ticks += r.ticks; agg.overheats += r.overheats; agg.peak += r.peakHeat;
    agg.armor += r.armorLeft / r.armorMax; agg.prop += r.propLeft / r.propMax;
    agg.ammo += r.ammoTotal ? r.ammoSpent / r.ammoTotal : 0;
  }
  rows.push({ a, s, agg });
}

console.log('\nSORTIE — BALANCE RUN   seeds=' + SEEDS + '   waves=' + WAVES.map(w => w.label).join(' > ') + '\n');
console.log(pad('BUILD', 15) + pad('CHASSIS', 9) + lpad('MASS', 9) + lpad('POWER', 9) + lpad('HEAT', 8) +
            lpad('WIN%', 7) + lpad('TICKS', 7) + lpad('O/H', 6) + lpad('PEAK', 7) + lpad('HULL', 7) + lpad('FUEL', 7) + lpad('AMMO', 7));
console.log('-'.repeat(105));

for (const { a, s, agg } of rows) {
  const n = SEEDS;
  console.log(
    pad(a.name, 15) + pad(s.chassis.name, 9) +
    lpad(`${s.massUsed}/${s.massBudget}`, 9) +
    lpad(`${s.powerDraw}/${s.powerAvail}`, 9) +
    lpad(s.heatRatio.toFixed(2) + 'x', 8) +
    lpad(((agg.win / n) * 100).toFixed(0) + '%', 7) +
    lpad((agg.ticks / n).toFixed(0), 7) +
    lpad((agg.overheats / n).toFixed(1), 6) +
    lpad(((agg.peak / n) * 100).toFixed(0) + '%', 7) +
    lpad(((agg.armor / n) * 100).toFixed(0) + '%', 7) +
    lpad(((agg.prop / n) * 100).toFixed(0) + '%', 7) +
    lpad(((agg.ammo / n) * 100).toFixed(0) + '%', 7)
  );
}

console.log('\nFAILURE MODES');
for (const { a, agg } of rows) {
  const f = Object.entries(agg.fails).sort((x, y) => y[1] - x[1]);
  if (!f.length) { console.log('  ' + pad(a.name, 15) + 'none'); continue; }
  console.log('  ' + pad(a.name, 15) + f.map(([k, v]) => `${k} x${v}`).join('  |  '));
  console.log('  ' + pad('', 15) + 'wiped on: ' + agg.wipeWave.map((c, i) => c ? `${WAVES[i].label}:${c}` : null).filter(Boolean).join(' '));
}

const wins = rows.map(r => r.agg.win / SEEDS);
const viable = wins.filter(w => w >= 0.35 && w <= 0.95).length;
console.log(`\nVIABLE CORNERS (35–95% win): ${viable}/${rows.length}   spread ${(Math.min(...wins) * 100).toFixed(0)}%–${(Math.max(...wins) * 100).toFixed(0)}%\n`);
