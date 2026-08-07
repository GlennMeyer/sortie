/* Machines, drawn in code.
 *
 * There is no artist on this project and there is not going to be one, so no sprite ever arrives
 * as a file. Every frame of every machine in every era is drawn into one canvas at load and handed
 * to the GPU as a single texture. That constraint is doing real work: because the figures are
 * generated from a RigSpec, a new era costs one object in era.ts rather than a few hundred frames
 * of animation, and a Colossus is a Line Suit with different numbers rather than a different file.
 *
 * The rig is deliberately crude and readable: a torso, a head, two arms, two legs, and a weapon in
 * the right hand. At the size these draw, silhouette and motion carry everything — a more detailed
 * figure would read as mush and cost ten times as much to pose.
 */

import type { Archetype } from './script';
import type { EraSkin, RigSpec } from './era';

/** One drawn frame in the atlas. */
export interface Cell { x: number; y: number; w: number; h: number }

/** A pose is the set of joint angles the frame was drawn at. */
export interface Pose {
  lean: number;      // torso tilt, radians. Forward is positive.
  armR: number;      // weapon arm, radians from straight down
  armL: number;
  legR: number;
  legL: number;
  crouch: number;    // 0..1, how far the knees are bent
  /** Where the weapon muzzle or blade tip sits, in cell pixels, once posed. */
}

export const POSES = {
  idle:    { lean: 0.02, armR: 0.25, armL: -0.18, legR: 0.06, legL: -0.06, crouch: 0.05 },
  walkA:   { lean: 0.06, armR: 0.20, armL: -0.40, legR: 0.45, legL: -0.35, crouch: 0.10 },
  walkB:   { lean: 0.06, armR: 0.40, armL: -0.20, legR: -0.35, legL: 0.45, crouch: 0.10 },
  aim:     { lean: -0.04, armR: 1.50, armL: 0.65, legR: 0.14, legL: -0.20, crouch: 0.14 },
  recoil:  { lean: -0.16, armR: 1.66, armL: 0.70, legR: 0.18, legL: -0.26, crouch: 0.22 },
  windup:  { lean: -0.30, armR: -0.95, armL: -0.30, legR: -0.30, legL: 0.34, crouch: 0.26 },
  swing:   { lean: 0.42, armR: 1.95, armL: 0.30, legR: 0.55, legL: -0.34, crouch: 0.18 },
  boost:   { lean: 0.55, armR: -0.30, armL: -0.55, legR: -0.42, legL: -0.22, crouch: 0.00 },
  evade:   { lean: -0.40, armR: -0.20, armL: 0.80, legR: -0.55, legL: 0.30, crouch: 0.30 },
  struck:  { lean: -0.50, armR: -0.70, armL: -0.95, legR: -0.20, legL: 0.22, crouch: 0.34 },
  down:    { lean: 1.45, armR: -1.20, armL: -1.40, legR: 0.90, legL: -0.70, crouch: 0.85 },
} satisfies Record<string, Pose>;

export type PoseName = keyof typeof POSES;
export const POSE_NAMES = Object.keys(POSES) as PoseName[];

/* 128, not 96. The board scales figures by `unit / cellSize`, so a bigger cell costs nothing on
   screen — it only buys sampling headroom for the zoom, which previously ran out at about x2.5 and
   went soft exactly when you leaned in to look. The whole sheet is 2816x2048, about 23MB on the
   GPU, which is the most it is worth spending before a phone starts caring. */
const CELL = 128;                // px per frame — generous, these get scaled down on stage
const GROUND_Y = CELL - 11;      // where the feet land inside a cell

interface Joint { x: number; y: number }

