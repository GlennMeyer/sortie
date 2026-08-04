'use strict';
/* Plays whole campaigns headlessly under a reasonable-player policy.
   Question it answers: does the war have a shape — losses that matter, an ending you can reach? */
const C = require('./campaign.js');
const RUNS = parseInt(process.argv[2] || '300', 10);

function policy(st) {
  // fly the least-fatigued ready pilots in the healthiest frames; squad of 2, 3 from ch.4
  const size = st.chapter >= 4 ? 3 : 2;
  const pilots = C.available(st).sort((a, b) => (a.fatigue + a.trauma) - (b.fatigue + b.trauma)).slice(0, size);
  const frames = C.flyable(st).sort((a, b) => b.integrity - a.integrity).slice(0, pilots.length);
  if (!pilots.length || !frames.length) return null;
  return pilots.slice(0, frames.length).map((p, i) => ({ pilotId: p.id, frameId: frames[i].id }));
}

const agg = { won: 0, wipe: 0, stalled: 0, reached: [], deaths: 0, wounds: 0,
  byPilot: {}, endOpinion: 0, rivalHp: 0, disobeyNotes: 0, chapterFail: {} };

for (let run = 1; run <= RUNS; run++) {
  const st = C.newCampaign(run);
  let guard = 0;
  while (!st.over && guard++ < 40) {
    // maintenance first
    for (const f of st.frames.slice().sort((a, b) => a.integrity - b.integrity)) {
      if (C.repairCost(f) > 0 && st.parts >= C.repairCost(f)) C.repair(st, f.id);
    }
    if (st.opinion >= 30) C.recruit(st);
    for (const p of C.available(st)) if (p.fatigue > 70 && C.available(st).length > 2) C.standDown(st, p.id);

    const squad = policy(st);
    if (!squad) { agg.stalled++; break; }
    const res = C.runSortie(st, squad, { noFrames: true });
    const rep = C.applyResult(st, res, squad);
    if (!res.ok) agg.chapterFail[st.chapter] = (agg.chapterFail[st.chapter] || 0) + 1;
    agg.deaths += rep.killed.length; agg.wounds += rep.wounded.length;
    for (const k of rep.killed) agg.byPilot[k.name] = (agg.byPilot[k.name] || 0) + 1;
    agg.disobeyNotes += rep.notes.filter(n => n.includes('ignored')).length;
    C.advanceChapter(st);
  }
  agg.reached.push(Math.min(st.chapter - 1, C.CHAPTERS));
  if (st.won) agg.won++;
  if (st.roster.every(p => p.status === 'KILLED')) agg.wipe++;
  agg.endOpinion += st.opinion; agg.rivalHp += st.rival.hp;
}

const avg = a => (a.reduce((x, y) => x + y, 0) / a.length);
console.log(`\nCAMPAIGN RUN — ${RUNS} wars, ${C.CHAPTERS} chapters each\n`);
console.log(`  reached chapter 8 (won)   ${(agg.won / RUNS * 100).toFixed(0)}%`);
console.log(`  roster wiped out          ${(agg.wipe / RUNS * 100).toFixed(0)}%`);
console.log(`  stalled (no one to fly)   ${(agg.stalled / RUNS * 100).toFixed(0)}%`);
console.log(`  avg chapter reached       ${avg(agg.reached).toFixed(1)} / ${C.CHAPTERS}`);
console.log(`  pilots killed per war     ${(agg.deaths / RUNS).toFixed(2)}`);
console.log(`  pilots wounded per war    ${(agg.wounds / RUNS).toFixed(2)}`);
console.log(`  orders ignored per war    ${(agg.disobeyNotes / RUNS).toFixed(2)}`);
console.log(`  end public opinion        ${(agg.endOpinion / RUNS).toFixed(0)}`);
console.log(`  rival hull by the end     ${(agg.rivalHp / RUNS).toFixed(0)} (started 560)`);
const dist = {};
for (const r of agg.reached) dist[r] = (dist[r] || 0) + 1;
console.log('\n  chapters reached:');
for (let i = 1; i <= C.CHAPTERS; i++)
  console.log('    ch' + i + '  ' + String(Math.round((dist[i] || 0) / RUNS * 100) + '%').padStart(5) + '  ' + '#'.repeat(Math.round((dist[i] || 0) / RUNS * 44)));
console.log('\n  sorties failed by chapter:', JSON.stringify(agg.chapterFail));
console.log('  pilots killed most often:', Object.entries(agg.byPilot).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>k+' '+v).join('  '));
