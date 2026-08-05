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
  /** Seconds of thruster burn left, for the flame behind a boosting machine. */
  burn: number;
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
  /** Whites the frame out briefly on a heavy hit; handed to the bloom composite. */
  private flash = 0;
  /** Seconds of slow motion left. A crit that lands at full speed is just a number changing. */
  private slow = 0;
  /** A brief camera punch-in on impact. */
  private punch = 0;
  private ridges = makeRidges();

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
        vx: 0, y: 0, vy: 0, count: a.count, down: false, flash: 0, burn: 0,
      });
    }
  }

  /** Jump the clock, replaying nothing — used by the scrubber. Runs without the cinematic
      time-scaling, or seeking to 6.8s would not land on 6.8s. */
  seek(t: number) {
    this.reset();
    const step = 1 / 30;
    for (let c = 0; c < t; c += step) this.advance(Math.min(step, t - c), false);
  }

  advance(dt: number, cinematic = true) {
    // decay the cinematic state on real time, not story time, or slow motion never ends
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.punch = Math.max(0, this.punch - dt * 2.2);
    if (cinematic && this.slow > 0) { this.slow = Math.max(0, this.slow - dt); dt *= 0.34; }
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
        if (b.style === 'boost') { p.pose = 'boost'; p.hold = 0.5; p.vy = 9; p.burn = 0.55; }
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
        this.burst(tgt.x, -tgt.actor.scale, tgt.z, look.colour, 14 + b.crit * 8, 1.6);
        this.shake = Math.max(this.shake, 0.7 + b.crit * 0.3);
        this.punch = Math.max(this.punch, 0.6 + b.crit * 0.2);
        if (b.crit >= 2) { this.slow = Math.max(this.slow, 0.45); this.flash = Math.max(this.flash, 0.5); }
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
        if (b.crit) { p.vy = 8; this.shake = Math.max(this.shake, 1.1); this.flash = Math.max(this.flash, 0.55); }
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
        this.burst(p.x, -p.actor.scale, p.z, '#FFC24B', 46, 3.0);
        this.burst(p.x, -p.actor.scale, p.z, '#FFFFFF', 16, 1.6);
        this.shake = 1.5; this.flash = 1; this.slow = Math.max(this.slow, 0.55); this.punch = 1;
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
    p.burn = Math.max(0, p.burn - dt);
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
    const px = PX_PER_METRE * this.camScale * (1 + this.punch * 0.16);
    const horizon = h * 0.44;
    const sx = w / 2 + (x - this.camX) * px * depth;
    const sy = horizon + (h * 0.40 - z * 4.0) * depth + y * px * depth;
    return { sx, sy, k: depth * this.camScale * (1 + this.punch * 0.16) };
  }

  /** The white-out level, for the bloom composite. */
  get flashLevel() { return this.flash; }

  private light(x: number, y: number, size: number, colour: string, alpha: number) {
    this.batch.sprite(this.atlas.glow, this.atlas.canvas.width, this.atlas.canvas.height,
      x, y, size / this.atlas.cellSize, 0, rgba(colour, alpha), 'add');
  }

  /** `intoTarget` means the caller has already sized the batch and bound an offscreen target,
      so this must not clear or resize out from under it. */
  draw(w: number, h: number, intoTarget = false) {
    const pal = this.skin.palette;
    const b = this.batch;
    if (!intoTarget) b.begin(w, h, [0, 0, 0]);

    const jitter = this.shake * 7;
    const ox = (Math.random() - 0.5) * jitter, oy = (Math.random() - 0.5) * jitter;
    const horizon = h * 0.44 + oy;

    // sky
    const bands = 18;
    for (let i = 0; i < bands; i++) {
      const t = Math.pow(i / (bands - 1), 0.8);
      b.quad(w / 2, (horizon / bands) * (i + 0.5), w, horizon / bands + 1, 0,
        mix(rgba(pal.sky[0]), rgba(pal.sky[1]), t));
    }

    // a low sun sitting in the haze, which is what gives the sky a direction
    const sunX = w * 0.68, sunY = horizon - h * 0.02;
    this.light(sunX, sunY, h * 0.62, pal.haze, 0.34);
    this.light(sunX, sunY, h * 0.16, '#FFFFFF', 0.30);

    /* Parallax ridges. Three layers of column quads from a fixed heightfield: the far ones barely
       move with the camera, the near ones slide, and that difference is the only thing telling
       you the battlefield has depth beyond the actors. */
    for (let layer = 0; layer < 3; layer++) {
      const par = 0.06 + layer * 0.10;
      const amp = h * (0.045 + layer * 0.030);
      const base = horizon + layer * h * 0.012;
      const tint = mix(rgba(pal.haze), rgba(pal.ground[1]), 0.35 + layer * 0.28);
      tint[3] = 1;
      const cols = 64;
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        const wx = u * w;
        const n = this.ridges[(layer * 97 + i) % this.ridges.length]!;
        const shift = -this.camX * par * PX_PER_METRE * 0.10;
        const hgt = amp * (0.35 + n);
        b.quad(wx + shift, base - hgt / 2, w / cols + 2, hgt, 0, tint);
      }
    }

    // haze band over the join, so ridges sit in air rather than on a line
    b.quad(w / 2, horizon, w, h * 0.09, 0, rgba(pal.haze, 0.26), 'add');

    // ground
    const gb = 20;
    for (let i = 0; i < gb; i++) {
      const t = Math.pow(i / (gb - 1), 0.7);
      b.quad(w / 2, horizon + ((h - horizon) / gb) * (i + 0.5), w, (h - horizon) / gb + 1, 0,
        mix(rgba(pal.ground[0]), rgba(pal.ground[1]), t));
    }

    const order = [...this.puppets.values()].sort((a, c) => c.z - a.z);

    // shadows, one per machine
    for (const p of order) {
      const n = Math.min(5, Math.max(1, p.count));
      for (let i = n - 1; i >= 0; i--) {
        const off = i * 3.3;
        const g = this.project(p.x + ox / 20 - p.facing * off * 1.15, 0, p.z + off, w, h);
        const sw = 30 * p.actor.scale * g.k * (1 - Math.min(0.6, p.y * 0.08));
        b.quad(g.sx, g.sy, sw, sw * 0.34, 0, [0, 0, 0, 0.36]);
      }
    }

    for (const p of order) {
      const cell = this.atlas.cell(this.skin.id, p.actor.archetype, p.pose, p.actor.side);
      const n = Math.min(5, Math.max(1, p.count));
      for (let i = n - 1; i >= 0; i--) {
        const off = i * 3.3;
        const gi = this.project(p.x + ox / 20 - p.facing * off * 1.15, -p.y, p.z + off, w, h);
        const sc = (p.actor.scale * SPRITE_SCALE) * gi.k;
        // thruster flame, behind the machine and only while it is burning
        if (p.burn > 0) {
          const fx = gi.sx - p.facing * 16 * sc, fy = gi.sy - cell.h * sc * 0.34;
          this.light(fx, fy, 46 * sc * (0.7 + Math.random() * 0.5), '#9FD8FF', 0.55 * p.burn);
          this.light(fx, fy, 22 * sc, '#FFFFFF', 0.5 * p.burn);
        }
        b.sprite(cell, this.atlas.canvas.width, this.atlas.canvas.height,
          gi.sx, gi.sy - cell.h * sc * 0.5, sc, 0,
          [1, 1, 1, i === 0 ? 1 : 0.84 - i * 0.08], 'normal', p.facing < 0);
        if (p.flash > 0 && i === 0) {
          this.light(gi.sx, gi.sy - cell.h * sc * 0.45, 60 * sc, '#FFE8C0', p.flash * 0.38);
        }
      }
    }

    // fire
    for (const s of this.shots) {
      if (s.t < 0) continue;
      const u = Math.min(1, s.t / s.dur);
      const arcLift = s.kind === 'arc' ? -Math.sin(u * Math.PI) * 6 : 0;
      const hx = s.x + (s.tx - s.x) * u;
      const hy = s.y + (s.ty - s.y) * u + arcLift;
      const hz = s.z + (s.tz - s.z) * u;
      const head = this.project(hx, hy, hz, w, h);
      const tailU = Math.max(0, u - (s.trail ? 0.30 : 0.08));
      const tArc = s.kind === 'arc' ? -Math.sin(tailU * Math.PI) * 6 : 0;
      const tail = this.project(s.x + (s.tx - s.x) * tailU,
        s.y + (s.ty - s.y) * tailU + tArc, s.z + (s.tz - s.z) * tailU, w, h);
      const fade = u >= 1 ? Math.max(0, 1 - (s.t - s.dur) * 7) : 1;
      const wide = s.width * head.k * 2.6;
      b.line(tail.sx, tail.sy, head.sx, head.sy, wide, rgba(s.colour, fade * 0.85), 'add');
      b.line(tail.sx, tail.sy, head.sx, head.sy, wide * 0.34, [1, 1, 1, fade * 0.95], 'add');
      this.light(head.sx, head.sy, 26 * head.k * s.width * 0.6, s.colour, fade * 0.8);
      if (u >= 1) {
        // arrival: a bright bloom where it lands
        this.light(head.sx, head.sy, 90 * head.k * fade, s.colour, fade * 0.9);
        this.light(head.sx, head.sy, 36 * head.k * fade, '#FFFFFF', fade * 0.8);
      }
    }

    for (const s of this.sparks) {
      const f = 1 - s.life / s.max;
      const g = this.project(s.x, s.y, s.z, w, h);
      this.light(g.sx, g.sy, s.size * g.k * 9, s.colour, f * 0.85);
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

/* A fixed heightfield for the parallax ridges. Fixed on purpose: the horizon should not reshuffle
   itself every time the page loads or the scrubber moves. */
function makeRidges(): number[] {
  const out: number[] = [];
  let seed = 0x5f3759df;
  for (let i = 0; i < 512; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const a = (seed >>> 16) / 65535;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const b = (seed >>> 16) / 65535;
    out.push((a * 0.65 + b * 0.35));
  }
  // smooth it, or the ridge line is noise rather than terrain
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < out.length - 1; i++) out[i] = (out[i - 1]! + out[i]! * 2 + out[i + 1]!) / 4;
  }
  return out;
}