/** Pose the skeleton. Everything downstream draws from these points. */
function skeleton(spec: RigSpec, p: Pose): Record<string, Joint> {
  const px = CELL * 0.62 / spec.height;             // metres -> pixels, leaving margin for weapons
  const hipY = GROUND_Y - spec.height * px * 0.48;
  const cx = CELL * 0.5;

  const lean = p.lean;
  const torsoLen = spec.height * px * 0.42;
  const shoulder: Joint = {
    x: cx + Math.sin(lean) * torsoLen,
    y: hipY - Math.cos(lean) * torsoLen + p.crouch * 5,
  };
  const hip: Joint = { x: cx, y: hipY + p.crouch * 7 };
  const headR = spec.head * spec.height * px * 0.72;
  const head: Joint = {
    x: shoulder.x + Math.sin(lean) * headR * 1.25,
    y: shoulder.y - Math.cos(lean) * headR * 1.25,
  };

  const armLen = spec.height * px * 0.34;
  const legLen = spec.height * px * 0.50;
  const j = (from: Joint, ang: number, len: number): Joint =>
    ({ x: from.x + Math.sin(ang) * len, y: from.y + Math.cos(ang) * len });

  return {
    hip, shoulder, head,
    handR: j(shoulder, p.armR, armLen),
    handL: j(shoulder, p.armL, armLen),
    /* Legs hang DOWN from the hip. `j` adds cos(angle) to y and canvas y grows downward, so a
       leg at angle 0 already points at the ground — the Math.PI these used to carry flipped the
       feet up over the torso and folded every figure into a featureless pill. */
    footR: j(hip, p.legR, legLen),
    footL: j(hip, p.legL, legLen),
    elbowR: j(shoulder, p.armR, armLen * 0.55),
    elbowL: j(shoulder, p.armL, armLen * 0.55),
    kneeR: j(hip, p.legR, legLen * 0.55),
    kneeL: j(hip, p.legL, legLen * 0.55),
  };
}

/* Machines are plated, not tubular.
   Round-capped strokes between joints give you a stick man every time — the silhouette that
   results is a tube with a ball on top, and no amount of colour rescues it. Everything here is
   drawn as a tapered quad between two joints, with a darker edge, so limbs read as armour panels
   and the outline has corners. Accent colour goes on pauldrons and the visor; a stripe down the
   chest just reads as a heat map. */

/* LIGHT.
 *
 * The single thing that separated these figures from looking like cut paper was that every panel
 * was one flat colour. A limb drawn as a flat quad is a flat quad at any resolution; a limb with
 * light running down one side of it is a cylinder. So every plate is now filled with a gradient
 * across its own axis rather than along the light direction — light catches the near edge, the far
 * edge falls into shadow, and the shape reads as round without a single extra polygon.
 *
 * One light, from up and to the left, consistent across every figure and every era. Consistency is
 * what makes the shading read as lighting rather than as decoration. */
const LIGHT = { x: -0.55, y: -0.83 };

/** Lighten/darken a hex colour and return rgb(). k > 1 lightens. */
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/* A plate is lit ACROSS its length, so a limb turns into a cylinder rather than a ribbon. The
   gradient runs along the limb's own normal, biased by how much that normal faces the light. */
function limbFill(ctx: CanvasRenderingContext2D, a: Joint, b: Joint, nx: number, ny: number,
                  w: number, base: string): CanvasGradient {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const face = nx * LIGHT.x + ny * LIGHT.y;          // -1 far side, +1 lit side
  const g = ctx.createLinearGradient(mx - nx * w, my - ny * w, mx + nx * w, my + ny * w);
  const lo = 0.58 + face * 0.08, hi = 1.16 + face * 0.10;
  g.addColorStop(0, shade(base, lo));
  g.addColorStop(0.45, shade(base, 0.95 + face * 0.07));
  g.addColorStop(0.80, shade(base, hi));
  g.addColorStop(1, shade(base, 0.74 + face * 0.08));   // a dark lip at the silhouette edge
  return g;
}

