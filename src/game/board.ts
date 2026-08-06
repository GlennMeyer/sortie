/* The tactical display, drawn properly.
 *
 * This is not a separate view you opt into. It is the board — the same hexes you deployed onto,
 * the same squads, the same battle — with the squad tokens replaced by the machines they stand
 * for, and the fire events replaced by shots that actually leave a muzzle and land somewhere.
 *
 * The division of labour with the page is deliberate and worth stating, because it is what keeps
 * this from becoming a rewrite of the game:
 *
 *   the page owns   terrain, deploy overlays, labels, hit-testing, and every decision
 *   this owns       machines, motion, weapons, impacts, light
 *
 * So the 2D canvas underneath still draws the grid and everything you interact with, and this
 * draws over it with a transparent background. Nothing here decides anything. Feed it the same
 * frame twice and you get the same picture, apart from time.
 *
 * A squad is drawn as its surviving machines, not as one token with a number under it. That is
 * the whole reason to do this: when a Line Suit squad drops from six to two you watch four
 * machines fall over, and you don't have to read a number to know the flank collapsed.
 */

import type { Archetype } from '../theatre/script';
import { ERAS, eraById, type EraSkin } from '../theatre/era';
import { buildAtlas, type Atlas, type PoseName } from '../theatre/rig';
import { Batcher, rgba } from '../theatre/gl';
import { Post } from '../theatre/post';

/* ---------- what the page hands over ---------- */

export interface SquadView {
  /** Stable across frames — this is what carries animation state. */
  key: string;
  x: number; y: number;              // hex centre, board coordinates
  side: 'p' | 'e';
  role: string;                      // swarm | line | fast | siege | heavy | ace
  /** Which age this machine belongs to: 1 primitive, 2 industrial, 3 mobile suit. */
  era?: number;
  n: number; nMax: number;
  charging?: boolean;
  /** Deploy phase only: a squad being dragged leaves a ghost behind. */
  alpha?: number;
  selected?: boolean;
}

export interface ShotView {
  from: { x: number; y: number };
  to: { x: number; y: number };
  side: 'p' | 'e';
  splash?: boolean;
  melee?: boolean;
  indirect?: boolean;
  killed?: number;
  crits?: number;
  role?: string;
  era?: number;
  uid?: string; tuid?: string;
  /** performance.now() when the event was played. */
  born: number;
}

export interface BoomView { x: number; y: number; born: number }

export interface Scene {
  /** Logical board size, before device pixel ratio. */
  w: number; h: number;
  dpr: number;
  /** Board pixels per hex radius, so machines scale with the grid. */
  R: number;
  camera: { x: number; y: number; zoom: number };
  squads: SquadView[];
  shots: ShotView[];
  booms: BoomView[];
  /** Battle or deploy — deploy stands everything at ease. */
  fighting: boolean;
}

/* ---------- role vocabulary ---------- */

const ARCH: Record<string, Archetype> = {
  swarm: 'grunt', line: 'grunt', fast: 'brawler',
  siege: 'artillery', heavy: 'heavy', ace: 'ace',
};

/** What each role's weapon reads as. Everything else follows from the era skin. */
const WEAPON: Record<string, 'sidearm' | 'rifle' | 'cannon' | 'lobbed' | 'blade' | 'polearm'> = {
  swarm: 'sidearm', line: 'rifle', fast: 'blade',
  siege: 'lobbed', heavy: 'cannon', ace: 'blade',
};

/* Whose machine this is has to survive being thirty pixels tall.
 *
 * The rig puts era accent on pauldrons and the visor, which is right at theatre scale and useless
 * here — at board scale that is four pixels and both armies read as the same grey. So the whole
 * figure is tinted toward its side. Warm for yours, cold iron-red for the regime's: different in
 * value as well as hue, because hue alone fails the moment two squads overlap. */
const TEAM: Record<'p' | 'e', [number, number, number]> = {
  p: [1.12, 0.90, 0.68],
  e: [1.00, 0.60, 0.56],
};

