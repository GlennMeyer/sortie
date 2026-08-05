/* The performance.
 *
 * Takes a Script and a clock and draws a frame. It owns no rules: it never decides who hits, only
 * how a hit that already happened should look. That separation is why scrubbing works, why the
 * same engagement can replay in any era, and why none of this can desync from the simulation.
 *
 * The 2.5D is a cheat and an honest one: actors live at (x, z) on a ground plane, and z only ever
 * buys you scale, vertical offset and draw order. No projection matrix, no depth buffer — just
 * back-to-front with a divide.
 */

import type { Actor, ActorId, Script, WeaponClass } from './script';
import { beatsBetween } from './script';
import type { EraSkin } from './era';
import { type Atlas, type PoseName, POSES } from './rig';
import { Batcher, rgba } from './gl';

interface Puppet {
  actor: Actor;
  x: number; z: number;
  /** Where it is heading, and how fast it is getting there. */
  tx: number; tz: number; speed: number;
  facing: 1 | -1;
  pose: PoseName;
  /** Seconds left holding a pose before falling back to idle or walk. */
  hold: number;
  gait: number;
  /** Knocked-back velocity, decays. */
  vx: number;
  /** Lifted off the ground — boosting or reeling. */
  y: number; vy: number;
  count: number;
  down: boolean;
  flash: number;
}

interface Shot {
  x: number; y: number; z: number;
  tx: number; ty: number; tz: number;
  t: number; dur: number;
  colour: string; width: number; kind: 'beam' | 'slug' | 'arc' | 'edge'; trail: boolean;
}

interface Spark {
  x: number; y: number; z: number;
  vx: number; vy: number;
  life: number; max: number; colour: string; size: number;
}

const GRAVITY = 42;
/* The two numbers that tie atlas pixels to world metres. Kept together because they only make
   sense as a pair: a sprite draws CELL * SPRITE_SCALE * k tall, a metre is PX_PER_METRE * k. */
const PX_PER_METRE = 30;
const SPRITE_SCALE = 1.55;

export class Theatre {
  private puppets = new Map<ActorId, Puppet>();
  private shots: Shot[] = [];
  private sparks: Spark[] = [];
  private shake = 0;
  private clock = 0;
  /** Metres either side of the centre line that the camera is trying to hold. */
  private camX = 0;
  private camScale = 1;

  constructor(
    private script: Script,
    private skin: EraSkin,
    private atlas: Atlas,
    private batch: Batcher,
  ) { this.reset(); }

  get time() { return this.clock; }
  get duration() { return this.script.duration; }

  setEra(skin: EraSkin) { this.skin = skin; }

  reset() {
    this.clock = 0;
    this.shots = []; this.sparks = []; this.shake = 0;
    this.puppets.clear();
    for (const a of this.script.actors) {
      this.puppets.set(a.id, {
        actor: a, x: a.at.x, z: a.at.z, tx: a.at.x, tz: a.at.z, speed: 6,
        facing: a.side === 'p' ? 1 : -1, pose: 'idle', hold: 0, gait: Math.random() * 6,
        vx: 0, y: 0, vy: 0, count: a.count, down: false, flash: 0,
      });
    }
  }

  /** Jump the clock, replaying nothing — used by the scrubber. */
  seek(t: number) {
    this.reset();
    const step = 1 / 30;
    for (let c = 0; c < t; c += step) this.advance(Math.min(step, t - c));
  }

  advance(dt: number) {
    const from = this.clock;
    this.clock = Math.min(this.duration, this.clock + dt);
    for (const b of beatsBetween(this.script, from, this.clock)) this.apply(b);

    for (const p of this.puppets.values()) this.stepPuppet(p, dt);
    this.stepShots(dt);
    this.stepSparks(dt);
    this.shake = Math.max(0, this.shake - dt * 3.4);

    // the camera holds the middle of whoever is still standing
    const live = [...this.puppets.values()].filter(p => !p.down);
    if (live.length) {
      const xs = live.map(p => p.x);
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      const spread = Math.max(14, Math.max(...xs) - Math.min(...xs) + 10);
      this.camX += (mid - this.camX) * Math.min(1, dt * 2.4);
      const want = Math.min(2.2, 46 / spread);
      this.camScale += (want - this.camScale) * Math.min(1, dt * 1.8);
    }
  }

