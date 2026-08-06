/* Noise, made in code.
 *
 * Same constraint as the sprites: no file ever arrives, so every sound in the game is synthesised
 * from oscillators and filtered noise at the moment it is needed. That is not a limitation being
 * worked around — it is what lets a shot sound like the age that fired it without shipping three
 * sample libraries. An era is a filter cutoff and an envelope, the same way it is a silhouette.
 *
 *   Early        wood, breath, and a thud. Nothing here is louder than an arm.
 *   Developed    a crack and a chamber. Powder, and the first sounds with a bang in them.
 *   Advanced     a charged whine and a discharge. Nothing about this is mechanical.
 *
 * The board fires ten weapons a tick and it must not become a wall. Everything goes through one
 * compressor, voices are capped per tick, and repeats of the same sound inside a few milliseconds
 * are dropped rather than stacked — a dozen identical rifle cracks in phase is not twelve rifles,
 * it is one very loud rifle.
 */

export type SoundKind = 'fire' | 'impact' | 'death' | 'boom' | 'melee' | 'click' | 'deploy' | 'win' | 'lose';

interface Voice { at: number }

/** How a shot sounds, per age. Mirrors the era skins the renderer uses. */
interface EraVoice {
  /** Weapon report. */
  fire(s: Synth, weight: number, crit: boolean): void;
  /** Something landing on armour. */
  impact(s: Synth, weight: number): void;
  /** A blade or a shaft, swung. */
  melee(s: Synth): void;
}

class Synth {
  readonly ctx: AudioContext;
  readonly bus: GainNode;
  private noiseBuf: AudioBuffer;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    /* One compressor across everything. Without it a busy tick clips, and clipping on a laptop
       speaker sounds like a fault rather than like a battle. */
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 10;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.5;
    this.bus.connect(comp);
    comp.connect(ctx.destination);

    // one second of white noise, reused by every sound that needs air, grit or an explosion
    const n = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, n, n);
    const d = this.noiseBuf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = (seed / 2147483648) - 1;
    }
  }

  get now() { return this.ctx.currentTime; }

  /** A filtered burst of noise: everything percussive in the game is one of these. */
  noise(opts: {
    dur: number; gain: number; type?: BiquadFilterType;
    f0: number; f1?: number; q?: number; delay?: number; curve?: number;
  }) {
    const t = this.now + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const flt = this.ctx.createBiquadFilter();
    flt.type = opts.type ?? 'bandpass';
    flt.frequency.setValueAtTime(Math.max(40, opts.f0), t);
    if (opts.f1 != null) flt.frequency.exponentialRampToValueAtTime(Math.max(40, opts.f1), t + opts.dur);
    flt.Q.value = opts.q ?? 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(flt); flt.connect(g); g.connect(this.bus);
    src.start(t); src.stop(t + opts.dur + 0.02);
  }

  /** A pitched tone, optionally swept. Beams, whines and the low end of an explosion. */
  tone(opts: {
    type?: OscillatorType; f0: number; f1?: number;
    dur: number; gain: number; delay?: number; detune?: number;
  }) {
    const t = this.now + (opts.delay ?? 0);
    const o = this.ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(Math.max(20, opts.f0), t);
    if (opts.f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t + opts.dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + opts.dur + 0.02);
  }
}

/* ---------- the ages ---------- */

const EARLY: EraVoice = {
  /* A shaft leaving a hand. Air first, then the dull knock of wood against wood — no bang,
     because nothing in this age contains a reaction. */
  fire(s, w, crit) {
    s.noise({ dur: 0.16, gain: 0.09 * w, f0: 900, f1: 320, q: 0.7 });
    s.tone({ type: 'triangle', f0: 190, f1: 90, dur: 0.10, gain: 0.06 * w, delay: 0.01 });
    if (crit) s.noise({ dur: 0.09, gain: 0.10, f0: 2400, f1: 800, q: 2, delay: 0.02 });
  },
  impact(s, w) {
    s.noise({ dur: 0.13, gain: 0.13 * w, f0: 420, f1: 140, q: 1.1 });
    s.tone({ type: 'triangle', f0: 120, f1: 58, dur: 0.14, gain: 0.10 * w });
  },
  melee(s) {
    s.noise({ dur: 0.11, gain: 0.10, f0: 1500, f1: 400, q: 0.8 });
    s.tone({ type: 'square', f0: 240, f1: 120, dur: 0.08, gain: 0.05, delay: 0.03 });
  },
};

