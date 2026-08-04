'use strict';
/* SORTIE — squad battle resolution on the hex board.
   Deterministic: same armies + same placement + same seed = same battle.

   The counter web lives in one rule: damage is applied to individual machines, and overkill is
   wasted. A Colossus shooting 55-hull Pods throws away most of every shot. Splash weapons hit
   several machines at once, so they shred swarms — and waste themselves on a single big target. */

const H = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./hex.js') : { COLS, ROWS, N_HEX, TERRAIN, id, colOf, rowOf, neighbours, makeMap, buildMap, costField, coverAt, moveCost, passable };
const A = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./army.js') 
  /* Browser: army.js is inlined into the same scope. This list must cover everything this
     file touches — a missing name is invisible to node and fatal in a browser. */
  : { UNITS, U, TECH, T, spec, enemySpec, newGame, income, buy, sell, buyTech, enemyArmy, resolveRound, intel, ROUNDS };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const d6 = rng => 1 + Math.floor(rng() * 6);
const ODDS = { 2: 1, 3: .972, 4: .917, 5: .833, 6: .722, 7: .583, 8: .417, 9: .278, 10: .167, 11: .083, 12: .028 };
const oddsOf = n => ODDS[clamp(Math.round(n), 2, 12)];

/* to-hit target number, same readable stack as before but per squad */
function toHit(att, tgt, map) {
  const mods = [];
  let n = 4;
  mods.push({ why: 'base', v: 4 });
  const dist = map.d(att.hex, tgt.hex);
  const br = att.s.br;
  // high ground extends reach by one, which is what makes a ridge worth the climb
  const bracket = dist <= br[0] ? 0 : dist <= br[1] ? 1 : 2;
  const rm = [0, 1, 3][bracket];
  if (rm) { mods.push({ why: ['short', 'medium', 'long'][bracket] + ' range', v: rm }); n += rm; }
  if (att.movedThisTick) { mods.push({ why: 'you moved', v: 1 }); n += 1; }
  if (tgt.movedThisTick) { mods.push({ why: 'target moved', v: 1 }); n += 1; }
  const hiA = map.terrain(att.hex).high, hiT = map.terrain(tgt.hex).high;
  const cov = H.coverAt(map, att.hex, tgt.hex);
  const cm = cov >= 0.2 ? 2 : cov > 0 ? 1 : 0;
  if (cm && hiA && !hiT) mods.push({ why: 'you see over the cover', v: 0 });   // height negates it
  else if (cm) { mods.push({ why: cm === 2 ? 'heavy cover' : 'cover', v: cm }); n += cm; }
  if (hiA && !hiT) { mods.push({ why: 'high ground', v: -1 }); n -= 1; }
  if (hiT && !hiA) { mods.push({ why: 'uphill', v: 1 }); n += 1; }
  if (tgt.charging) { mods.push({ why: 'target is charging', v: -CHARGE_EXPOSURE }); n -= CHARGE_EXPOSURE; }
  if (att.s.acc) { mods.push({ why: att.s.name.toLowerCase(), v: att.s.acc }); n += att.s.acc; }
  return { need: clamp(n, 2, 12), mods, bracket, dist };
}
const modsText = t => t.mods.map(m => m.why + ' ' + (m.v > 0 ? '+' + m.v : m.v)).join(', ');

function makeSquad(s, side, uid) {
  return {
    uid, side, s, id: s.id, hex: s.hex == null ? -1 : s.hex,
    hp: new Array(s.n).fill(s.hp), nMax: s.n,
    mp: 0, cd: 0, movedThisTick: 0, kills: 0,
    shots: 0, hits: 0, dealt: 0, wasted: 0, idle: 0, idleWhy: {}, tookFrom: {},
    stance: s.stance === 'charge' ? 'charge' : 'hold',
    charging: s.stance === 'charge',      // true until they make contact
    impact: false,                        // the strike on arrival lands once
  };
}

/* CHARGE. Commit to closing and you sprint, but you cannot shoot on the way in and you are far
   easier to hit while you cross open ground. Arrive and the first strike lands at double damage
   with the blade through the armour. Worth it for something already built for knife range;
   suicide for anything that wanted to stay at distance. */
