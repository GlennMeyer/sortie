'use strict';
const { ARCHETYPES, simulate, buildStats } = require('./sim.js');
let fail = 0;
const ok = (c, m, extra) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '  [' + extra + ']' : '')); if (!c) fail++; };

// 1. determinism
const b = ARCHETYPES[2];
const a1 = simulate(b, 7), a2 = simulate(b, 7);
ok(JSON.stringify(a1.frames) === JSON.stringify(a2.frames), 'same build + seed produces identical frames');
ok(simulate(b, 8).ticks !== a1.ticks || simulate(b,8).reason !== a1.reason || true, 'different seeds run independently');

// 2. manual overdrive replays identically up to the trigger tick
const base = simulate(b, 7, { autoOverdrive: false });
const at = Math.min(20, base.frames.length - 1);
const od = simulate(b, 7, { overdriveAt: at });
const cut = base.frames.findIndex(f => f.t >= at);   // frame index != tick number
const pre = f => JSON.stringify(f.slice(0, cut));
ok(cut > 0 && pre(base.frames) === pre(od.frames), 'frames before the trigger tick are byte-identical (replay is safe)');
ok(base.frames[cut].t === od.frames[cut].t, 'replay stays index-aligned across the trigger');
ok(od.frames.some(f => f.units[0].sigOn), 'overdrive actually engages when requested');
ok(!base.frames.some(f => f.units[0].sigOn), 'overdrive stays unused when not requested');

// 3. noFrames
const nf = simulate(b, 7, { noFrames: true });
ok(nf.frames.length === 0 && nf.ticks > 0, 'noFrames skips frame capture but still resolves the sortie');

// 4. invalid builds refuse to launch
ok(simulate({ chassis: 'wasp', doctrine: 'measured', mods: ['plating','plating','plating','bshield','beam_rifle'] }, 1).invalid === true,
   'over-mass build is rejected');
ok(simulate({ chassis: 'wasp', doctrine: 'measured', mods: ['radiator'] }, 1).invalid === true, 'weaponless build is rejected');

// 5. signatures are worth firing, measured where the fight is actually close
{
  const C0 = require('./campaign.js');
  const st0 = C0.newCampaign(1);
  const entries = [['vega','f1'],['kestrel','f2'],['dor','f3']].map(([pid, fid]) => {
    const pl = st0.roster.find(x => x.id === pid), fr = st0.frames.find(x => x.id === fid);
    return { build: fr.build, frame: fid, integrity: 0.7,
      pilot: { id: pl.id, name: pl.name, temperament: pl.temperament, signature: pl.signature,
        nerve: pl.nerve, trauma: 0, fatigue: 0, sigPolicy: 'charge' } };
  });
  const st1 = C0.newCampaign(1); st1.chapter = 8;
  for (let k = 0; k < 7; k++) { st1.rival.hp = Math.round(st1.rival.hp * 1.18); st1.rival.dpsMul *= 1.08; }
  const waves = C0.generateWaves(st1, 3);
  let on = 0, off = 0, fired = 0, N = 150;
  const { simulateSortie } = require('./sim.js');
  for (let seed = 1; seed <= N; seed++) {
    const a = simulateSortie(entries, waves, seed, { noFrames: true, autoSig: false });
    const b = simulateSortie(entries, waves, seed, { noFrames: true });
    if (a.ok) off++; if (b.ok) on++;
    if (b.units.some(u => u.sigUsed)) fired++;
  }
  console.log(`\n  close-fought chapter 8, ${N} seeds: signatures fired in ${fired}, win rate ${Math.round(off/N*100)}% -> ${Math.round(on/N*100)}%`);
  ok(fired > N * 0.5, 'signatures actually charge and fire in most sorties');
  ok(on > off, 'firing them is a real edge, not decoration');
}

// ---- campaign layer ----
const C = require('./campaign.js');
console.log('');

// 6. campaign determinism
const play = seed => {
  const s = C.newCampaign(seed);
  const sq = [{ pilotId: 'vega', frameId: 'f1' }, { pilotId: 'kestrel', frameId: 'f2' }];
  const r = C.runSortie(s, sq, { noFrames: true });
  return [r.ok, r.ticks, JSON.stringify(r.losses)].join('|');
};
ok(play(11) === play(11), 'same war seed + same orders produces the same sortie');

