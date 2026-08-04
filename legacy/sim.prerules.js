'use strict';
/* SORTIE — deterministic combat sim.
   No DOM, no randomness outside the seeded PRNG. Same build + same seed = same sortie.
   Shared verbatim between the browser prototype and the headless balance runner. */

const CHASSIS = {
  wasp:    { name: 'WASP',    cls: 'LIGHT',  mass: 44, power: 44, heatCap: 95,  dissip: 10.8, armor: 400, evade: 0.46, prop: 130, speed: 12.0 },
  halberd: { name: 'HALBERD', cls: 'MEDIUM', mass: 50, power: 52, heatCap: 125, dissip: 9.6, armor: 560, evade: 0.26, prop: 104, speed: 8.0 },
  bulwark: { name: 'BULWARK', cls: 'HEAVY',  mass: 56, power: 68, heatCap: 150, dissip: 7.8, armor: 640, evade: 0.10, prop: 66,  speed: 5.5 },
};

/* kind: 'w' weapon, 's' support.
   bands: where the weapon can be used. targets: max bodies hit (area weapons).
   use: ammo consumed per activation. cycle: ticks between activations. */
const MODULES = [
  { id: 'beam_rifle', name: 'BEAM RIFLE',     kind: 'w', mass: 12, power: 30, heat: 12, dmg: 95,  dtype: 'beam',    minR: 2, maxR: 7, blast: 0, ammo: null, use: 0, cycle: 1, los: true,
    note: 'Reaches almost the whole board, needs a clear line, and cooks you if you hold the trigger.' },
  { id: 'beam_saber', name: 'BEAM SABER',     kind: 'w', mass: 6,  power: 20, heat: 14, dmg: 165, dtype: 'beam',    minR: 1, maxR: 1, blast: 0, ammo: null, use: 0, cycle: 1, los: true,
    note: 'Adjacent hex only. Cheapest kill in the game — you have to survive the walk in.' },
  { id: 'mg',         name: 'MACHINE CANNON', kind: 'w', mass: 9,  power: 4,  heat: 4,  dmg: 32,  dtype: 'kinetic', minR: 1, maxR: 4, blast: 0, ammo: 320, use: 8, cycle: 1, los: true,
    note: 'Almost no heat, short reach. Runs dry exactly when you need it.' },
  { id: 'missiles',   name: 'MISSILE POD',    kind: 'w', mass: 16, power: 6,  heat: 14, dmg: 68,  dtype: 'kinetic', minR: 3, maxR: 8, blast: 1, ammo: 30,  use: 3, cycle: 2, los: false,
    note: 'Indirect fire — arcs over debris, no line of sight needed. Splashes one hex out, so it only pays against a cluster.' },
  { id: 'bazooka',    name: 'BAZOOKA',        kind: 'w', mass: 14, power: 3,  heat: 19, dmg: 285, dtype: 'kinetic', minR: 2, maxR: 6, blast: 0, ammo: 10,  use: 1, cycle: 3, los: true,
    note: 'Ten rounds. Bring them to the rival, not the chaff.' },
  { id: 'scatter',    name: 'SCATTER GUN',    kind: 'w', mass: 11, power: 5,  heat: 12, dmg: 68,  dtype: 'kinetic', minR: 1, maxR: 2, blast: 1, ammo: 56,  use: 2, cycle: 1, los: true,
    note: 'Point blank crowd control for pilots who commit.' },

  { id: 'radiator',   name: 'RADIATOR FIN',   kind: 's', mass: 8,  power: 2,  dissip: 4.2,
    note: 'The whole build lives or dies here.' },
  { id: 'aux',        name: 'AUX REACTOR',    kind: 's', mass: 14, power: 0,  powerGain: 38, passiveHeat: 1.4,
    note: 'Buys power. Charges heat for it, every tick, forever.' },
  { id: 'thruster',   name: 'THRUSTER PACK',  kind: 's', mass: 10, power: 8,  propEff: 0.40, evade: 0.12, speed: 3.0,
    note: 'Closing distance and staying alive are the same stat.' },
  { id: 'bshield',    name: 'BEAM SHIELD',    kind: 's', mass: 10, power: 18, block: 0.34, passiveHeat: 3.2,
    note: 'Cuts incoming by more than half — while adding to the problem.' },
  { id: 'plating',    name: 'ARMOR PLATING',  kind: 's', mass: 20, power: 0,  armorGain: 280, evadeLoss: 0.13, speed: -2.0,
    note: 'Trades the dodge for the hull. Heavy frames only.' },
  { id: 'hopper',     name: 'AMMO HOPPER',    kind: 's', mass: 9,  power: 1,  ammoMul: 0.60,
    note: 'Turns a two-wave gun into a four-wave gun.' },
];
const MOD = Object.fromEntries(MODULES.map(m => [m.id, m]));

/* Chaff cannot kill you outright — it exists to drain hull, heat headroom, ammo and fuel
   before the only enemy that can actually beat you launches. On a board it also has to get
   into range to do that, which is what makes terrain matter. */