/* How long each reaction reads for, in seconds. Short: at four ticks a second during fast
   playback, anything longer overlaps the next event and the machine never returns to rest. */
const FIRE_HOLD = 0.42;
const STRUCK_HOLD = 0.34;
const WALK_TIME = 0.30;
const DEATH_FALL = 0.70;
const CORPSE_LINGER = 0.55;          // how long a wreck stays after it lands
const MAX_WRECKS = 3;                // per squad — a heap of them is noise, not information

/** Per-machine animation state. Machines outlive frames; squads outlive battles. */
interface Body {
  /** Offset from the squad centre, in hex-radius units. Fixed for a machine's life. */
  ox: number; oy: number;
  phase: number;                     // idle bob, so a formation doesn't breathe in unison
  dying: number;                     // seconds since it was destroyed, -1 while alive
}

interface Squad {
  key: string;
  x: number; y: number;              // where it is drawn now
  tx: number; ty: number;            // where the frame says it should be
  px: number; py: number;            // where it was when the move started
  moveT: number;                     // seconds into the current move, >= WALK_TIME when settled
  facing: number;                    // -1 or 1
  fireT: number;                     // seconds since it last fired, big when idle
  struckT: number;
  meleeT: number;
  aimX: number; aimY: number;        // what it is pointed at
  bodies: Body[];
  n: number;
  side: 'p' | 'e';
  role: string;
  seen: number;                      // frame stamp, for culling squads that left the board
}

/* ---------- shot geometry ---------- */

/** A shot in flight, derived fresh each frame from the event list. Nothing is stored. */
interface Flight {
  x0: number; y0: number; x1: number; y1: number;
  t: number;                         // 0..1 along the path
  age: number;                       // seconds since the event
  ev: ShotView;
}

const SHOT_TIME = 0.34;              // seconds for a bolt to cross, whatever the distance
const IMPACT_TIME = 0.55;

export class BoardRenderer {
  private batch: Batcher;
  private post: Post | null;
  private atlas: Atlas;
  private era: EraSkin;
  private squads = new Map<string, Squad>();
  private stamp = 0;
  private last = 0;
  private rand = 1;
  readonly ok: boolean;

  /* Every age is in the atlas at once, because a late war fields all three at the same time.
     That is the point: the Line Suits you have been dragging around since round one are still on
     the field in round nine, visibly a generation behind the machine standing next to them, and
     you can see at a glance which half of your army is obsolete. The ladder stops being a number
     in a tooltip and becomes the thing you are looking at. */
  constructor(canvas: HTMLCanvasElement, eraId = 'mobilesuit') {
    this.era = eraById(eraId);
    this.atlas = buildAtlas(ERAS);
    this.batch = new Batcher(canvas, this.atlas.canvas, true);
    this.ok = this.batch.ok;
    this.post = this.ok ? new Post(this.batch.context, 'overlay') : null;
    if (this.post && !this.post.ok) this.post = null;
  }

  /** The age a machine of this tier belongs to. Out-of-range falls back to the newest. */
  private skin(era: number | undefined): EraSkin {
    return ERAS[Math.max(0, Math.min(ERAS.length - 1, (era ?? ERAS.length) - 1))] ?? this.era;
  }

  /** Deterministic jitter, so a formation looks arranged rather than shuffled every frame. */
  private noise(): number {
    this.rand = (this.rand * 1664525 + 1013904223) >>> 0;
    return this.rand / 4294967296;
  }

  private squadOf(v: SquadView): Squad {
    let s = this.squads.get(v.key);
    if (!s) {
      s = {
        key: v.key, x: v.x, y: v.y, tx: v.x, ty: v.y, px: v.x, py: v.y,
        moveT: WALK_TIME, facing: v.side === 'p' ? 1 : -1,
        fireT: 99, struckT: 99, meleeT: 99, aimX: v.x, aimY: v.y,
        bodies: [], n: v.n, side: v.side, role: v.role, seen: this.stamp,
      };
      this.squads.set(v.key, s);
    }
    return s;
  }

