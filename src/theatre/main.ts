/* Theatre spike.
 *
 * A hand-written script standing in for one the simulation will emit. The point of this page is to
 * prove the shape: that an engagement is data, that the performance never decides anything, and
 * that switching era changes only vocabulary — same beats, same timings, same outcome, ten
 * thousand years apart. Flip between the three skins while it plays and nothing restarts.
 */

import type { Beat, Script } from './script';
import { ERAS, eraById } from './era';
import { buildAtlas } from './rig';
import { Batcher } from './gl';
import { Theatre } from './theatre';

function demoScript(): Script {
  const beats: Beat[] = [];
  const B = (b: Beat) => beats.push(b);

  // two files of grunts, a brawler apiece, and something heavy on the far side
  const actors: Script['actors'] = [
    { id: 'p1', side: 'p', archetype: 'grunt',   count: 5, countMax: 5, scale: 1.0, at: { x: -11, z: 1 },  name: 'LINE SUITS' },
    { id: 'p2', side: 'p', archetype: 'brawler', count: 3, countMax: 3, scale: 1.05, at: { x: -14, z: 5 }, name: 'LANCERS' },
    { id: 'p3', side: 'p', archetype: 'artillery', count: 2, countMax: 2, scale: 1.2, at: { x: -17, z: 9 }, name: 'SIEGE WALKERS' },
    { id: 'e1', side: 'e', archetype: 'grunt',   count: 5, countMax: 5, scale: 1.0, at: { x: 11, z: 2 },  name: 'LINE SUITS' },
    { id: 'e2', side: 'e', archetype: 'heavy',   count: 1, countMax: 1, scale: 1.5, at: { x: 14, z: 6 }, name: 'COLOSSUS' },
    { id: 'e3', side: 'e', archetype: 'ace',     count: 1, countMax: 1, scale: 1.1, at: { x: 16, z: 10 }, name: 'ACE FRAME' },
  ];

  // opening fire at range
  B({ t: 0.4, k: 'shoot', who: 'p3', at: 'e2', weapon: 'lobbed', shots: 2, hits: 1, crit: 0 });
  B({ t: 0.9, k: 'struck', who: 'e2', share: 0.10, crit: false, splash: true });
  B({ t: 1.1, k: 'shoot', who: 'e1', at: 'p1', weapon: 'rifle', shots: 4, hits: 2, crit: 0 });
  B({ t: 1.5, k: 'struck', who: 'p1', share: 0.12, crit: false, splash: false });
  B({ t: 1.7, k: 'shoot', who: 'p1', at: 'e1', weapon: 'rifle', shots: 4, hits: 3, crit: 1 });
  B({ t: 2.1, k: 'struck', who: 'e1', share: 0.20, crit: true, splash: false });
  B({ t: 2.3, k: 'lose', who: 'e1' });

  // the brawler commits
  B({ t: 2.2, k: 'move', who: 'p2', to: { x: 3, z: 6 }, style: 'boost' });
  B({ t: 2.6, k: 'shoot', who: 'e3', at: 'p2', weapon: 'rifle', shots: 3, hits: 1, crit: 0 });
  B({ t: 2.9, k: 'evade', who: 'p2', dir: -1 });
  B({ t: 3.4, k: 'move', who: 'p2', to: { x: 11, z: 6 }, style: 'boost' });
  B({ t: 4.2, k: 'strike', who: 'p2', at: 'e2', weapon: 'blade', crit: 2 });
  B({ t: 4.4, k: 'struck', who: 'e2', share: 0.40, crit: true, splash: false });

  // the line closes
  B({ t: 3.0, k: 'move', who: 'p1', to: { x: -3, z: 1 }, style: 'walk' });
  B({ t: 3.0, k: 'move', who: 'e1', to: { x: 3, z: 2 }, style: 'walk' });
  B({ t: 4.6, k: 'shoot', who: 'e1', at: 'p1', weapon: 'rifle', shots: 4, hits: 3, crit: 0 });
  B({ t: 5.0, k: 'struck', who: 'p1', share: 0.22, crit: false, splash: false });
  B({ t: 5.1, k: 'lose', who: 'p1' });
  B({ t: 5.3, k: 'shoot', who: 'p1', at: 'e1', weapon: 'rifle', shots: 3, hits: 3, crit: 1 });
  B({ t: 5.7, k: 'struck', who: 'e1', share: 0.30, crit: true, splash: false });
  B({ t: 5.8, k: 'lose', who: 'e1' });

  // the heavy answers the brawler
  B({ t: 5.4, k: 'strike', who: 'e2', at: 'p2', weapon: 'polearm', crit: 0 });
  B({ t: 5.6, k: 'struck', who: 'p2', share: 0.45, crit: false, splash: false });
  B({ t: 5.9, k: 'lose', who: 'p2' });
  B({ t: 6.2, k: 'evade', who: 'p2', dir: 1 });
  B({ t: 6.8, k: 'strike', who: 'p2', at: 'e2', weapon: 'blade', crit: 3 });
  B({ t: 7.0, k: 'struck', who: 'e2', share: 0.60, crit: true, splash: false });
  B({ t: 7.3, k: 'down', who: 'e2' });

  // the ace picks its moment
  B({ t: 7.6, k: 'move', who: 'e3', to: { x: 5, z: 7 }, style: 'boost' });
  B({ t: 8.4, k: 'strike', who: 'e3', at: 'p2', weapon: 'blade', crit: 2 });
  B({ t: 8.6, k: 'struck', who: 'p2', share: 0.70, crit: true, splash: false });
  B({ t: 8.8, k: 'down', who: 'p2' });
  B({ t: 9.2, k: 'shoot', who: 'p3', at: 'e3', weapon: 'lobbed', shots: 3, hits: 2, crit: 0 });
  B({ t: 9.9, k: 'struck', who: 'e3', share: 0.35, crit: false, splash: true });
  B({ t: 10.2, k: 'shoot', who: 'p1', at: 'e3', weapon: 'rifle', shots: 3, hits: 2, crit: 1 });
  B({ t: 10.6, k: 'struck', who: 'e3', share: 0.55, crit: true, splash: false });
  B({ t: 11.0, k: 'down', who: 'e3' });
  B({ t: 11.4, k: 'down', who: 'e1' });

  return { duration: 12.5, actors, beats: beats.sort((a, b) => a.t - b.t), ground: 'open' };
}

