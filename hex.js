'use strict';
/* SORTIE — hex geometry and battlefield generation.
   Storage is odd-r offset (rows of columns, odd rows nudged right); all real math is done in
   cube coordinates. Distance and line-of-sight are precomputed per map because terrain never
   moves during a sortie — that turns the hot path of the combat loop into two array lookups. */

const COLS = 15, ROWS = 11;
const N_HEX = COLS * ROWS;

/* Two different ideas that were one flag for far too long:
     opaque — you cannot see or shoot through it
     blocks — you cannot stand on it
   A ridge is opaque but standable. Conflating them made hills transparent, because they had to
   be deployable and `blocks:false` also meant "shoot straight through". */
/* Three ideas, deliberately separate:
     opaque     — you cannot see or shoot through it
     blocks     — you cannot deploy on it
     impassable — you cannot enter it at all
   Ridges are opaque but standable. Rock is all three. Trenches are none of them and simply
   shelter whoever is in the hole. */
const TERRAIN = {
  open:   { id: 'open',   cost: 1, opaque: false, blocks: false, impassable: false, cover: 0.00, high: false,
    note: 'Nothing to hide behind.' },
  debris: { id: 'debris', cost: 2, opaque: true,  blocks: true,  impassable: false, cover: 0.22, high: false,
    note: 'Blocks line of sight. You can cross it, slowly, but you cannot hold it.' },
  ridge:  { id: 'ridge',  cost: 2, opaque: true,  blocks: false, impassable: false, cover: 0.08, high: true,
    note: 'High ground. Blocks sight from below; standing on it you see over the rubble and your hits can crit.' },
  rock:   { id: 'rock',   cost: 99, opaque: true, blocks: true,  impassable: true,  cover: 0.00, high: false,
    note: 'Solid. Nothing crosses it and nothing shoots through it — the only real chokepoints on the board.' },
  trench: { id: 'trench', cost: 2, opaque: false, blocks: false, impassable: false, cover: 0.26, high: false,
    note: 'A hole worth being in. Shelters whoever holds it without blocking their own line of fire.' },
  marsh:  { id: 'marsh',  cost: 3, opaque: false, blocks: false, impassable: false, cover: 0.00, high: false,
    note: 'Slow going and no cover at all. Crossing it costs you the tempo.' },
};
const passable = (map, h) => !TERRAIN[map.tiles[h]].impassable;

const id = (c, r) => r * COLS + c;
const colOf = i => i % COLS;
const rowOf = i => (i / COLS) | 0;
const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

function toCube(i) {
  const c = colOf(i), r = rowOf(i);
  const x = c - ((r - (r & 1)) >> 1);
  const z = r;
  return [x, -x - z, z];
}
function cubeDist(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/* odd-r offset neighbours: even rows lean left, odd rows lean right */
const NB = [
  [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]],   // even row
  [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]],   // odd row
];
function neighbours(i) {
  const c = colOf(i), r = rowOf(i), out = [];
  for (const [dc, dr] of NB[r & 1]) {
    const nc = c + dc, nr = r + dr;
    if (inBounds(nc, nr)) out.push(id(nc, nr));
  }
  return out;
}

function cubeRound(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return [rx, ry, rz];
}
function cubeToIndex(cu) {
  const r = cu[2], c = cu[0] + ((r - (r & 1)) >> 1);
  return inBounds(c, r) ? id(c, r) : -1;
}

/* Every hex the shot passes through, endpoints excluded.
   A line that runs exactly along a hex edge is ambiguous — rounding picks one of two tied hexes
   arbitrarily, so a shot could resolve as clear while visibly clipping the rubble next to it.
   We nudge the endpoints both ways and take the union, so an ambiguous line counts BOTH hexes:
   if either blocks, the shot is blocked. Strict, and it matches what the player sees. */
function lineBetween(a, b) {
  const A = toCube(a), B = toCube(b);
  const n = cubeDist(A, B);
  if (n <= 1) return [];
  const seen = new Set();
  for (const e of [1e-6, -1e-6]) {
    for (let s = 1; s < n; s++) {
      const t = s / n;
      const hx = cubeToIndex(cubeRound(
        A[0] + e + (B[0] + e - A[0] - e) * t,
        A[1] - e + (B[1] - e - A[1] + e) * t,
        A[2] + (B[2] - A[2]) * t));
      if (hx >= 0 && hx !== a && hx !== b) seen.add(hx);
    }
  }
  return [...seen];
}

/* ---------- maps ---------- */

/* Deterministic terrain. Deploy zone is the bottom two rows; the enemy owns the top three. */
/* The board was 91% open ground, so terrain barely featured. Density matters more than variety:
   spreading a handful of hexes across six types would just make each of them rare. */
