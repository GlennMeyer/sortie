'use strict';
/* SORTIE — army list, shop and the escalating war of attrition.
   The game is here: credits, counter-picking, and what you can afford to lose. */

/* Squads, not individuals. Every unit is N identical machines that die one at a time.
   role decides the counter web:
     swarm   — many, cheap, melts to splash, wins by bodies
     line    — the neutral middle
     fast    — reaches the artillery before it fires twice
     siege   — enormous reach and splash, helpless up close
     heavy   — expensive, tanky, needs AP or numbers to crack
     ace     — a single named machine that beats anything its own price */
const UNITS = [
  { id: 'pods',   name: 'SCRAP PODS',   role: 'swarm', era: 1, slots: 1, cost: 140, n: 8, hp: 70,  dmg: 6,  minR: 1, maxR: 3, br: [1,2,3],
    speed: 1.01, ap: 0, save: 0, splash: 0, acc: 1,
    note: 'Barely armed and barely armoured. They exist to be in the way.' },
  { id: 'line',   name: 'LINE SUITS',   role: 'line', era: 1, slots: 1,  cost: 230, n: 6, hp: 105, dmg: 10, minR: 1, maxR: 5, br: [2,4,5],
    speed: 0.79, ap: 1, save: 6, splash: 0, acc: 0,
    note: 'The mass-produced answer to everything and the best answer to nothing.' },
  { id: 'heavy',  name: 'HEAVY SUITS',  role: 'line', era: 2, slots: 2,  cost: 450, n: 4, hp: 273, dmg: 24, minR: 1, maxR: 5, br: [2,3,5],
    speed: 0.57, ap: 2, save: 5, splash: 0, acc: 0,
    note: 'Slower, thicker, and it takes real armour-piercing to move them.' },
  { id: 'lancers',name: 'LANCERS',      role: 'fast', era: 1, slots: 2,  cost: 485, n: 3, hp: 222, dmg: 58, minR: 1, maxR: 1, br: [1,1,1],
    speed: 2.04, ap: 3, save: 6, splash: 0, acc: -1,
    note: 'Closes fast and ignores armour. Cannot shoot anything it has not reached.' },
  { id: 'skirm',  name: 'SKIRMISHERS',  role: 'fast', era: 2, slots: 2,  cost: 445, n: 3, hp: 199, dmg: 44, minR: 1, maxR: 4, br: [2,3,4],
    speed: 1.39, ap: 1, save: 6, splash: 0, acc: 0,
    note: 'Fast enough to choose its range. Hits hardest where nobody is looking.' },
  { id: 'siege',  name: 'SIEGE WALKERS',role: 'siege', era: 2, slots: 3, cost: 880, n: 2, hp: 295, dmg: 71, minR: 3, maxR: 9, br: [5,7,9],
    speed: 0.32, ap: 1, save: 6, splash: 2, acc: 1, emplaced: true,
    note: 'Emplaced: it holds the hex you put it on. Reaches the whole field and splashes two, and cannot fire inside three hexes — so where you set it down is the whole decision.' },
  { id: 'missile',name: 'MISSILE TRACK',role: 'siege', era: 3, slots: 2, cost: 660, n: 3, hp: 144, dmg: 40, minR: 2, maxR: 7, br: [4,6,7],
    speed: 0.65, ap: 0, save: 0, splash: 3, acc: 1, indirect: true, emplaced: true,
    note: 'Emplaced, and fires indirect — no line of sight needed, so terrain never blocks it. Splashes three. Swarm food becomes swarm graveyard, if nothing reaches it.' },
  { id: 'colossus',name:'COLOSSUS',     role: 'heavy', era: 3, slots: 3, cost: 740, n: 1, hp: 1750,dmg: 93, minR: 1, maxR: 6, br: [2,4,6],
    speed: 0.48, ap: 2, save: 4, splash: 0, acc: 0,
    note: 'One machine worth a company. Everything small that shoots it dies; anything with AP does not.' },
  { id: 'ace',    name: 'ACE FRAME',    role: 'ace', era: 3, slots: 3,   cost: 900, n: 1, hp: 905, dmg: 156,minR: 1, maxR: 6, br: [3,5,6],
    speed: 1.37, ap: 2, save: 4, splash: 0, acc: 0,
    note: 'A single pilot who is simply better. Beats anything at its price and folds to a crowd.' },
];
const U = Object.fromEntries(UNITS.map(u => [u.id, u]));