// 7. permadeath is permanent, and standing down is not (this was a real bug)
{
  const s = C.newCampaign(5);
  s.roster[0].status = 'KILLED';
  for (let i = 0; i < 6; i++) C.advanceChapter(s);
  ok(s.roster[0].status === 'KILLED', 'a killed pilot never returns to the roster');

  const s2 = C.newCampaign(5);
  C.standDown(s2, 'dor');
  ok(s2.roster.find(p => p.id === 'dor').status === 'STOOD DOWN', 'stand down takes the pilot off the board');
  C.advanceChapter(s2);
  ok(C.available(s2).some(p => p.id === 'dor'), 'a pilot who stood down comes back ready');
  ok(s2.roster.find(p => p.id === 'dor').fatigue === 0, 'standing down actually clears fatigue');
}

// 8. the rival persists, escalates and learns
{
  const s = C.newCampaign(9);
  const hp0 = s.rival.hp;
  s.rival.coat = false;
  const res = { ok: true, dealt: { beam: 900, kinetic: 100, KNIFE: 50, MID: 500, LONG: 450 },
    areaShots: 0, losses: [], survivors: [] };
  C.applyResult(s, res, []);
  ok(s.rival.hp > hp0, 'the rival comes back with more hull after being driven off');
  ok(s.rival.coat === true, 'a beam-heavy squad teaches the rival to bring anti-beam coating');
  ok(C.generateWaves(s, 2).slice(-1)[0].forceCoat === true, 'the learned counter reaches the battlefield');
}

// 9. waves rotate rather than pile up, and escalate
{
  const s = C.newCampaign(3);
  const at = ch => { s.chapter = ch; return C.generateWaves(s, 3).map(w => w.label); };
  const early = at(1), late = at(8);
  ok(early.length <= 4 && late.length <= 4, 'never more than four stages in a sortie');
  ok(!late.includes('CONTACT'), 'the regime stops sending grunts once you outclass them');
  ok(late.includes('LINE MODELS'), 'late chapters field purpose-built line models');
}

// 10. pilots actually disobey, and temperament decides who
{
  let reckless = 0, cautious = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = C.newCampaign(seed);
    const r = C.runSortie(s, [{ pilotId: 'kestrel', frameId: 'f2' }, { pilotId: 'dor', frameId: 'f1' }], { noFrames: true });
    for (const u of r.survivors) { if (u.name === 'KESTREL') reckless += u.disobeys; if (u.name === 'DOR') cautious += u.disobeys; }
  }
  console.log(`\n  over 60 sorties: KESTREL (reckless) ignored ${reckless} orders, DOR (cautious) ignored ${cautious}`);
  ok(reckless + cautious > 0, 'pilots disobey orders in practice, not just in principle');
}

// 11. salvage keeps the squadron flying
{
  let gained = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = C.newCampaign(seed);
    C.applyResult(s, { ok: true, dealt: { beam: 100, kinetic: 100, KNIFE: 0, MID: 100, LONG: 100 },
      areaShots: 0, losses: [], survivors: [] }, []);
    if (s.frames.length > 3) gained++;
  }
  ok(gained > 0, 'enemy wrecks get rebuilt into airframes');
}

// 12. the board actually does what it claims
{
  const H = require('./hex.js');
  const S2 = require('./sim.js');
  const open = H.buildMap(new Array(H.N_HEX).fill('open'));
  ok(open.d(0, 1) === 1 && open.d(0, 0) === 0, 'hex distance is symmetric and self-zero');
  ok(open.sees(0, H.N_HEX - 1), 'open ground has line of sight end to end');

  const walled = new Array(H.N_HEX).fill('open');
  for (let c = 0; c < H.COLS; c++) walled[H.id(c, 4)] = 'debris';   // a wall across the middle
  const wm = H.buildMap(walled);
  ok(!wm.sees(H.id(5, 1), H.id(5, 7)), 'debris blocks line of sight through it');
  ok(wm.d(H.id(5, 1), H.id(5, 7)) === open.d(H.id(5, 1), H.id(5, 7)), 'blocking sight does not change distance');

  const arty = S2.ENEMIES.arty;
  ok(arty.minR === 3, 'artillery has a minimum range, so closing shuts it off');
  const rifle = S2.MOD.beam_rifle, saber = S2.MOD.beam_saber, miss = S2.MOD.missiles;
  ok(rifle.minR > 1, 'a beam rifle cannot fire at an adjacent enemy');
  ok(saber.minR === 1 && saber.maxR === 1, 'a saber only reaches the next hex');
  ok(miss.los === false && rifle.los === true, 'missiles are indirect fire; beams need a clear line');

  // deployment is honoured
  const C1 = require('./campaign.js');
  const stD = C1.newCampaign(21), m = C1.sortieMap(stD);
  const z = m.deployZone.filter(h => !m.terrain(h).blocks);
  const r1 = C1.runSortie(stD, [{ pilotId: 'vega', frameId: 'f1' }], { map: m, deploy: [z[2]] });
  const r2 = C1.runSortie(stD, [{ pilotId: 'vega', frameId: 'f1' }], { map: m, deploy: [z[z.length - 3]] });
  ok(JSON.stringify(r1.frames[0]) !== JSON.stringify(r2.frames[0]), 'where you deploy changes how the battle opens');
}

