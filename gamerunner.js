'use strict';
/* Plays whole games under a reasonable-buyer policy. Answers: does the arms race have an arc? */
const A = require('./army.js'), B = require('./battle.js');
const RUNS = parseInt(process.argv[2] || '120', 10);

function buyPolicy(st, enemy, rng) {
  // counter what they brought: splash for crowds, AP for big things, bodies otherwise
  const theirs = {};
  for (const e of enemy) theirs[A.U[e.id].role] = (theirs[A.U[e.id].role] || 0) + A.U[e.id].n;
  const crowded = (theirs.swarm || 0) + (theirs.line || 0) >= 10;
  const big = (theirs.heavy || 0) + (theirs.ace || 0) > 0;
  // Must be able to reach the whole roster, or the runner reports units as unplayable when it
  // simply never asked for them.
  let want = crowded ? ['missile', 'siege', 'line', 'pods'] : big ? ['lancers', 'heavy', 'line'] : ['line', 'skirm', 'heavy', 'pods'];
  if (st.credits > 1400) want.push('colossus', 'ace');       // splurge when rich
  for (const id of st.unlocked) if (!want.includes(id)) want.push(id);
  // upgrade first when we already own the squads it would improve, then spend the rest on bodies
  const t = A.TECH.filter(t => !st.tech.includes(t.id) && st.army.filter(s => s.id === t.unit).length >= 2 && t.cost <= st.credits);
  if (t.length && rng() < 0.7) A.buyTech(st, t[Math.floor(rng() * t.length)].id);
  let guard = 0;
  while (guard++ < 30) {
    const pool = want.filter(id => st.unlocked.includes(id) && A.U[id].cost <= st.credits);
    if (!pool.length) break;
    A.buy(st, pool[Math.floor(rng() * pool.length)]);
  }
}

const agg = { won: 0, lost: 0, rounds: 0, roundWins: 0, roundsPlayed: 0, wipes: 0, armyMax: 0, techs: 0 };
for (let run = 1; run <= RUNS; run++) {
  const st = A.newGame(run);
  const rng = B.mulberry32(run * 7919);
  let guard = 0;
  while (!st.over && guard++ < 20) {
    const enemy = A.enemyArmy(st, rng);
    buyPolicy(st, enemy, rng);
    const mine = st.army.map(s => Object.assign(A.squadSpec(st, s), { hex: s.hex }));
    const theirs = enemy.map(e => A.enemySpec(st, e));
    if (!mine.length) { st.over = true; st.won = false; break; }
    const res = B.simulateBattle(mine, theirs, (st.seed * 31 + st.round * 977) >>> 0, { noFrames: true, round: st.round });
    res.lostSquads = res.lostSquads.map((l, i) => ({ uid: st.army[+l.uid.slice(1)] ? st.army[+l.uid.slice(1)].uid : -1, id: l.id }));
    agg.roundsPlayed++; if (res.won) agg.roundWins++;
    agg.wipes += res.lostSquads.length;
    A.resolveRound(st, res);
    if (!st.over) {
      const offer = A.offerBoons(st, rng, st.lastLost);
      const prefer = offer.find(b => b.kind === 'tech') || offer.find(b => b.catchUp) || offer[0];
      A.takeBoon(st, prefer);
    }
    agg.armyMax = Math.max(agg.armyMax, st.army.length);
  }
  agg.rounds += st.round - 1; agg.techs += st.tech.length;
  agg.boons = (agg.boons || 0) + st.boons.length;
  if (st.won) agg.won++; else agg.lost++;
}
console.log(`\n${RUNS} games`);
console.log('  player wins            ' + Math.round(agg.won / RUNS * 100) + '%');
console.log('  avg rounds played      ' + (agg.rounds / RUNS).toFixed(1) + ' / ' + A.ROUNDS);
console.log('  rounds won by player   ' + Math.round(agg.roundWins / agg.roundsPlayed * 100) + '%');
console.log('  squads wiped per round ' + (agg.wipes / agg.roundsPlayed).toFixed(2));
console.log('  largest army fielded   ' + agg.armyMax + ' squads');
console.log('  tech owned per game    ' + (agg.techs / RUNS).toFixed(1) + ' of ' + A.TECH.length);
console.log('  rewards drafted        ' + ((agg.boons || 0) / RUNS).toFixed(1));
