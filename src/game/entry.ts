/* What the page sees.
 *
 * The game is one HTML file with one inlined script, and it is going to stay that way — it has to
 * run from a file:// URL, from a Claude artifact, and from GitHub Pages with no server and no
 * network. So the renderer is compiled to a single IIFE that hangs one object off `window`, and
 * build.js pastes it into the page next to the simulation. TypeScript on this side of the line,
 * plain script on the other, one file out the door.
 */

import { createBoardRenderer, BoardRenderer } from './board';
import type { Scene, SquadView, ShotView, BoomView } from './board';
import { createSound, Sound } from './sound';

export type { Scene, SquadView, ShotView, BoomView, BoardRenderer, Sound };

declare global {
  interface Window {
    SortieGL?: { create: typeof createBoardRenderer };
    SortieSound?: { create: typeof createSound };
  }
}

window.SortieGL = { create: createBoardRenderer };
window.SortieSound = { create: createSound };