function plate(ctx: CanvasRenderingContext2D, a: Joint, b: Joint, wa: number, wb: number,
               fill: string, edge?: string) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * wa, a.y + ny * wa);
  ctx.lineTo(b.x + nx * wb, b.y + ny * wb);
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
  ctx.lineTo(a.x - nx * wa, a.y - ny * wa);
  ctx.closePath();
  ctx.fillStyle = fill.charAt(0) === '#' ? limbFill(ctx, a, b, nx, ny, Math.max(wa, wb), fill) : fill;
  ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
  /* A rim light on the lit edge — and it has to stay a RIM. Scaling its width with the plate put a
     bright slab down the middle of every torso, which reads as a blown highlight rather than as a
     hard edge. It is capped in absolute pixels: a highlight is a property of the boundary, not of
     how big the thing is. */
  if (fill.charAt(0) === '#') {
    const s = nx * LIGHT.x + ny * LIGHT.y > 0 ? 1 : -1;
    const inset = 0.82;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * wa * s * inset, a.y + ny * wa * s * inset);
    ctx.lineTo(b.x + nx * wb * s * inset, b.y + ny * wb * s * inset);
    ctx.strokeStyle = shade(fill, 1.55);
    ctx.lineWidth = Math.min(2.2, Math.max(0.7, Math.min(wa, wb) * 0.30));
    ctx.globalAlpha = 0.42;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function box(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number,
             rot: number, fill: string, edge?: string) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h);
  if (fill.charAt(0) === '#') {
    // lit from the same direction as everything else, in the box's own rotated frame
    const lx = LIGHT.x * Math.cos(-rot) - LIGHT.y * Math.sin(-rot);
    const ly = LIGHT.x * Math.sin(-rot) + LIGHT.y * Math.cos(-rot);
    const g = ctx.createLinearGradient(lx * w * 0.5, ly * h * 0.5, -lx * w * 0.5, -ly * h * 0.5);
    g.addColorStop(0, shade(fill, 1.20));
    g.addColorStop(0.55, shade(fill, 0.98));
    g.addColorStop(1, shade(fill, 0.66));
    ctx.fillStyle = g;
  } else ctx.fillStyle = fill;
  ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.restore();
}

/** The weapon in the right hand, drawn along the forearm. Returns the muzzle or blade tip. */
function drawWeapon(ctx: CanvasRenderingContext2D, elbow: Joint, hand: Joint,
                    cls: 'gun' | 'edge' | 'none', reach: number, metal: string, accent: string): Joint {
  const dx = hand.x - elbow.x, dy = hand.y - elbow.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tip: Joint = { x: hand.x + ux * reach, y: hand.y + uy * reach };
  const ang = Math.atan2(uy, ux);
  if (cls === 'gun') {
    box(ctx, hand.x + ux * reach * 0.30, hand.y + uy * reach * 0.30,
      reach * 0.62, reach * 0.30, ang, shade(metal, 0.55), shade(metal, 0.35));
    plate(ctx, hand, tip, reach * 0.10, reach * 0.055, shade(metal, 0.8));
  } else if (cls === 'edge') {
    box(ctx, hand.x + ux * reach * 0.14, hand.y + uy * reach * 0.14,
      reach * 0.24, reach * 0.20, ang, shade(metal, 0.5));
    plate(ctx, hand, tip, reach * 0.09, reach * 0.02, accent);
  }
  return tip;
}

/* A machine, not a figure with armour on.
 *
 * The lighting pass made these look lit; it did not make them look like mobile suits. What does
 * that is hardware, and specifically these five things, in rough order of how much each one buys:
 *
 *   the head        a fin and two eyes. Nothing says "mobile suit" faster, and it is eight pixels.
 *   skirt armour    plates flaring off the waist. The widest part of the lower body, and the
 *                   reason a mech reads as top-heavy rather than as a person in plate.
 *   the backpack    with sabre hilts standing above the shoulders, breaking the silhouette.
 *   pauldrons       flared, with a raised outer lip, and much wider than a shoulder.
 *   the boots       blocks with a toe, not the little wedges a person stands on.
 *
 * Colour is blocked into four roles rather than metal-plus-accent — body, plate, accent, trim —
 * because "a silhouette in a team colour" is exactly what makes a figure read as a game token.
 */