/* ---------- page ---------- */

const cv = document.getElementById('stage') as HTMLCanvasElement;
const status = document.getElementById('status') as HTMLElement;
const scrub = document.getElementById('scrub') as HTMLInputElement;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const eraBar = document.getElementById('eras') as HTMLElement;

const atlas = buildAtlas(ERAS);
const batch = new Batcher(cv, atlas.canvas);
const script = demoScript();
let era = eraById('mobilesuit');
const theatre = new Theatre(script, era, atlas, batch);

if (!batch.ok) {
  status.textContent = 'This browser has no WebGL, so the theatre cannot draw.';
} else {
  for (const e of ERAS) {
    const b = document.createElement('button');
    b.className = 'btn' + (e.id === era.id ? ' on' : '');
    b.textContent = e.name;
    b.title = e.blurb;
    b.onclick = () => {
      era = e; theatre.setEra(e);
      [...eraBar.children].forEach(c => c.classList.toggle('on', c === b));
      status.textContent = e.blurb;
    };
    eraBar.appendChild(b);
  }
  status.textContent = era.blurb;

  /* ?t=6.8 seeks to that second and holds. The performance is a pure function of the script and a
     clock, so any instant can be reproduced exactly — which makes a moment linkable, and is the
     only way to check a frame in a headless browser, where requestAnimationFrame never ticks. */
  const wanted = new URLSearchParams(location.search).get('t');
  let playing = wanted == null;
  if (wanted != null) { theatre.seek(Math.max(0, Math.min(script.duration, +wanted || 0))); }
  playBtn.textContent = playing ? 'Pause' : 'Play';
  playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? 'Pause' : 'Play'; };
  scrub.max = String(Math.round(script.duration * 100));
  scrub.oninput = () => { theatre.seek(+scrub.value / 100); };

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing) {
      theatre.advance(dt);
      if (theatre.time >= theatre.duration) theatre.reset();
      scrub.value = String(Math.round(theatre.time * 100));
    }
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    theatre.draw(Math.max(1, Math.round(rect.width * dpr)), Math.max(1, Math.round(rect.height * dpr)));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
