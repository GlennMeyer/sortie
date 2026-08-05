/* What the theatre performs.
 *
 * The simulation stays exactly what it is: headless, deterministic, and the only authority on who
 * hit what. It does not know this file exists. A SCRIPT is the flat, timed record of an
 * engagement, and the theatre's whole job is to perform one.
 *
 * Everything here is deliberately era-free. A beat says `melee` with weapon class `blade` — not
 * "beam sabre", not "bronze xiphos". Binding that to something you can look at is an EraSkin's
 * job, which is what lets the same engagement replay as spearmen or as mobile suits without the
 * performance code knowing which it is.
 */

export type Side = 'p' | 'e';
export type ActorId = string;

/** How a machine is built, which decides its rig and how it carries itself. */
export type Archetype = 'grunt' | 'brawler' | 'heavy' | 'artillery' | 'ace';

/** What a weapon *does*, not what it looks like. Skins supply the looks. */
export type WeaponClass =
  | 'sidearm'   // short, fast, low commitment
  | 'rifle'     // the standard ranged engagement
  | 'cannon'    // slow, heavy, one big report
  | 'lobbed'    // arcs over things and lands among them
  | 'blade'     // closes and cuts
  | 'polearm';  // closes and thrusts, with reach

export interface Vec2 { x: number; z: number }

export interface Actor {
  id: ActorId;
  side: Side;
  archetype: Archetype;
  /** Machines still standing, and how many it started with — the rig draws a file of them. */
  count: number;
  countMax: number;
  /** 1 is a standard machine. A Colossus is bigger; a Scrap Pod is not. */
  scale: number;
  at: Vec2;
  name: string;
}

export type Beat =
  /** Crossing ground. `boost` is a committed dash — thrusters lit, no fire on the way in. */
  | { t: number; k: 'move'; who: ActorId; to: Vec2; style: 'walk' | 'boost' }
  /** A ranged exchange. `hits` of `shots` landed; the theatre decides how to show the misses. */
  | { t: number; k: 'shoot'; who: ActorId; at: ActorId; weapon: WeaponClass; shots: number; hits: number; crit: number }
  /** Contact. The swing itself; damage arrives as a separate `struck` so timing can be tuned. */
  | { t: number; k: 'strike'; who: ActorId; at: ActorId; weapon: WeaponClass; crit: number }
  /** Getting out of the way — the reason mechs should not stand in a line trading fire. */
  | { t: number; k: 'evade'; who: ActorId; dir: -1 | 1 }
  /** Taking it. `share` is the fraction of the squad's remaining strength that just went. */
  | { t: number; k: 'struck'; who: ActorId; share: number; crit: boolean; splash: boolean }
  /** One machine of a squad gone. */
  | { t: number; k: 'lose'; who: ActorId }
  /** The squad is finished. */
  | { t: number; k: 'down'; who: ActorId };

export interface Script {
  /** Seconds. The performance is a pure function of the script and a clock. */
  duration: number;
  actors: Actor[];
  beats: Beat[];
  /** Ground the engagement is fought over, so the stage can dress it. */
  ground: 'open' | 'rubble' | 'ridge' | 'marsh';
}

export const actorsById = (s: Script): Map<ActorId, Actor> =>
  new Map(s.actors.map(a => [a.id, a]));

/** Beats due between two instants. The clock may jump — scrubbing is allowed. */
export function beatsBetween(s: Script, from: number, to: number): Beat[] {
  if (to < from) return [];
  return s.beats.filter(b => b.t > from && b.t <= to);
}
