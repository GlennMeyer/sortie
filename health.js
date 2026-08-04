'use strict';
/* One command, one screen: is the game still healthy?
   Run this after any change — it is the iteration loop, not a report. */
const { execSync } = require('child_process');
const A = require('./army.js'), B = require('./battle.js');

const bar = (v, lo, hi, width) => {
  const n = Math.round(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * (width || 20));
  return '#'.repeat(n) + '·'.repeat((width || 20) - n);
};
const verdict = (v, lo, hi) => (v >= lo && v <= hi) ? 'ok' : (v < lo ? 'LOW' : 'HIGH');

/* 1. Marginal value: given an army you already have, what is the best use of the next credits?
   This is the metric that matters. The mono-army duel matrix once reported an 18-point spread on
   a roster whose real spread was 91 — it cannot see auto-picks, because nobody plays mono-armies. */
function marginalHealth() {
  const st = A.newGame(1);
  const SPENDS = [800, 1300, 2000], SEEDS = 10;
  const BASES = [['line', 'line', 'skirm'], ['pods', 'pods', 'line', 'siege'], ['heavy', 'missile', 'line']];
  const REFERENCE = ['line', 'skirm', 'missile', 'heavy', 'lancers'];
  const refBuy = spend => {
    const out = []; let left = spend, i = 0, g = 0;
    while (g++ < 24) { const id = REFERENCE[i++ % REFERENCE.length];
      if (A.priceOf(st, id) > left) { if (REFERENCE.every(r => A.priceOf(st, r) > left)) break; continue; }
      out.push(A.spec(st, id)); left -= A.priceOf(st, id); }
    return out;
  };
  const out = {};
  for (const u of A.UNITS) {
    let w = 0, g = 0;
    for (const spend of SPENDS) {
      const k = Math.floor(spend / A.priceOf(st, u.id));
      if (k < 1) { g += BASES.length * SEEDS; continue; }
      const left = spend - k * A.priceOf(st, u.id);
      const filler = new Array(Math.floor(left / A.priceOf(st, 'pods'))).fill(0).map(() => A.spec(st, 'pods'));
      for (const base of BASES) {
        const mine = base.map(i2 => A.spec(st, i2)).concat(new Array(k).fill(0).map(() => A.spec(st, u.id)))
          .concat(u.id === 'pods' ? [] : filler);
        const foe = base.map(i2 => A.spec(st, i2)).concat(refBuy(spend));
        for (let s = 1; s <= SEEDS; s++) { g++; if (B.simulateBattle(mine, foe, s, { noFrames: true }).won) w++; }
      }
    }
    out[u.id] = w / g;
  }
  return out;
}

function rosterHealth() {
  const budgets = []; for (let b = 1200; b <= 4000; b += 400) budgets.push(b);
  const ids = A.UNITS.map(u => u.id), rate = {};
  const st = A.newGame(1);
  for (const a of ids) {
    let w = 0, g = 0;
    for (const b of ids) {
      if (a === b) continue;
      for (const bud of budgets) {
        const ka = Math.max(1, Math.floor(bud / A.priceOf(st, a))), kb = Math.max(1, Math.floor(bud / A.priceOf(st, b)));
        const fa = new Array(ka).fill(0).map(() => A.spec(st, a)), fb = new Array(kb).fill(0).map(() => A.spec(st, b));
        for (let s = 1; s <= 4; s++) { g++; if (B.simulateBattle(fa, fb, s, { noFrames: true }).won) w++; }
      }
    }
    rate[a] = w / g;
  }
  return rate;
}

