'use strict';
/* SORTIE — campaign layer.
   The carrier, the roster, the war. Pure and deterministic: same campaign seed + same
   decisions = same war, every time. Combat is delegated to sim.js. */

const S = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./sim.js')
  /* Browser: sim.js is inlined into the same scope, so pull its exports off the enclosing scope.
     This list must cover everything this file touches — a missing name here is invisible to the
     node tests and fatal in the browser. uitest.js is what catches it. */
  : { CHASSIS, MODULES, MOD, ENEMIES, WAVES, DOCTRINES, ARCHETYPES, TEMPERAMENTS, SIGNATURES, AUTOPILOT,
      buildStats, simulate, simulateSortie, makeUnit, placeWave, hexSpeed, preferredRange,
      mulberry32, clamp, H };

const CHAPTERS = 8;

/* ---------- people ----------
   Signature and temperament are the character. Nerve is how much of the order survives
   contact with them. */

const ROSTER_START = [
  { id: 'vega',    name: 'VEGA',    temperament: 'tempered', signature: 'overdrive', nerve: 76,
    bio: 'Flew for the regime for six years. Does not talk about it.' },
  { id: 'kestrel', name: 'KESTREL', temperament: 'reckless', signature: 'surge',     nerve: 82,
    bio: 'Nineteen. Has decided she cannot be killed, which is not the same as being right.' },
  { id: 'dor',     name: 'DOR',     temperament: 'cautious', signature: 'anchor',    nerve: 68,
    bio: 'Deck chief. Learned to fly because nobody else was left to.' },
];

const RECRUIT_POOL = [
  { id: 'saito', name: 'SAITO', temperament: 'green',    signature: 'ghost',     nerve: 58,
    bio: 'Refugee off Colony 7. Three weeks in a cockpit.' },
  { id: 'marr',  name: 'MARR',  temperament: 'tempered', signature: 'ghost',     nerve: 74,
    bio: 'Freighter pilot. Unimpressed by all of this.' },
  { id: 'ibis',  name: 'IBIS',  temperament: 'reckless', signature: 'overdrive', nerve: 80,
    bio: 'Defected mid-engagement. Brought the frame with him.' },
  { id: 'cole',  name: 'COLE',  temperament: 'cautious', signature: 'surge',     nerve: 71,
    bio: 'Test pilot. Knows exactly how much these things can take.' },
  { id: 'nox',   name: 'NOX',   temperament: 'green',    signature: 'anchor',    nerve: 61,
    bio: 'Was studying orbital mechanics eight months ago.' },
];

const FRAMES_START = [
  { id: 'f1', name: 'HALBERD-01', build: { chassis: 'halberd', doctrine: 'aggressive',
      mods: ['beam_rifle', 'missiles', 'radiator', 'hopper'] }, integrity: 1.0 },
  { id: 'f2', name: 'WASP-02',    build: { chassis: 'wasp', doctrine: 'aggressive',
      mods: ['beam_saber', 'scatter', 'radiator', 'thruster', 'hopper'] }, integrity: 1.0 },
  { id: 'f3', name: 'BULWARK-03', build: { chassis: 'bulwark', doctrine: 'measured',
      mods: ['missiles', 'bazooka', 'radiator', 'hopper'] }, integrity: 0.55 },
];

/* ---------- the war ---------- */

function newCampaign(seed) {
  return {
    seed: seed >>> 0, chapter: 1, over: false, won: false,
    parts: 40, opinion: 62, collateral: 0,
    roster: ROSTER_START.map(p => Object.assign({}, p, { trauma: 0, fatigue: 0, sorties: 0, kills: 0, status: 'READY', outFor: 0 })),
    frames: FRAMES_START.map(f => Object.assign({}, f, { build: Object.assign({}, f.build, { mods: f.build.mods.slice() }) })),
    recruitsLeft: RECRUIT_POOL.map(p => p.id),
    rival: { name: 'CRIMSON', hp: 560, dpsMul: 1.0, evade: 0.30, coat: false, boost: false, encounters: 0, drivenOff: 0 },
    history: [],
  };
}

/* Escalation is the plot. The regime is an industrial power: it fields more, then it fields
   counters, and the rival comes back from every defeat with something new. */
/* Enemy volume scales with how many pilots you commit. Incoming fire is split across the
   squad, so without this a bigger squad would be strictly free. */