function makeMap(rng, chapter) {
  const tiles = new Array(N_HEX).fill('open');
  const scale = 1 + Math.min(0.4, chapter * 0.05);
  const bands = [
    ['debris', 0.055 * scale],
    ['ridge',  0.045 * scale],
    ['trench', 0.040 * scale],
    ['marsh',  0.035 * scale],
    ['rock',   0.025 * scale],
  ];
  for (let i = 0; i < N_HEX; i++) {
    if (rowOf(i) >= ROWS - 3) continue;        // keep the deploy zone clean
    let roll = rng(), placed = null;
    for (const [kind, p] of bands) { if (roll < p) { placed = kind; break; } roll -= p; }
    if (placed) tiles[i] = placed;
  }
  // a broken band across the middle so crossing is a route choice, not a coin flip
  const midRow = (ROWS / 2) | 0;
  for (let c = 0; c < COLS; c++) {
    const r = rng();
    if (r < 0.14) tiles[id(c, midRow)] = 'rock';
    else if (r < 0.34) tiles[id(c, midRow)] = 'debris';
  }
  // never wall the board off completely
  let open = 0;
  for (let c = 0; c < COLS; c++) if (!TERRAIN[tiles[id(c, midRow)]].impassable) open++;
  if (open < 4) for (let c = 0; c < COLS && open < 4; c += 3) { tiles[id(c, midRow)] = 'open'; open++; }

  return buildMap(tiles);
}

function buildMap(tiles) {
  const dist = new Uint8Array(N_HEX * N_HEX);
  const los = new Uint8Array(N_HEX * N_HEX);
  /* From high ground you shoot over rubble. No terrain currently blocks a shot from a ridge —
     debris is the only blocker and height clears it — but the table is computed per-blocker so a
     genuinely tall obstacle could be added later without reworking anything. */
  const losHigh = new Uint8Array(N_HEX * N_HEX);
  const cubes = [];
  for (let i = 0; i < N_HEX; i++) cubes.push(toCube(i));

  for (let a = 0; a < N_HEX; a++) {
    for (let b = a; b < N_HEX; b++) {
      const d = cubeDist(cubes[a], cubes[b]);
      dist[a * N_HEX + b] = d; dist[b * N_HEX + a] = d;
      let clear = 1, clearHigh = 1;
      for (const h of lineBetween(a, b)) {
        const t = TERRAIN[tiles[h]];
        if (t.opaque) clear = 0;               // from the ground, rubble and hills both stop it
        if (t.opaque && t.high) clearHigh = 0; // from a hill you see over rubble, not over another hill
      }
      los[a * N_HEX + b] = clear; los[b * N_HEX + a] = clear;
      losHigh[a * N_HEX + b] = clearHigh; losHigh[b * N_HEX + a] = clearHigh;
    }
  }
  return {
    tiles, dist, los, losHigh, COLS, ROWS, N_HEX,
    d: (a, b) => dist[a * N_HEX + b],
    sees: (a, b) => los[a * N_HEX + b] === 1,
    /* Line of sight from `a` to `b`, taking the shooter's elevation into account. Standing on a
       ridge is what lets you shoot over the debris in between. */
    seesFrom: (a, b) => (TERRAIN[tiles[a]].high ? losHigh[a * N_HEX + b] : los[a * N_HEX + b]) === 1,
    terrain: i => TERRAIN[tiles[i]],
    // three rows a side: armies reach twenty-odd squads and two rows could not hold them
    deployZone: (() => { const z = []; for (let r = ROWS - 3; r < ROWS; r++) for (let c = 0; c < COLS; c++) z.push(id(c, r)); return z; })(),
    enemyZone: (() => { const z = []; for (let r = 0; r < 3; r++) for (let c = 0; c < COLS; c++) z.push(id(c, r)); return z; })(),
  };
}

/* Entering a hex costs its terrain, plus one more for gaining elevation. Moving along a ridge
   is only the terrain cost, and dropping off one is free of the climb — so high ground is
   expensive to take and cheap to hold, which is the point of it. */
function moveCost(map, from, to) {
  const t = TERRAIN[map.tiles[to]];
  const climbing = t.high && !TERRAIN[map.tiles[from]].high;
  return t.cost + (climbing ? 1 : 0);
}

/* movement cost field out from a set of goals, so a unit can step downhill toward it */
function costField(map, goals) {
  const f = new Int16Array(N_HEX).fill(9999);
  let frontier = [];
  for (const g of goals) { f[g] = 0; frontier.push(g); }
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      for (const nb of neighbours(cur)) {
        if (TERRAIN[map.tiles[nb]].impassable) continue;
        const c = f[cur] + moveCost(map, cur, nb);
        if (c < f[nb]) { f[nb] = c; next.push(nb); }
      }
    }
    frontier = next;
  }
  return f;
}

/* Cover applies when the shot's last leg clips terrain beside the target. */
function coverAt(map, from, to) {
  let best = 0;
  for (const nb of neighbours(to)) {
    const t = TERRAIN[map.tiles[nb]];
    if (t.cover <= best) continue;
    if (map.d(from, nb) < map.d(from, to)) best = t.cover;   // the cover sits between us
  }
  return Math.max(best, TERRAIN[map.tiles[to]].cover);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COLS, ROWS, N_HEX, TERRAIN, id, colOf, rowOf, inBounds, toCube, cubeDist,
    neighbours, lineBetween, makeMap, buildMap, costField, coverAt, moveCost, passable };
}