  /* A squad's machines stand in a wedge, tightest for the swarms. The offsets are generated once
     per machine and never move, so a squad reads as a formation you recognise between frames. */
  private fitBodies(s: Squad, want: number) {
    while (s.bodies.length < want) {
      const i = s.bodies.length;
      const ring = i === 0 ? 0 : 1 + Math.floor((i - 1) / 4);
      const a = (i * 2.399) + ring;                     // golden-angle-ish, keeps rings from lining up
      const r = ring * 0.55;
      s.bodies.push({
        ox: Math.cos(a) * r + (this.noise() - 0.5) * 0.12,
        oy: Math.sin(a) * r * 0.58 + (this.noise() - 0.5) * 0.10,
        phase: this.noise() * Math.PI * 2,
        dying: -1,
      });
    }
    /* Losses kill from the back of the formation and the machine stays on the field, falling.
       Removing it outright is the difference between "a squad shrank" and "you watched it die". */
    let alive = 0;
    for (const b of s.bodies) if (b.dying < 0) alive++;
    for (let i = s.bodies.length - 1; i >= 0 && alive > want; i--) {
      const b = s.bodies[i]!;
      if (b.dying < 0) { b.dying = 0; alive--; }
    }
    /* Wrecks clear, and only a few are kept. A squad losing six machines over four ticks was
       stacking six corpses inside one hex on top of the survivors, and the hex became an
       unreadable heap of overlapping figures — which reads as a rendering fault, not a rout. */
    s.bodies = s.bodies.filter(b => b.dying < 0 || b.dying < DEATH_FALL + CORPSE_LINGER);
    let wrecks = 0;
    for (let i = s.bodies.length - 1; i >= 0; i--) {
      if (s.bodies[i]!.dying < 0) continue;
      if (++wrecks > MAX_WRECKS) s.bodies.splice(i, 1);
    }
  }

  /* ---------- the frame ---------- */

  draw(scene: Scene) {
    if (!this.ok) return;
    const now = performance.now() / 1000;
    const dt = this.last ? Math.min(0.05, now - this.last) : 0.016;
    this.last = now;
    this.stamp++;

    const pw = Math.max(1, Math.round(scene.w * scene.dpr));
    const ph = Math.max(1, Math.round(scene.h * scene.dpr));

    this.advance(scene, dt);

    const drawing = () => this.paint(scene, now);
    if (this.post) {
      this.batch.begin(pw, ph, [0, 0, 0], 0);
      this.post.bindScene(pw, ph);
      drawing();
      this.batch.end();
      this.post.present(now, 0);
    } else {
      this.batch.begin(pw, ph, [0, 0, 0], 0);
      drawing();
      this.batch.end();
    }
  }

