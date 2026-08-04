'use strict';
/* Where does a war go wrong for someone who is NOT a solved policy?
   Every balance number so far came from bots that already know the counter web. A first-time
   player does not. This plays the same war under three ways of buying — good, plain, and bad —
   and reports the round-by-round win rate, so we can see whether the game is losable at the
   point where a person is still learning what beats what. */
const A = require('./army.js'), B = require('./battle.js');
const RUNS = parseInt(process.argv[2] || '120', 10);

const BUYERS = {
  'counter-picks (a bot)': (st, enemy, rng) => {
    const theirs = {};
    for (const e of enemy) theirs[A.U[e.id].role] = (theirs[A.U[e.id].role] || 0) + A.U[e.id].n;
    const crowded = (theirs.swarm || 0) + (theirs.line || 0) >= 10;
    const big = (theirs.heavy || 0) + (theirs.ace || 0) > 0;
    let want = crowded ? ['missile', 'siege', 'line', 'pods'] : big ? ['lancers', 'heavy', 'line'] : ['line', 'skirm', 'heavy', 'pods'];
    for (const id of st.unlocked) if (!want.includes(id)) want.push(id);
    const t = A.TECH.filter(t => !st.tech.includes(t.id) && st.army.filter(s => s.id === t.unit).length >= 2 && t.cost <= st.credits);
    if (t.length && rng() < 0.7) A.buyTech(st, t[Math.floor(rng() * t.length)].id);
    let g = 0;
    while (g++ < 30) {
      const pool = want.filter(id => st.unlocked.includes(id) && A.priceOf(st, id) <= st.credits);
      if (!pool.length) break;
      A.buy(st, pool[Math.floor(rng() * pool.length)]);
    }
  },
  'buys sensibly, no counters': (st, enemy, rng) => {
    // spends its money on a mix, ignores what the enemy brought — what a person does at first
    let g = 0;
    while (g++ < 30) {
      const pool = st.unlocked.filter(id => A.priceOf(st, id) <= st.credits);
      if (!pool.length) break;
      A.buy(st, pool[Math.floor(rng() * pool.length)]);
    }
  },
  'favourites only': (st, enemy, rng) => {
    // picks the two things it likes the look of and buys them forever
    const fav = ['ace', 'colossus', 'lancers'].filter(id => st.unlocked.includes(id));
    let g = 0;
    while (g++ < 30) {
      const pool = (fav.length ? fav : st.unlocked).filter(id => A.priceOf(st, id) <= st.credits);
      if (!pool.length) break;
      A.buy(st, pool[Math.floor(rng() * pool.length)]);
    }
  },
};

for (const [name, buy] of Object.entries(BUYERS)) {
  const perRound = {};
  let wars = 0, warWins = 0;
  for (let run = 1; run <= RUNS; run++) {
    const st = A.newGame(run), rng = B.mulberry32(run * 7919);
    let guard = 0;
    while (!st.over && guard++ < 20) {
      const enemy = A.enemyArmy(st, rng);
      buy(st, enemy, rng);
      const mine = st.army.map(s => Object.assign(A.squadSpec(st, s), { hex: s.hex }));
      const theirs = enemy.map(e => A.enemySpec(st, e));
      if (!mine.length) { st.over = true; st.won = false; break; }
      const r = st.round;
      const res = B.simulateBattle(mine, theirs, (st.seed * 31 + st.round * 977) >>> 0, { noFrames: true, round: st.round });
      res.lostSquads = res.lostSquads.map(l => ({ uid: st.army[+l.uid.slice(1)] ? st.army[+l.uid.slice(1)].uid : -1, id: l.id }));
      perRound[r] = perRound[r] || { w: 0, n: 0 };
      perRound[r].n++; if (res.won) perRound[r].w++;
      A.resolveRound(st, res);
      if (!st.over) {
        const offer = A.offerBoons(st, rng, st.lastLost);
        A.takeBoon(st, offer.find(b => b.kind === 'tech') || offer[0]);
      }
    }
    wars++; if (st.won) warWins++;
  }
  console.log('\n' + name + '  —  wins ' + Math.round(warWins / wars * 100) + '% of wars');
  const line = [];
  for (const r of Object.keys(perRound).sort((a, b) => a - b)) {
    const { w, n } = perRound[r];
    if (n < RUNS * 0.15) continue;
    line.push('r' + r + ' ' + String(Math.round(w / n * 100)).padStart(3) + '%');
  }
  console.log('  ' + line.join('  '));
}