  private apply(b: import('./script').Beat) {
    const p = this.puppets.get(b.who);
    if (!p) return;
    switch (b.k) {
      case 'move':
        p.tx = b.to.x; p.tz = b.to.z;
        p.speed = b.style === 'boost' ? 26 : 7;
        if (b.style === 'boost') { p.pose = 'boost'; p.hold = 0.5; p.vy = 9; }
        p.facing = b.to.x >= p.x ? 1 : -1;
        break;
      case 'shoot': {
        const tgt = this.puppets.get(b.at);
        if (!tgt) break;
        p.facing = tgt.x >= p.x ? 1 : -1;
        p.pose = 'recoil'; p.hold = 0.26;
        const look = this.skin.look(b.weapon);
        const muzzle = this.muzzleWorld(p);
        for (let i = 0; i < Math.max(1, Math.min(b.shots, 6)); i++) {
          const spread = (i - b.shots / 2) * 0.35;
          this.shots.push({
            x: muzzle.x, y: muzzle.y, z: p.z,
            tx: tgt.x + spread, ty: -tgt.actor.scale * 1.1, tz: tgt.z,
            t: -i * 0.06, dur: Math.max(0.09, Math.hypot(tgt.x - p.x, tgt.z - p.z) / look.speed),
            colour: look.colour, width: look.width, kind: look.kind, trail: look.trail,
          });
        }
        this.burst(muzzle.x, muzzle.y, p.z, look.colour, look.flash / 6, 0.9);
        this.shake = Math.max(this.shake, b.weapon === 'cannon' ? 0.9 : 0.28);
        break;
      }
      case 'strike': {
        const tgt = this.puppets.get(b.at);
        if (!tgt) break;
        p.facing = tgt.x >= p.x ? 1 : -1;
        p.pose = 'swing'; p.hold = 0.34;
        const look = this.skin.look(b.weapon);
        this.burst(tgt.x, -tgt.actor.scale, tgt.z, look.colour, 10 + b.crit * 6, 1.6);
        this.shake = Math.max(this.shake, 0.7 + b.crit * 0.3);
        break;
      }
      case 'evade':
        p.pose = 'evade'; p.hold = 0.32;
        p.vx = b.dir * 16; p.vy = 7;
        break;
      case 'struck': {
        p.pose = 'struck'; p.hold = 0.24;
        p.flash = 1;
        p.vx += -p.facing * (5 + b.share * 26);
        if (b.crit) { p.vy = 8; this.shake = Math.max(this.shake, 1.1); }
        this.burst(p.x, -p.actor.scale * 1.1, p.z,
          b.crit ? '#FFF0C0' : this.skin.palette.metal, b.splash ? 16 : 8, b.crit ? 1.7 : 1.1);
        break;
      }
      case 'lose':
        p.count = Math.max(0, p.count - 1);
        this.burst(p.x, -p.actor.scale, p.z, '#FF8A3D', 18, 2.1);
        this.shake = Math.max(this.shake, 0.8);
        break;
      case 'down':
        p.down = true; p.pose = 'down'; p.hold = 999;
        this.burst(p.x, -p.actor.scale, p.z, '#FFC24B', 34, 2.8);
        this.shake = 1.5;
        break;
    }
  }

  /* Where a shot leaves the machine, in world metres.
     This was wrong twice over: it used the hand rather than the weapon, and it converted atlas
     pixels to metres with a figure height that did not match the one actually drawn on stage —
     so beams left the fist at roughly hip height. A sprite is drawn CELL * SPRITE_SCALE * k
     pixels tall while a metre is PX_PER_METRE * k pixels, which fixes the conversion exactly. */
  private muzzleWorld(p: Puppet) {
    const cell = this.atlas.cellSize;
    const m = this.atlas.muzzle(this.skin.id, p.actor.archetype, p.pose);
    const mPerPx = (p.actor.scale * SPRITE_SCALE) / PX_PER_METRE;
    return {
      x: p.x + (m.x - cell / 2) * mPerPx * p.facing,
      y: -(this.atlas.figureHeight - m.y) * mPerPx - p.y,
    };
  }

