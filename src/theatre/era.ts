/* Eras are vocabulary, not code.
 *
 * The performance knows a squad is making a `blade` strike. It does not know, and must never know,
 * whether that is a bronze falx or a beam sabre. An EraSkin answers three questions —
 *
 *   what colour is this war        palette
 *   what does that weapon look     look(WeaponClass)
 *   what shape is this machine     rig(Archetype)
 *
 * — and that is the whole of what it takes to move an engagement ten thousand years. Adding an era
 * is adding one object to ERAS. Nothing in the renderer or the performance changes.
 */

import type { Archetype, WeaponClass } from './script';

/** How a shot reads in flight. */
export interface WeaponLook {
  /** A drawn bolt, a solid slug, an arcing thrown thing, or a held edge. */
  kind: 'beam' | 'slug' | 'arc' | 'edge';
  colour: string;
  /** Core thickness in pixels at standard scale. */
  width: number;
  /** How far the muzzle flash throws light. 0 for anything that does not flash. */
  flash: number;
  /** Travel in metres per second. Edges do not travel. */
  speed: number;
  /** Does it leave a trail behind it as it goes. */
  trail: boolean;
}

/** Proportions of the procedurally drawn figure. Metres. */
export interface RigSpec {
  height: number;
  /** Shoulder width relative to height. */
  breadth: number;
  /** Head size relative to height. A helm, a cockpit, a sensor cluster. */
  head: number;
  /** Does it have visible thrusters — decides whether it boosts or runs. */
  thrusters: boolean;
  /** Bulk of the limbs. Stone-age levies are thin; a Colossus is not. */
  limb: number;
  /* The four fields below are what make an age recognisable from its outline alone. Colour tells
     you which age at a glance and stops working the moment the figure is thirty pixels tall and
     half of it is in shadow; silhouette keeps working. */
  /** How much armour sits on the frame: 0 is a body with a weapon, 1 is a walking tank. */
  plating: number;
  /** A shield on the off arm. The single strongest read for pre-gunpowder warfare. */
  shield: boolean;
  /** Helmet crest height, relative to the head. 0 for anything with a sealed cockpit. */
  crest: number;
  /** A lit visor. Nothing before electric light has one. */
  visor: boolean;
}

export interface Palette {
  sky: [string, string];
  haze: string;
  ground: [string, string];
  player: string;
  foe: string;
  metal: string;
  shadow: string;
}

export interface EraSkin {
  id: string;
  name: string;
  /** Shown when the theatre opens, so you know what age you are watching. */
  blurb: string;
  palette: Palette;
  look(w: WeaponClass): WeaponLook;
  rig(a: Archetype): RigSpec;
}

const baseRig = (a: Archetype): RigSpec => {
  const b = { plating: 1, shield: false, crest: 0, visor: true };
  switch (a) {
    case 'grunt':     return { ...b, height: 1.8, breadth: 0.26, head: 0.13, thrusters: false, limb: 0.9 };
    case 'brawler':   return { ...b, height: 2.0, breadth: 0.30, head: 0.13, thrusters: true,  limb: 1.0 };
    case 'heavy':     return { ...b, height: 2.6, breadth: 0.42, head: 0.11, thrusters: false, limb: 1.5 };
    case 'artillery': return { ...b, height: 2.1, breadth: 0.38, head: 0.10, thrusters: false, limb: 1.2 };
    case 'ace':       return { ...b, height: 2.1, breadth: 0.28, head: 0.12, thrusters: true,  limb: 0.95 };
  }
};

/* ---------- the ages ---------- */

/** Sticks and stones. Everything is thrown, swung, or carried on a shaft. */
const STONE: EraSkin = {
  id: 'stone',
  name: 'THE LONG WAR',
  blurb: 'Bronze and bone. Nothing here travels faster than an arm can throw it.',
  palette: {
    sky: ['#2A2016', '#6B4A2A'], haze: '#8A6A44',
    ground: ['#3A2E20', '#241B12'],
    player: '#C8A15E', foe: '#8E4B3A', metal: '#B9A98A',
    shadow: 'rgba(10,6,2,.5)',
  },
  look(w) {
    switch (w) {
      case 'sidearm': return { kind: 'arc',  colour: '#D8C08A', width: 2, flash: 0,  speed: 22, trail: false };
      case 'rifle':   return { kind: 'arc',  colour: '#E4D2A2', width: 2, flash: 0,  speed: 34, trail: false };
      case 'cannon':  return { kind: 'arc',  colour: '#9C8B6A', width: 5, flash: 0,  speed: 18, trail: false };
      case 'lobbed':  return { kind: 'arc',  colour: '#8C7A56', width: 4, flash: 0,  speed: 14, trail: false };
      case 'blade':   return { kind: 'edge', colour: '#E8DCC0', width: 3, flash: 0,  speed: 0,  trail: false };
      case 'polearm': return { kind: 'edge', colour: '#D6C39A', width: 3, flash: 0,  speed: 0,  trail: false };
    }
  },
  /* A body carrying a shield and a shaft. Short, thin, crested, and wearing almost nothing —
     the outline of a man, which is exactly what it should be ten thousand years before a cockpit. */
  rig(a) {
    const r = baseRig(a);
    return { ...r, height: r.height * 0.62, thrusters: false, limb: r.limb * 0.78,
      breadth: r.breadth * 0.85, plating: 0.22, shield: a !== 'artillery' && a !== 'heavy', crest: 0.9, visor: false };
  },
};