function drawFigure(ctx: CanvasRenderingContext2D, skin: EraSkin, arch: Archetype, p: Pose,
                    side: 'p' | 'e', weapon: 'gun' | 'edge' | 'none'): Joint {
  const spec = skin.rig(arch);
  const s = skeleton(spec, p);
  const px = CELL * 0.62 / spec.height;
  /* plate() and box() take half-widths, so every panel drawn from `unit` comes out twice this
     wide. Sized so a shoulder is about a quarter of the figure's height — armour, not a barrel. */
  const unit = spec.breadth * spec.height * px * spec.limb * 0.55;
  /* Panels are sized from `unit`, which carries bulk — but a torso's HEIGHT does not, so on the
     widest frames the pauldrons and skirt grew past the body they hang on and the machine became a
     slab. Everything that sticks out sideways is capped against the figure's own height, so bulk
     reads as bulk and never as a pile. */
  const fh = spec.height * px;
  const wide = (v: number) => Math.min(v, fh * 0.20);
  const L = skin.livery(side);
  const body = L.body, plateC = L.plate, accent = L.accent, trim = L.trim;
  const dark = shade(body, 0.46);
  const edge = shade(plateC, 0.42);
  const arm = spec.plating;                    // 0 a body with a weapon, 1 a walking tank
  const lean = p.lean;
  const cos = Math.cos(lean), sin = Math.sin(lean);

  /* ---------- behind everything ---------- */

  /* Backpack and sabre hilts. Two hard verticals rising past the shoulders is the cheapest
     silhouette break available and it is what stops a mech reading as a torso with arms. */
  if (spec.thrusters) {
    const bx = s.shoulder!.x - cos * unit * 0.85, by = s.shoulder!.y + sin * unit * 0.85 + unit * 0.55;
    box(ctx, bx, by, unit * 1.35, unit * 1.7, lean, plateC, edge);
    box(ctx, bx, by + unit * 0.75, unit * 1.05, unit * 0.4, lean, shade(plateC, 0.7));
    for (const d of [-0.55, 0.55]) {
      const hx = bx + cos * 0 + d * unit * 0.9, hy = by - unit * 1.4;
      box(ctx, hx, hy, unit * 0.26, unit * 1.5, lean + d * 0.16, shade(body, 0.8), edge);
      box(ctx, hx, hy - unit * 0.75, unit * 0.30, unit * 0.30, lean + d * 0.16, accent);
    }
  }

  // far-side limbs, darkened so the near side reads in front
  plate(ctx, s.hip!, s.kneeL!, unit * 0.44, unit * 0.34, dark);
  plate(ctx, s.kneeL!, s.footL!, unit * 0.34, unit * 0.26, dark);
  box(ctx, s.footL!.x + unit * 0.16, s.footL!.y, unit * 0.78, unit * 0.32, 0, dark);
  plate(ctx, s.shoulder!, s.elbowL!, unit * 0.34, unit * 0.28, dark);
  plate(ctx, s.elbowL!, s.handL!, unit * 0.28, unit * 0.22, dark);

  /* The off-hand shield, for ages that carry one. Drawn before the near-side limbs so the body
     overlaps it, which is what makes it read as carried rather than bolted on. */
  if (spec.shield) {
    const fh = spec.height * px;
    const sw = fh * 0.23, sh = fh * 0.40;
    const cx2 = s.handL!.x - unit * 0.2, cy2 = s.handL!.y - unit * 0.4;
    box(ctx, cx2, cy2, sw, sh, lean * 0.5, shade(plateC, 0.9), edge);
    box(ctx, cx2, cy2, sw * 0.72, sh * 0.80, lean * 0.5, shade(body, 0.72));
    box(ctx, cx2, cy2, sw * 0.30, sh * 0.17, lean * 0.5, accent);
  }

  /* ---------- legs ---------- */

  plate(ctx, s.hip!, s.kneeR!, unit * 0.54, unit * 0.42, body, edge);
  plate(ctx, s.kneeR!, s.footR!, unit * 0.40, unit * 0.30, body, edge);
  // knee guard: a real shell on anything armoured, and where the accent lands on the leg
  if (arm > 0.35) {
    box(ctx, s.kneeR!.x, s.kneeR!.y, unit * 0.62 * arm, unit * 0.52 * arm, lean, plateC, edge);
    box(ctx, s.kneeR!.x, s.kneeR!.y, unit * 0.30 * arm, unit * 0.24 * arm, lean, accent);
  }
  /* Boots. A mech stands on blocks with a toe, not on the wedge a person stands on — and the
     accent on the foot is straight off every mobile suit ever drawn. */
  const bw = unit * (0.86 + 0.30 * arm), bh = unit * (0.34 + 0.14 * arm);
  box(ctx, s.footR!.x + unit * 0.16, s.footR!.y - bh * 0.25, bw, bh, 0, body, edge);
  box(ctx, s.footR!.x + unit * 0.40, s.footR!.y + bh * 0.18, bw * 0.52, bh * 0.62, 0, accent, edge);

  /* ---------- waist, skirt, chest ---------- */

  const waist = { x: (s.hip!.x * 2 + s.shoulder!.x) / 3, y: (s.hip!.y * 2 + s.shoulder!.y) / 3 };
  // a narrow waist, so the chest and skirt both read as wider than it
  plate(ctx, s.hip!, waist, unit * (0.34 + 0.10 * arm), unit * (0.38 + 0.12 * arm), shade(plateC, 1.1), edge);

  /* Skirt armour: a front plate and two flaring side plates hanging off the waist. This is the
     single biggest change to the lower silhouette — without it a mech is a person in armour. */
  if (arm > 0.45) {
    const sy = s.hip!.y + unit * 0.30;
    box(ctx, s.hip!.x + sin * unit * 0.1, sy, wide(unit * 0.78), unit * 0.92, lean, plateC, edge);
    box(ctx, s.hip!.x + wide(unit * 0.82), sy - unit * 0.05, wide(unit * 0.62), unit * 1.02, lean + 0.22, plateC, edge);
    box(ctx, s.hip!.x - wide(unit * 0.82), sy - unit * 0.05, wide(unit * 0.54), unit * 0.94, lean - 0.22, shade(plateC, 0.82), edge);
    box(ctx, s.hip!.x + sin * unit * 0.1, sy + unit * 0.30, unit * 0.30, unit * 0.20, lean, trim);
  }

  // chest: the dark group, with a bright intake block and vent slots
  plate(ctx, waist, s.shoulder!, wide(unit * (0.54 + 0.26 * arm)), wide(unit * (0.66 + 0.42 * arm)), plateC, edge);
  if (arm > 0.5) {
    const cx3 = (waist.x + s.shoulder!.x) / 2, cy3 = (waist.y + s.shoulder!.y) / 2;
    box(ctx, cx3 + sin * unit * 0.12, cy3, unit * 0.86, unit * 0.60, lean, shade(body, 0.92), edge);
    for (const d of [-0.34, 0.34])
      box(ctx, cx3 + d * unit * 0.62 * cos, cy3 + d * unit * 0.1, unit * 0.26, unit * 0.42, lean, accent);
    box(ctx, cx3, cy3 - unit * 0.42, unit * 0.5, unit * 0.16, lean, trim);
  }

  /* Pauldrons: flared, lipped, and much wider than the shoulder underneath. On a mobile suit these
     are the widest thing on the machine and most of what you recognise at distance. */
  const pw = wide(unit * (0.40 + 0.66 * arm)), ph = unit * (0.34 + 0.42 * arm);
  const sox = wide(unit * 0.42);
  box(ctx, s.shoulder!.x + sox, s.shoulder!.y - unit * 0.06, pw, ph, lean - 0.14, plateC, edge);
  box(ctx, s.shoulder!.x + sox * 1.45, s.shoulder!.y + unit * 0.02, pw * 0.44, ph * 0.86, lean - 0.14, shade(body, 0.86), edge);
  if (arm > 0.5) box(ctx, s.shoulder!.x + sox, s.shoulder!.y - ph * 0.52, pw * 0.68, unit * 0.16, lean - 0.14, trim);
  box(ctx, s.shoulder!.x - sox * 1.24, s.shoulder!.y - unit * 0.04, pw * 0.82, ph * 0.9, lean + 0.14, shade(plateC, 0.78), edge);

  /* ---------- head ---------- */

  const hr = Math.max(2.4, spec.head * spec.height * px * 0.66);
  // helm, then jaw, then the fin — drawn in that order so the fin sits proud of everything
  box(ctx, s.head!.x, s.head!.y, hr * 1.55, hr * 1.55, lean, shade(body, 1.02), edge);
  box(ctx, s.head!.x + sin * hr * 0.5, s.head!.y + cos * hr * 0.52, hr * 1.2, hr * 0.5, lean, shade(plateC, 1.15), edge);
  if (spec.visor) {
    /* Two eyes and a mouth vent. A single visor slit reads as a helmet; a PAIR of eyes reads as a
       face, and a face is the difference between a machine and a lump with a stripe on it. */
    for (const d of [-0.42, 0.42])
      box(ctx, s.head!.x + d * hr * 0.62 * cos + sin * hr * 0.12,
          s.head!.y + d * hr * 0.62 * sin - cos * hr * 0.12, hr * 0.34, hr * 0.26, lean, accent);
    box(ctx, s.head!.x + sin * hr * 0.46, s.head!.y + cos * hr * 0.44, hr * 0.66, hr * 0.16, lean, trim);
    // the fin: a centre blade with two swept vanes
    box(ctx, s.head!.x - sin * hr * 1.05, s.head!.y - cos * hr * 1.05, hr * 0.24, hr * 0.9, lean, trim, edge);
    for (const d of [-1, 1])
      box(ctx, s.head!.x - sin * hr * 0.78 + d * hr * 0.5 * cos,
          s.head!.y - cos * hr * 0.78 + d * hr * 0.5 * sin, hr * 0.62, hr * 0.2, lean + d * 0.55, trim, edge);
  } else if (spec.crest > 0) {
    box(ctx, s.head!.x - sin * hr * 1.1, s.head!.y - cos * hr * 1.1,
      hr * 0.5, hr * 1.6 * spec.crest, lean, accent, edge);
    box(ctx, s.head!.x + sin * hr * 0.32, s.head!.y - cos * hr * 0.1, hr * 0.66, hr * 0.24, lean, shade(plateC, 0.5));
  } else {
    box(ctx, s.head!.x + sin * hr * 0.3, s.head!.y - cos * hr * 0.1, hr * 0.7, hr * 0.26, lean, shade(plateC, 0.5));
  }

  /* ---------- weapon arm, over the top ---------- */

  plate(ctx, s.shoulder!, s.elbowR!, unit * 0.42, unit * 0.34, body, edge);
  plate(ctx, s.elbowR!, s.handR!, unit * 0.34, unit * 0.28, body, edge);
  // a blocky fist, because a mech's hand is a machine part
  box(ctx, s.handR!.x, s.handR!.y, unit * 0.44, unit * 0.40, lean, shade(plateC, 1.05), edge);
  return drawWeapon(ctx, s.elbowR!, s.handR!, weapon, spec.height * px * 0.30, body, accent);
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  /** era id -> archetype -> pose -> cell */
  cell(era: string, arch: Archetype, pose: PoseName, side: 'p' | 'e'): Cell;
  /** Where the shot actually leaves the machine — muzzle or blade tip, in cell pixels. Firing
      from the hand put beams out at hip height; they leave the weapon, not the fist. */
  muzzle(era: string, arch: Archetype, pose: PoseName): { x: number; y: number };
  cellSize: number;
  /** Height of a drawn figure in cell pixels, so the stage can convert to metres. */
  figureHeight: number;
  /** A soft radial falloff. Every spark, flash, flame and sun in the scene samples this — square
      quads are what made the first pass look like confetti. */
  glow: Cell;
  /** A horizontally tapered streak, for beam cores and sabre trails. */
  streak: Cell;
}