const ENEMIES = {
  grunt: { name: 'GRUNT',      armor: 80,  dmg: 5.0,  minR: 1, maxR: 4, speed: 1.0, evade: 0.05 },
  arty:  { name: 'ARTILLERY',  armor: 65,  dmg: 19,   minR: 3, maxR: 9, speed: 0.5, evade: 0.02,
           note: 'Cannot fire inside two hexes. Getting under it is the whole answer.' },
  skirm: { name: 'SKIRMISHER', armor: 64,  dmg: 5.6,  minR: 1, maxR: 3, speed: 1.7, evade: 0.22, beamResist: 0.40 },
  elite: { name: 'LINE MODEL', armor: 150, dmg: 8.5,   minR: 1, maxR: 5, speed: 0.9, evade: 0.12, beamResist: 0.25 },
  ace:   { name: 'ACE',        armor: 760, dmg: 36,   minR: 1, maxR: 7, speed: 1.8, evade: 0.32 },
};

/* formation: how the wave is placed. 'cluster' packs them (missile food), 'line' spreads them
   across the width, 'flank' splits to both edges. Clustering is no longer a magic number —
   it is where the bodies actually are. */
const WAVES = [
  { label: 'CONTACT',   formation: 'cluster', groups: [{ type: 'grunt', n: 10 }] },
  { label: 'RIDGELINE', formation: 'line',    groups: [{ type: 'grunt', n: 7 }, { type: 'arty', n: 3 }] },
  { label: 'HARRIERS',  formation: 'flank',   groups: [{ type: 'skirm', n: 9 }, { type: 'arty', n: 1 }] },
  { label: 'THE ACE',   formation: 'cluster', ace: true, groups: [{ type: 'ace', n: 1 }] },
];

/* redline — how far past the heat cap a pilot is willing to push the reactor before easing off.
   Above 1.0 the build can genuinely scram itself; that risk is the doctrine's whole personality. */