function generateWaves(st, squadSize) {
  const ch = st.chapter, w = [];
  const n = squadSize || 1;
  const cap = (x, max) => Math.max(1, Math.round(Math.min(x, max) * n * 0.40));
  const populated = ch >= 3;

  // Waves rotate rather than accumulate — max three stages before the rival. The regime
  // stops wasting grunts on you and starts sending things built for the job.
  // formation is the tactical question: packed waves feed missile pods, spread waves starve them
  if (ch <= 5) w.push({ label: 'CONTACT', formation: 'cluster', populated,
    groups: [{ type: 'grunt', n: cap(6 + Math.floor(ch / 2), 10) }] });

  if (ch >= 2) w.push({ label: 'RIDGELINE', formation: 'line', populated,
    groups: [{ type: 'grunt', n: cap(4 + Math.floor(ch / 2), 8) }, { type: 'arty', n: cap(1 + Math.floor(ch / 3), 3) }] });

  if (ch >= 4) w.push({ label: 'HARRIERS', formation: 'flank', populated,
    groups: [{ type: 'skirm', n: cap(4 + Math.floor(ch / 2), 9) }, { type: 'arty', n: 1 }] });

  if (ch >= 6) w.push({ label: 'LINE MODELS', formation: 'line', populated,
    groups: [{ type: 'elite', n: cap(2 + Math.floor(ch / 3), 5) }] });

  const r = st.rival;
  // On a board the rival shoots one pilot at a time, so its damage must NOT scale with squad
  // size — only its hull does, because more guns are pointed at it.
  // The rival shoots one pilot at a time, so its damage does not scale with squad size —
  // only its hull does, because more guns end up pointed at it.
  const rm = r.dpsMul, rh = Math.round(r.hp * (0.70 + 0.28 * n));
  w.push({ label: r.name, formation: 'cluster', ace: true, populated: false,
    forceCoat: r.coat, forceBoost: r.boost,
    groups: [{ type: 'ace', n: 1, stats: { name: r.name, armor: rh, evade: r.evade,
      dmg: 52 * rm, minR: 1, maxR: 7, speed: 1.8 } }] });
  return w;
}

function flyable(st) { return st.frames.filter(f => f.integrity >= 0.22); }
function available(st) { return st.roster.filter(p => p.status === 'READY'); }

/* The exact map this chapter's sortie will be fought on, so deployment is not a guess. */
function sortieSeed(st) { return (st.seed * 7919 + st.chapter * 104729) >>> 0; }
function sortieMap(st) {
  return S.H.makeMap(S.mulberry32((sortieSeed(st) ^ 0x9e3779b9) >>> 0), st.chapter);
}

/* Where the first wave will actually stand, so deployment is a decision and not a blind guess.
   Uses a fresh stream from the same seed — the sim places wave one before touching its rng
   for anything else, so this is exactly what you will face. */
function previewWave(st, squadSize, map) {
  const waves = generateWaves(st, squadSize || 1);
  return S.placeWave(map || sortieMap(st), waves[0], S.mulberry32(sortieSeed(st)))
    .map(e => ({ hex: e.hex, type: e.type, hp: e.hp, max: e.max, name: e.e.name }));
}

/* squad: [{pilotId, frameId}] */
function runSortie(st, squad, opts = {}) {
  const entries = squad.map(a => {
    const p = st.roster.find(x => x.id === a.pilotId);
    const f = st.frames.find(x => x.id === a.frameId);
    return { build: f.build, frame: f.id, integrity: f.integrity,
      pilot: { id: p.id, name: p.name, temperament: p.temperament, signature: p.signature,
        nerve: p.nerve, trauma: p.trauma, fatigue: p.fatigue, sigPolicy: 'charge' } };
  });
  const seed = sortieSeed(st);
  return S.simulateSortie(entries, generateWaves(st, entries.length), seed,
    Object.assign({ chapter: st.chapter }, opts));
}