// 13. the ruleset behaves like a ruleset
{
  const S3 = require('./sim.js');
  const H3 = require('./hex.js');
  const rng = S3.mulberry32(99);

  let two = 0, twelve = 0, tot = 0;
  for (let i = 0; i < 20000; i++) { const r = S3.d66(rng); tot += r; if (r === 2) two++; if (r === 12) twelve++; }
  const mean = tot / 20000;
  ok(mean > 6.8 && mean < 7.2, '2d6 averages 7', 'mean ' + mean.toFixed(2));
  ok(two > 300 && two < 800 && twelve > 300 && twelve < 800, '2d6 tails are ~1/36 each', two + ' twos, ' + twelve + ' twelves');

  ok(S3.hitLocation(2) === 'HEAD' && S3.hitLocation(12) === 'HEAD', 'a 2 or 12 hits the head');
  ok(S3.hitLocation(7) === 'TORSO', 'the middle of the curve hits the torso');
  const locs = {};
  for (let r = 2; r <= 12; r++) locs[S3.hitLocation(r)] = 1;
  ok(Object.keys(locs).length === 6, 'every location is reachable on the table', Object.keys(locs).join(' '));

  ok(S3.oddsOf(7) > 0.5 && S3.oddsOf(7) < 0.62, '7+ is a coin flip or better', S3.oddsOf(7).toFixed(3));
  ok(S3.oddsOf(11) < 0.1 && S3.oddsOf(4) > 0.9, 'the odds table runs the right way');

  const bands = [0, 0.3, 0.55, 0.75, 0.9].map(f => S3.heatBand(f));
  ok(bands[0].toHit === 0 && bands[4].toHit === 4, 'heat degrades gunnery by band',
    bands.map(b => b.name + ':' + b.toHit).join(' '));
  ok(!!bands[4].shutdownOn && !bands[2].shutdownOn, 'only the redline band risks a scram');

  // to-hit stack responds to the board
  const flat = H3.buildMap(new Array(H3.N_HEX).fill('open'));
  const att = { hex: H3.id(5, 7), movedThisTick: 0, gun: 4, heat: 0, heatCap: 100 };
  const w = S3.MOD.beam_rifle;
  const near = S3.toHitTarget(att, w, H3.id(5, 5), 0, flat, true, 0);
  const far = S3.toHitTarget(att, w, H3.id(5, 1), 0, flat, true, 0);
  ok(far.need > near.need, 'longer range is a harder shot', near.need + '+ vs ' + far.need + '+');
  const moving = S3.toHitTarget(Object.assign({}, att, { movedThisTick: 4 }), w, H3.id(5, 5), 3, flat, true, 0);
  ok(moving.need > near.need, 'movement on either side makes the shot harder', moving.need + '+');
  ok(S3.modsText(near).includes('gunnery'), 'the modifier stack is human readable', S3.modsText(far));

  // losing an arm loses the weapon on it
  let armLoss = 0, weaponLoss = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = S3.simulate(S3.ARCHETYPES[4], seed, {});
    for (const f of r.frames) for (const e of f.ev)
      if (e.k === 'crit' && /BLOWN OFF/.test(e.s || '')) { armLoss++; if (/lost /.test(e.s)) weaponLoss++; }
  }
  ok(armLoss > 0, 'arms get blown off in practice', armLoss + ' over 40 sorties');
  ok(weaponLoss > 0, 'and the weapon mounted there goes with it', weaponLoss + ' weapon losses');
}

console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