/* Tech is bought once and upgrades every squad of that type you own, now and later. */
const TECH = [
  { id: 'pods_charge',  unit: 'pods',    cost: 140, name: 'SUICIDE CHARGE',  note: 'Pods detonate on death, hurting whatever killed them.', apply: u => { u.deathBlast = 24; } },
  { id: 'line_coat',    unit: 'line',    cost: 175, name: 'ANTI-BEAM COAT',  note: 'Improves the save by one against armour-piercing fire.', apply: u => { u.save = Math.max(3, (u.save || 7) - 1); } },
  { id: 'line_more',    unit: 'line',    cost: 210, name: 'EXPANDED SQUAD',  note: 'Two more machines in every Line Suit squad.',            apply: u => { u.n += 2; } },
  { id: 'heavy_ap',     unit: 'heavy',   cost: 195, name: 'MAGNETIC ROUNDS', note: 'Heavy Suits gain armour-piercing.',                      apply: u => { u.ap += 2; } },
  { id: 'lance_boost',  unit: 'lancers', cost: 170, name: 'THRUSTER BOOST',  note: 'Lancers cross the field faster.',                        apply: u => { u.speed += 0.9; } },
  { id: 'lance_more',   unit: 'lancers', cost: 225, name: 'EXPANDED SQUAD',  note: 'A fourth Lancer in every squad.',                        apply: u => { u.n += 1; } },
  { id: 'skirm_range',  unit: 'skirm',   cost: 155, name: 'LONG BARRELS',    note: 'Skirmishers reach two hexes further.',                   apply: u => { u.maxR += 2; u.br = [u.br[0], u.br[1] + 1, u.br[2] + 2]; } },
  { id: 'siege_range',  unit: 'siege',   cost: 180, name: 'EXTENDED BARREL', note: 'Siege Walkers reach further and splash wider.',          apply: u => { u.maxR += 2; u.br = [u.br[0], u.br[1] + 1, u.br[2] + 2]; u.splash += 1; } },
  { id: 'missile_pods', unit: 'missile', cost: 180, name: 'SATURATION PODS', note: 'Missile Tracks splash two more machines.',               apply: u => { u.splash += 2; } },
  { id: 'colossus_pd',  unit: 'colossus',cost: 225, name: 'POINT DEFENCE',   note: 'The Colossus shrugs off splash damage entirely.',        apply: u => { u.splashImmune = true; } },
  { id: 'ace_newtype',  unit: 'ace',     cost: 280, name: 'NEWTYPE REFLEXES',note: 'The Ace fires twice as often.',                           apply: u => { u.cycle = 0.5; } },
];
const T = Object.fromEntries(TECH.map(t => [t.id, t]));

/* A unit type with your purchased tech folded in. */
function spec(state, id) {
  const u = Object.assign({}, U[id]);
  u.br = u.br.slice();
  for (const tid of state.tech) if (T[tid] && T[tid].unit === id) T[tid].apply(u);
  return u;
}

const ROUNDS = 10;

/* THE LADDER.
   Every machine has an era, and a war climbs it: you open with blades, massed bodies and the
   simplest rifles, and you finish with guided fire, superheavy hulls and a single pilot who is
   better than everyone. Unlocks always come from the earliest era that still has something in it,
   so progress is a march rather than a lottery — and the regime climbs the same ladder, so it
   cannot field a Colossus while you are still holding spears.

   Era 1  close combat, numbers, the basic line
   Era 2  specialised roles: skirmishers, artillery, heavy armour
   Era 3  guided weapons, superheavies, aces

   The long-term intent is to extend this downward (sticks, stones, massed infantry) and upward,
   so a run is the whole evolution of warfare rather than one slice of it. */
