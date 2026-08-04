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

/* ---------- sortie ---------- */

function simulate(build, seed, opts = {}) {
  const s = buildStats(build);
  const doc = DOCTRINES[build.doctrine || 'measured'];
  const rng = mulberry32(seed >>> 0);
  const frames = [];

  if (!s.valid) {
    return { ok: false, invalid: true, reason: s.overMass ? 'OVER MASS BUDGET' : 'NO WEAPON FITTED', frames, stats: s };
  }

  const st = {
    armor: s.armorMax, heat: 0, prop: s.propMax, dist: 100,
    shutdown: 0, overdriveLeft: 0, overdriveUsed: false,
    venting: false, overheats: 0, peakHeat: 0, t: 0,
  };
  const weapons = s.weapons.map(w => ({
    m: w, cd: 0, ammo: w.ammo == null ? null : Math.round(w.ammo * s.ammoMul),
    ammo0: w.ammo == null ? null : Math.round(w.ammo * s.ammoMul), fired: 0,
  }));
  const cycleMul = s.brownout ? 2 : 1;
  const dealt = { beam: 0, kinetic: 0, KNIFE: 0, MID: 0, LONG: 0 };

  let result = null;

  for (let wi = 0; wi < WAVES.length && !result; wi++) {
    const wave = WAVES[wi];
    const enemies = [];
    for (const g of wave.groups) {
      for (let i = 0; i < g.n; i++) {
        const base = ENEMIES[g.type];
        enemies.push({ type: g.type, hp: base.armor, max: base.armor, e: base });
      }
    }

    // The ace studied your last three waves and brought the counter.
    let aceCoat = false, aceBoost = false;
    if (wave.ace) {
      const totalDmg = dealt.beam + dealt.kinetic || 1;
      const knifeShare = dealt.KNIFE / totalDmg;
      aceCoat = dealt.beam / totalDmg > 0.55;
      aceBoost = knifeShare > 0.70;
      if (aceCoat) enemies[0].hp = enemies[0].max;
    }

    st.dist = 100;
    st.heat *= 0.75; // brief lull between waves — a partial vent, never a reset
    let waveTicks = 0;

    while (waveTicks < 220) {
      st.t++; waveTicks++;
      const ev = [];
      const alive = enemies.filter(e => e.hp > 0);
      if (!alive.length) break;

      /* --- 1. doctrine: pick a band --- */
      const heatFrac = st.heat / s.heatCap;
      if (heatFrac >= doc.ventAt) st.venting = true;
      if (st.venting && heatFrac < 0.45) st.venting = false;

      let want;
      if (st.shutdown > 0) {
        want = 'LONG';
      } else if (st.venting) {
        want = 'LONG';
      } else {
        let best = null, bestScore = -Infinity;
        for (const b of ['LONG', 'MID', 'KNIFE']) {
          let out = 0, hin = 0;
          for (const w of weapons) {
            if (!w.m.bands.includes(b)) continue;
            if (w.ammo !== null && w.ammo < w.m.use) continue;
            const eff = Math.max(1, Math.round(w.m.targets * (1 - wave.spread * 0.8)));
            out += (w.m.dmg * eff) / (w.m.cycle * cycleMul);
            hin += w.m.heat / (w.m.cycle * cycleMul);
          }
          if (out <= 0) continue;
          const incoming = alive.reduce((a, e) => a + e.e.dps[b], 0);
          const heatPenalty = 1 + Math.max(0, (hin + s.passiveHeat - s.dissip)) * 0.55;
          let score = out / heatPenalty - incoming * 1.6;
          if (b === 'KNIFE') score *= doc.closeBias;
          if (b === 'LONG') score *= doc.standoff;
          if (b !== 'LONG' && st.prop <= 0) score *= 0.4; // can't maneuver in close on empty tanks
          if (score > bestScore) { bestScore = score; best = b; }
        }
        want = best || 'LONG';
      }

      /* --- 2. move, spend propellant --- */
      const dry = st.prop <= 0;
      const spd = s.speed * (dry ? 0.5 : 1);
      const target = bandCenter(want);
      let delta = clamp(target - st.dist, -spd, spd);
      if (aceBoost && delta < 0) delta *= 0.65; // the ace keeps backing off out of saber reach
      if (delta !== 0) {
        st.dist = clamp(st.dist + delta, 0, 100);
        const cost = Math.abs(delta) * 0.11 * (s.chassis.mass / 50) / (1 + s.propEff);
        st.prop = Math.max(0, st.prop - cost);
      }
      // Evasive maneuvering burns fuel just to stay alive, and heavy frames burn more of it.
      st.prop = Math.max(0, st.prop - 0.35 * (s.chassis.mass / 50));
      const band = bandOf(st.dist);

      /* --- 3. fire --- */
      if (st.shutdown > 0) {
        st.shutdown--;
        if (st.shutdown === 0) ev.push({ k: 'sys', s: 'REACTOR ONLINE' });
      } else if (!st.venting) {
        const ready = weapons
          .filter(w => w.cd <= 0 && w.m.bands.includes(band) && (w.ammo === null || w.ammo >= w.m.use))
          .sort((a, b) => (b.m.dmg * b.m.targets) / Math.max(b.m.heat, 0.5) - (a.m.dmg * a.m.targets) / Math.max(a.m.heat, 0.5));

        for (const w of ready) {
          const gen = st.overdriveLeft > 0 ? 0 : w.m.heat;
          if (st.heat + gen > s.heatCap * doc.redline && st.overdriveLeft <= 0) continue;
          const live = enemies.filter(e => e.hp > 0);
          if (!live.length) break;

          const eff = Math.max(1, Math.round(w.m.targets * (1 - wave.spread * 0.8)));
          const picks = live.sort((a, b) => a.hp - b.hp).slice(0, eff);
          let dmgOut = 0, kills = 0;
          for (const tgt of picks) {
            let d = w.m.dmg;
            if (w.m.dtype === 'beam' && tgt.e.beamResist) d *= (1 - tgt.e.beamResist);
            if (tgt.type === 'ace' && aceCoat && w.m.dtype === 'beam') d *= 0.42;
            if (rng() < tgt.e.evade) { ev.push({ k: 'miss', s: `${w.m.name} — target evaded` }); continue; }
            tgt.hp -= d; dmgOut += d;
            if (tgt.hp <= 0) kills++;
          }
          dealt[w.m.dtype] += dmgOut; dealt[band] += dmgOut;
          st.heat += gen; w.cd = w.m.cycle * cycleMul; w.fired++;
          if (w.ammo !== null) w.ammo -= w.m.use;
          if (kills) ev.push({ k: 'kill', s: `${w.m.name} — ${kills} destroyed` });
          else if (dmgOut) ev.push({ k: 'hit', s: `${w.m.name} — ${Math.round(dmgOut)} dmg` });
          if (w.ammo !== null && w.ammo < w.m.use) ev.push({ k: 'warn', s: `${w.m.name} DRY` });
        }
      }

      /* --- 4. incoming --- */
      const live = enemies.filter(e => e.hp > 0);
      const rawIn = live.reduce((a, e) => a + e.e.dps[band], 0);
      let evade = st.shutdown > 0 ? 0.05 : (dry ? 0.05 : s.evade);
      const taken = rawIn * (1 - evade) * (1 - s.block);
      st.armor -= taken;

      /* --- 5. thermal. Heat spikes on the trigger pull and the scram check reads that spike;
             radiators only pull it back down afterwards. --- */
      if (st.overdriveLeft > 0) st.overdriveLeft--;
      st.heat += s.passiveHeat;
      st.peakHeat = Math.max(st.peakHeat, st.heat / s.heatCap);
      if (st.heat >= s.heatCap && st.shutdown <= 0) {
        st.shutdown = 3; st.overheats++; st.heat = s.heatCap;
        ev.push({ k: 'crit', s: 'OVERHEAT — REACTOR SCRAM, 3 TICKS' });
      }
      st.heat = Math.max(0, st.heat - s.dissip * (st.shutdown > 0 ? 1.5 : 1));
      for (const w of weapons) if (w.cd > 0) w.cd--;

      /* --- 6. overdrive. Manual when the player calls it, otherwise the headless policy:
             save it for the ace and spend it at the redline. --- */
      if (opts.overdriveAt != null) {
        if (!st.overdriveUsed && st.t >= opts.overdriveAt && st.shutdown <= 0) {
          st.overdriveUsed = true; st.overdriveLeft = 4;
          ev.push({ k: 'sig', s: 'SIGNATURE — OVERDRIVE, 4 TICKS OF ZERO HEAT' });
        }
      } else if (opts.autoOverdrive !== false && !st.overdriveUsed && wave.ace &&
          st.heat / s.heatCap > 0.72 && st.shutdown <= 0) {
        st.overdriveUsed = true; st.overdriveLeft = 4;
        ev.push({ k: 'sig', s: 'SIGNATURE — OVERDRIVE, 4 TICKS OF ZERO HEAT' });
      }

      if (!opts.noFrames) frames.push({
        t: st.t, wave: wi, waveLabel: wave.label, dist: st.dist, band,
        heat: st.heat, armor: Math.max(0, st.armor), prop: st.prop,
        alive: enemies.filter(e => e.hp > 0).length, total: enemies.length,
        aceHp: wave.ace ? Math.max(0, enemies[0].hp) : null,
        aceMax: wave.ace ? enemies[0].max : null,
        shutdown: st.shutdown > 0, overdrive: st.overdriveLeft > 0, venting: st.venting,
        ammo: weapons.map(w => ({ name: w.m.name, ammo: w.ammo, max: w.ammo0 })),
        ev,
      });

      if (st.armor <= 0) {
        result = { ok: false, reason: dry ? 'DESTROYED — OUT OF PROPELLANT' : st.overheats > 0 ? 'DESTROYED — THERMAL COLLAPSE' : 'DESTROYED — HULL BREACH', wave: wi };
        break;
      }
    }
    if (!result && enemies.some(e => e.hp > 0)) {
      result = { ok: false, reason: 'SORTIE TIMED OUT — COULD NOT FINISH THE WAVE', wave: wi };
    }
  }

  if (!result) result = { ok: true, reason: 'ACE DOWN — SORTIE COMPLETE', wave: WAVES.length - 1 };

  const ammoSpent = weapons.filter(w => w.ammo0 !== null)
    .reduce((a, w) => a + (w.ammo0 - w.ammo), 0);
  const ammoTotal = weapons.filter(w => w.ammo0 !== null).reduce((a, w) => a + w.ammo0, 0);

  return {
    ok: result.ok, reason: result.reason, failedWave: result.ok ? null : result.wave,
    ticks: st.t, armorLeft: Math.max(0, st.armor), armorMax: s.armorMax,
    propLeft: st.prop, propMax: s.propMax, peakHeat: st.peakHeat, overheats: st.overheats,
    ammoSpent, ammoTotal, frames, stats: s, weapons,
  };
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
  module.exports = { CHASSIS, MODULES, MOD, ENEMIES, WAVES, DOCTRINES, ARCHETYPES, buildStats, simulate, bandOf, mulberry32 };
}
