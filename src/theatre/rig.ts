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

function limb(ctx: CanvasRenderingContext2D, a: Joint, b: Joint, w: number, colour: string) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawFigure(ctx: CanvasRenderingContext2D, skin: EraSkin, arch: Archetype, p: Pose, tint: string) {
  const spec = skin.rig(arch);
  const s = skeleton(spec, p);
  const px = CELL * 0.62 / spec.height;
  // narrow enough that torso, arms and legs stay separate shapes at stage size
  const thick = Math.max(2.2, spec.breadth * spec.height * px * 0.34 * spec.limb);

  // legs and the far arm sit behind the torso
  limb(ctx, s.hip!, s.kneeL!, thick * 0.9, skin.palette.shadow);
  limb(ctx, s.kneeL!, s.footL!, thick * 0.75, skin.palette.shadow);
  limb(ctx, s.shoulder!, s.elbowL!, thick * 0.7, skin.palette.shadow);
  limb(ctx, s.elbowL!, s.handL!, thick * 0.6, skin.palette.shadow);

  limb(ctx, s.hip!, s.kneeR!, thick, skin.palette.metal);
  limb(ctx, s.kneeR!, s.footR!, thick * 0.82, skin.palette.metal);

  // torso, with the squad's colour down the front so sides read at a glance
  limb(ctx, s.hip!, s.shoulder!, thick * 1.5, skin.palette.metal);
  limb(ctx, s.hip!, s.shoulder!, thick * 0.55, tint);

  // head
  const headR = Math.max(2.2, spec.head * spec.height * px * 0.72);
  ctx.fillStyle = skin.palette.metal;
  ctx.beginPath(); ctx.arc(s.head!.x, s.head!.y, headR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(s.head!.x + headR * 0.35, s.head!.y - headR * 0.1, headR * 0.34, 0, Math.PI * 2);
  ctx.fill();

  // weapon arm last, over the top
  limb(ctx, s.shoulder!, s.elbowR!, thick * 0.85, skin.palette.metal);
  limb(ctx, s.elbowR!, s.handR!, thick * 0.7, skin.palette.metal);

  if (spec.thrusters) {
    ctx.fillStyle = skin.palette.metal;
    const back = { x: s.shoulder!.x - Math.cos(p.lean) * thick * 1.4, y: s.shoulder!.y + Math.sin(p.lean) * thick * 1.4 };
    ctx.fillRect(back.x - thick * 0.5, back.y, thick, thick * 2.2);
  }
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  /** era id -> archetype -> pose -> cell */
  cell(era: string, arch: Archetype, pose: PoseName, side: 'p' | 'e'): Cell;
  /** Where the weapon hand sits inside a cell, so muzzles and blades attach correctly. */
  hand(era: string, arch: Archetype, pose: PoseName): { x: number; y: number };
  cellSize: number;
}

const ARCHES: Archetype[] = ['grunt', 'brawler', 'heavy', 'artillery', 'ace'];

/** Draw every era x archetype x pose x side once, into one texture. */
export function buildAtlas(skins: EraSkin[]): Atlas {
  const sides: ('p' | 'e')[] = ['p', 'e'];
  const cols = POSE_NAMES.length * sides.length;
  const rows = skins.length * ARCHES.length;
  const canvas = document.createElement('canvas');
  canvas.width = cols * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext('2d')!;

  const cells = new Map<string, Cell>();
  const hands = new Map<string, { x: number; y: number }>();
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
          drawFigure(ctx, skin, arch, POSES[pose], side === 'p' ? skin.palette.player : skin.palette.foe);
          ctx.restore();
          cells.set(key(skin.id, arch, pose, side), { x, y, w: CELL, h: CELL });
          col++;
        }
        const s = skeleton(skin.rig(arch), POSES[pose]);
        hands.set(key(skin.id, arch, pose), { x: s.handR!.x, y: s.handR!.y });
      }
      row++;
    }
  }

  return {
    canvas,
    cellSize: CELL,
    cell: (e, a, p, s) => cells.get(key(e, a, p, s)) ?? { x: 0, y: 0, w: CELL, h: CELL },
    hand: (e, a, p) => hands.get(key(e, a, p)) ?? { x: CELL / 2, y: CELL / 2 },
  };
}