/* High ground is worth taking: it costs 3 movement to climb, and from up there your hits can
   crit — beat the target number by 3 or more and the shot lands double and ignores armour.
   Nothing crits from flat ground, so the ridge is a position, not a bonus. */
/* A crew inside its own minimum range is not helpless, just badly placed: sidearms only, no
   splash, a fraction of the damage. Before this, a Siege Walker hugged by something fast simply
   stood there for forty ticks and died without firing — technically the counter working, but it
   reads as a broken unit. */
const POINT_BLANK_DAMAGE = 0.40;

const CRIT_MARGIN = 3;
const CRIT_DAMAGE = 2.0;

const CHARGE_SPEED = 1.7;
const CHARGE_EXPOSURE = 2;   // to-hit bonus against a squad mid-charge
const IMPACT_DAMAGE = 3.2;
const IMPACT_AP = 2;
const alive = q => q.hp.length;
const wantRange = s => clamp(s.br[0], s.minR, s.maxR);

/* Damage lands on individual machines. Overkill is thrown away — that is the whole counter web. */
function applyDamage(q, dmg, splash, ev) {
  let killed = 0, wasted = 0;
  const targets = Math.min(q.hp.length, 1 + (q.s.splashImmune ? 0 : splash));
  for (let k = 0; k < targets; k++) {
    if (!q.hp.length) break;
    let j = 0;                                  // finish the most damaged machine first
    for (let i = 1; i < q.hp.length; i++) if (q.hp[i] < q.hp[j]) j = i;
    q.hp[j] -= dmg;
    if (q.hp[j] <= 0) { wasted += -q.hp[j]; q.hp.splice(j, 1); killed++; }   // overkill, thrown away
  }
  return { killed, wasted };
}

/* Deterministic placement, exposed so the shop screen can show you exactly where the enemy
   will stand before you spend a credit. Counter-picking is the game; blind counter-picking is not. */
function deployArmy(map, specs, side) {
  const zone = (side === 'p' ? map.deployZone : map.enemyZone).filter(h => !map.terrain(h).blocks);
  const used = new Set(), out = [];
  specs.forEach((sp, i) => {
    if (sp.hex != null && sp.hex >= 0 && zone.includes(sp.hex) && !used.has(sp.hex)) { used.add(sp.hex); out.push(sp.hex); return; }
    let h = zone[Math.floor((i + 1) * zone.length / (specs.length + 1))], guard = 0;
    while (used.has(h) && guard++ < zone.length) h = zone[(zone.indexOf(h) + 1) % zone.length];
    used.add(h); out.push(h);
  });
  return out;
}