const ERAS = { 1: 'EARLY', 2: 'DEVELOPED', 3: 'ADVANCED' };
const START_UNLOCKED = 3;
function prng(a) {                       // army.js has no other need for randomness, so keep it local
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* Everyone starts at the bottom of the ladder with the same three. */
function startingRoster() { return UNITS.filter(u => u.era === 1).map(u => u.id); }

/* The earliest era you have not finished. */
function currentEra(state) {
  for (const e of [1, 2, 3]) if (UNITS.some(u => u.era === e && !state.unlocked.includes(u.id))) return e;
  return 3;
}

function newGame(seed, mods) {
  mods = mods || {};
  const roster = startingRoster();
  if (mods.extraUnlock) {                       // FORWARD SCOUTS: a fourth machine off the ladder
    const next = UNITS.filter(u => !roster.includes(u.id)).sort((a, b) => a.era - b.era)[0];
    if (next) roster.push(next.id);
  }
  return {
    mods,
    seed: seed >>> 0, round: 1, credits: 950 + (mods.credits || 0), supply: 15, enemySupply: 15,
    army: [],            // [{id, uid, hex}] — your squads, they persist between rounds
    incomeBonus: mods.incomeBonus || 0,   // permanent, from boons and doctrines
    discounts: {},       // unitId -> price multiplier, permanent
    lastLost: [],        // unit ids wiped last round, so a catch-up boon can rebuild one
    boons: [],           // what you have taken, for the record
    tech: mods.freeTech ? [TECH[0].id] : [],
    unlocked: roster,
    efleet: [],          // the regime's standing army — it persists exactly like yours
    /* The regime opens lighter than you do. Round one used to be an even 950 apiece, which sounds
       fair and is not: the regime's buyer is a solved policy and a person playing their first war
       is not, so an even budget lost the opening battle about two times in three. The first
       sortie has to be winnable by someone still learning what beats what. Tiers scale this back
       up, so the handicap belongs to the beginning of the ladder, not to the whole of it. */
    eCredits: Math.round(840 * (mods.enemyIncome || 1)),
    enemyTech: [],
    log: [], over: false, won: false, nextUid: 1,
  };
}

/* Income rises so the board escalates whether or not you are winning. */
function income(state) { return 470 + (state.round - 1) * 150 + (state.incomeBonus || 0); }

function priceOf(state, id) {
  return Math.round(U[id].cost * ((state.discounts && state.discounts[id]) || 1));
}
/* The board holds a limited force, but a slot has to cost what it is worth. With every unit
   taking one slot the cap made credits irrelevant: eighteen slots of Colossus is three times the
   army of eighteen slots of Pods, so once you were rich the only question was "what is the biggest
   thing I can put in a slot" and cheap units became a trap. Big machines now take three. */
/* RANKS. A squad climbs D -> C -> B -> A -> S, and every rank is roughly a third stronger in both
   hull and damage, compounding to about 3.3x at S.
   This exists because the slot cap made the late game unbuyable: by round eight you were capped
   84% of the time and sitting on four thousand dead credits with nothing to spend them on. Ranks
   turn money into power when you cannot turn it into bodies — and they keep era-one machines worth
   fielding in round ten, which is what makes extending the ladder possible at all. */
const RANKS = [
  { id: 0, name: 'D', mult: 1.00 },
  { id: 1, name: 'C', mult: 1.35 },
  { id: 2, name: 'B', mult: 1.82 },
  { id: 3, name: 'A', mult: 2.46 },
  { id: 4, name: 'S', mult: 3.32 },
];
const MAX_RANK = RANKS.length - 1;
const MERGE_COUNT = 3;      // three of a kind become one of the next rank, freeing slots

const SLOT_CAP = 18;
const slotCap = state => SLOT_CAP + ((state.mods && state.mods.extraSlots) || 0);
const ARMY_CAP = 18;      // kept for the deploy zone, which holds 45 hexes
const slotsUsed = state => state.army.reduce((a, s) => a + (U[s.id].slots || 1), 0);
function buy(state, id) {
  const u = U[id];
  const price = priceOf(state, id);
  if (!u || state.credits < price) return null;
  if (slotsUsed(state) + (u.slots || 1) > slotCap(state)) return null;
  if (state.unlocked && !state.unlocked.includes(id)) return null;
  state.credits -= price;
  const first = state.army.length === 0 && state.mods && state.mods.startRank;
  const sq = { id, uid: state.nextUid++, hex: -1, stance: 'hold', rank: first ? state.mods.startRank : 0 };
  state.army.push(sq);
  return sq;
}
function sell(state, uid) {
  const i = state.army.findIndex(s => s.uid === uid);
  if (i < 0) return false;
  state.credits += Math.floor(priceOf(state, state.army[i].id) * 0.6);
  state.army.splice(i, 1);
  return true;
}
/* Stance is set before the battle and is the only order you give: hold the line, or commit. */
function setStance(state, uid, stance) {
  const sq = state.army.find(s => s.uid === uid);
  if (!sq) return false;
  sq.stance = stance === 'charge' ? 'charge' : 'hold';
  return true;
}

function buyTech(state, tid) {
  const t = T[tid];
  if (!t || state.tech.includes(tid) || state.credits < t.cost) return false;
  state.credits -= t.cost; state.tech.push(tid);
  return true;
}

/* The enemy buys an army that answers yours. This is the arms race: field a swarm and it
   buys splash; field one giant and it buys armour-piercing. */
function enemyArmy(state, rng) {
  /* The regime keeps its army between rounds exactly as you keep yours, and spends an income on
     top. Rebuilding from scratch each round while your force compounded was why the player ran
     away with it — persistence has to be symmetric or the arms race is not one. */


  const mine = {};
  for (const sq of state.army) { const u = U[sq.id]; mine[u.role] = (mine[u.role] || 0) + u.n; }
  const crowded = (mine.swarm || 0) + (mine.line || 0) >= 12;
  const bigs = (mine.heavy || 0) + (mine.ace || 0);

  const want = [];
  if (crowded) want.push('missile', 'siege');
  if (bigs > 0) want.push('lancers', 'heavy');
  if ((mine.siege || 0) > 0) want.push('skirm', 'lancers');
  want.push('line', 'pods', 'heavy', 'skirm');
  // it climbs the same ladder — no Colossus in round one, but it does get there
  const m = state.mods || {};
  const eraCap = state.round >= (m.era3 || 7) ? 3 : state.round >= (m.era2 || 4) ? 2 : 1;
  for (const u of UNITS) if (u.era === eraCap && !want.includes(u.id)) want.push(u.id);
  for (let i = want.length - 1; i >= 0; i--) if (U[want[i]].era > eraCap) want.splice(i, 1);
  if (!want.length) want.push(...UNITS.filter(u => u.era <= eraCap).map(u => u.id));

  /* The same eighteen slots you get. It used to be SLOT_CAP + 3, checked *before* adding, so the
     regime fielded 21.4 slots to your 18 by the last round — a third more squads on the board. */
  const eSlots = () => state.efleet.reduce((a, o) => a + (U[o.id].slots || 1), 0);
  let guard = 0;
  while (guard++ < 40) {
    const pool = want.filter(id => U[id].cost <= state.eCredits && eSlots() + (U[id].slots || 1) <= SLOT_CAP);
    if (!pool.length) break;
    const pick = pool[Math.floor(rng() * pool.length)];
    state.efleet.push({ id: pick, uid: 10000 + state.nextUid++, hex: -1, rank: (state.mods && state.mods.enemyRank) || 0 });
    state.eCredits -= U[pick].cost;
  }

  // slot-capped and still holding credits? spend them on quality, exactly as you can
  let up = 0;
  while (up++ < 6 && state.eCredits > 0) {
    const pool = state.efleet.filter(o => (o.rank || 0) < MAX_RANK);
    if (!pool.length) break;
    const target = pool.sort((a, b) => (a.rank || 0) - (b.rank || 0))[0];
    const cost = Math.round(U[target.id].cost * (1.1 + (target.rank || 0) * 0.55));
    if (state.eCredits < cost) break;
    state.eCredits -= cost; target.rank = (target.rank || 0) + 1;
  }

  const techPool = TECH.filter(t => state.efleet.some(o => o.id === t.unit) && !state.enemyTech.includes(t.id));
  if (techPool.length && state.round >= 3 && rng() < 0.8)
    state.enemyTech.push(techPool[Math.floor(rng() * techPool.length)].id);

  return state.efleet;
}

function enemySpec(state, idOrSquad) {
  const sq = typeof idOrSquad === 'object' ? idOrSquad : { id: idOrSquad, rank: 0 };
  const u = Object.assign({}, U[sq.id]);
  u.br = u.br.slice();
  for (const tid of state.enemyTech) if (T[tid] && T[tid].unit === sq.id) T[tid].apply(u);
  const m = RANKS[sq.rank || 0].mult;
  u.hp = Math.round(u.hp * m);
  u.dmg = Math.round(u.dmg * m * 10) / 10;
  u.rank = sq.rank || 0; u.rankName = RANKS[sq.rank || 0].name;
  return u;
}

/* A squad's actual numbers: its type, plus your tech, plus its rank. */
function squadSpec(state, sq) {
  const u = spec(state, sq.id);
  const m = RANKS[sq.rank || 0].mult;
  u.hp = Math.round(u.hp * m);
  u.dmg = Math.round(u.dmg * m * 10) / 10;
  u.rank = sq.rank || 0;
  u.rankName = RANKS[sq.rank || 0].name;
  return u;
}
/* Paying for a rank costs more than the squad did — going tall should be a real commitment. */
function upgradeCost(state, sq) {
  if ((sq.rank || 0) >= MAX_RANK) return null;
  return Math.round(priceOf(state, sq.id) * (1.1 + (sq.rank || 0) * 0.55) / 5) * 5;
}
function upgrade(state, uid) {
  const sq = state.army.find(x => x.uid === uid);
  if (!sq) return false;
  const cost = upgradeCost(state, sq);
  if (cost == null || state.credits < cost) return false;
  state.credits -= cost; sq.rank = (sq.rank || 0) + 1;
  return true;
}
/* Or merge three of a kind at the same rank. Costs nothing, and hands two slots back. */
function mergeable(state, sq) {
  if ((sq.rank || 0) >= MAX_RANK) return null;
  const same = state.army.filter(x => x.id === sq.id && (x.rank || 0) === (sq.rank || 0));
  return same.length >= MERGE_COUNT ? same.slice(0, MERGE_COUNT) : null;
}
function merge(state, uid) {
  const sq = state.army.find(x => x.uid === uid);
  if (!sq) return false;
  const group = mergeable(state, sq);
  if (!group) return false;
  const keep = group[0];
  for (const g of group.slice(1)) state.army.splice(state.army.findIndex(x => x.uid === g.uid), 1);
  keep.rank = (keep.rank || 0) + 1;
  return true;
}

/* Three of whatever you have not unlocked yet. Taking one is permanent. */
function offerUnlocks(state, rng) {
  const locked = UNITS.filter(u => !state.unlocked.includes(u.id));
  if (!locked.length) return [];
  const era = currentEra(state);
  const pool = locked.filter(u => u.era === era).map(u => u.id);
  const out = [];
  const take = pool.slice();
  for (let i = 0; i < 3 && take.length; i++) out.push(take.splice(Math.floor(rng() * take.length), 1)[0]);
  return out.map(id => Object.assign({}, U[id]));
}
function takeUnlock(state, id) {
  if (!U[id] || state.unlocked.includes(id)) return false;
  state.unlocked.push(id);
  return true;
}

/* ---------- boons ----------
   A draft, not a gift: three options, you take one and lose the other two. Tech lives in this
   pool rather than competing with squads for credits, which is why almost nobody bought it.
   Lose a round and you are offered a fourth, catch-up option — that rubber band is what stops
   an early snowball deciding the whole war. */

/* Rarity is exponential in both directions: each tier is roughly 2× rarer and ~1.7× stronger
   than the one below, so a LEGENDARY is ~80× rarer and ~13× the effect of a COMMON.
   Luck rises with the round and when you are losing, so late wars and desperate ones are where
   the big cards actually show up. */
const RARITY = [
  { id: 'common',    name: 'COMMON',    w: 100, mult: 1.0,  color: '#7E8B99' },
  { id: 'uncommon',  name: 'UNCOMMON',  w: 52,  mult: 1.7,  color: '#5FD38A' },
  { id: 'rare',      name: 'RARE',      w: 26,  mult: 2.9,  color: '#56D2E4' },
  { id: 'elite',     name: 'ELITE',     w: 11,  mult: 4.8,  color: '#FFC24B' },
  { id: 'epic',      name: 'EPIC',      w: 4,   mult: 8.0,  color: '#FF6A1F' },
  { id: 'legendary', name: 'LEGENDARY', w: 1.2, mult: 13.0, color: '#FFD24B' },
];
const RAR = Object.fromEntries(RARITY.map(r => [r.id, r]));

function rollRarity(rng, luck) {
  const weights = RARITY.map((r, i) => r.w * Math.pow(luck, i));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < RARITY.length; i++) { roll -= weights[i]; if (roll <= 0) return RARITY[i]; }
  return RARITY[0];
}
function luckOf(state, behind) {
  return 1 + (state.round - 1) * 0.10 + (behind ? 0.40 : 0);
}