  /** Advance animation state to match the frame the page is showing. */
  private advance(scene: Scene, dt: number) {
    const nowMs = performance.now();

    for (const v of scene.squads) {
      const s = this.squadOf(v);
      s.seen = this.stamp;
      s.side = v.side; s.role = v.role; s.n = v.n;
      if (v.x !== s.tx || v.y !== s.ty) {
        /* The frame teleports a squad a whole hex; the machines walk it. Without this the entire
           battle is a slideshow, and no amount of muzzle flash rescues a slideshow. */
        s.px = s.x; s.py = s.y;
        s.tx = v.x; s.ty = v.y;
        s.moveT = 0;
        if (Math.abs(v.x - s.px) > 1) s.facing = v.x > s.px ? 1 : -1;
      }
      s.moveT = Math.min(WALK_TIME, s.moveT + dt);
      const k = WALK_TIME <= 0 ? 1 : s.moveT / WALK_TIME;
      const e = k * k * (3 - 2 * k);                              // ease, so it settles
      s.x = s.px + (s.tx - s.px) * e;
      s.y = s.py + (s.ty - s.py) * e;
      s.fireT += dt; s.struckT += dt; s.meleeT += dt;
      this.fitBodies(s, Math.max(0, Math.min(v.n, maxBodies(v))));
      for (const b of s.bodies) if (b.dying >= 0) b.dying += dt;
    }
    // squads that stopped being sent — wiped, or the battle ended — let go of their state
    for (const [k, s] of this.squads) if (s.seen < this.stamp - 2) this.squads.delete(k);

    /* Reactions are derived from the event list rather than pushed, so scrubbing the playbar
       backwards cannot leave a machine stuck mid-recoil. */
    for (const ev of scene.shots) {
      const age = (nowMs - ev.born) / 1000;
      if (age > FIRE_HOLD + 0.2) continue;
      const shooter = ev.uid != null ? this.squads.get(ev.uid) : null;
      if (shooter) {
        if (ev.melee) shooter.meleeT = Math.min(shooter.meleeT, age);
        else shooter.fireT = Math.min(shooter.fireT, age);
        shooter.aimX = ev.to.x; shooter.aimY = ev.to.y;
        if (Math.abs(ev.to.x - shooter.x) > 2) shooter.facing = ev.to.x > shooter.x ? 1 : -1;
      }
      const target = ev.tuid != null ? this.squads.get(ev.tuid) : null;
      if (target && age > SHOT_TIME) target.struckT = Math.min(target.struckT, age - SHOT_TIME);
    }
  }

  /* ---------- painting ---------- */

  private paint(scene: Scene, now: number) {
    const cam = scene.camera;
    const d = scene.dpr;
    const sx = (x: number) => (x - cam.x) * cam.zoom * d + (scene.w * d) / 2;
    const sy = (y: number) => (y - cam.y) * cam.zoom * d + (scene.h * d) / 2;
    const S = cam.zoom * d;                                   // board px -> device px

    /* Machines are scaled to the grid: a hex is R across, a Line Suit stands about that tall, and
       a Colossus is visibly a different class of object. */
    const unit = scene.R * S;
    const [aw, ah] = [this.atlas.canvas.width, this.atlas.canvas.height];
    const nowMs = performance.now();

    const order = [...scene.squads].sort((a, b) => a.y - b.y);

    // ground shadows first, all of them, so no machine casts a shadow over another machine
    for (const v of order) {
      const s = this.squads.get(v.key); if (!s) continue;
      const scale = bodyScale(v) * unit / this.atlas.cellSize;
      for (const b of s.bodies) {
        const bx = sx(s.x + b.ox * scene.R), by = sy(s.y + b.oy * scene.R);
        const fade = b.dying >= 0 ? Math.max(0, 1 - b.dying / (DEATH_FALL + 1.0)) : 1;
        this.batch.sprite(this.atlas.glow, aw, ah, bx, by + unit * 0.30,
          scale * 0.55, 0, [0, 0, 0.02, 0.42 * fade * (v.alpha ?? 1)], 'normal');
        /* and a faint pad in the side's colour under the shadow. It is the only marking that
           still works when two squads are standing on top of each other. */
        const c = v.side === 'p' ? this.skin(v.era).palette.player : this.skin(v.era).palette.foe;
        this.batch.sprite(this.atlas.glow, aw, ah, bx, by + unit * 0.31,
          scale * 0.40, 0, rgba(c, 0.42 * fade * (v.alpha ?? 1)), 'add');
      }
    }

    for (const v of order) {
      const s = this.squads.get(v.key); if (!s) continue;
      this.paintSquad(scene, s, v, sx, sy, unit, aw, ah, now);
    }

    // weapons last and additive, so they light everything they cross
    for (const ev of scene.shots) this.paintShot(scene, ev, sx, sy, S, aw, ah, nowMs);
    for (const b of scene.booms) this.paintBoom(b, sx, sy, S, aw, ah, nowMs);
  }