function simulateBattle(playerSquads, enemySquads, seed, opts = {}) {
  const rng = mulberry32(seed >>> 0);
  const map = opts.map || H.makeMap(mulberry32((seed ^ 0x9e3779b9) >>> 0), opts.round || 1);
  const frames = [];
  const squads = [];
  playerSquads.forEach((s, i) => squads.push(makeSquad(s, 'p', 'p' + i)));
  enemySquads.forEach((s, i) => squads.push(makeSquad(s, 'e', 'e' + i)));

  // deployment: anything unplaced gets spread across its own zone
  for (const side of ['p', 'e']) {
    const zone = (side === 'p' ? map.deployZone : map.enemyZone).filter(h => !map.terrain(h).blocks);
    const mine = squads.filter(q => q.side === side);
    const used = new Set(mine.filter(q => q.hex >= 0 && zone.includes(q.hex)).map(q => q.hex));
    mine.forEach((q, i) => {
      if (q.hex >= 0 && zone.includes(q.hex) && !map.terrain(q.hex).blocks) return;
      let h = zone[Math.floor((i + 1) * zone.length / (mine.length + 1))];
      let guard = 0;
      while (used.has(h) && guard++ < zone.length) h = zone[(zone.indexOf(h) + 1) % zone.length];
      q.hex = h; used.add(h);
    });
  }

  let t = 0, result = null, quiet = 0;
  const CAP = opts.cap || 140;

  while (t < CAP) {
    t++;
    const ev = [];
    const hpBefore = squads.reduce((a, q) => a + q.hp.reduce((x, y) => x + y, 0), 0);
    const live = squads.filter(q => alive(q) > 0);
    const ps = live.filter(q => q.side === 'p'), es = live.filter(q => q.side === 'e');
    if (!ps.length || !es.length) break;

    const occ = new Set(live.map(q => q.hex));

    for (const q of live) {
      if (!alive(q)) continue;
      q.movedThisTick = 0;
      const foes = (q.side === 'p' ? es : ps).filter(x => alive(x) > 0);
      if (!foes.length) break;

      // pick a target: the one this squad kills most efficiently
      let tgt = foes[0], best = -Infinity;
      for (const f of foes) {
        const d = map.d(q.hex, f.hex);
        const reach = d >= q.s.minR && d <= q.s.maxR + (map.terrain(q.hex).high ? 1 : 0) &&
          (q.s.indirect || map.seesFrom(q.hex, f.hex));
        const eff = Math.min(f.hp.length, 1 + q.s.splash) * Math.min(q.s.dmg, f.s.hp);
        const sc = eff / (1 + d * 0.6) + (reach ? 40 : 0);
        if (sc > best) { best = sc; tgt = f; }
      }

      // move toward the range we actually want
      const want = q.charging ? Math.max(1, q.s.minR) : wantRange(q.s);
      const d0 = map.d(q.hex, tgt.hex);
      if (q.charging && d0 <= Math.max(1, q.s.minR)) { q.charging = false; q.impact = true; }

      const holdingHeight = map.terrain(q.hex).high && !q.charging &&
        d0 >= q.s.minR && d0 <= q.s.maxR + 1 && (q.s.indirect || map.seesFrom(q.hex, tgt.hex));
      /* Artillery is emplaced: it fights from the hex you put it on and never repositions.
         Siege pieces that stroll toward the enemy read as slow brawlers rather than artillery,
         and they walked themselves out of the cover they were placed in. Holding still makes
         the placement the decision, and makes flanking them the answer. */
      const needMove = !q.s.emplaced && !holdingHeight &&
        (d0 > want || d0 < q.s.minR || (!q.s.indirect && !map.seesFrom(q.hex, tgt.hex)));

      if (needMove) {
        /* Pick the best ground within reach, then path to it with a cost field.
           Stepping greedily to the best neighbour looks equivalent and is not: a unit can sit in a
           basin where every adjacent hex scores worse and simply stop forever. Adding impassable
           rock made those basins common — a Lancer squad was found frozen on a ridge four hexes
           from the enemy for an entire battle, never firing a shot. */
        const score = h => {
          const d = map.d(h, tgt.hex);
          const miss = d < q.s.minR ? (q.s.minR - d) * 3 : d > want ? (d - want) : 0;
          const blind = (q.s.indirect || map.seesFrom(h, tgt.hex)) ? 0 : 2;
          const canFire = d >= q.s.minR && d <= q.s.maxR + 1 && (q.s.indirect || map.seesFrom(h, tgt.hex));
          const height = canFire && map.terrain(h).high && !q.charging ? -1.4 : 0;
          return miss + blind + height;
        };
        let dest = q.hex, bestScore = score(q.hex);
        for (let h = 0; h < H.N_HEX; h++) {
          if (!H.passable(map, h) || (occ.has(h) && h !== q.hex)) continue;
          if (map.d(q.hex, h) > 7) continue;
          const v = score(h) + map.d(q.hex, h) * 0.12;   // prefer near ground, all else equal
          if (v < bestScore) { bestScore = v; dest = h; }
        }

        if (dest !== q.hex) {
          const field = H.costField(map, [dest]);
          q.mp += q.s.speed * (q.charging ? CHARGE_SPEED : 1);
          let guard = 0;
          while (guard++ < 6 && q.mp >= 1) {
            let step = -1, bv = field[q.hex];
            for (const nb of H.neighbours(q.hex)) {
              if (occ.has(nb) || !H.passable(map, nb)) continue;
              if (field[nb] < bv) { bv = field[nb]; step = nb; }
            }
            if (step < 0) break;
            const cost = H.moveCost(map, q.hex, step);
            if (q.mp < cost) break;
            occ.delete(q.hex); q.mp -= cost; q.hex = step; occ.add(q.hex); q.movedThisTick++;
          }
        }
      }

      // fire — a squad still crossing the ground cannot shoot
      const idle = why => { q.idle++; q.idleWhy[why] = (q.idleWhy[why] || 0) + 1; };
      if (q.charging) { idle('still closing'); continue; }
      if (q.cd > 0) { q.cd--; idle('reloading'); continue; }
      const d = map.d(q.hex, tgt.hex);
      const reachBonus = map.terrain(q.hex).high ? 1 : 0;
      const pointBlank = d < q.s.minR;
      if (pointBlank && !map.seesFrom(q.hex, tgt.hex)) { idle('enemy inside its minimum range'); continue; }
      if (d > q.s.maxR + reachBonus) { idle('nothing in range'); continue; }
      if (!q.s.indirect && !map.seesFrom(q.hex, tgt.hex)) { idle('no clear line of sight'); continue; }

      const th = toHit(q, tgt, map);
      const shots = alive(q);
      const impact = q.impact;
      q.impact = false;
      const elevated = map.terrain(q.hex).high && !pointBlank;
      // real 2d6 per shot rather than a coin weighted by the odds — the margin is what crits
      let hits = 0, saved = 0, crits = 0;
      for (let i = 0; i < shots; i++) {
        const roll = d6(rng) + d6(rng);
        if (roll < th.need) continue;
        const crit = elevated && roll - th.need >= CRIT_MARGIN;
        const need = (tgt.s.save || 7) + q.s.ap + (impact ? IMPACT_AP : 0);
        if (!crit && need <= 6 && d6(rng) >= need) { saved++; continue; }   // a crit goes through armour
        hits++; if (crit) crits++;
      }
      let killed = 0;
      let base = impact ? q.s.dmg * IMPACT_DAMAGE : q.s.dmg;
      if (pointBlank) base *= POINT_BLANK_DAMAGE;
      q.shots += shots; q.hits += hits;
      for (let i = 0; i < hits; i++) {
        if (!alive(tgt)) break;
        const d = i < crits ? base * CRIT_DAMAGE : base;
        const res = applyDamage(tgt, d, pointBlank ? 0 : q.s.splash, ev);
        killed += res.killed; q.dealt += d; q.wasted += res.wasted;
        if (res.killed) tgt.tookFrom[q.s.name] = (tgt.tookFrom[q.s.name] || 0) + res.killed;
      }
      q.kills += killed;
      q.cd = Math.max(0, Math.round((q.s.cycle || 1) - 1));

      ev.push({ k: q.side === 'p' ? 'pfire' : 'efire', from: q.hex, to: tgt.hex,
        splash: q.s.splash, killed, side: q.side,
        s: (impact ? 'IMPACT! ' : '') + (crits ? 'CRIT×' + crits + ' ' : '') + (pointBlank ? 'POINT BLANK ' : '') +
           `${q.s.name} → ${tgt.s.name}: ${shots} shots, needs ${th.need}+, ${hits} hit` +
           (saved ? `, ${saved} saved` : '') + (killed ? ` — ${killed} destroyed` : ''),
        detail: modsText(th) });

      if (killed && tgt.s.deathBlast && alive(tgt) >= 0) {          // suicide charge tech
        const back = killed * tgt.s.deathBlast;
        applyDamage(q, back, 0, ev);
        ev.push({ k: 'boom', at: q.hex, s: `${tgt.s.name} detonate — ${back} back into ${q.s.name}` });
      }
      if (!alive(tgt)) ev.push({ k: 'wipe', at: tgt.hex, s: `${tgt.s.name} wiped out` });
    }

    /* Stalemate: a Siege Walker hugged by Pods cannot fire and cannot escape, and neither side
       can hurt the other. Rather than grind to the tick cap doing nothing, call it. */
    const hpAfter = squads.reduce((a, q) => a + q.hp.reduce((x, y) => x + y, 0), 0);
    quiet = (hpBefore - hpAfter) < 1 ? quiet + 1 : 0;

    if (!opts.noFrames) frames.push({
      t,
      squads: squads.filter(q => alive(q) > 0).map(q => ({
        uid: q.uid, side: q.side, id: q.id, name: q.s.name, hex: q.hex,
        n: alive(q), nMax: q.nMax, hpTop: q.hp.length ? Math.max(...q.hp) : 0, hpEach: q.s.hp, role: q.s.role,
        charging: q.charging, stance: q.stance,
      })),
      ev,
    });
    if (quiet >= 14) break;
  }

  const pLeft = squads.filter(q => q.side === 'p' && alive(q) > 0);
  const eLeft = squads.filter(q => q.side === 'e' && alive(q) > 0);
  const pPower = pLeft.reduce((a, q) => a + alive(q) * q.s.hp, 0);
  const ePower = eLeft.reduce((a, q) => a + alive(q) * q.s.hp, 0);
  const won = pPower > ePower;
  /* How badly it went is measured by what the WINNER has left of their own army, not by the
     loser's remnant — battles end in annihilation, so the loser is always near zero and every
     result scored as a rout. A winner who was mauled taking the field takes less from you. */
  const pStart = playerSquads.reduce((a, sp) => a + sp.n * sp.hp, 0) || 1;
  const eStart = enemySquads.reduce((a, sp) => a + sp.n * sp.hp, 0) || 1;
  const winnerLeft = won ? pPower / pStart : ePower / eStart;
  const bite = winnerLeft > 0.62 ? 3 : winnerLeft > 0.28 ? 2 : 1;

  /* The after-action. An auto-battler's loop is watch, understand, adapt — and understanding was
     entirely on the player until this existed. */
  const mine = squads.filter(q => q.side === 'p');
  const notes = [];
  for (const q of mine) {
    if (q.shots === 0) {
      const why = Object.entries(q.idleWhy).sort((a, b) => b[1] - a[1])[0];
      notes.push({ kind: 'silent', squad: q.s.name,
        text: q.s.name + ' never fired a shot — ' + (why ? why[0] : 'no target') });
    } else if (q.wasted > q.dealt * 0.3) {
      notes.push({ kind: 'overkill', squad: q.s.name,
        text: Math.round(q.wasted / (q.dealt || 1) * 100) + '% of ' + q.s.name +
          ' damage was overkill — too much gun for what it shot at' });
    }
  }
  const killers = {};
  for (const q of mine) for (const [name, n] of Object.entries(q.tookFrom)) killers[name] = (killers[name] || 0) + n;
  const worst = Object.entries(killers).sort((a, b) => b[1] - a[1])[0];
  const lostMachines = mine.reduce((a, q) => a + (q.nMax - alive(q)), 0);
  if (worst) notes.push({ kind: 'killer', squad: worst[0],
    text: 'Their ' + worst[0] + ' accounted for ' + worst[1] + ' of your ' + lostMachines + ' machines lost' });

  const foeRoles = {};
  for (const q of squads.filter(x => x.side === 'e')) foeRoles[q.s.role] = (foeRoles[q.s.role] || 0) + q.nMax;
  const advice = (foeRoles.swarm || 0) + (foeRoles.line || 0) >= 14 ? 'They are fielding numbers — splash hits several machines a shot.'
    : (foeRoles.heavy || 0) + (foeRoles.ace || 0) > 0 ? 'They have armour — bring armour-piercing, or enough bodies that overkill stops mattering.'
    : (foeRoles.siege || 0) > 0 ? 'They are shooting from range — something fast that closes shuts a siege line down.'
    : null;
  if (advice) notes.push({ kind: 'advice', text: advice });

  return {
    won, ticks: t, frames, map, bite, notes,
    stats: mine.map(q => ({ name: q.s.name, shots: q.shots, hits: q.hits,
      dealt: Math.round(q.dealt), wasted: Math.round(q.wasted), idle: q.idle,
      lost: q.nMax - alive(q), nMax: q.nMax })),
    survivors: pLeft.map(q => ({ uid: q.uid, id: q.id, n: alive(q), nMax: q.nMax, kills: q.kills })),
    lostSquads: squads.filter(q => q.side === 'p' && !alive(q)).map(q => ({ uid: q.uid, id: q.id })),
    enemyLost: squads.filter(q => q.side === 'e' && !alive(q)).map(q => ({ uid: q.uid, id: q.id })),
    playerLeft: pLeft.length, enemyLeft: eLeft.length, pPower, ePower,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { simulateBattle, deployArmy, makeSquad, toHit, modsText, oddsOf, mulberry32, wantRange,
    CHARGE_SPEED, CHARGE_EXPOSURE, IMPACT_DAMAGE, CRIT_MARGIN, CRIT_DAMAGE };
}
