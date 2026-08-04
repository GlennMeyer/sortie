'use strict';
/* Which way of playing actually wins? If one strategy dominates the game is solved; if they all
   land the same the choices do not matter. Either would be a problem. */
const A = require('./army.js'), B = require('./battle.js');
const WARS = parseInt(process.argv[2] || '60', 10);

const STRATS = {
  'counter-pick': (st, foe, rng) => {
    const theirs = {};
    for (const e of foe) theirs[A.U[e.id].role] = (theirs[A.U[e.id].role] || 0) + A.U[e.id].n;
    const crowded = (theirs.swarm || 0) + (theirs.line || 0) >= 12;
    const big = (theirs.heavy || 0) + (theirs.ace || 0) > 0;
    const siege = (theirs.siege || 0) > 0;
    return crowded ? ['missile', 'siege', 'pods'] : big ? ['lancers', 'heavy'] : siege ? ['skirm', 'lancers'] : ['line', 'skirm', 'heavy'];
  },
  'cheapest bodies': st => st.unlocked.slice().sort((a, b) => A.priceOf(st, a) - A.priceOf(st, b)),
  'most expensive': st => st.unlocked.slice().sort((a, b) => A.priceOf(st, b) - A.priceOf(st, a)),
  'one of each role': st => {
    const byRole = {};
    for (const id of st.unlocked) byRole[A.U[id].role] = byRole[A.U[id].role] || id;
    return Object.values(byRole);
  },
  'upgrades first': st => st.unlocked.slice(),
  'all-in melee': st => ['lancers', 'pods'].filter(id => st.unlocked.includes(id)).concat(st.unlocked),
};
const TECH_FIRST = new Set(['upgrades first']);
const CHARGE_ALL = new Set(['all-in melee']);

function playWar(name, pick, seed) {
  const st = A.newGame(seed), rng = B.mulberry32(seed * 7919);
  let guard = 0;
  while (!st.over && guard++ < 20) {
    const foe = A.enemyArmy(st, rng);
    const uo = A.offerUnlocks(st, rng);
    if (uo.length) {
      const want = pick(st, foe, rng);
      A.takeUnlock(st, (uo.find(u => want.includes(u.id)) || uo[0]).id);
    }
    if (TECH_FIRST.has(name)) {
      let g = 0;
      while (g++ < 4) {
        const t = A.TECH.filter(t => !st.tech.includes(t.id) && st.army.some(s => s.id === t.unit) && t.cost <= st.credits);
        if (!t.length) break;
        A.buyTech(st, t[0].id);
      }
    } else {
      const t = A.TECH.filter(t => !st.tech.includes(t.id) && st.army.filter(s => s.id === t.unit).length >= 2 && t.cost <= st.credits);
      if (t.length && rng() < 0.5) A.buyTech(st, t[Math.floor(rng() * t.length)].id);
    }
    let g = 0;
    while (g++ < 30) {
      const want = pick(st, foe, rng).filter(id => st.unlocked.includes(id) && A.priceOf(st, id) <= st.credits);
      const pool = want.length ? want : st.unlocked.filter(id => A.priceOf(st, id) <= st.credits);
      if (!pool.length || !A.buy(st, pool[0])) break;
    }
    if (CHARGE_ALL.has(name)) for (const s of st.army) A.setStance(st, s.uid, 'charge');
    // slot-capped with credits left? buy quality instead of quantity
    let upN = 0;
    while (upN++ < 6) {
      const cands = st.army.filter(x => A.upgradeCost(st, x) != null && A.upgradeCost(st, x) <= st.credits);
      if (!cands.length) break;
      /* Merging trades force for slots — three squads become one at 1.35x — so it is only right
         when slots are the binding constraint. Doing it greedily deletes your army. */
      const capped = A.slotsUsed(st) >= A.SLOT_CAP - 1;
      const m = capped ? cands.find(x => A.mergeable(st, x)) : null;
      if (m) A.merge(st, m.uid);
      else A.upgrade(st, cands.sort((a, b) => (a.rank || 0) - (b.rank || 0))[0].uid);
    }
    if (!st.army.length) { st.over = true; st.won = false; break; }
    const res = B.simulateBattle(st.army.map(s => Object.assign(A.squadSpec(st, s), { stance: s.stance })),
      foe.map(e => A.enemySpec(st, e)), (st.seed * 31 + st.round * 977) >>> 0, { noFrames: true, round: st.round });
    res.lostSquads = res.lostSquads.map(l => { const i = +String(l.uid).slice(1); return { uid: st.army[i] ? st.army[i].uid : -1, id: l.id }; });
    A.resolveRound(st, res);
    if (!st.over) { const o = A.offerBoons(st, rng, st.lastLost); A.takeBoon(st, o.find(b => b.catchUp) || o[0]); }
  }
  return st.won;
}

console.log('\nstrategy tournament — ' + WARS + ' wars each\n');
const rows = [];
for (const [name, pick] of Object.entries(STRATS)) {
  let w = 0;
  for (let s = 1; s <= WARS; s++) if (playWar(name, pick, s)) w++;
  rows.push([name, w / WARS]);
}
rows.sort((a, b) => b[1] - a[1]);
for (const [name, wr] of rows)
  console.log('  ' + name.padEnd(18) + String(Math.round(wr * 100) + '%').padStart(5) + '  ' + '#'.repeat(Math.round(wr * 40)));
const vals = rows.map(r => r[1]);
const spread = Math.max(...vals) - Math.min(...vals);
console.log('\n  spread ' + Math.round(spread * 100) + ' points  ' +
  (spread < 0.12 ? '<- choices barely matter' : spread > 0.45 ? '<- one strategy dominates' : '<- meaningful strategic range'));