/** Powder and plate. Muzzle flash, iron, and the first machines that outweigh their crew. */
const INDUSTRIAL: EraSkin = {
  id: 'industrial',
  name: 'THE FOUNDRY WARS',
  blurb: 'Powder, plate and smoke. Range starts to mean something.',
  palette: {
    sky: ['#1B2026', '#4A5560'], haze: '#6E7A85',
    ground: ['#2E3339', '#1A1E22'],
    player: '#C7752F', foe: '#9E3A32', metal: '#8E9AA6',
    shadow: 'rgba(4,8,12,.5)',
  },
  look(w) {
    switch (w) {
      case 'sidearm': return { kind: 'slug', colour: '#FFC77A', width: 2, flash: 10, speed: 120, trail: false };
      case 'rifle':   return { kind: 'slug', colour: '#FFD089', width: 2, flash: 14, speed: 190, trail: true };
      case 'cannon':  return { kind: 'slug', colour: '#FFB05A', width: 5, flash: 26, speed: 150, trail: true };
      case 'lobbed':  return { kind: 'arc',  colour: '#C6C0B0', width: 4, flash: 12, speed: 40,  trail: true };
      case 'blade':   return { kind: 'edge', colour: '#DCE6F0', width: 3, flash: 0,  speed: 0,   trail: false };
      case 'polearm': return { kind: 'edge', colour: '#C8D2DC', width: 3, flash: 0,  speed: 0,   trail: false };
    }
  },
  /* Plate over everything and a sealed helm with no light behind it. Broad in the shoulder and
     short in the leg — the age when armour got heavier faster than the legs carrying it. */
  rig(a) {
    const r = baseRig(a);
    return { ...r, height: r.height * 0.84, breadth: r.breadth * 1.22, limb: r.limb * 1.15,
      plating: 0.8, shield: false, crest: 0.25, visor: false };
  },
};

/** Mobile suits. Beams, thrusters, and machines that move faster than they have any right to. */
const MOBILE_SUIT: EraSkin = {
  id: 'mobilesuit',
  name: 'THE SORTIE',
  blurb: 'Beam and thrust. Everything on this field can kill everything else.',
  palette: {
    sky: ['#0B1017', '#16283C'], haze: '#2B4A6B',
    ground: ['#1B222B', '#0E1319'],
    player: '#FF6A1F', foe: '#FF4438', metal: '#8CA0B4',
    shadow: 'rgba(0,4,10,.55)',
  },
  look(w) {
    switch (w) {
      case 'sidearm': return { kind: 'beam', colour: '#FFB84D', width: 2, flash: 14, speed: 320, trail: true };
      case 'rifle':   return { kind: 'beam', colour: '#FF8A3D', width: 3, flash: 22, speed: 420, trail: true };
      case 'cannon':  return { kind: 'beam', colour: '#FF5A2A', width: 6, flash: 40, speed: 380, trail: true };
      case 'lobbed':  return { kind: 'arc',  colour: '#7FE3F5', width: 4, flash: 18, speed: 70,  trail: true };
      case 'blade':   return { kind: 'edge', colour: '#7FE3F5', width: 5, flash: 30, speed: 0,   trail: true };
      case 'polearm': return { kind: 'edge', colour: '#A7F0FF', width: 4, flash: 26, speed: 0,   trail: true };
    }
  },
  /* Tall, thin in the limb and enormous in the pauldron, with a lit visor and thrust behind it.
     Nothing about this shape would survive gravity without the engine, which is the point. */
  rig(a) {
    const r = baseRig(a);
    return { ...r, height: r.height * 1.08, limb: r.limb * 0.92, breadth: r.breadth * 1.1,
      thrusters: true, plating: 1, shield: false, crest: 0, visor: true };
  },
};

export const ERAS: EraSkin[] = [STONE, INDUSTRIAL, MOBILE_SUIT];
export const eraById = (id: string): EraSkin => ERAS.find(e => e.id === id) ?? MOBILE_SUIT;