const DOCTRINES = {
  aggressive: { name: 'AGGRESSIVE', closeBias: 1.35, ventAt: 0.92, standoff: 0.80, redline: 1.18 },
  measured:   { name: 'MEASURED',   closeBias: 1.00, ventAt: 0.80, standoff: 1.00, redline: 1.04 },
  standoff:   { name: 'STANDOFF',   closeBias: 0.70, ventAt: 0.70, standoff: 1.30, redline: 0.88 },
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bandOf(d) { return d > 66 ? 'LONG' : d > 33 ? 'MID' : 'KNIFE'; }
function bandCenter(b) { return b === 'LONG' ? 84 : b === 'MID' ? 50 : 16; }
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

/* ---------- loadout ---------- */

function buildStats(build) {
  const ch = CHASSIS[build.chassis];
  const mods = build.mods.map(id => MOD[id]).filter(Boolean);
  const sum = k => mods.reduce((a, m) => a + (m[k] || 0), 0);

  const s = {
    chassis: ch,
    mods,
    massUsed: sum('mass'),
    massBudget: ch.mass,
    powerDraw: sum('power'),
    powerAvail: ch.power + sum('powerGain'),
    heatCap: ch.heatCap,
    dissip: ch.dissip + sum('dissip'),
    passiveHeat: sum('passiveHeat'),
    armorMax: ch.armor + sum('armorGain'),
    evade: clamp(ch.evade + sum('evade') - sum('evadeLoss'), 0.02, 0.75),
    propMax: ch.prop,
    propEff: sum('propEff'),
    speed: Math.max(2, ch.speed + sum('speed')),
    ammoMul: 1 + sum('ammoMul'),
    block: mods.reduce((a, m) => Math.max(a, m.block || 0), 0),
    weapons: mods.filter(m => m.kind === 'w'),
  };

  // Sustained heat if every weapon fires on cooldown forever, vs what the frame can shed.
  s.heatLoad = s.passiveHeat + s.weapons.reduce((a, w) => a + w.heat / w.cycle, 0);
  s.reach = s.weapons.reduce((a, w) => Math.max(a, w.maxR), 0);
  s.heatRatio = s.heatLoad / s.dissip;
  s.overMass = s.massUsed > s.massBudget;
  s.brownout = s.powerDraw > s.powerAvail;
  s.valid = !s.overMass && s.weapons.length > 0;
  return s;
}


/* ---------- pilots ----------
   A pilot is not a stat line. Doctrine issues an order every tick; temperament, trauma and
   fatigue decide whether the order is actually obeyed. A script that fails because of who
   someone is turns a balance readout into a story beat. */

const TEMPERAMENTS = {
  reckless: { name: 'RECKLESS', pPush: 0.55, pFlinch: 0.04, traumaGain: 0.8,
    note: 'Ignores the break-off order. Worse when the rival is on the field.' },
  tempered: { name: 'TEMPERED', pPush: 0.14, pFlinch: 0.14, traumaGain: 1.0,
    note: 'Does what you tell them, most of the time.' },
  cautious: { name: 'CAUTIOUS', pPush: 0.04, pFlinch: 0.38, traumaGain: 1.1,
    note: 'Disengages early. Sometimes that is correct.' },
  green:    { name: 'GREEN',    pPush: 0.30, pFlinch: 0.34, traumaGain: 1.7,
    note: 'Does neither thing reliably, and breaks fastest.' },
};

const SIGNATURES = {
  overdrive: { name: 'OVERDRIVE', dur: 4, note: 'Four ticks generating zero heat.' },
  ghost:     { name: 'GHOST',     dur: 4, note: 'Four ticks where every weapon fires at any range.' },
  surge:     { name: 'SURGE',     dur: 4, note: 'Four ticks where damage scales with hull already lost.' },
  anchor:    { name: 'ANCHOR',    dur: 4, note: 'Four ticks of cover for the whole squad.' },
};

/* Used by the single-unit balance tooling. Never disobeys, so it burns no RNG and the
   tuned numbers stay exactly what they were. */
const AUTOPILOT = { id: 'auto', name: 'AUTOPILOT', temperament: 'tempered',
  pPush: 0, pFlinch: 0, signature: 'overdrive', sigPolicy: 'legacyHeat', nerve: 100, trauma: 0, fatigue: 0 };

function pilotGrip(p) {
  return clamp((p.nerve - (p.trauma || 0) * 0.6 - (p.fatigue || 0) * 0.5) / 100, 0.05, 1);
}

/* ---------- sortie ---------- */

const H = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./hex.js')
  : { COLS, ROWS, N_HEX, TERRAIN, id, colOf, rowOf, neighbours, makeMap, buildMap, costField, coverAt };

function makeUnit(entry, idx) {
  const st = buildStats(entry.build);
  const p = entry.pilot || AUTOPILOT;
  const temp = Object.assign({}, TEMPERAMENTS[p.temperament] || TEMPERAMENTS.tempered);
  if (p.pPush != null) temp.pPush = p.pPush;
  if (p.pFlinch != null) temp.pFlinch = p.pFlinch;
  return {
    idx, pilot: p, temp, s: st, doc: DOCTRINES[entry.build.doctrine || 'measured'],
    frame: entry.frame || null, integrity: entry.integrity == null ? 1 : entry.integrity,
    nerve: p.nerve == null ? 70 : p.nerve, trauma: p.trauma || 0, fatigue: p.fatigue || 0,
    armor: st.armorMax * (entry.integrity == null ? 1 : entry.integrity),
    heat: 0, prop: st.propMax, hex: -1, mp: 0,
    shutdown: 0, venting: false, overheats: 0, peakHeat: 0,
    od: 0, ghost: 0, surge: 0, anchor: 0, sigUsed: false, charge: 0,
    dead: false, deadAt: null, kills: 0, disobeys: 0, hurtMarks: 0, moved: 0,
    cycleMul: st.brownout ? 2 : 1,
    weapons: st.weapons.map(w => ({ m: w, cd: 0,
      ammo: w.ammo == null ? null : Math.round(w.ammo * st.ammoMul),
      ammo0: w.ammo == null ? null : Math.round(w.ammo * st.ammoMul), fired: 0 })),
  };
}

function grip(u) { return clamp((u.nerve - u.trauma * 0.6 - u.fatigue * 0.5) / 100, 0.05, 1); }

/* The range this loadout actually wants to fight at. Without this a unit closes to zero and
   parks inside its own weapons' minimum range, unable to shoot anything. */
function preferredRange(u) {
  let best = 1, bestVal = -1;
  for (let r = 1; r <= 9; r++) {
    let val = 0;
    for (const w of u.weapons) {
      if (r < w.m.minR || r > w.m.maxR) continue;
      if (w.ammo !== null && w.ammo < w.m.use) continue;
      val += (w.m.dmg * (1 + w.m.blast)) / w.m.cycle;
    }
    if (val > bestVal) { bestVal = val; best = r; }
  }
  return best;
}

/* hexes per tick, from frame speed */
function hexSpeed(st) { return Math.max(0.55, st.speed / 6); }

/* Place a wave on the board. Formation decides how packed it is, which is what makes a
   missile pod worth carrying — or dead weight. */
function placeWave(map, wave, rng) {
  const zone = map.enemyZone.filter(h => !map.terrain(h).blocks);
  const out = [];
  const pick = [];
  if (wave.formation === 'cluster') {
    const c = zone[Math.floor(rng() * zone.length)];
    const sorted = zone.slice().sort((a, b) => map.d(c, a) - map.d(c, b));
    pick.push(...sorted);
  } else if (wave.formation === 'flank') {
    const qa = Math.round(H.COLS * 0.28), qb = Math.round(H.COLS * 0.72);
    const near = c => zone.slice().sort((a, b) => Math.abs(H.colOf(a) - c) - Math.abs(H.colOf(b) - c));
    const A = near(qa), B = near(qb);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      if (A[i]) pick.push(A[i]);
      if (B[i]) pick.push(B[i]);
    }
  } else {
    const step = Math.max(1, Math.floor(zone.length / 12));
    for (let i = 0; i < zone.length; i += step) pick.push(zone[i]);
    for (const h of zone) if (!pick.includes(h)) pick.push(h);
  }

  const used = new Set();
  const spill = map.tiles.map((_, i) => i).filter(h => !map.terrain(h).blocks && H.rowOf(h) < H.ROWS - 3);
  const take = () => {
    for (const h of pick) if (!used.has(h)) { used.add(h); return h; }
    for (const h of spill) if (!used.has(h)) { used.add(h); return h; }
    return pick[0];
  };
  for (const g of wave.groups) {
    const base = g.stats || ENEMIES[g.type];
    for (let i = 0; i < g.n; i++)
      out.push({ type: g.type, e: base, hp: base.armor, max: base.armor, hex: take(), mp: 0, cd: 0 });
  }
  return out;
}