const BOONS = [
  { id: 'bonds',   name: 'WAR BONDS',      kind: 'income',  amount: 220, note: 'Permanent: +220 credits of income every round.' },
  { id: 'levy',    name: 'EMERGENCY LEVY', kind: 'credits', amount: 600, note: 'One payment of 600 credits, right now.' },
  { id: 'depot',   name: 'FORWARD DEPOT',  kind: 'discount', amount: 0.75, note: 'One unit type costs 25% less for the rest of the war.' },
  { id: 'salvage', name: 'SALVAGE CREW',   kind: 'rebuild', note: 'Rebuild one squad that was wiped out last round, free.' },
  { id: 'quota',   name: 'PRODUCTION QUOTA', kind: 'unit',  note: 'A free squad, delivered now.' },
];

function offerBoons(state, rng, lostLast) {
  const out = [];
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const behind = (lostLast && lostLast.length > 0) || state.supply < state.enemySupply;
  const luck = luckOf(state, behind);
  const owned = new Set(state.army.map(s => s.id));

  /* field upgrades — rarity buys you more of them at once */
  const techPool = TECH.filter(t => !state.tech.includes(t.id));
  if (techPool.length) {
    const r = rollRarity(rng, luck);
    const count = Math.min(techPool.length, Math.max(1, Math.round(r.mult / 3.2)));
    const relevant = techPool.filter(t => owned.has(t.unit));
    const chosen = [];
    const pool = (relevant.length >= count ? relevant : techPool).slice();
    for (let i = 0; i < count && pool.length; i++) chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    out.push({ id: 'tech:' + chosen.map(t => t.id).join('+'), kind: 'tech', rarity: r.id,
      tech: chosen.map(t => t.id),
      name: chosen.length > 1 ? chosen.length + ' FIELD UPGRADES' : chosen[0].name,
      note: chosen.map(t => t.name + ' — ' + t.note).join('  ') });
  }

  /* free squads — rarity buys both quantity and access to the expensive end of the roster */
  {
    const r = rollRarity(rng, luck);
    const ceiling = 120 + r.mult * 90;                     // legendary reaches the Colossus
    const affordable = UNITS.filter(u => u.cost <= ceiling && state.unlocked.includes(u.id));
    if (!affordable.length) affordable.push(U[state.unlocked[0]]);
    const prefer = affordable.filter(u => !owned.has(u.id));
    const u = pick(prefer.length ? prefer : (affordable.length ? affordable : UNITS));
    const count = Math.max(1, Math.round(r.mult / 2.6));
    out.push({ id: 'unit:' + u.id, kind: 'unit', unit: u.id, count, rarity: r.id,
      name: count > 1 ? 'FREE: ' + count + '× ' + u.name : 'FREE: ' + u.name,
      note: (count * u.n) + ' machines delivered now. Normally ' + (u.cost * count) + ' credits.' });
  }

  /* economy — the numbers scale straight off the multiplier */
  {
    const r = rollRarity(rng, luck);
    const which = pick(['income', 'credits', 'discount']);
    if (which === 'income') {
      const amount = Math.round(60 * r.mult / 10) * 10;
      out.push({ id: 'bonds', kind: 'income', amount, rarity: r.id, name: 'WAR BONDS',
        note: 'Permanent: +' + amount + ' credits of income every round for the rest of the war.' });
    } else if (which === 'credits') {
      const amount = Math.round(210 * r.mult / 10) * 10;
      out.push({ id: 'levy', kind: 'credits', amount, rarity: r.id, name: 'EMERGENCY LEVY',
        note: 'One payment of ' + amount + ' credits, right now.' });
    } else {
      const d = pick(UNITS);
      const off = Math.min(0.6, 0.07 * r.mult);
      out.push({ id: 'discount:' + d.id, kind: 'discount', unit: d.id, amount: 1 - off, rarity: r.id,
        name: 'FORWARD DEPOT', note: d.name + ' costs ' + Math.round(off * 100) + '% less for the rest of the war.' });
    }
  }

  /* The rubber band, and only when you are actually behind. Destroyed squads are already rebuilt
     automatically, so "rebuild the squad you lost" would just hand you a duplicate — the catch-up
     is about the *bill*, or about squads you could not afford to rebuild at all. */
  const behindNow = state.lastRoundWon === false || state.supply < state.enemySupply;
  if (behindNow && state.lastScrapped && state.lastScrapped.length) {
    const ids = state.lastScrapped.slice();
    out.push({ id: 'reclaim', kind: 'reclaim', rarity: rollRarity(rng, luck + 0.3).id,
      name: 'SALVAGE CREW', catchUp: true,
      note: 'Recover ' + ids.join(', ') + ' from the wreck — the squads you could not afford to rebuild.' });
  } else if (behindNow && state.lastBill > 0) {
    out.push({ id: 'refund', kind: 'refund', amount: state.lastBill, rarity: rollRarity(rng, luck + 0.3).id,
      name: 'FIELD WORKSHOPS', catchUp: true,
      note: 'Refund the ' + state.lastBill + ' credits you just spent rebuilding.' });
  } else if (state.supply < state.enemySupply) {
    const r = rollRarity(rng, luck + 0.3);
    const amount = Math.round(260 * r.mult / 10) * 10;
    out.push({ id: 'levy2', kind: 'credits', amount, rarity: r.id, name: 'EMERGENCY LEVY',
      note: 'One payment of ' + amount + ' credits, right now.', catchUp: true });
  }
  return out;
}

