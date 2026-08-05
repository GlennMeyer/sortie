'use strict';
/* What shape is the war?

   A good arc opens winnable, tightens through the middle, and stays genuinely in doubt at the end
   for a player who is playing well. Two failures look identical in a headline win rate: a
   walkover that collapses at the end, and a flat coin-flip throughout. Only the round-by-round
   curve tells them apart, so this prints the curve for two players at once —

     plays properly  — buys, and converts credits into ranks once the slot cap bites
     never ranks up  — buys only, which is what a person does before the game tells them

   The gap between those two curves is the cost of not knowing. The shape of the first is whether
   the game is any good. */
const A = require('./army.js'), B = require('./battle.js');
const RUNS = parseInt(process.argv[2] || '80', 10);
const SLOPES = (process.argv[3] || '150').split(',').map(Number);

function play(runs, slope, ranksUp) {
  const per = {}; let wars = 0, warWins = 0, unspent = 0, tail = 0;
  for (let run = 1; run <= runs; run++) {
    const st = A.newGame(run, { enemySlope: slope });
    const rng = B.mulberry32(run * 7919);
    let guard = 0;
    while (!st.over && guard++ < 20) {
      const enemy = A.enemyArmy(st, rng);
      let g = 0;
      while (g++ < 30) {
        const pool = st.unlocked.filter(id => A.priceOf(st, id) <= st.credits
          && A.slotsUsed(st) + (A.U[id].slots || 1) <= A.slotCap(st));
        if (!pool.length) break;
        A.buy(st, pool[Math.floor(rng() * pool.length)]);
      }
      if (ranksUp) {
        let u = 0;
        while (u++ < 40) {
          const c = st.army.filter(sq => { const x = A.upgradeCost(st, sq); return x != null && x <= st.credits; });
          if (!c.length) break;
          c.sort((a, b) => A.upgradeCost(st, a) - A.upgradeCost(st, b));
          if (!A.upgrade(st, c[0].uid)) break;
        }
      }
      const mine = st.army.map(s => Object.assign(A.squadSpec(st, s), { hex: s.hex }));
      const theirs = enemy.map(e => A.enemySpec(st, e));
      if (!mine.length) { st.over = true; st.won = false; break; }
      const r = st.round;
      const res = B.simulateBattle(mine, theirs, (st.seed * 31 + st.round * 977) >>> 0, { noFrames: true, round: st.round });
      res.lostSquads = res.lostSquads.map(l => ({ uid: st.army[+l.uid.slice(1)] ? st.army[+l.uid.slice(1)].uid : -1, id: l.id }));
      per[r] = per[r] || { w: 0, n: 0 };
      per[r].n++; if (res.won) per[r].w++;
      if (r >= 8) { tail++; unspent += st.credits; }
      A.resolveRound(st, res);
      if (!st.over) { const o = A.offerBoons(st, rng, st.lastLost); A.takeBoon(st, o[0]); }
    }
    wars++; if (st.won) warWins++;
  }
  const curve = [];
  for (const r of Object.keys(per).sort((a, b) => a - b)) {
    if (per[r].n < runs * 0.15) continue;
    curve.push({ r: +r, p: Math.round(per[r].w / per[r].n * 100) });
  }
  return { wars: Math.round(warWins / wars * 100), curve, unspent: tail ? Math.round(unspent / tail) : 0 };
}

for (const slope of SLOPES) {
  console.log('\nregime income slope ' + slope + ' per round  (you gain 150)');
  for (const [name, ranksUp] of [['plays properly ', true], ['never ranks up ', false]]) {
    const r = play(RUNS, slope, ranksUp);
    console.log('  ' + name + ' wars ' + String(r.wars + '%').padStart(4) + '   ' +
      r.curve.map(c => 'r' + c.r + ' ' + String(c.p).padStart(3) + '%').join(' ') +
      '   late credits idle ' + r.unspent);
  }
}
