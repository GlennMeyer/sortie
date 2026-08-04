'use strict';
/* Evolutionary balance tuning.
 *
 * Two rules make this work rather than produce mush:
 *
 * 1. IT MUTATES MAGNITUDES, NOT IDENTITIES. cost / hull / damage / speed are dials. Range
 *    brackets, splash, armour-piercing, saves and role are what a unit *is* — mutate those and
 *    the counter web dissolves into nine interchangeable blobs.
 *
 * 2. FITNESS REWARDS DIFFERENTIATION, NOT JUST FAIRNESS. Optimising "every unit wins 50%" alone
 *    converges on nine identical units, all at 50% because none of them counter anything. So the
 *    fitness explicitly rewards a HIGH spread within each unit's matchup row (it should crush
 *    some things and fold to others) while keeping the spread BETWEEN units low.
 */
const fs = require('fs');
const A = require('./army.js'), B = require('./battle.js');

const POP = parseInt(process.argv[2] || '16', 10);
const GENS = parseInt(process.argv[3] || '12', 10);
const SEEDS = 3;
const SPENDS = [1400];
const BASES = [['line', 'line', 'skirm'], ['pods', 'pods', 'siege']];
const REFERENCE = ['line', 'skirm', 'missile', 'heavy', 'lancers'];
const DIALS = ['cost', 'hp', 'dmg', 'speed'];
const BOUNDS = { cost: [80, 900], hp: [40, 2600], dmg: [4, 220], speed: [0.30, 2.60] };

const rnd = B.mulberry32(20260803);
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.7;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

function seedGenome() {
  const g = {};
  for (const u of A.UNITS) { g[u.id] = {}; for (const d of DIALS) g[u.id][d] = u[d]; }
  return g;
}
function mutate(g, rate) {
  const out = JSON.parse(JSON.stringify(g));
  for (const id of Object.keys(out)) for (const d of DIALS) {
    if (rnd() > rate) continue;
    const [lo, hi] = BOUNDS[d];
    const step = out[id][d] * 0.18 * gauss();
    out[id][d] = clamp(d === 'speed' ? +(out[id][d] + step).toFixed(2) : Math.round(out[id][d] + step), lo, hi);
  }
  return out;
}
function cross(a, b) {
  const out = {};
  for (const id of Object.keys(a)) { out[id] = {}; for (const d of DIALS) out[id][d] = rnd() < 0.5 ? a[id][d] : b[id][d]; }
  return out;
}
/* A genome is just a set of overrides applied on top of the real unit definitions. */
function specOf(g, id) {
  const u = Object.assign({}, A.U[id]);
  u.br = u.br.slice();
  for (const d of DIALS) u[d] = g[id][d];
  return u;
}

function evaluate(g) {
  const ids = A.UNITS.map(u => u.id);
  const refBuy = spend => {
    const out = []; let left = spend, i = 0, guard = 0;
    while (guard++ < 24) { const id = REFERENCE[i++ % REFERENCE.length];
      if (g[id].cost > left) { if (REFERENCE.every(r => g[r].cost > left)) break; continue; }
      out.push(specOf(g, id)); left -= g[id].cost; }
    return out;
  };

  // marginal value: given an army, is this the obvious buy?
  const marginal = {};
  for (const id of ids) {
    let w = 0, n = 0;
    for (const spend of SPENDS) {
      const k = Math.floor(spend / g[id].cost);
      if (k < 1) { n += BASES.length * SEEDS; continue; }
      const left = spend - k * g[id].cost;
      const filler = new Array(Math.floor(left / g.pods.cost)).fill(0).map(() => specOf(g, 'pods'));
      for (const base of BASES) {
        const mine = base.map(x => specOf(g, x)).concat(new Array(k).fill(0).map(() => specOf(g, id)))
          .concat(id === 'pods' ? [] : filler);
        const foe = base.map(x => specOf(g, x)).concat(refBuy(spend));
        for (let s = 1; s <= SEEDS; s++) { n++; if (B.simulateBattle(mine, foe, s, { noFrames: true }).won) w++; }
      }
    }
    marginal[id] = w / n;
  }

  // duel rows: each unit should beat some things and fold to others
  // sample four opponents per unit rather than all eight — the standard deviation of the row is
  // what we need, and it converges long before an exhaustive matrix does
  const rows = {};
  for (const a of ids) {
    const row = [];
    const foes = ids.filter(x => x !== a).sort(() => rnd() - 0.5).slice(0, 4);
    for (const b of foes) {
      const ka = Math.max(1, Math.floor(1800 / g[a].cost)), kb = Math.max(1, Math.floor(1800 / g[b].cost));
      const fa = new Array(ka).fill(0).map(() => specOf(g, a)), fb = new Array(kb).fill(0).map(() => specOf(g, b));
      let w = 0;
      for (let s = 1; s <= 2; s++) if (B.simulateBattle(fa, fb, s, { noFrames: true }).won) w++;
      row.push(w / 2);
    }
    rows[a] = row;
  }

  const means = Object.values(marginal);
  const spread = Math.max(...means) - Math.min(...means);
  const centre = means.reduce((x, y) => x + y, 0) / means.length;
  const sd = arr => { const m = arr.reduce((x, y) => x + y, 0) / arr.length;
    return Math.sqrt(arr.reduce((x, y) => x + (y - m) ** 2, 0) / arr.length); };
  const differentiation = ids.reduce((a, id) => a + sd(rows[id]), 0) / ids.length;

  const fitness = -(spread * 3.0) + differentiation * 2.2 - Math.abs(centre - 0.5) * 2.0;
  return { fitness, spread, differentiation, centre, marginal };
}

let pop = [seedGenome()];
while (pop.length < POP) pop.push(mutate(seedGenome(), 0.7));

let best = null;
for (let gen = 1; gen <= GENS; gen++) {
  const scored = pop.map(g => ({ g, ...evaluate(g) })).sort((a, b) => b.fitness - a.fitness);
  if (!best || scored[0].fitness > best.fitness) best = scored[0];   // global best, not this gen's
  console.log('gen ' + String(gen).padStart(2) +
    '  fitness ' + scored[0].fitness.toFixed(3) + ' (best ' + best.fitness.toFixed(3) + ')' +
    '  spread ' + Math.round(scored[0].spread * 100) +
    '  differentiation ' + scored[0].differentiation.toFixed(3) +
    '  centre ' + Math.round(scored[0].centre * 100) + '%');
  const elite = scored.slice(0, Math.max(2, Math.round(POP * 0.25))).map(s => s.g);
  const next = elite.slice();
  while (next.length < POP) {
    const a = elite[Math.floor(rnd() * elite.length)], b = elite[Math.floor(rnd() * elite.length)];
    next.push(mutate(cross(a, b), 0.35));
  }
  pop = next;
}

console.log('\nbest genome vs the current numbers:');
for (const u of A.UNITS) {
  const g = best.g[u.id];
  console.log('  ' + u.name.padEnd(15) +
    DIALS.map(d => d + ' ' + String(u[d]).padStart(5) + '->' + String(g[d]).padStart(5)).join('  '));
}

if (process.argv.includes('--write')) {
  let src = fs.readFileSync('army.js', 'utf8');
  for (const u of A.UNITS) for (const d of DIALS) {
    const re = new RegExp("(id: '" + u.id + "',[\\s\\S]*?" + d + ": )[0-9.]+");
    src = src.replace(re, '$1' + best.g[u.id][d]);
  }
  fs.writeFileSync('army.js', src);
  console.log('\narmy.js updated');
} else {
  console.log('\n(dry run — pass --write to apply)');
}