  private paintSquad(scene: Scene, s: Squad, v: SquadView,
                     sx: (x: number) => number, sy: (y: number) => number,
                     unit: number, aw: number, ah: number, now: number) {
    const arch = ARCH[v.role] ?? 'grunt';
    const scale = bodyScale(v) * unit / this.atlas.cellSize;
    const walking = s.moveT < WALK_TIME;
    const alpha = v.alpha ?? 1;
    const skin = this.skin(v.era);
    const accent = v.side === 'p' ? skin.palette.player : skin.palette.foe;

    for (const b of s.bodies) {
      const bx = sx(s.x + b.ox * scene.R);
      const bob = b.dying >= 0 ? 0 : Math.sin(now * 2.1 + b.phase) * unit * 0.012;
      const by = sy(s.y + b.oy * scene.R) + bob;

      const team = TEAM[v.side];
      let pose: PoseName = 'idle';
      let tilt = 0, lift = 0;
      let tint: [number, number, number, number] = [team[0], team[1], team[2], alpha];

      if (b.dying >= 0) {
        /* A destroyed machine falls, and keeps burning for a moment after it lands. It is the
           only readout in the game that tells you a loss happened where it happened. */
        const k = Math.min(1, b.dying / DEATH_FALL);
        pose = k < 0.35 ? 'struck' : 'down';
        tilt = k * 0.42 * -s.facing;
        lift = k * unit * 0.10;
        const fade = Math.max(0, 1 - Math.max(0, b.dying - DEATH_FALL) / 1.0);
        // a wreck cools from its own fire back to dead metal
        tint = [team[0], team[1] * (0.55 + 0.45 * (1 - k)), team[2] * (0.4 + 0.6 * (1 - k)), fade * alpha];
      } else if (s.struckT < STRUCK_HOLD) {
        const k = s.struckT / STRUCK_HOLD;
        pose = 'struck';
        /* A hot flash on the frame itself, decaying. It has to stay warm rather than white: pushed
           to white it clips, the bright pass takes the whole silhouette, and the bloom returns a
           featureless blob where the machine getting shot used to be. */
        const f = (1 - k) * 0.55;
        tint = [team[0] + f * 1.0, team[1] + f * 0.5, team[2] + f * 0.25, alpha];
        tilt = (1 - k) * 0.16 * -s.facing;
      } else if (s.meleeT < FIRE_HOLD) {
        const k = s.meleeT / FIRE_HOLD;
        pose = k < 0.35 ? 'windup' : 'swing';
      } else if (s.fireT < FIRE_HOLD) {
        pose = s.fireT < 0.13 ? 'recoil' : 'aim';
      } else if (walking) {
        pose = (Math.floor(now * 7 + b.phase) & 1) ? 'walkA' : 'walkB';
      } else if (v.charging) {
        pose = 'boost';
        lift = Math.abs(Math.sin(now * 5 + b.phase)) * unit * 0.06;
      } else if (scene.fighting) {
        pose = Math.sin(now * 1.4 + b.phase) > 0.7 ? 'aim' : 'idle';
      }

      const cell = this.atlas.cell(skin.id, arch, pose, v.side);
      /* Rotation is about the sprite's centre, so a machine tipping over swings its feet out from
         under it and reads as floating. Shifting the centre by the arc its feet would travel puts
         the pivot back on the ground where a falling machine's pivot actually is. */
      const foot = this.atlas.cellSize * scale * 0.42;
      const px = bx + Math.sin(tilt) * foot;
      const py = (by - lift) + foot * (1 - Math.cos(tilt));
      this.batch.sprite(cell, aw, ah, px, py, scale, tilt, tint, 'normal', s.facing < 0);

      /* Thrusters, for anything that boosts. Two soft flames under the machine — the cheapest
         possible way to say "this thing is not walking". */
      if ((v.charging || (walking && arch === 'brawler')) && b.dying < 0) {
        const f = 0.55 + Math.abs(Math.sin(now * 22 + b.phase)) * 0.45;
        for (const dx of [-0.11, 0.11]) {
          this.batch.sprite(this.atlas.glow, aw, ah, bx + dx * unit, by + unit * 0.24,
            scale * 0.42 * f, 0, rgba(accent, 0.72 * alpha), 'add');
        }
      }
    }

    if (v.selected) {
      // a soft mark under the selected squad; the hard ring is still drawn by the page
      this.batch.sprite(this.atlas.glow, aw, ah, sx(s.x), sy(s.y) + unit * 0.32,
        unit * 2.4 / this.atlas.cellSize, 0, rgba('#56D2E4', 0.34), 'add');
    }
  }

