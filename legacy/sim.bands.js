'use strict';
/* SORTIE — deterministic combat sim.
   No DOM, no randomness outside the seeded PRNG. Same build + same seed = same sortie.
   Shared verbatim between the browser prototype and the headless balance runner. */

const CHASSIS = {
  wasp:    { name: 'WASP',    cls: 'LIGHT',  mass: 44, power: 44, heatCap: 95,  dissip: 9.0, armor: 400, evade: 0.46, prop: 130, speed: 12.0 },
  halberd: { name: 'HALBERD', cls: 'MEDIUM', mass: 50, power: 52, heatCap: 125, dissip: 8.0, armor: 560, evade: 0.26, prop: 104, speed: 8.0 },
  bulwark: { name: 'BULWARK', cls: 'HEAVY',  mass: 56, power: 68, heatCap: 150, dissip: 6.5, armor: 640, evade: 0.10, prop: 66,  speed: 5.5 },
};

/* kind: 'w' weapon, 's' support.
   bands: where the weapon can be used. targets: max bodies hit (area weapons).
   use: ammo consumed per activation. cycle: ticks between activations. */
const MODULES = [
  { id: 'beam_rifle', name: 'BEAM RIFLE',     kind: 'w', mass: 12, power: 30, heat: 10, dmg: 95,  dtype: 'beam',    bands: ['LONG', 'MID'],   targets: 1, ammo: null, use: 0, cycle: 1,
    note: 'One-shots a grunt at any range. Cooks you if you hold the trigger.' },
  { id: 'beam_saber', name: 'BEAM SABER',     kind: 'w', mass: 6,  power: 20, heat: 12, dmg: 165, dtype: 'beam',    bands: ['KNIFE'],         targets: 1, ammo: null, use: 0, cycle: 1,
    note: 'Cheapest kill in the game. You have to survive the walk in.' },
  { id: 'mg',         name: 'MACHINE CANNON', kind: 'w', mass: 9,  power: 4,  heat: 3,  dmg: 32,  dtype: 'kinetic', bands: ['MID', 'KNIFE'],  targets: 1, ammo: 320, use: 8, cycle: 1,
    note: 'Almost no heat. Runs dry exactly when you need it.' },
  { id: 'missiles',   name: 'MISSILE POD',    kind: 'w', mass: 16, power: 6,  heat: 12, dmg: 68,  dtype: 'kinetic', bands: ['LONG', 'MID'],   targets: 5, ammo: 30,  use: 3, cycle: 2,
    note: 'Deletes tight formations. Wasted on skirmishers.' },
  { id: 'bazooka',    name: 'BAZOOKA',        kind: 'w', mass: 14, power: 3,  heat: 16, dmg: 285, dtype: 'kinetic', bands: ['LONG', 'MID'],   targets: 1, ammo: 10,  use: 1, cycle: 3,
    note: 'Eight rounds. Bring them to the ace, not the chaff.' },
  { id: 'scatter',    name: 'SCATTER GUN',    kind: 'w', mass: 11, power: 5,  heat: 10, dmg: 68,  dtype: 'kinetic', bands: ['KNIFE'],         targets: 3, ammo: 56,  use: 2, cycle: 1,
    note: 'Knife-range crowd control for pilots who commit.' },

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
   before the only enemy that can actually beat you launches. */
const ENEMIES = {
  grunt: { name: 'GRUNT',      armor: 80,  dps: { LONG: 1.0, MID: 2.2, KNIFE: 1.8 }, evade: 0.05 },
  arty:  { name: 'ARTILLERY',  armor: 65,  dps: { LONG: 11.0, MID: 3.5, KNIFE: 0.0 }, evade: 0.02 },
  skirm: { name: 'SKIRMISHER', armor: 64,  dps: { LONG: 1.4, MID: 3.0, KNIFE: 2.8 }, evade: 0.22, beamResist: 0.40 },
  ace:   { name: 'ACE',        armor: 760, dps: { LONG: 30,  MID: 25,  KNIFE: 24 },  evade: 0.32 },
};

/* spread 0..1 — how loose the formation is. Area weapons hit fewer bodies as it climbs. */
const WAVES = [
  { label: 'CONTACT',   groups: [{ type: 'grunt', n: 12 }], spread: 0.55 },
  { label: 'RIDGELINE', groups: [{ type: 'grunt', n: 8 }, { type: 'arty', n: 3 }], spread: 0.20 },
  { label: 'HARRIERS',  groups: [{ type: 'skirm', n: 10 }, { type: 'arty', n: 1 }], spread: 0.85 },
  { label: 'THE ACE',   groups: [{ type: 'ace', n: 1 }], spread: 0.00, ace: true },
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

function makeUnit(entry, idx) {
  const st = buildStats(entry.build);
  const p = entry.pilot || AUTOPILOT;
  const temp = Object.assign({}, TEMPERAMENTS[p.temperament] || TEMPERAMENTS.tempered);
  if (p.pPush != null) temp.pPush = p.pPush;         // AUTOPILOT zeroes these so it burns no RNG
  if (p.pFlinch != null) temp.pFlinch = p.pFlinch;
  return {
    idx, pilot: p, temp, s: st, doc: DOCTRINES[entry.build.doctrine || 'measured'],
    frame: entry.frame || null, integrity: entry.integrity == null ? 1 : entry.integrity,
    nerve: p.nerve == null ? 70 : p.nerve, trauma: p.trauma || 0, fatigue: p.fatigue || 0,
    armor: st.armorMax * (entry.integrity == null ? 1 : entry.integrity), heat: 0, prop: st.propMax, dist: 100, band: 'LONG',
    shutdown: 0, venting: false, overheats: 0, peakHeat: 0,
    od: 0, ghost: 0, surge: 0, anchor: 0, sigUsed: false, charge: 0,
    dead: false, deadAt: null, kills: 0, disobeys: 0, hurtMarks: 0,
    cycleMul: st.brownout ? 2 : 1,
    weapons: st.weapons.map(w => ({ m: w, cd: 0,
      ammo: w.ammo == null ? null : Math.round(w.ammo * st.ammoMul),
      ammo0: w.ammo == null ? null : Math.round(w.ammo * st.ammoMul), fired: 0 })),
  };
}

function grip(u) { return clamp((u.nerve - u.trauma * 0.6 - u.fatigue * 0.5) / 100, 0.05, 1); }

/* ---------- sortie ----------
   squad: [{ build, pilot }]. waves: wave list (the campaign generates escalating ones).
   Deterministic: same squad + same waves + same seed = same sortie, every time. */

function simulateSortie(squad, waves, seed, opts = {}) {
  waves = waves || WAVES;
  const rng = mulberry32(seed >>> 0);
  const frames = [];
  const units = squad.map(makeUnit);

  const bad = units.find(u => !u.s.valid);
  if (bad) return { ok: false, invalid: true, units, frames, stats: bad.s,
    reason: bad.s.overMass ? 'OVER MASS BUDGET' : 'NO WEAPON FITTED' };

  const sigOrders = opts.sigOrders || (opts.overdriveAt != null ? [{ u: 0, t: opts.overdriveAt }] : []);
  const autoSig = opts.autoSig !== false && opts.autoOverdrive !== false && opts.overdriveAt == null;
  const dealt = { beam: 0, kinetic: 0, KNIFE: 0, MID: 0, LONG: 0 };
  let areaShots = 0;
  let t = 0, result = null;

  const fireSig = (u, ev) => {
    u.sigUsed = true; u.charge = 0;
    const sig = SIGNATURES[u.pilot.signature] || SIGNATURES.overdrive;
    if (u.pilot.signature === 'anchor') for (const o of units) { if (!o.dead) o.anchor = sig.dur; }
    else if (u.pilot.signature === 'ghost') u.ghost = sig.dur;
    else if (u.pilot.signature === 'surge') u.surge = sig.dur;
    else u.od = sig.dur;
    ev.push({ k: 'sig', u: u.idx, s: `${u.pilot.name} — ${sig.name}` });
  };

  for (let wi = 0; wi < waves.length && !result; wi++) {
    const wave = waves[wi];
    const enemies = [];
    for (const g of wave.groups) {
      const base = g.stats || ENEMIES[g.type];
      for (let i = 0; i < g.n; i++) enemies.push({ type: g.type, hp: base.armor, max: base.armor, e: base });
    }

    // The rival studied what you did. The campaign can force a counter it already learned.
    let aceCoat = false, aceBoost = false;
    if (wave.ace) {
      const total = dealt.beam + dealt.kinetic || 1;
      aceCoat = wave.forceCoat != null ? wave.forceCoat : dealt.beam / total > 0.55;
      aceBoost = wave.forceBoost != null ? wave.forceBoost : dealt.KNIFE / total > 0.70;
    }

    for (const u of units) { u.dist = 100; u.heat *= 0.75; }
    let waveTicks = 0;

    while (waveTicks < 220) {
      t++; waveTicks++;
      const ev = [];
      if (!enemies.some(e => e.hp > 0)) break;
      const liveUnits = units.filter(u => !u.dead);
      if (!liveUnits.length) break;

      for (const u of liveUnits) {
        const alive = enemies.filter(e => e.hp > 0);
        if (!alive.length) break;

        /* --- 1. doctrine picks a band --- */
        const heatFrac = u.heat / u.s.heatCap;
        if (heatFrac >= u.doc.ventAt) u.venting = true;
        if (u.venting && heatFrac < 0.45) u.venting = false;

        let want;
        if (u.shutdown > 0 || u.venting) want = 'LONG';
        else {
          let best = null, bestScore = -Infinity;
          for (const b of ['LONG', 'MID', 'KNIFE']) {
            let out = 0, hin = 0;
            for (const w of u.weapons) {
              if (!w.m.bands.includes(b)) continue;
              if (w.ammo !== null && w.ammo < w.m.use) continue;
              const eff = Math.max(1, Math.round(w.m.targets * (1 - wave.spread * 0.8)));
              out += (w.m.dmg * eff) / (w.m.cycle * u.cycleMul);
              hin += w.m.heat / (w.m.cycle * u.cycleMul);
            }
            if (out <= 0) continue;
            const incoming = alive.reduce((a, e) => a + e.e.dps[b], 0);
            const heatPenalty = 1 + Math.max(0, (hin + u.s.passiveHeat - u.s.dissip)) * 0.55;
            let score = out / heatPenalty - incoming * 1.6;
            if (b === 'KNIFE') score *= u.doc.closeBias;
            if (b === 'LONG') score *= u.doc.standoff;
            if (b !== 'LONG' && u.prop <= 0) score *= 0.4;
            if (score > bestScore) { bestScore = score; best = b; }
          }
          want = best || 'LONG';
        }

        /* --- 1b. the pilot decides whether to obey it --- */
        const g = grip(u);
        if (want === 'LONG' && u.temp.pPush > 0 && u.shutdown <= 0) {
          let p = u.temp.pPush * (1.6 - g);
          if (wave.ace && u.pilot.temperament === 'reckless') p *= 1.6;
          if (rng() < clamp(p, 0, 0.9)) {
            const close = u.weapons.some(w => w.m.bands.includes('KNIFE'));
            want = close ? 'KNIFE' : 'MID'; u.disobeys++;
            ev.push({ k: 'defy', u: u.idx, s: `${u.pilot.name} ignores the break-off order` });
          }
        } else if (want === 'KNIFE' && u.temp.pFlinch > 0 && u.shutdown <= 0) {
          const p = u.temp.pFlinch * (1.6 - g) + u.trauma / 300;
          if (rng() < clamp(p, 0, 0.9)) {
            want = 'MID'; u.disobeys++;
            ev.push({ k: 'defy', u: u.idx, s: `${u.pilot.name} breaks off instead of closing` });
          }
        }

        /* --- 2. move and burn --- */
        const dry = u.prop <= 0;
        const spd = u.s.speed * (dry ? 0.5 : 1);
        let delta = clamp(bandCenter(want) - u.dist, -spd, spd);
        if (aceBoost && delta < 0) delta *= 0.65;
        if (delta !== 0) {
          u.dist = clamp(u.dist + delta, 0, 100);
          u.prop = Math.max(0, u.prop - Math.abs(delta) * 0.11 * (u.s.chassis.mass / 50) / (1 + u.s.propEff));
        }
        u.prop = Math.max(0, u.prop - 0.35 * (u.s.chassis.mass / 50));
        u.band = bandOf(u.dist);

        /* --- 3. fire --- */
        if (u.shutdown > 0) {
          u.shutdown--;
          if (u.shutdown === 0) ev.push({ k: 'sys', u: u.idx, s: `${u.pilot.name} — reactor online` });
        } else if (!u.venting) {
          const ready = u.weapons
            .filter(w => w.cd <= 0 && (u.ghost > 0 || w.m.bands.includes(u.band)) && (w.ammo === null || w.ammo >= w.m.use))
            .sort((a, b) => (b.m.dmg * b.m.targets) / Math.max(b.m.heat, 0.5) - (a.m.dmg * a.m.targets) / Math.max(a.m.heat, 0.5));

          for (const w of ready) {
            const gen = u.od > 0 ? 0 : w.m.heat;
            if (u.heat + gen > u.s.heatCap * u.doc.redline && u.od <= 0) continue;
            const live = enemies.filter(e => e.hp > 0);
            if (!live.length) break;

            const eff = Math.max(1, Math.round(w.m.targets * (1 - wave.spread * 0.8)));
            const picks = live.sort((a, b) => a.hp - b.hp).slice(0, eff);
            let dmgOut = 0, kills = 0;
            for (const tgt of picks) {
              let d = w.m.dmg;
              if (u.surge > 0) d *= 1 + (1 - u.armor / u.s.armorMax) * 0.8;
              if (w.m.dtype === 'beam' && tgt.e.beamResist) d *= (1 - tgt.e.beamResist);
              if (tgt.type === 'ace' && aceCoat && w.m.dtype === 'beam') d *= 0.42;
              if (rng() < tgt.e.evade) { ev.push({ k: 'miss', u: u.idx, s: `${w.m.name} — target evaded` }); continue; }
              tgt.hp -= d; dmgOut += d;
              if (tgt.hp <= 0) { kills++; u.kills++; }
            }
            dealt[w.m.dtype] += dmgOut; dealt[u.band] += dmgOut;
            if (w.m.targets > 1 && wave.populated) areaShots++;
            u.heat += gen; w.cd = w.m.cycle * u.cycleMul; w.fired++;
            if (w.ammo !== null) w.ammo -= w.m.use;
            if (kills) ev.push({ k: 'kill', u: u.idx, s: `${u.pilot.name}: ${w.m.name} — ${kills} destroyed` });
            else if (dmgOut) ev.push({ k: 'hit', u: u.idx, s: `${u.pilot.name}: ${w.m.name} — ${Math.round(dmgOut)}` });
            if (w.ammo !== null && w.ammo < w.m.use) ev.push({ k: 'warn', u: u.idx, s: `${u.pilot.name}: ${w.m.name} dry` });
          }
        }
      }

      /* --- 4. incoming, split by how much attention each pilot has drawn --- */
      const live = enemies.filter(e => e.hp > 0);
      const shooters = units.filter(u => !u.dead);
      const wts = shooters.map(u => 1 + (u.band === 'KNIFE' ? 1.2 : u.band === 'MID' ? 0.5 : 0));
      const wSum = wts.reduce((a, b) => a + b, 0) || 1;
      shooters.forEach((u, i) => {
        const raw = live.reduce((a, e) => a + e.e.dps[u.band], 0) * (wts[i] / wSum);
        const dry = u.prop <= 0;
        let ev2 = u.shutdown > 0 ? 0.05 : (dry ? 0.05 : u.s.evade);
        if (u.anchor > 0) ev2 = Math.min(0.85, ev2 + 0.30);
        const blk = Math.min(0.80, u.s.block + (u.anchor > 0 ? 0.25 : 0));
        const taken = raw * (1 - ev2) * (1 - blk);
        u.armor -= taken;
        u.charge = Math.min(100, u.charge + (taken / u.s.armorMax) * 130);
        const frac = u.armor / u.s.armorMax;                      // fear compounds as the hull opens up
        if (frac < 0.5 && u.hurtMarks < 1) { u.hurtMarks = 1; u.trauma = Math.min(100, u.trauma + 8 * u.temp.traumaGain); }
        if (frac < 0.25 && u.hurtMarks < 2) { u.hurtMarks = 2; u.trauma = Math.min(100, u.trauma + 12 * u.temp.traumaGain); }
      });

      /* --- 5. thermal --- */
      for (const u of units) {
        if (u.dead) continue;
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

      /* --- 6. signatures --- */
      for (const u of units) {
        if (u.dead || u.sigUsed || u.shutdown > 0) continue;
        if (sigOrders.some(o => o.u === u.idx && t >= o.t)) { fireSig(u, ev); continue; }
        if (!autoSig) continue;
        if (u.pilot.sigPolicy === 'legacyHeat') {
          if (wave.ace && u.heat / u.s.heatCap > 0.72) fireSig(u, ev);
        } else if (u.charge >= 100 && (wave.ace || u.armor / u.s.armorMax < 0.5)) fireSig(u, ev);
      }

      /* --- 7. losses --- */
      for (const u of units) {
        if (u.dead || u.armor > 0) continue;
        u.dead = true; u.deadAt = t; u.armor = 0;
        u.cause = u.prop <= 0 ? 'OUT OF PROPELLANT' : u.overheats > 0 ? 'THERMAL COLLAPSE' : 'HULL BREACH';
        ev.push({ k: 'down', u: u.idx, s: `${u.pilot.name} IS DOWN — ${u.cause}` });
        for (const o of units) if (!o.dead) o.trauma = Math.min(100, o.trauma + 14 * o.temp.traumaGain);
      }

      if (!opts.noFrames) frames.push({
        t, wave: wi, waveLabel: wave.label,
        alive: enemies.filter(e => e.hp > 0).length, total: enemies.length,
        aceHp: wave.ace ? Math.max(0, enemies[0].hp) : null,
        aceMax: wave.ace ? enemies[0].max : null,
        aceCoat, aceBoost,
        units: units.map(u => ({
          name: u.pilot.name, dead: u.dead, dist: u.dist, band: u.band,
          armor: Math.max(0, u.armor), armorMax: u.s.armorMax,
          heat: u.heat, heatCap: u.s.heatCap, prop: u.prop, propMax: u.s.propMax,
          shutdown: u.shutdown > 0, venting: u.venting, charge: u.charge, sigUsed: u.sigUsed,
          sigOn: u.od > 0 || u.ghost > 0 || u.surge > 0 || u.anchor > 0,
          trauma: u.trauma,
          ammo: u.weapons.map(w => ({ name: w.m.name, ammo: w.ammo, max: w.ammo0 })),
        })),
        ev,
      });

      if (units.every(u => u.dead)) {
        result = { ok: false, reason: 'SQUAD DESTROYED — ' + (units[units.length - 1].cause || 'HULL BREACH'), wave: wi };
        break;
      }
    }
    if (!result && enemies.some(e => e.hp > 0) && units.some(u => !u.dead)) {
      result = { ok: false, reason: 'SORTIE TIMED OUT — COULD NOT FINISH THE WAVE', wave: wi };
    }
  }

  if (!result) result = { ok: true, wave: waves.length - 1,
    reason: units.some(u => u.dead) ? 'OBJECTIVE TAKEN — WITH LOSSES' : 'ACE DOWN — SORTIE COMPLETE' };

  const u0 = units[0];
  for (const u of units) u.hullLeft = u.dead ? 0 : u.armor / u.s.armorMax;
  const ammoSpent = units.reduce((a, u) => a + u.weapons.filter(w => w.ammo0 !== null).reduce((x, w) => x + (w.ammo0 - w.ammo), 0), 0);
  const ammoTotal = units.reduce((a, u) => a + u.weapons.filter(w => w.ammo0 !== null).reduce((x, w) => x + w.ammo0, 0), 0);

  return {
    ok: result.ok, reason: result.reason, failedWave: result.ok ? null : result.wave,
    ticks: t, frames, units, stats: u0.s, weapons: u0.weapons,
    armorLeft: Math.max(0, u0.armor), armorMax: u0.s.armorMax,
    propLeft: u0.prop, propMax: u0.s.propMax,
    peakHeat: u0.peakHeat, overheats: units.reduce((a, u) => a + u.overheats, 0),
    ammoSpent, ammoTotal, dealt, areaShots,
    losses: units.filter(u => u.dead).map(u => ({ name: u.pilot.name, id: u.pilot.id, at: u.deadAt, cause: u.cause, frame: u.frame })),
    survivors: units.filter(u => !u.dead).map(u => ({
      name: u.pilot.name, id: u.pilot.id, hull: u.armor / u.s.armorMax, frame: u.frame,
      kills: u.kills, disobeys: u.disobeys, trauma: u.trauma, overheats: u.overheats })),
  };
}

/* Single-unit wrapper. AUTOPILOT never disobeys, so it consumes no extra RNG and every
   number the balance tooling produced still holds. */
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
    buildStats, simulate, simulateSortie, makeUnit, bandOf, mulberry32, clamp };
}