/* Cash out an offer you cannot use.
   Some rounds every reward is dead — tech for a unit you do not own, a free squad when you have
   no slots left, SALVAGE CREW when nothing was scrapped. Being forced to take a nothing is worse
   than being given nothing. Banking always pays, so the choice is never empty.

   Deliberately below what a pure-cash boon of the same rarity hands you (210 x mult): banking is
   the floor under a bad offer, never the best line. Taking the upgrade should still win whenever
   the upgrade is any good. */
function bankValue(boon) {
  if (!boon) return 0;
  const mult = (RAR[boon.rarity] || RAR.common).mult;
  return Math.max(100, Math.round(140 * mult / 10) * 10);
}

function bankBoon(state, boon) {
  const v = bankValue(boon);
  if (!v) return false;
  state.credits += v;
  state.banked = (state.banked || 0) + v;
  return true;
}

function takeBoon(state, boon) {
  if (!boon) return false;
  switch (boon.kind) {
    case 'tech': {
      for (const t of [].concat(boon.tech)) if (!state.tech.includes(t)) state.tech.push(t);
      break;
    }
    case 'reclaim': {
      for (const name of (state.lastScrapped || [])) {
        const u = UNITS.find(x => x.name === name);
        if (u && slotsUsed(state) + (u.slots || 1) <= slotCap(state))
          state.army.push({ id: u.id, uid: state.nextUid++, hex: -1, stance: 'hold', rank: 0 });
      }
      state.lastScrapped = [];
      break;
    }
    case 'refund': state.credits += boon.amount; break;
    case 'unit': {
      for (let i = 0; i < (boon.count || 1); i++) {
        if (slotsUsed(state) + (U[boon.unit].slots || 1) > slotCap(state)) break;
        state.army.push({ id: boon.unit, uid: state.nextUid++, hex: -1, stance: 'hold', rank: 0 });
      }
      break;
    }
    case 'income': state.incomeBonus = (state.incomeBonus || 0) + boon.amount; break;
    case 'credits': state.credits += boon.amount; break;
    case 'discount': state.discounts[boon.unit] = (state.discounts[boon.unit] || 1) * boon.amount; break;
    default: return false;
  }
  state.boons.push(boon.name);
  return true;
}