const DEVELOPED: EraVoice = {
  /* Powder: a hard crack over a chamber that rings for a moment. The crack is the whole
     identity — take it away and it is the same thud as a thrown rock. */
  fire(s, w, crit) {
    s.noise({ dur: 0.05, gain: 0.26 * w, f0: 5200, f1: 1400, q: 0.6, type: 'highpass' });
    s.noise({ dur: 0.22, gain: 0.11 * w, f0: 700, f1: 190, q: 1.4, delay: 0.008 });
    s.tone({ type: 'square', f0: 150, f1: 52, dur: 0.16, gain: 0.09 * w });
    if (crit) s.tone({ type: 'sawtooth', f0: 900, f1: 300, dur: 0.12, gain: 0.07, delay: 0.02 });
  },
  impact(s, w) {
    s.noise({ dur: 0.10, gain: 0.16 * w, f0: 2600, f1: 600, q: 1.6 });
    s.tone({ type: 'triangle', f0: 170, f1: 70, dur: 0.16, gain: 0.11 * w });
  },
  melee(s) {
    // steel on steel: two close tones beating against each other
    s.tone({ type: 'triangle', f0: 1750, f1: 1500, dur: 0.24, gain: 0.07 });
    s.tone({ type: 'triangle', f0: 1790, f1: 1520, dur: 0.24, gain: 0.06, detune: 18 });
    s.noise({ dur: 0.07, gain: 0.11, f0: 4200, f1: 1600, q: 1.2 });
  },
};

const ADVANCED: EraVoice = {
  /* A charge and a discharge, in that order — the tiny rising whine before the shot is what
     separates a beam from a bang. Nothing about this sounds mechanical. */
  fire(s, w, crit) {
    s.tone({ type: 'sawtooth', f0: 380, f1: 2600, dur: 0.055, gain: 0.05 * w });
    s.tone({ type: 'sawtooth', f0: 2100, f1: 240, dur: 0.20, gain: 0.15 * w, delay: 0.05 });
    s.noise({ dur: 0.14, gain: 0.08 * w, f0: 3400, f1: 900, q: 2.2, delay: 0.05 });
    if (crit) s.tone({ type: 'square', f0: 3200, f1: 700, dur: 0.16, gain: 0.09, delay: 0.05 });
  },
  impact(s, w) {
    s.noise({ dur: 0.16, gain: 0.15 * w, f0: 1800, f1: 260, q: 1.1 });
    s.tone({ type: 'sine', f0: 210, f1: 60, dur: 0.22, gain: 0.13 * w });
  },
  melee(s) {
    // a sabre: a bright sustained edge rather than an impact
    s.tone({ type: 'sawtooth', f0: 620, f1: 2400, dur: 0.13, gain: 0.09 });
    s.tone({ type: 'sine', f0: 2600, f1: 1200, dur: 0.20, gain: 0.07, delay: 0.06 });
    s.noise({ dur: 0.12, gain: 0.07, f0: 5200, f1: 1800, q: 2, delay: 0.05 });
  },
};

const VOICES: EraVoice[] = [EARLY, DEVELOPED, ADVANCED];

/* ---------- the board's ears ---------- */

export class Sound {
  private synth: Synth | null = null;
  private ctx: AudioContext | null = null;
  private recent = new Map<string, Voice>();
  private tickVoices = 0;
  private tickAt = 0;
  private _on = true;
  readonly available: boolean;

  constructor() {
    this.available = typeof window !== 'undefined' &&
      !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
  }

