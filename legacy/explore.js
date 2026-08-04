'use strict';
/* Search the build space. Answers: how many genuinely different builds can clear a sortie? */
const { CHASSIS, MODULES, DOCTRINES, buildStats, simulate, mulberry32 } = require('./sim.js');
const SEEDS = parseInt(process.argv[2] || '12', 10);
const SAMPLE = parseInt(process.argv[3] || '900', 10);   // hex combat is ~7ms/sortie: sample, don't enumerate
const ids = MODULES.map(m => m.id);
const combos = [];
(function rec(start, cur) {
  if (cur.length >= 3) combos.push(cur.slice());
  if (cur.length === 5) return;
  for (let i = start; i < ids.length; i++) { cur.push(ids[i]); rec(i + 1, cur); cur.pop(); }
})(0, []);

const legal = [];
for (const chassis of Object.keys(CHASSIS))
  for (const doctrine of Object.keys(DOCTRINES))
    for (const mods of combos) {
      const b = { chassis, doctrine, mods };
      const s = buildStats(b);
      if (s.valid && !s.brownout) legal.push({ b, s });
    }

const pick = mulberry32(12345);
const pool = legal.slice();
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(pick() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const sample = pool.slice(0, Math.min(SAMPLE, pool.length));

const results = [];
for (const { b, s } of sample) {
  let win = 0;
  for (let seed = 1; seed <= SEEDS; seed++) if (simulate(b, seed, { noFrames: true }).ok) win++;
  results.push({ b, s, wr: win / SEEDS });
}
results.sort((a, b) => b.wr - a.wr);
const viable = results.filter(r => r.wr >= 0.5);
console.log(`\nlegal builds ${legal.length}  sampled ${results.length}   clearing >=50% ${viable.length} (${(viable.length/results.length*100).toFixed(1)}%)   >=90% ${results.filter(r=>r.wr>=0.9).length}`);

const key = r => r.b.chassis;
const byCh = {};
for (const r of viable) byCh[key(r)] = (byCh[key(r)] || 0) + 1;
console.log('viable by chassis:', byCh);
const byDoc = {};
for (const r of viable) byDoc[r.b.doctrine] = (byDoc[r.b.doctrine] || 0) + 1;
console.log('viable by doctrine:', byDoc);
const use = {};
for (const r of viable) for (const m of r.b.mods) use[m] = (use[m] || 0) + 1;
console.log('\nmodule presence among viable builds:');
for (const [k, v] of Object.entries(use).sort((a,b)=>b[1]-a[1]))
  console.log('  ' + k.padEnd(12) + String(Math.round(v / viable.length * 100) + '%').padStart(5) + '  ' + '#'.repeat(Math.round(v/viable.length*40)));

const maxPres = Math.max(...Object.values(use)) / viable.length;
const prim = {};
for (const r of viable) { const w = r.b.mods.find(m => ['beam_rifle','beam_saber','missiles','bazooka','mg','scatter'].includes(m)); prim[w] = (prim[w]||0)+1; }
console.log(`\nDIVERSITY  max module presence ${(maxPres*100).toFixed(0)}% (want <65%)   distinct lead weapons ${Object.keys(prim).length}/6`);

console.log('\ntop 12 builds');
for (const r of results.slice(0, 12))
  console.log('  ' + String(Math.round(r.wr*100)+'%').padStart(5) + '  ' + r.s.chassis.name.padEnd(8) + r.b.doctrine.padEnd(11) +
    String(r.s.massUsed+'/'+r.s.massBudget).padStart(7) + ' ' + r.s.heatRatio.toFixed(2)+'x  ' + r.b.mods.join(' '));