  private burst(x: number, y: number, z: number, colour: string, n: number, force: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.4 + Math.random()) * force * 9;
      this.sparks.push({
        x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3,
        life: 0, max: 0.28 + Math.random() * 0.5, colour, size: 1 + Math.random() * 2.4,
      });
    }
  }

  private stepPuppet(p: Puppet, dt: number) {
    if (!p.down) {
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        const step = Math.min(d, p.speed * dt);
        p.x += (dx / d) * step; p.z += (dz / d) * step;
        p.gait += dt * (p.speed > 12 ? 2 : 9);
        if (p.hold <= 0) p.pose = p.speed > 12 ? 'boost' : (Math.sin(p.gait) > 0 ? 'walkA' : 'walkB');
      } else if (p.hold <= 0) {
        p.pose = 'idle';
      }
    }
    p.x += p.vx * dt;
    p.vx *= Math.pow(0.02, dt);
    p.y += p.vy * dt;
    if (p.y > 0) { p.vy -= GRAVITY * dt; } else { p.y = 0; p.vy = 0; }
    if (p.y > 0) p.vy -= GRAVITY * dt;
    p.hold = Math.max(0, p.hold - dt);
    p.flash = Math.max(0, p.flash - dt * 5);
  }

  private stepShots(dt: number) {
    for (const s of this.shots) s.t += dt;
    this.shots = this.shots.filter(s => s.t < s.dur + 0.12);
  }

  private stepSparks(dt: number) {
    for (const s of this.sparks) {
      s.life += dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vy += GRAVITY * 0.55 * dt;
      s.vx *= Math.pow(0.25, dt);
    }
    this.sparks = this.sparks.filter(s => s.life < s.max);
  }

  /* ---------- drawing ---------- */

  /** World (x metres, y metres up, z depth) -> screen pixels. */
  private project(x: number, y: number, z: number, w: number, h: number) {
    const depth = 1 / (1 + z * 0.045);
    const px = PX_PER_METRE * this.camScale;
    const horizon = h * 0.44;
    const sx = w / 2 + (x - this.camX) * px * depth;
    const sy = horizon + (h * 0.40 - z * 4.0) * depth + y * px * depth;
    return { sx, sy, k: depth * this.camScale };
  }

  draw(w: number, h: number) {
    const pal = this.skin.palette;
    const b = this.batch;
    b.begin(w, h, [0, 0, 0]);

    const jitter = this.shake * 6;
    const ox = (Math.random() - 0.5) * jitter, oy = (Math.random() - 0.5) * jitter;

    // sky, in bands, and a haze along the horizon so the ground has something to meet
    const horizon = h * 0.46 + oy;
    const bands = 14;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const y0 = (horizon / bands) * i;
      b.quad(w / 2, y0 + horizon / bands / 2, w, horizon / bands + 1, 0,
        mix(rgba(pal.sky[0]), rgba(pal.sky[1]), t));
    }
    b.quad(w / 2, horizon, w, h * 0.10, 0, rgba(pal.haze, 0.30), 'add');

    // ground, receding
    const gb = 16;
    for (let i = 0; i < gb; i++) {
      const t = i / (gb - 1);
      const y0 = horizon + ((h - horizon) / gb) * i;
      b.quad(w / 2, y0 + (h - horizon) / gb / 2, w, (h - horizon) / gb + 1, 0,
        mix(rgba(pal.ground[0]), rgba(pal.ground[1]), t));
    }

    const order = [...this.puppets.values()].sort((a, c) => c.z - a.z);

    // shadows first, so nothing casts over a machine in front of it
    for (const p of order) {
      const n = Math.min(5, Math.max(1, p.count));
      for (let i = n - 1; i >= 0; i--) {
        const off = i * 3.3;
        const g = this.project(p.x + ox / 20 - p.facing * off * 1.15, 0, p.z + off, w, h);
        const sw = 30 * p.actor.scale * g.k * (1 - Math.min(0.6, p.y * 0.08));
        b.quad(g.sx, g.sy, sw, sw * 0.34, 0, [0, 0, 0, 0.34]);
      }
    }

    for (const p of order) {
      const cell = this.atlas.cell(this.skin.id, p.actor.archetype, p.pose, p.actor.side);
      // a file of machines: the squad is drawn as up to five figures stepped back in depth
      const n = Math.min(5, Math.max(1, p.count));
      for (let i = n - 1; i >= 0; i--) {
        const off = i * 3.3;
        const gi = this.project(p.x + ox / 20 - p.facing * off * 1.15, -p.y, p.z + off, w, h);
        const sc = (p.actor.scale * SPRITE_SCALE) * gi.k;
        b.sprite(cell, this.atlas.canvas.width, this.atlas.canvas.height,
          gi.sx, gi.sy - cell.h * sc * 0.5, sc, 0,
          [1, 1, 1, i === 0 ? 1 : 0.82 - i * 0.09], 'normal', p.facing < 0);
      }
      /* No hit-flash quad here: an additive rectangle over a figure reads as a white box, not as
         a hit. The spark burst already carries the impact. */
    }

    // fire, over everything, additively
    for (const s of this.shots) {
      if (s.t < 0) continue;
      const u = Math.min(1, s.t / s.dur);
      const hx = s.x + (s.tx - s.x) * u;
      const hy = s.y + (s.ty - s.y) * u + (s.kind === 'arc' ? -Math.sin(u * Math.PI) * 6 : 0);
      const hz = s.z + (s.tz - s.z) * u;
      const head = this.project(hx, hy, hz, w, h);
      const tailU = Math.max(0, u - (s.trail ? 0.26 : 0.06));
      const tx = s.x + (s.tx - s.x) * tailU;
      const ty = s.y + (s.ty - s.y) * tailU + (s.kind === 'arc' ? -Math.sin(tailU * Math.PI) * 6 : 0);
      const tz = s.z + (s.tz - s.z) * tailU;
      const tail = this.project(tx, ty, tz, w, h);
      const fade = u >= 1 ? Math.max(0, 1 - (s.t - s.dur) * 8) : 1;
      const col = rgba(s.colour, fade);
      b.line(tail.sx, tail.sy, head.sx, head.sy, s.width * head.k * 2.2, col, 'add');
      b.line(tail.sx, tail.sy, head.sx, head.sy, s.width * head.k * 0.8, [1, 1, 1, fade * 0.9], 'add');
    }

    for (const s of this.sparks) {
      const f = 1 - s.life / s.max;
      const g = this.project(s.x, s.y, s.z, w, h);
      b.quad(g.sx, g.sy, s.size * g.k * 3.2, s.size * g.k * 3.2, 0, rgba(s.colour, f * 0.9), 'add');
    }

    b.end();
  }
}

function mix(a: [number, number, number, number], c: [number, number, number, number], t: number):
  [number, number, number, number] {
  return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t, 1];
}


export { POSES };
export type { WeaponClass, Actor, Script };
