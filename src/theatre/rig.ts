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

const CELL = 96;                 // px per frame — generous, these get scaled down on stage
const GROUND_Y = CELL - 8;       // where the feet land inside a cell

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
  ctx.fillStyle = fill; ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
}

function box(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number,
             rot: number, fill: string, edge?: string) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = fill; ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.restore();
}

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

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

function drawFigure(ctx: CanvasRenderingContext2D, skin: EraSkin, arch: Archetype, p: Pose,
                    tint: string, weapon: 'gun' | 'edge' | 'none'): Joint {
  const spec = skin.rig(arch);
  const s = skeleton(spec, p);
  const px = CELL * 0.62 / spec.height;
  /* plate() and box() take half-widths, so every panel drawn from `unit` comes out twice this
     wide. Sized so a shoulder is about a quarter of the figure's height — armour, not a barrel. */
  const unit = spec.breadth * spec.height * px * spec.limb * 0.55;
  const metal = skin.palette.metal;
  const dark = shade(metal, 0.52);
  const edge = shade(metal, 0.34);

  // far side limbs, darkened so the near side reads in front
  plate(ctx, s.hip!, s.kneeL!, unit * 0.42, unit * 0.34, dark);
  plate(ctx, s.kneeL!, s.footL!, unit * 0.32, unit * 0.24, dark);
  box(ctx, s.footL!.x + unit * 0.12, s.footL!.y, unit * 0.66, unit * 0.28, 0, dark);
  plate(ctx, s.shoulder!, s.elbowL!, unit * 0.32, unit * 0.26, dark);
  plate(ctx, s.elbowL!, s.handL!, unit * 0.26, unit * 0.20, dark);

  const arm = spec.plating;                    // 0 a body with a weapon, 1 a walking tank

  /* The off-hand shield. Drawn before the near-side limbs so the body overlaps it, which is what
     makes it read as carried rather than as a plate stuck to the front of the figure. */
  if (spec.shield) {
    /* Sized from the figure's own height, not from `unit`. `unit` carries breadth and limb bulk,
       so a heavy frame grew a shield taller than itself and the machine vanished behind a plank. */
    const fh = spec.height * px;
    const sw = fh * 0.26, sh = fh * 0.44;
    box(ctx, s.handL!.x - unit * 0.2, s.handL!.y - unit * 0.4, sw, sh, p.lean * 0.5,
      shade(metal, 0.62), edge);
    box(ctx, s.handL!.x - unit * 0.2, s.handL!.y - unit * 0.4, sw * 0.42, sh * 0.5, p.lean * 0.5, tint);
  }

  if (spec.thrusters) {
    const bx = s.shoulder!.x - Math.cos(p.lean) * unit * 0.9;
    const by = s.shoulder!.y + Math.sin(p.lean) * unit * 0.9 + unit * 0.5;
    box(ctx, bx, by, unit * 0.75, unit * 1.5, p.lean, shade(metal, 0.62), edge);
  }

  // near leg
  plate(ctx, s.hip!, s.kneeR!, unit * 0.52, unit * 0.40, metal, edge);
  plate(ctx, s.kneeR!, s.footR!, unit * 0.38, unit * 0.28, metal, edge);
  box(ctx, s.footR!.x + unit * 0.14, s.footR!.y, unit * 0.80, unit * 0.32, 0, shade(metal, 0.75), edge);
  if (arm > 0.4) box(ctx, s.kneeR!.x, s.kneeR!.y, unit * 0.44 * arm, unit * 0.34 * arm, 0, tint);   // knee guard

  // waist and chest as separate blocks, chest wider at the shoulders
  const waist = { x: (s.hip!.x * 2 + s.shoulder!.x) / 3, y: (s.hip!.y * 2 + s.shoulder!.y) / 3 };
  plate(ctx, s.hip!, waist, unit * (0.42 + 0.20 * arm), unit * (0.48 + 0.22 * arm), shade(metal, 0.7), edge);
  plate(ctx, waist, s.shoulder!, unit * (0.52 + 0.26 * arm), unit * (0.62 + 0.40 * arm), metal, edge);
  // a vent block on the chest, not a stripe — and only on something that has vents
  if (arm > 0.5) box(ctx, (waist.x + s.shoulder!.x) / 2, (waist.y + s.shoulder!.y) / 2,
    unit * 0.62, unit * 0.46, p.lean, shade(metal, 0.62), edge);

  /* Pauldrons: the widest thing on a mobile suit and where its colour lives. A levy has none —
     the shoulder is a shoulder — so the two ages read differently from the outline alone. */
  box(ctx, s.shoulder!.x + unit * 0.30, s.shoulder!.y,
    unit * (0.34 + 0.52 * arm), unit * (0.30 + 0.32 * arm), p.lean, tint, edge);
  box(ctx, s.shoulder!.x - unit * 0.42, s.shoulder!.y,
    unit * (0.30 + 0.40 * arm), unit * (0.26 + 0.28 * arm), p.lean, shade(metal, 0.6), edge);

  // head: a small angular block with a lit visor
  const hr = Math.max(2.2, spec.head * spec.height * px * 0.62);
  if (spec.crest > 0) {
    // a crest reads as a helmet at any size, and nothing after gunpowder has one
    box(ctx, s.head!.x - Math.sin(p.lean) * hr * 1.1, s.head!.y - Math.cos(p.lean) * hr * 1.1,
      hr * 0.5, hr * 1.6 * spec.crest, p.lean, tint, edge);
  }
  box(ctx, s.head!.x, s.head!.y, hr * 1.5, hr * 1.7, p.lean, shade(metal, 0.85), edge);
  if (spec.visor) box(ctx, s.head!.x + hr * 0.34, s.head!.y - hr * 0.12, hr * 0.80, hr * 0.32, p.lean, tint);
  else box(ctx, s.head!.x + hr * 0.30, s.head!.y - hr * 0.10, hr * 0.62, hr * 0.26, p.lean, shade(metal, 0.42));

  // weapon arm over the top
  plate(ctx, s.shoulder!, s.elbowR!, unit * 0.40, unit * 0.32, metal, edge);
  plate(ctx, s.elbowR!, s.handR!, unit * 0.32, unit * 0.26, metal, edge);
  return drawWeapon(ctx, s.elbowR!, s.handR!, weapon, spec.height * px * 0.28, metal, tint);
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
          const tip = drawFigure(ctx, skin, arch, POSES[pose],
            side === 'p' ? skin.palette.player : skin.palette.foe, CARRIES[arch]);
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
