'use strict';
/* Pick the best validated build for each (chassis x lead weapon) corner, so the prototype's
   presets are distinct strategies that demonstrably work — not hand-guesses. */
const { CHASSIS, MODULES, DOCTRINES, buildStats, simulate, mulberry32 } = require('./sim.js');
const SEEDS = 14;
const SAMPLE = 1400;   // dice combat is slow: sample the space rather than enumerate it
const ids = MODULES.map(m => m.id);
const LEAD = ['beam_rifle','beam_saber','missiles','bazooka','mg','scatter'];
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
      if (!s.valid || s.brownout) continue;
      const lead = mods.filter(m => LEAD.includes(m));
      if (lead.length < 1 || lead.length > 2) continue;
      legal.push({ b, s, lead: lead[0] });
    }
const pick = mulberry32(4242);
for (let i = legal.length - 1; i > 0; i--) { const j = Math.floor(pick() * (i + 1)); [legal[i], legal[j]] = [legal[j], legal[i]]; }

const best = {};
for (const { b, s, lead } of legal.slice(0, SAMPLE)) {
  let win = 0, oh = 0;
  for (let seed = 1; seed <= SEEDS; seed++) { const r = simulate(b, seed, { noFrames: true }); if (r.ok) win++; oh += r.overheats; }
  const k = b.chassis + '|' + lead, wr = win / SEEDS;
  if (!best[k] || wr > best[k].wr) best[k] = { b, s, wr, oh: oh / SEEDS };
}

const rows = Object.entries(best).filter(([, v]) => v.wr >= 0.55).sort((a, b) => b[1].wr - a[1].wr);
console.log('\nvalidated corner builds (best per chassis x lead weapon, >=55% clear)\n');
for (const [k, v] of rows)
  console.log('  ' + String(Math.round(v.wr*100)+'%').padStart(5) + '  o/h ' + v.oh.toFixed(1) + '  ' +
    k.padEnd(22) + v.b.doctrine.padEnd(11) + String(v.s.massUsed+'/'+v.s.massBudget).padStart(7) +
    String(v.s.powerDraw+'/'+v.s.powerAvail).padStart(8) + ' ' + v.s.heatRatio.toFixed(2)+'x  ' + v.b.mods.join(' '));