/* Your army persists, but not for free. Squads destroyed in a battle are rebuilt between rounds
   at a fraction of their price, billed against next round's income. Anything you cannot afford to
   rebuild is disbanded.
   The two ends of this were both wrong: permanent loss wiped the whole army in half of all rounds
   (a treadmill), and free rebuilds made watching your force die completely weightless. Paying for
   it means a bad round costs you the next round's shopping, which is a real consequence you can
   see coming. */
const REBUILD_RATE = 0.25;
function resolveRound(state, result) {
  const wiped = new Set(result.lostSquads.map(l => l.uid));
  const lost = state.army.filter(s => wiped.has(s.uid));

  if (result.won) state.enemySupply = Math.max(0, state.enemySupply - result.bite);
  else state.supply = Math.max(0, state.supply - result.bite);

  state.lastLost = lost.map(l => l.id);
  state.lastRoundWon = !!result.won;
  const line = result.won
    ? `Round ${state.round}: field held. Enemy supply -${result.bite}.`
    : `Round ${state.round}: pushed off the field. Supply -${result.bite}.`;
  state.log.push({ round: state.round, won: result.won, bite: result.bite,
    rebuilt: lost.map(l => U[l.id].name), lost: [], text: line });

  state.round++;
  if (state.supply <= 0) { state.over = true; state.won = false; }
  else if (state.enemySupply <= 0) { state.over = true; state.won = true; }
  else if (state.round > ROUNDS) { state.over = true; state.won = state.enemySupply < state.supply; }
  else {
    state.credits += income(state);

    /* The repair bill, charged against what you just earned. Cheapest squads are rebuilt first,
       so a bad round costs you next round's shopping rather than your whole force. */
    let bill = 0;
    const scrapped = [];
    for (const sq of lost.slice().sort((a, b) => priceOf(state, a.id) - priceOf(state, b.id))) {
      const price = Math.round(priceOf(state, sq.id) * REBUILD_RATE * ((state.mods && state.mods.rebuildScale) || 1));
      if (state.credits >= price) { state.credits -= price; bill += price; }
      else {
        const i = state.army.findIndex(x => x.uid === sq.uid);
        if (i >= 0) state.army.splice(i, 1);
        scrapped.push(U[sq.id].name);
      }
    }
    /* The regime rebuilds on the same terms — it pays for its dead too, or writes them off.
       Charging only the player made a loss unrecoverable. */
    state.eCredits += Math.round((420 + (state.round - 1) * 150) * ((state.mods && state.mods.enemyIncome) || 1));   // round has already advanced
    const eLost = (result.enemyLost || []).map(l => l.id);
    for (const id of eLost.slice().sort((a, b) => U[a].cost - U[b].cost)) {
      const price = Math.round(U[id].cost * REBUILD_RATE);
      if (state.eCredits >= price) state.eCredits -= price;
      else {
        const i = state.efleet.findIndex(x => x.id === id);
        if (i >= 0) state.efleet.splice(i, 1);
      }
    }

    state.lastBill = bill; state.lastScrapped = scrapped;
    return { lost: lost.map(l => U[l.id].name), bite: result.bite, bill, scrapped };
  }
  return { lost: lost.map(l => U[l.id].name), bite: result.bite, bill: 0, scrapped: [] };
}

/* What the enemy is bringing, shown before you commit — the whole point is counter-picking. */
function intel(enemy) {
  const by = {};
  for (const e of enemy) by[e.id] = (by[e.id] || 0) + 1;
  return Object.entries(by).map(([id, k]) => ({ id, k, name: U[id].name, role: U[id].role }))
    .sort((a, b) => b.k - a.k);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UNITS, U, TECH, T, BOONS, RARITY, RAR, ROUNDS, ARMY_CAP, SLOT_CAP, slotsUsed, rollRarity, luckOf, newGame, income, slotCap, priceOf, buy, sell, buyTech, setStance, spec, squadSpec, RANKS, MAX_RANK, MERGE_COUNT,
    upgradeCost, upgrade, mergeable, merge, startingRoster, offerUnlocks, takeUnlock, START_UNLOCKED, ERAS, currentEra,
    enemyArmy, enemySpec, resolveRound, intel, offerBoons, takeBoon, bankValue, bankBoon };
}