  private paintShot(scene: Scene, ev: ShotView,
                    sx: (x: number) => number, sy: (y: number) => number,
                    S: number, aw: number, ah: number, nowMs: number) {
    const age = (nowMs - ev.born) / 1000;
    const look = this.skin(ev.era).look(WEAPON[ev.role ?? 'line'] ?? 'rifle');
    const col = look.colour;
    const unit = scene.R * S;

    const shooter = ev.uid != null ? this.squads.get(ev.uid) : null;
    const x0 = sx(shooter ? shooter.x : ev.from.x);
    const y0 = sy(shooter ? shooter.y : ev.from.y) - unit * 0.30;   // shots leave at chest height
    const tgt = ev.tuid != null ? this.squads.get(ev.tuid) : null;
    const x1 = sx(tgt ? tgt.x : ev.to.x);
    const y1 = sy(tgt ? tgt.y : ev.to.y) - unit * 0.26;

    if (ev.melee) {
      /* A blade doesn't travel. The arc is drawn at the target, swept through the strike. */
      if (age > 0.42) return;
      const k = age / 0.42;
      const mx = x0 + (x1 - x0) * 0.72, my = y0 + (y1 - y0) * 0.72;
      const a = -0.9 + k * 2.4;
      const len = unit * 1.15 * Math.sin(Math.min(1, k * 1.6) * Math.PI);
      this.batch.stretched(this.atlas.streak, aw, ah, mx, my, len, Math.max(2.5, unit * 0.10),
        a, rgba(col, (1 - k) * 0.95), 'add');
      this.batch.sprite(this.atlas.glow, aw, ah, mx, my,
        unit * 0.9 / this.atlas.cellSize * (0.6 + k), 0, rgba(col, (1 - k) * 0.55), 'add');
      if (k > 0.45) this.sparks(mx, my, unit, col, (k - 0.45) / 0.55, aw, ah, ev.crits ?? 0);
      return;
    }

    const t = Math.min(1, age / SHOT_TIME);

    // muzzle flash, at the moment of firing
    if (age < 0.11 && look.flash > 0) {
      const f = 1 - age / 0.11;
      this.batch.sprite(this.atlas.glow, aw, ah, x0, y0,
        unit * 0.75 / this.atlas.cellSize * f, 0, rgba(col, 0.75 * f), 'add');
    }

    if (t < 1) {
      const flight: Flight = { x0, y0, x1, y1, t, age, ev };
      this.paintFlight(flight, look.kind === 'arc' || !!ev.indirect, col, look.width, unit, aw, ah);
    }

    // impact
    const hitAge = age - SHOT_TIME;
    if (hitAge >= 0 && hitAge < IMPACT_TIME) {
      const k = hitAge / IMPACT_TIME;
      const heavy = (ev.killed ?? 0) > 0;
      const size = (ev.splash ? 1.5 : 0.85) * (heavy ? 1.4 : 1);
      this.batch.sprite(this.atlas.glow, aw, ah, x1, y1,
        unit * size / this.atlas.cellSize * (0.35 + k * 1.5), 0,
        rgba(heavy ? '#FFD9A0' : col, (1 - k) * (heavy ? 0.8 : 0.5)), 'add');
      if (k < 0.6) this.sparks(x1, y1, unit, col, k / 0.6, aw, ah, (ev.crits ?? 0) + (heavy ? 3 : 0));
    }
  }