  get on() { return this._on; }
  set on(v: boolean) {
    this._on = v;
    if (v) this.resume();
    else if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /* Browsers will not start audio without a gesture, so this is called from the first real click
     rather than at load. Calling it again is free. */
  resume() {
    if (!this.available || !this._on) return;
    try {
      if (!this.ctx) {
        const C = window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new C();
        this.synth = new Synth(this.ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* no audio on this machine; the game is unchanged */ }
  }

  /** Volume, 0..1. */
  setVolume(v: number) { if (this.synth) this.synth.bus.gain.value = Math.max(0, Math.min(1, v)) * 0.5; }

  /* A tick can emit a dozen weapons at once. Past a handful they stop being distinguishable and
     start being loud, so the rest are dropped — and identical sounds inside 40ms are dropped
     outright, because twelve rifle cracks in phase is one very loud rifle, not twelve rifles. */
  private allow(key: string, cap: number): boolean {
    if (!this.synth) return false;
    const t = this.synth.now;
    if (t - this.tickAt > 0.09) { this.tickAt = t; this.tickVoices = 0; }
    if (this.tickVoices >= cap) return false;
    const r = this.recent.get(key);
    if (r && t - r.at < 0.04) return false;
    this.recent.set(key, { at: t });
    if (this.recent.size > 64) this.recent.clear();
    this.tickVoices++;
    return true;
  }

  /**
   * @param kind  what happened
   * @param era   1..3, so the same event sounds like the age that caused it
   * @param opts  weight scales the report; crit brightens it
   */
  play(kind: SoundKind, era = 3, opts: { weight?: number; crit?: boolean } = {}) {
    if (!this._on || !this.synth) return;
    const s = this.synth;
    const v = VOICES[Math.max(0, Math.min(VOICES.length - 1, era - 1))] ?? ADVANCED;
    const w = Math.max(0.35, Math.min(1.6, opts.weight ?? 1));

    switch (kind) {
      case 'fire':
        if (!this.allow('fire' + era, 4)) return;
        v.fire(s, w, !!opts.crit);
        return;
      case 'melee':
        if (!this.allow('melee' + era, 3)) return;
        v.melee(s);
        return;
      case 'impact':
        if (!this.allow('impact' + era, 4)) return;
        v.impact(s, w);
        return;
      case 'death':
        // a machine coming apart, whatever age it is from
        if (!this.allow('death', 3)) return;
        s.noise({ dur: 0.42, gain: 0.20 * w, f0: 900, f1: 90, q: 0.8 });
        s.tone({ type: 'sine', f0: 130, f1: 34, dur: 0.5, gain: 0.17 * w });
        return;
      case 'boom':
        if (!this.allow('boom', 2)) return;
        s.noise({ dur: 0.60, gain: 0.26, f0: 1400, f1: 70, q: 0.7 });
        s.tone({ type: 'sine', f0: 90, f1: 28, dur: 0.7, gain: 0.22 });
        return;
      /* The interface gets a voice too, and it is deliberately small: a click you can hear is a
         click you know landed, and placing a squad on the board should feel like setting a weight
         down rather than like nothing at all. */
      case 'click':
        if (!this.allow('click', 2)) return;
        s.noise({ dur: 0.035, gain: 0.07, f0: 2600, f1: 1400, q: 1.5 });
        return;
      case 'deploy':
        if (!this.allow('deploy', 2)) return;
        s.tone({ type: 'triangle', f0: 300, f1: 150, dur: 0.09, gain: 0.09 });
        s.noise({ dur: 0.12, gain: 0.09, f0: 700, f1: 200, q: 1 });
        return;
      case 'win':
        s.tone({ type: 'triangle', f0: 330, f1: 495, dur: 0.30, gain: 0.13 });
        s.tone({ type: 'triangle', f0: 495, f1: 660, dur: 0.36, gain: 0.11, delay: 0.16 });
        return;
      case 'lose':
        s.tone({ type: 'triangle', f0: 300, f1: 190, dur: 0.42, gain: 0.13 });
        s.tone({ type: 'sine', f0: 150, f1: 84, dur: 0.60, gain: 0.11, delay: 0.14 });
        return;
    }
  }
}

export function createSound(): Sound { return new Sound(); }