const ARCHES: Archetype[] = ['grunt', 'brawler', 'heavy', 'artillery', 'ace'];

/** What each archetype carries. Brawlers and aces close; everything else shoots. */
const CARRIES: Record<Archetype, 'gun' | 'edge'> = {
  grunt: 'gun', brawler: 'edge', heavy: 'gun', artillery: 'gun', ace: 'edge',
};

/** Draw every era x archetype x pose x side once, into one texture. */
export function buildAtlas(skins: EraSkin[]): Atlas {
  const sides: ('p' | 'e')[] = ['p', 'e'];
  const cols = POSE_NAMES.length * sides.length;
  const rows = skins.length * ARCHES.length;
  const canvas = document.createElement('canvas');
  canvas.width = cols * CELL;
  canvas.height = (rows + 1) * CELL;          // one spare row for the light sprites
  const ctx = canvas.getContext('2d')!;

  const cells = new Map<string, Cell>();
  const muzzles = new Map<string, { x: number; y: number }>();
  const key = (e: string, a: Archetype, p: PoseName, s?: string) => `${e}|${a}|${p}${s ? '|' + s : ''}`;

  let row = 0;
  for (const skin of skins) {
    for (const arch of ARCHES) {
      let col = 0;
      for (const pose of POSE_NAMES) {
        for (const side of sides) {
          const x = col * CELL, y = row * CELL;
          ctx.save();
          ctx.translate(x, y);
          ctx.beginPath(); ctx.rect(0, 0, CELL, CELL); ctx.clip();
          const tip = drawFigure(ctx, skin, arch, POSES[pose], side, CARRIES[arch]);
          ctx.restore();
          if (side === 'p') muzzles.set(key(skin.id, arch, pose), tip);
          cells.set(key(skin.id, arch, pose, side), { x, y, w: CELL, h: CELL });
          col++;
        }
      }
      row++;
    }
  }

  /* The light sprites, on the spare row. Every glow in the scene samples these — hard-edged
     quads are what made the first pass read as confetti rather than sparks. */
  const glowCell: Cell = { x: 0, y: rows * CELL, w: CELL, h: CELL };
  {
    const g = ctx.createRadialGradient(glowCell.x + CELL / 2, glowCell.y + CELL / 2, 0,
      glowCell.x + CELL / 2, glowCell.y + CELL / 2, CELL / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.13)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(glowCell.x, glowCell.y, CELL, CELL);
  }
  const streakCell: Cell = { x: CELL, y: rows * CELL, w: CELL, h: CELL };
  {
    /* Composed on its own canvas and then stamped in. 'destination-in' is a WHOLE-CANVAS
       operation — masking the streak directly on the atlas zeroed the alpha of every figure and
       the glow with it, and the entire sheet sampled as nothing. */
    const tmp = document.createElement('canvas');
    tmp.width = CELL; tmp.height = CELL;
    const tc = tmp.getContext('2d')!;
    const along = tc.createLinearGradient(0, 0, CELL, 0);
    along.addColorStop(0, 'rgba(255,255,255,0)');
    along.addColorStop(0.5, 'rgba(255,255,255,1)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    tc.fillStyle = along;
    tc.fillRect(0, 0, CELL, CELL);
    // taper across as well, so a beam ends in a point rather than a flat bar
    const across = tc.createLinearGradient(0, 0, 0, CELL);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    tc.globalCompositeOperation = 'destination-in';
    tc.fillStyle = across;
    tc.fillRect(0, 0, CELL, CELL);
    ctx.drawImage(tmp, streakCell.x, streakCell.y);
  }

  return {
    canvas,
    glow: glowCell,
    streak: streakCell,
    cellSize: CELL,
    figureHeight: GROUND_Y,
    cell: (e, a, p, s) => cells.get(key(e, a, p, s)) ?? { x: 0, y: 0, w: CELL, h: CELL },
    muzzle: (e, a, p) => muzzles.get(key(e, a, p)) ?? { x: CELL / 2, y: CELL / 2 },
  };
}