/* ---------- sortie ---------- */

function simulateSortie(squad, waves, seed, opts = {}) {
  waves = waves || WAVES;
  const rng = mulberry32(seed >>> 0);
  const map = opts.map || H.makeMap(mulberry32((seed ^ 0x9e3779b9) >>> 0), opts.chapter || 1);
  const frames = [];
  const units = squad.map(makeUnit);

  const bad = units.find(u => !u.s.valid);
  if (bad) return { ok: false, invalid: true, units, frames, map, stats: bad.s,
    reason: bad.s.overMass ? 'OVER MASS BUDGET' : 'NO WEAPON FITTED' };

  // deployment
  const zone = map.deployZone.filter(h => !map.terrain(h).blocks);
  units.forEach((u, i) => {
    const want = opts.deploy && opts.deploy[i];
    u.hex = (want != null && zone.includes(want)) ? want
      : zone[Math.floor((i + 1) * zone.length / (units.length + 1))];
  });
  for (let i = 1; i < units.length; i++)                       // never stack on deploy
    while (units.slice(0, i).some(o => o.hex === units[i].hex)) units[i].hex = zone[(zone.indexOf(units[i].hex) + 1) % zone.length];

  const sigOrders = opts.sigOrders || (opts.overdriveAt != null ? [{ u: 0, t: opts.overdriveAt }] : []);
  const autoSig = opts.autoSig !== false && opts.autoOverdrive !== false && opts.overdriveAt == null;
  const dealt = { beam: 0, kinetic: 0, KNIFE: 0, MID: 0, LONG: 0 };
  let areaShots = 0, t = 0, result = null;

  const fireSig = (u, ev) => {
    u.sigUsed = true; u.charge = 0;
    const sig = SIGNATURES[u.pilot.signature] || SIGNATURES.overdrive;
    if (u.pilot.signature === 'anchor') for (const o of units) { if (!o.dead) o.anchor = sig.dur; }
    else if (u.pilot.signature === 'ghost') u.ghost = sig.dur;
    else if (u.pilot.signature === 'surge') u.surge = sig.dur;
    else u.od = sig.dur;
    ev.push({ k: 'sig', u: u.idx, s: `${u.pilot.name} — ${sig.name}` });
  };

  const canReach = (w, d, ghost) => ghost ? d <= w.maxR + 2 : (d >= w.minR && d <= w.maxR);
  const bandName = d => d <= 1 ? 'KNIFE' : d <= 4 ? 'MID' : 'LONG';

  for (let wi = 0; wi < waves.length && !result; wi++) {
    const wave = waves[wi];
    const enemies = placeWave(map, wave, rng);

    let aceCoat = false, aceBoost = false;
    if (wave.ace) {
      const total = dealt.beam + dealt.kinetic || 1;
      aceCoat = wave.forceCoat != null ? wave.forceCoat : dealt.beam / total > 0.55;
      aceBoost = wave.forceBoost != null ? wave.forceBoost : dealt.KNIFE / total > 0.70;
    }
    for (const u of units) { u.heat *= 0.75; u.mp = 0; }
    let waveTicks = 0;

    while (waveTicks < 160) {
      t++; waveTicks++;
      const ev = [];
      if (!enemies.some(e => e.hp > 0)) break;
      if (units.every(u => u.dead)) break;

      const occupied = () => {
        const o = new Set();
        for (const u of units) if (!u.dead) o.add(u.hex);
        for (const e of enemies) if (e.hp > 0) o.add(e.hex);
        return o;
      };

      /* ---- player units: choose ground, move, shoot ---- */
      for (const u of units) {
        if (u.dead) continue;
        const live = enemies.filter(e => e.hp > 0);
        if (!live.length) break;
        const occ = occupied();
        const bonusR = map.terrain(u.hex).high ? 1 : 0;

        if (u.shutdown <= 0) {
          const heatFrac = u.heat / u.s.heatCap;
          if (heatFrac >= u.doc.ventAt) u.venting = true;
          if (u.venting && heatFrac < 0.45) u.venting = false;

          /* score every hex we could plausibly reach */
          const wantR = preferredRange(u);
          const field = H.costField(map, [u.hex]);
          const budget = Math.max(2, Math.round(hexSpeed(u.s) * 3));
          let bestHex = u.hex, bestScore = -Infinity;
          const consider = [];
          for (let h = 0; h < H.N_HEX; h++)
            if (field[h] <= budget && (h === u.hex || !occ.has(h))) consider.push(h);

          for (const h of consider) {
            const hi = map.terrain(h).high ? 1 : 0;
            let out = 0, hin = 0;
            for (const w of u.weapons) {
              if (w.ammo !== null && w.ammo < w.m.use) continue;
              let hit = 0;
              for (const e of live) {
                const d = map.d(h, e.hex);
                if (!canReach(w.m, d, false) || d > w.m.maxR + hi) continue;
                if (w.m.los && !map.sees(h, e.hex)) continue;
                hit += 1 + (w.m.blast ? live.filter(o => map.d(o.hex, e.hex) <= w.m.blast).length - 1 : 0);
                break;
              }
              if (!hit) continue;
              out += (w.m.dmg * hit) / (w.m.cycle * u.cycleMul);
              hin += w.m.heat / (w.m.cycle * u.cycleMul);
            }
            let incoming = 0;
            for (const e of live) {
              const d = map.d(h, e.hex);
              if (d < e.e.minR || d > e.e.maxR + 1) continue;
              if (!map.sees(h, e.hex)) continue;
              incoming += e.e.dmg;
            }
            const cover = H.coverAt(map, live[0].hex, h);
            const heatPenalty = 1 + Math.max(0, hin + u.s.passiveHeat - u.s.dissip) * 0.55;
            let minD = 99;
            for (const e of live) { const d = map.d(h, e.hex); if (d < minD) minD = d; }
            // Nothing in reach: move toward the range this loadout can actually shoot from,
            // which is not the same as moving as close as possible.
            let sc = out > 0
              ? out / heatPenalty - incoming * (1 - cover) * 1.5 + cover * 10 + hi * 6
              : -Math.abs(minD - wantR) * 8 + cover * 3;
            if (u.venting) sc = -incoming * 2 + cover * 24 - Math.abs(minD - wantR) * 0.5;
            const avgD = live.reduce((a, e) => a + map.d(h, e.hex), 0) / live.length;
            if (avgD <= 2) sc *= u.doc.closeBias;
            if (avgD >= 5) sc *= u.doc.standoff;
            sc -= field[h] * 0.6;                                // don't wander for marginal gain
            if (sc > bestScore) { bestScore = sc; bestHex = h; }
          }

          /* the pilot decides whether to obey */
          const g = grip(u);
          const closing = map.d(bestHex, live[0].hex) < map.d(u.hex, live[0].hex);
          if (!closing && u.temp.pPush > 0) {
            let pp = u.temp.pPush * (1.6 - g);
            if (wave.ace && u.pilot.temperament === 'reckless') pp *= 1.6;
            if (rng() < clamp(pp, 0, 0.9)) {
              const aim = Math.max(1, wantR - 1);
              const push = consider.filter(h => map.d(h, live[0].hex) < map.d(u.hex, live[0].hex) && map.d(h, live[0].hex) >= aim);
              if (push.length) {
                bestHex = push.sort((a, b) => Math.abs(map.d(a, live[0].hex) - aim) - Math.abs(map.d(b, live[0].hex) - aim))[0];
                u.disobeys++; ev.push({ k: 'defy', u: u.idx, s: `${u.pilot.name} pushes forward against orders` });
              }
            }
          } else if (closing && u.temp.pFlinch > 0) {
            const pf = u.temp.pFlinch * (1.6 - g) + u.trauma / 300;
            if (rng() < clamp(pf, 0, 0.9)) {
              const back = consider.filter(h => map.d(h, live[0].hex) > map.d(u.hex, live[0].hex));
              if (back.length) {
                bestHex = back.sort((a, b) => H.coverAt(map, live[0].hex, b) - H.coverAt(map, live[0].hex, a))[0];
                u.disobeys++; ev.push({ k: 'defy', u: u.idx, s: `${u.pilot.name} refuses to close and takes cover` });
              }
            }
          }

          /* move */
          if (bestHex !== u.hex) {
            u.mp += hexSpeed(u.s) * (u.prop > 0 ? 1 : 0.5);
            let guard = 0;
            while (guard++ < 6) {
              let step = -1, bv = map.d(u.hex, bestHex) * 2 + map.terrain(u.hex).cost;
              for (const nb of H.neighbours(u.hex)) {
                if (occ.has(nb) && nb !== bestHex) continue;
                const v = map.d(nb, bestHex) * 2 + map.terrain(nb).cost;
                if (v < bv) { bv = v; step = nb; }
              }
              if (step < 0) break;
              const cost = map.terrain(step).cost;
              if (u.mp < cost) break;
              occ.delete(u.hex); u.mp -= cost; u.hex = step; occ.add(u.hex); u.moved++;
              u.prop = Math.max(0, u.prop - cost * 0.9 * (u.s.chassis.mass / 50) / (1 + u.s.propEff));
            }
          }
        }
        u.prop = Math.max(0, u.prop - 0.35 * (u.s.chassis.mass / 50));

        /* shoot */
        if (u.shutdown > 0) {
          u.shutdown--;
          if (u.shutdown === 0) ev.push({ k: 'sys', u: u.idx, s: `${u.pilot.name} — reactor online` });
        } else if (!u.venting) {
          const hi = map.terrain(u.hex).high ? 1 : 0;
          const ready = u.weapons
            .filter(w => w.cd <= 0 && (w.ammo === null || w.ammo >= w.m.use))
            .sort((a, b) => (b.m.dmg * (1 + b.m.blast)) / Math.max(b.m.heat, 0.5) - (a.m.dmg * (1 + a.m.blast)) / Math.max(a.m.heat, 0.5));

          for (const w of ready) {
            const gen = u.od > 0 ? 0 : w.m.heat;
            if (u.heat + gen > u.s.heatCap * u.doc.redline && u.od <= 0) continue;
            const live2 = enemies.filter(e => e.hp > 0);
            if (!live2.length) break;

            // pick the aim point: for a blast weapon, the hex catching the most bodies
            // -Infinity, not -1: the score is (bodies × 1000 − target hull), which goes negative
            // against anything over 1000 hull. Starting at -1 made units refuse to shoot the rival.
            let aim = null, aimScore = -Infinity;
            for (const e of live2) {
              const d = map.d(u.hex, e.hex);
              if (d < w.m.minR || d > w.m.maxR + hi + (u.ghost > 0 ? 2 : 0)) continue;
              if (w.m.los && u.ghost <= 0 && !map.sees(u.hex, e.hex)) continue;
              const caught = w.m.blast ? live2.filter(o => map.d(o.hex, e.hex) <= w.m.blast) : [e];
              const sc = caught.length * 1000 - e.hp;
              if (sc > aimScore) { aimScore = sc; aim = { hex: e.hex, targets: caught }; }
            }
            if (!aim) continue;

            // Ammo discipline: don't put a 285-damage bazooka round through an 80-hull grunt
            // when something cheaper is loaded. Scarce ammo is for the thing it was bought for.
            if (w.ammo !== null && aim.targets.length === 1 && w.m.dmg > aim.targets[0].hp * 2.5) {
              const alt = ready.some(o => o !== w && o.cd <= 0 && (o.ammo === null || o.ammo >= o.m.use) &&
                (() => { const d = map.d(u.hex, aim.hex); return d >= o.m.minR && d <= o.m.maxR + hi && (!o.m.los || map.sees(u.hex, aim.hex)); })());
              if (alt) continue;
            }

            let dmgOut = 0, kills = 0;
            const band = bandName(map.d(u.hex, aim.hex));
            for (const tgt of aim.targets) {
              let d = w.m.dmg;
              if (u.surge > 0) d *= 1 + (1 - u.armor / u.s.armorMax) * 0.8;
              if (w.m.dtype === 'beam' && tgt.e.beamResist) d *= (1 - tgt.e.beamResist);
              if (tgt.type === 'ace' && aceCoat && w.m.dtype === 'beam') d *= 0.62;
              const cover = H.coverAt(map, u.hex, tgt.hex);
              const upHill = map.terrain(tgt.hex).high && !map.terrain(u.hex).high ? 0.12 : 0;
              const shot = { from: u.hex, to: tgt.hex, dtype: w.m.dtype, blast: w.m.blast, side: 'p' };
              if (rng() < clamp(tgt.e.evade + cover + upHill, 0, 0.85)) {
                ev.push({ k: 'miss', u: u.idx, shot: Object.assign({ missed: true }, shot),
                  s: `${w.m.name} — ${cover > 0 ? 'blocked by cover' : 'target evaded'}` });
                continue;
              }
              tgt.hp -= d; dmgOut += d;
              ev.push({ k: 'fx', shot: Object.assign({ dmg: Math.round(d) }, shot) });
              if (tgt.hp <= 0) { kills++; u.kills++; ev.push({ k: 'fx', boom: tgt.hex, big: tgt.type === 'ace' }); }
            }
            dealt[w.m.dtype] += dmgOut; dealt[band] += dmgOut;
            if (w.m.blast && wave.populated) areaShots++;
            u.heat += gen; w.cd = w.m.cycle * u.cycleMul; w.fired++;
            if (w.ammo !== null) w.ammo -= w.m.use;
            if (kills) ev.push({ k: 'kill', u: u.idx, s: `${u.pilot.name}: ${w.m.name} — ${kills} destroyed` });
            else if (dmgOut) ev.push({ k: 'hit', u: u.idx, s: `${u.pilot.name}: ${w.m.name} — ${Math.round(dmgOut)}` });
            if (w.ammo !== null && w.ammo < w.m.use) ev.push({ k: 'warn', u: u.idx, s: `${u.pilot.name}: ${w.m.name} dry` });
          }
        }
      }

      /* ---- the regime moves and shoots ---- */
      {
        const occ = occupied();
        for (const e of enemies) {
          if (e.hp <= 0) continue;
          const targets = units.filter(u => !u.dead);
          if (!targets.length) break;
          let tgt = targets[0], td = map.d(e.hex, tgt.hex);
          for (const u of targets) { const d = map.d(e.hex, u.hex); if (d < td) { td = d; tgt = u; } }

          // walk toward the reach we want; artillery backs out of its own dead zone
          const wantMin = e.e.minR, wantMax = e.e.maxR;
          const needsMove = td > wantMax || td < wantMin || !map.sees(e.hex, tgt.hex);
          if (needsMove) {
            e.mp += e.e.speed;
            let guard = 0;
            while (guard++ < 4 && e.mp >= 1) {
              let step = -1, best = Infinity;
              for (const nb of H.neighbours(e.hex)) {
                if (occ.has(nb)) continue;
                const d = map.d(nb, tgt.hex);
                const miss = d < wantMin ? (wantMin - d) * 2 : d > wantMax ? (d - wantMax) : 0;
                const blind = map.sees(nb, tgt.hex) ? 0 : 1.5;
                const score = miss + blind;
                if (score < best) { best = score; step = nb; }
              }
              const curD = map.d(e.hex, tgt.hex);
              const curMiss = (curD < wantMin ? (wantMin - curD) * 2 : curD > wantMax ? (curD - wantMax) : 0) + (map.sees(e.hex, tgt.hex) ? 0 : 1.5);
              if (step < 0 || best >= curMiss) break;
              const cost = map.terrain(step).cost;
              if (e.mp < cost) break;
              occ.delete(e.hex); e.mp -= cost; e.hex = step; occ.add(e.hex);
            }
          }

          const d = map.d(e.hex, tgt.hex);
          if (d < e.e.minR || d > e.e.maxR || !map.sees(e.hex, tgt.hex)) continue;
          const cover = H.coverAt(map, e.hex, tgt.hex);
          let evade = tgt.shutdown > 0 ? 0.05 : (tgt.prop <= 0 ? 0.05 : tgt.s.evade);
          if (tgt.anchor > 0) evade = Math.min(0.85, evade + 0.30);
          evade = Math.min(0.90, evade + cover);
          const blk = Math.min(0.80, tgt.s.block + (tgt.anchor > 0 ? 0.25 : 0));
          const taken = e.e.dmg * (1 - evade) * (1 - blk);
          tgt.armor -= taken;
          ev.push({ k: 'efire', shot: { from: e.hex, to: tgt.hex, dtype: 'enemy', blast: 0, side: 'e', dmg: Math.round(taken) } });
          tgt.charge = Math.min(100, tgt.charge + (taken / tgt.s.armorMax) * 300);
          const frac = tgt.armor / tgt.s.armorMax;
          if (frac < 0.5 && tgt.hurtMarks < 1) { tgt.hurtMarks = 1; tgt.trauma = Math.min(100, tgt.trauma + 8 * tgt.temp.traumaGain); }
          if (frac < 0.25 && tgt.hurtMarks < 2) { tgt.hurtMarks = 2; tgt.trauma = Math.min(100, tgt.trauma + 12 * tgt.temp.traumaGain); }
        }
      }

      /* ---- thermal ---- */
      for (const u of units) {
        if (u.dead) continue;
        u.charge = Math.min(100, u.charge + 1.5);   // nerve builds under fire as well as from it
        if (u.od > 0) u.od--; if (u.ghost > 0) u.ghost--; if (u.surge > 0) u.surge--; if (u.anchor > 0) u.anchor--;
        u.heat += u.s.passiveHeat;
        u.peakHeat = Math.max(u.peakHeat, u.heat / u.s.heatCap);
        if (u.heat >= u.s.heatCap && u.shutdown <= 0) {
          u.shutdown = 3; u.overheats++; u.heat = u.s.heatCap;
          ev.push({ k: 'crit', u: u.idx, s: `${u.pilot.name} — OVERHEAT, reactor scram` });
        }
        u.heat = Math.max(0, u.heat - u.s.dissip * (u.shutdown > 0 ? 1.5 : 1));
        for (const w of u.weapons) if (w.cd > 0) w.cd--;
      }

      /* ---- signatures ---- */
      for (const u of units) {
        if (u.dead || u.sigUsed || u.shutdown > 0) continue;
        if (sigOrders.some(o => o.u === u.idx && t >= o.t)) { fireSig(u, ev); continue; }
        if (!autoSig) continue;
        if (u.pilot.sigPolicy === 'legacyHeat') { if (wave.ace && u.heat / u.s.heatCap > 0.72) fireSig(u, ev); }
        else if (u.charge >= 100 && (wave.ace || u.armor / u.s.armorMax < 0.5)) fireSig(u, ev);
      }

      /* ---- losses ---- */
      for (const u of units) {
        if (u.dead || u.armor > 0) continue;
        u.dead = true; u.deadAt = t; u.armor = 0;
        u.cause = u.prop <= 0 ? 'OUT OF PROPELLANT' : u.overheats > 0 ? 'THERMAL COLLAPSE' : 'HULL BREACH';
        ev.push({ k: 'down', u: u.idx, boom: u.hex, big: true, s: `${u.pilot.name} IS DOWN — ${u.cause}` });
        for (const o of units) if (!o.dead) o.trauma = Math.min(100, o.trauma + 14 * o.temp.traumaGain);
      }

      if (!opts.noFrames) frames.push({
        t, wave: wi, waveLabel: wave.label,
        alive: enemies.filter(e => e.hp > 0).length, total: enemies.length,
        aceHp: wave.ace ? Math.max(0, enemies[0].hp) : null,
        aceMax: wave.ace ? enemies[0].max : null, aceCoat, aceBoost,
        enemies: enemies.filter(e => e.hp > 0).map(e => ({ hex: e.hex, type: e.type, hp: e.hp, max: e.max, name: e.e.name })),
        units: units.map(u => ({
          name: u.pilot.name, dead: u.dead, hex: u.hex,
          armor: Math.max(0, u.armor), armorMax: u.s.armorMax,
          heat: u.heat, heatCap: u.s.heatCap, prop: u.prop, propMax: u.s.propMax,
          shutdown: u.shutdown > 0, venting: u.venting, charge: u.charge, sigUsed: u.sigUsed,
          sigOn: u.od > 0 || u.ghost > 0 || u.surge > 0 || u.anchor > 0, trauma: u.trauma,
          ammo: u.weapons.map(w => ({ name: w.m.name, ammo: w.ammo, max: w.ammo0 })),
        })),
        ev,
      });

      if (units.every(u => u.dead)) {
        result = { ok: false, reason: 'SQUAD DESTROYED — ' + (units[units.length - 1].cause || 'HULL BREACH'), wave: wi };
        break;
      }
    }
    if (!result && enemies.some(e => e.hp > 0) && units.some(u => !u.dead))
      result = { ok: false, reason: 'SORTIE TIMED OUT — COULD NOT FINISH THE WAVE', wave: wi };
  }

  if (!result) result = { ok: true, wave: waves.length - 1,
    reason: units.some(u => u.dead) ? 'OBJECTIVE TAKEN — WITH LOSSES' : 'RIVAL DRIVEN OFF — SORTIE COMPLETE' };

  const u0 = units[0];
  const ammoSpent = units.reduce((a, u) => a + u.weapons.filter(w => w.ammo0 !== null).reduce((x, w) => x + (w.ammo0 - w.ammo), 0), 0);
  const ammoTotal = units.reduce((a, u) => a + u.weapons.filter(w => w.ammo0 !== null).reduce((x, w) => x + w.ammo0, 0), 0);

  return {
    ok: result.ok, reason: result.reason, failedWave: result.ok ? null : result.wave,
    ticks: t, frames, units, map, stats: u0.s, weapons: u0.weapons,
    armorLeft: Math.max(0, u0.armor), armorMax: u0.s.armorMax,
    propLeft: u0.prop, propMax: u0.s.propMax,
    peakHeat: u0.peakHeat, overheats: units.reduce((a, u) => a + u.overheats, 0),
    ammoSpent, ammoTotal, dealt, areaShots,
    losses: units.filter(u => u.dead).map(u => ({ name: u.pilot.name, id: u.pilot.id, at: u.deadAt, cause: u.cause, frame: u.frame })),
    survivors: units.filter(u => !u.dead).map(u => ({
      name: u.pilot.name, id: u.pilot.id, hull: u.armor / u.s.armorMax, frame: u.frame,
      kills: u.kills, disobeys: u.disobeys, trauma: u.trauma, overheats: u.overheats, moved: u.moved })),
  };
}