/* 2. whole wars under a competent buyer */
function warHealth(runs) {
  const agg = { won: 0, rounds: 0, rw: 0, played: 0, tech: 0, seen: {}, firstSeen: {} };
  for (let run = 1; run <= runs; run++) {
    const st = A.newGame(run), rng = B.mulberry32(run * 7919);
    let g = 0;
    while (!st.over && g++ < 20) {
      const want0 = ['line','skirm','heavy','pods','lancers','siege','missile','colossus','ace'];
    const en = A.enemyArmy(st, rng);
    { const uo = A.offerUnlocks(st, rng); if (uo.length) A.takeUnlock(st, (uo.find(u => want0.includes(u.id)) || uo[0]).id); }
      const theirs = {};
      for (const e of en) theirs[A.U[e.id].role] = (theirs[A.U[e.id].role] || 0) + A.U[e.id].n;
      const crowded = (theirs.swarm || 0) + (theirs.line || 0) >= 10;
      const big = (theirs.heavy || 0) + (theirs.ace || 0) > 0;
      let want = crowded ? ['missile', 'siege', 'line', 'pods', 'heavy'] : big ? ['lancers', 'heavy', 'line'] : ['line', 'skirm', 'heavy', 'pods', 'lancers', 'siege'];
      if (st.credits > 1400) want.push('colossus', 'ace');
      for (const id of st.unlocked) if (!want.includes(id)) want.push(id);   // field whatever we unlocked
      let g2 = 0;
      while (g2++ < 30) { const pool = want.filter(id => st.unlocked.includes(id) && A.priceOf(st, id) <= st.credits); if (!pool.length) break; A.buy(st, pool[Math.floor(rng() * pool.length)]); }
      for (const s of st.army) { agg.seen[s.id] = 1; agg.firstSeen[s.id] = Math.min(agg.firstSeen[s.id] || 99, st.round); }
      // slot-capped with credits left? buy quality instead of quantity
      let upN = 0;
      while (upN++ < 6) {
        const cands = st.army.filter(x => A.upgradeCost(st, x) != null && A.upgradeCost(st, x) <= st.credits);
        if (!cands.length) break;
        /* Merging trades force for slots: three squads become one at 1.35x, so it is only
           right when slots are the binding constraint. Doing it greedily deletes your army. */
        const capped = A.slotsUsed(st) >= A.SLOT_CAP - 1;
        const m = capped ? cands.find(x => A.mergeable(st, x)) : null;
        if (m) A.merge(st, m.uid);
        else A.upgrade(st, cands.sort((a, b) => (a.rank || 0) - (b.rank || 0))[0].uid);
      }
      if (!st.army.length) break;
      const res = B.simulateBattle(st.army.map(s => A.squadSpec(st, s)), en.map(e => A.enemySpec(st, e)),
        (st.seed * 31 + st.round * 977) >>> 0, { noFrames: true, round: st.round });
      res.lostSquads = res.lostSquads.map(l => { const i = +String(l.uid).slice(1); return { uid: st.army[i] ? st.army[i].uid : -1, id: l.id }; });
      agg.played++; if (res.won) agg.rw++;
      A.resolveRound(st, res);
      if (!st.over) { const o = A.offerBoons(st, rng, st.lastLost); A.takeBoon(st, o.find(b => b.kind === 'tech') || o[0]); }
    }
    agg.rounds += st.round - 1; agg.tech += st.tech.length; if (st.won) agg.won++;
  }
  return agg;
}

const RUNS = parseInt(process.argv[2] || '120', 10);
console.log('\nSORTIE HEALTH\n');

const rate = marginalHealth();
const vals = Object.values(rate);
const spread = Math.max(...vals) - Math.min(...vals);
const mid = vals.reduce((a, b) => a + b, 0) / vals.length;
console.log('ROSTER  (marginal value: is this the obvious buy? all should cluster together)');
for (const u of A.UNITS) {
  const r = rate[u.id];
  console.log('  ' + u.name.padEnd(15) + String(A.U[u.id].cost).padStart(4) + '  ' +
    String(Math.round(r * 100) + '%').padStart(5) + '  ' + bar(r, 0.2, 0.9) + '  ' +
    (r > mid + 0.14 ? 'AUTO-PICK' : r < mid - 0.14 ? 'DEAD BUY' : 'ok'));
}
console.log('  spread ' + Math.round(spread * 100) + ' points  ' + (spread <= 0.22 ? 'ok' : 'TOO WIDE — run node tune2.js'));

const w = warHealth(RUNS);
console.log('\nWAR  (' + RUNS + ' games under a competent buyer)');
const rows = [
  ['wars won by player', w.won / RUNS, 0.40, 0.62, v => Math.round(v * 100) + '%'],
  ['rounds won', w.rw / w.played, 0.45, 0.65, v => Math.round(v * 100) + '%'],
  ['avg war length', (w.rounds / RUNS) / A.ROUNDS, 0.55, 1.0, v => (v * A.ROUNDS).toFixed(1) + ' / ' + A.ROUNDS],
  ['tech owned per war', (w.tech / RUNS) / A.TECH.length, 0.3, 1.0, v => (v * A.TECH.length).toFixed(1) + ' / ' + A.TECH.length],
];
for (const [k, v, lo, hi, fmt] of rows)
  console.log('  ' + k.padEnd(22) + fmt(v).padStart(10) + '  ' + bar(v, 0, 1) + '  ' + verdict(v, lo, hi));

const never = A.UNITS.filter(u => !w.seen[u.id]);
console.log('\nROSTER REACH');
for (const u of A.UNITS)
  console.log('  ' + u.name.padEnd(15) + (w.seen[u.id] ? 'first fielded round ' + w.firstSeen[u.id] : 'NEVER FIELDED'));
console.log('\n' + (never.length ? never.length + ' unit(s) unreachable' : 'whole roster reachable') +
  '  ·  ' + (spread <= 0.22 ? 'roster balanced (marginal spread ' + Math.round(spread * 100) + ')' : 'roster needs tuning'));
