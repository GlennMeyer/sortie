'use strict';
/* SORTIE — what survives a war.
   Everything else in this project resets: win or lose, newGame() wipes the board. That is the
   difference between a game and a game you open twice. A profile persists across wars and across
   sessions, and it pulls in both directions — every war you win hands you a permanent doctrine,
   and every war you win also raises the tier the regime fights at. */

const TIERS = [
  { n: 1, name: 'SKIRMISH',   income: 1.00, era2: 4, era3: 7, rank: 0, note: 'The regime fights as it always has.' },
  { n: 2, name: 'INCURSION',  income: 1.08, era2: 4, era3: 7, rank: 0, note: 'Better funded.' },
  { n: 3, name: 'OFFENSIVE',  income: 1.08, era2: 3, era3: 7, rank: 0, note: 'Developed machines a round sooner.' },
  { n: 4, name: 'CAMPAIGN',   income: 1.18, era2: 3, era3: 6, rank: 0, note: 'Advanced machines a round sooner.' },
  { n: 5, name: 'TOTAL WAR',  income: 1.28, era2: 3, era3: 6, rank: 0, note: 'A war economy behind them.' },
  { n: 6, name: 'ANNIHILATION', income: 1.28, era2: 2, era3: 5, rank: 1, note: 'Their line starts blooded — every squad a rank up.' },
  { n: 7, name: 'EXTINCTION', income: 1.40, era2: 2, era3: 5, rank: 1, note: 'Everything, sooner, and better.' },
];

/* Chosen one at a time after a war you win. They stack, and they are what makes tier seven
   survivable — the difficulty and the answer to it advance together. */
const DOCTRINES = [
  { id: 'logistics', name: 'LOGISTICS CORPS', note: 'Open every war with 180 more credits.' },
  { id: 'scouts',    name: 'FORWARD SCOUTS',  note: 'Begin with a fourth machine already unlocked.' },
  { id: 'cadre',     name: 'VETERAN CADRE',   note: 'Your first squad each war is promoted to rank C.' },
  { id: 'economy',   name: 'WAR ECONOMY',     note: '+45 income every round, for the rest of the war.' },
  { id: 'engineers', name: 'FIELD ENGINEERS', note: 'Rebuilding destroyed squads costs 40% less.' },
  { id: 'arsenal',   name: 'ARSENAL ACCESS',  note: 'Start each war with one field upgrade already fitted.' },
  { id: 'reserves',  name: 'DEEP RESERVES',   note: 'Two extra slots on the field, permanently.' },
];
const D = Object.fromEntries(DOCTRINES.map(d => [d.id, d]));

const KEY = 'sortie.profile.v1';
function blank() { return { warsFought: 0, warsWon: 0, streak: 0, best: 0, doctrines: [], pending: null }; }

/* localStorage is not guaranteed in a sandboxed frame, so never let it take the page down. */
function load() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(KEY);
    if (!raw) return blank();
    return Object.assign(blank(), JSON.parse(raw));
  } catch (e) { return blank(); }
}
function save(p) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* memory only */ }
  return p;
}
function reset() { const p = blank(); save(p); return p; }

const tierOf = profile => TIERS[Math.min(TIERS.length - 1, profile.warsWon)];
const has = (profile, id) => profile.doctrines.includes(id);

/* Three you do not already hold. */
function offerDoctrines(profile, rng) {
  const pool = DOCTRINES.filter(d => !has(profile, d.id));
  const out = [];
  const take = pool.slice();
  for (let i = 0; i < 3 && take.length; i++) out.push(take.splice(Math.floor(rng() * take.length), 1)[0]);
  return out;
}
function takeDoctrine(profile, id) {
  if (!D[id] || has(profile, id)) return false;
  profile.doctrines.push(id); profile.pending = null; save(profile);
  return true;
}

/* Everything the profile changes about a war, as plain data — army.js stays independent of how
   any of it was earned. */
function modifiers(profile) {
  const t = tierOf(profile);
  return {
    credits:      has(profile, 'logistics') ? 180 : 0,
    incomeBonus:  has(profile, 'economy') ? 45 : 0,
    extraUnlock:  has(profile, 'scouts') ? 1 : 0,
    startRank:    has(profile, 'cadre') ? 1 : 0,
    rebuildScale: has(profile, 'engineers') ? 0.6 : 1,
    freeTech:     has(profile, 'arsenal') ? 1 : 0,
    extraSlots:   has(profile, 'reserves') ? 2 : 0,
    enemyIncome:  t.income,
    era2: t.era2, era3: t.era3, enemyRank: t.rank,
    tier: t,
  };
}

function recordWar(profile, won) {
  profile.warsFought++;
  if (won) { profile.warsWon++; profile.streak++; profile.best = Math.max(profile.best, profile.streak); }
  else profile.streak = 0;
  save(profile);
  return profile;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TIERS, DOCTRINES, D, blank, load, save, reset, tierOf, has, offerDoctrines, takeDoctrine, recordWar, modifiers };
}