  /** The bolt itself: a tapered streak along its path, arcing if the weapon lobs. */
  private paintFlight(f: Flight, arcs: boolean, col: string, width: number,
                      unit: number, aw: number, ah: number) {
    const seg = 0.22;                                  // how much of the path the bolt occupies
    const t1 = f.t, t0 = Math.max(0, f.t - seg);
    const pt = (t: number): [number, number] => {
      const x = f.x0 + (f.x1 - f.x0) * t;
      let y = f.y0 + (f.y1 - f.y0) * t;
      if (arcs) y -= Math.sin(t * Math.PI) * unit * 1.35;   // a lobbed round clears the ridgeline
      return [x, y];
    };
    const [ax, ay] = pt(t0), [bx, by] = pt(t1);
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const rot = Math.atan2(dy, dx);
    const w = width * unit * 0.035;

    /* A soft sheath in the weapon's colour, then a thin white core down the middle of it. Both are
       sized in pixels — the streak is a 96px cell and drawing it at its own scale put a blob the
       size of two hexes on every shot. */
    this.batch.stretched(this.atlas.streak, aw, ah, (ax + bx) / 2, (ay + by) / 2,
      len, Math.max(2.5, w * 3.0), rot, rgba(col, 0.55), 'add');
    this.batch.stretched(this.atlas.streak, aw, ah, (ax + bx) / 2, (ay + by) / 2,
      len, Math.max(1.2, w), rot, [1, 1, 1, 0.9], 'add');
    this.batch.sprite(this.atlas.glow, aw, ah, bx, by,
      unit * 0.34 / this.atlas.cellSize, 0, rgba(col, 0.7), 'add');
  }

  private sparks(x: number, y: number, unit: number, col: string, k: number,
                 aw: number, ah: number, extra: number) {
    const n = 5 + Math.min(8, extra * 2);
    for (let i = 0; i < n; i++) {
      /* Fixed angles from the index rather than a random draw: a spark that jumps to a new
         bearing every frame reads as static, not as debris. */
      const a = i * 2.399;
      const r = unit * (0.25 + 1.15 * k) * (0.6 + (i % 3) * 0.22);
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.7 + unit * k * k * 0.5;   // and they fall
      this.batch.sprite(this.atlas.glow, aw, ah, px, py,
        unit * 0.20 / this.atlas.cellSize * (1 - k), 0, rgba(col, (1 - k) * 0.85), 'add');
    }
  }

  private paintBoom(b: BoomView, sx: (x: number) => number, sy: (y: number) => number,
                    S: number, aw: number, ah: number, nowMs: number) {
    const age = (nowMs - b.born) / 1000;
    if (age > 0.75) return;
    const k = age / 0.75;
    const unit = 25 * S;
    const x = sx(b.x), y = sy(b.y) - unit * 0.2;
    this.batch.sprite(this.atlas.glow, aw, ah, x, y,
      unit * 3.2 / this.atlas.cellSize * (0.3 + k * 1.6), 0,
      rgba('#FFB05A', (1 - k) * 0.9), 'add');
    this.sparks(x, y, unit, '#FFD9A0', k, aw, ah, 6);
  }
}

/** How many machines a squad is worth drawing. Eight pods in one hex is mush at any zoom. */
function maxBodies(v: SquadView): number {
  return Math.min(v.n, v.nMax > 6 ? 6 : v.nMax);
}

/** Bigger classes stand taller — the silhouette is doing the identification work. */
function bodyScale(v: SquadView): number {
  const crowd = maxBodies(v) >= 5 ? 0.82 : maxBodies(v) >= 3 ? 0.92 : 1;
  const cls = v.role === 'heavy' ? 1.55 : v.role === 'ace' ? 1.2
    : v.role === 'siege' ? 1.15 : v.role === 'swarm' ? 0.8 : 1;
  return 1.35 * crowd * cls;
}

/** Build a renderer, or null if this browser cannot. The page falls back to flat tokens. */
export function createBoardRenderer(canvas: HTMLCanvasElement, era?: string): BoardRenderer | null {
  try {
    const r = new BoardRenderer(canvas, era);
    return r.ok ? r : null;
  } catch { return null; }
}