function simulate(build, seed, opts = {}) {
  return simulateSortie([{ build, pilot: AUTOPILOT }], WAVES, seed, opts);
}

/* ---------- reference builds for the balance runner ---------- */

/* Presets found by presets.js searching the legal build space — each is the strongest build
   for one chassis x lead-weapon corner, so they are distinct strategies that verifiably work. */
const ARCHETYPES = [
  { key: 'knife',  name: 'KNIFE FIGHTER', doctrine: 'aggressive', chassis: 'wasp',    mods: ['beam_saber', 'scatter', 'radiator', 'thruster', 'hopper'],
    blurb: 'Crosses open ground fast and kills inside the artillery minimum.' },
  { key: 'interc', name: 'INTERCEPTOR',   doctrine: 'aggressive', chassis: 'wasp',    mods: ['beam_rifle', 'missiles', 'hopper'],
    blurb: 'No radiator. Runs hot on purpose and scrams about twice a sortie.' },
  { key: 'line',   name: 'LINE MECH',     doctrine: 'aggressive', chassis: 'halberd', mods: ['beam_rifle', 'missiles', 'radiator', 'hopper'],
    blurb: 'The doctrinal answer. Nothing spectacular, nothing missing.' },
  { key: 'duel',   name: 'DUELIST',       doctrine: 'measured',   chassis: 'halberd', mods: ['beam_saber', 'missiles', 'radiator', 'bshield', 'hopper'],
    blurb: 'Softens the wave at range, then closes for the ace.' },
  { key: 'lance',  name: 'HEAVY LANCE',   doctrine: 'aggressive', chassis: 'bulwark', mods: ['beam_rifle', 'missiles', 'radiator', 'thruster', 'hopper'],
    blurb: 'A heavy frame that bought back its mobility.' },
  { key: 'sat',    name: 'SATURATION',    doctrine: 'aggressive', chassis: 'bulwark', mods: ['missiles', 'scatter', 'thruster', 'bshield', 'hopper'],
    blurb: 'All kinetic. The anti-beam coating means nothing to it.' },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHASSIS, MODULES, MOD, ENEMIES, WAVES, DOCTRINES, ARCHETYPES, TEMPERAMENTS, SIGNATURES, AUTOPILOT,
    buildStats, simulate, simulateSortie, makeUnit, placeWave, hexSpeed, preferredRange, mulberry32, clamp, H };
}