/* Consequences. This is where a sortie stops being a fight and becomes a war. */
function applyResult(st, res, squad) {
  const rng = S.mulberry32((st.seed * 31 + st.chapter * 7717) >>> 0);
  const report = { chapter: st.chapter, ok: res.ok, reason: res.reason, killed: [], wounded: [], notes: [], salvage: 0 };
  if (res.invalid) { report.notes.push('Sortie scrubbed: ' + res.reason); return report; }

  // damage to frames
  for (const s of res.survivors) {
    const f = st.frames.find(x => x.id === s.frame);
    if (f) f.integrity = Math.max(0.55, Math.min(f.integrity, s.hull));
  }
  for (const l of res.losses) {
    const f = st.frames.find(x => x.id === l.frame);
    if (f) f.integrity = 0.28;
  }

  // pilots: a downed frame is not automatically a dead pilot
  for (const l of res.losses) {
    const p = st.roster.find(x => x.id === l.id);
    if (!p) continue;
    const ejected = rng() < 0.72;
    if (ejected) {
      p.status = 'WOUNDED'; p.outFor = 1 + Math.floor(rng() * 2);
      p.trauma = Math.min(100, p.trauma + 30);
      report.wounded.push({ name: p.name, out: p.outFor });
    } else {
      p.status = 'KILLED';
      report.killed.push({ name: p.name, cause: l.cause });
    }
  }
  // survivors carry what happened to them
  for (const s of res.survivors) {
    const p = st.roster.find(x => x.id === s.id);
    if (!p) continue;
    p.trauma = Math.min(100, Math.round(s.trauma));
    p.fatigue = Math.min(100, p.fatigue + 28);
    p.sorties++; p.kills += s.kills;
    if (s.disobeys > 0) report.notes.push(`${p.name} ignored ${s.disobeys} order${s.disobeys > 1 ? 's' : ''}`);
  }

  // salvage and public opinion
  const salvage = res.ok ? 26 + st.chapter * 5 : 22 + st.chapter * 3;
  st.parts += salvage;
  report.salvage = salvage;
  if (res.areaShots > 0) {
    const harm = Math.round(res.areaShots * 0.18);
    st.collateral += harm;
    st.opinion = Math.max(0, st.opinion - harm);
    report.collateral = harm;
    report.notes.push(`${harm} civilian casualties attributed to area fire`);
  } else if (res.ok) {
    st.opinion = Math.min(100, st.opinion + 4);
  }
  if (!res.ok) st.opinion = Math.max(0, st.opinion - 5);

  // You fight with hand-me-downs. Enemy wrecks dragged back aboard become airframes.
  if (res.ok && st.frames.length < 6 && rng() < 0.55) {
    const n = st.frames.length + 1;
    const kit = [
      { chassis: 'halberd', doctrine: 'measured', mods: ['beam_rifle', 'mg', 'radiator', 'hopper'] },
      { chassis: 'wasp', doctrine: 'aggressive', mods: ['beam_saber', 'mg', 'radiator', 'thruster'] },
      { chassis: 'bulwark', doctrine: 'measured', mods: ['missiles', 'scatter', 'radiator', 'hopper'] },
    ][st.chapter % 3];
    const f = { id: 'sv' + n, name: 'SALVAGE-0' + n, build: kit, integrity: 0.62, salvaged: true };
    st.frames.push(f);
    report.salvaged = f.name;
    report.notes.push(`${f.name} rebuilt from enemy wreckage`);
  }

  // the rival learns
  const r = st.rival;
  r.encounters++;
  const total = res.dealt.beam + res.dealt.kinetic || 1;
  const beamShare = res.dealt.beam / total, knifeShare = res.dealt.KNIFE / total;
  if (res.ok) {
    r.drivenOff++;
    r.hp = Math.round(r.hp * 1.10); r.dpsMul *= 1.08; r.evade = Math.min(0.5, r.evade + 0.02);
    if (beamShare > 0.5 && !r.coat) { r.coat = true; report.notes.push(`${r.name} will return with anti-beam coating`); }
    else if (knifeShare > 0.5 && !r.boost) { r.boost = true; report.notes.push(`${r.name} will return with a boost package`); }
    else report.notes.push(`${r.name} withdrew under power and will be back`);
  } else {
    r.hp = Math.round(r.hp * 1.06);
    report.notes.push(`${r.name} holds the field`);
  }

  st.history.push(report);
  return report;
}

function advanceChapter(st) {
  // the deck crew patches what they can between chapters, for free
  for (const f of st.frames) f.integrity = Math.min(1, f.integrity + 0.12);
  for (const p of st.roster) {
    if (p.status === 'WOUNDED' || p.status === 'STOOD DOWN') {
      p.outFor--;
      if (p.outFor <= 0) { p.status = 'READY'; p.trauma = Math.max(0, p.trauma - 10); }
    }
    if (p.status === 'READY') p.fatigue = Math.max(0, p.fatigue - 18);
  }
  st.chapter++;
  if (st.roster.every(p => p.status === 'KILLED')) { st.over = true; st.won = false; }
  else if (st.chapter > CHAPTERS) {
    st.over = true;
    const last = st.history[st.history.length - 1];
    st.won = !!(last && last.ok);   // you win by driving the rival off in the final chapter
  }
  return st;
}

/* between-chapter actions */
function repairCost(f) { return Math.ceil((1 - f.integrity) * 30); }
function repair(st, frameId) {
  const f = st.frames.find(x => x.id === frameId);
  const c = repairCost(f);
  if (!f || c === 0 || st.parts < c) return false;
  st.parts -= c; f.integrity = 1; return true;
}
function standDown(st, pilotId) {
  const p = st.roster.find(x => x.id === pilotId);
  if (!p || p.status !== 'READY') return false;
  p.status = 'STOOD DOWN'; p.outFor = 1;
  p.fatigue = 0; p.trauma = Math.max(0, p.trauma - 35);
  return true;
}
function recruit(st) {
  if (st.opinion < 30 || !st.recruitsLeft.length || st.parts < 25) return null;
  const id = st.recruitsLeft.shift();
  const base = RECRUIT_POOL.find(p => p.id === id);
  st.parts -= 25;
  const p = Object.assign({}, base, { trauma: 0, fatigue: 0, sorties: 0, kills: 0, status: 'READY', outFor: 0 });
  st.roster.push(p);
  return p;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHAPTERS, ROSTER_START, RECRUIT_POOL, FRAMES_START, newCampaign, generateWaves, sortieMap, sortieSeed, previewWave,
    runSortie, applyResult, advanceChapter, flyable, available, repair, repairCost, standDown, recruit };
}
