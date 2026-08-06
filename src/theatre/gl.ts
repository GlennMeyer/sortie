/* A small sprite batcher.
 *
 * Not a general renderer and not trying to be. It draws textured quads and solid quads, sorts
 * nothing, and batches until the blend mode changes — which is exactly enough for a 2.5D stage
 * where the draw order is "back to front, and beams last, additively".
 *
 * Two texture units: 0 is the figure atlas, 1 is a single white pixel. Beams, flashes and shadows
 * are the same quad path as a sprite, sampling white and relying on the tint. That keeps one
 * shader and one vertex format for everything on screen.
 */

export type Blend = 'normal' | 'add';

interface Batch { blend: Blend; tex: 0 | 1; start: number; count: number }

const VERT = `
attribute vec2 aPos;
attribute vec2 aUV;
attribute vec4 aTint;
uniform vec2 uRes;
varying vec2 vUV;
varying vec4 vTint;
void main() {
  vUV = aUV;
  vTint = aTint;
  vec2 clip = (aPos / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUV;
varying vec4 vTint;
uniform sampler2D uTex;
void main() {
  vec4 t = texture2D(uTex, vUV);
  gl_FragColor = t * vTint;
}`;

const FLOATS_PER_VERT = 8;          // x y u v r g b a
const MAX_QUADS = 4096;

export class Batcher {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private buf: WebGLBuffer;
  private data: Float32Array;
  private atlasTex: WebGLTexture;
  private whiteTex: WebGLTexture;
  private quads = 0;
  private batches: Batch[] = [];
  private cur: Batch | null = null;
  private uRes: WebGLUniformLocation;
  private uTex: WebGLUniformLocation;
  readonly ok: boolean = false;

  /* `transparent` makes this canvas an overlay: it composites onto whatever is drawn beneath it
     rather than owning the frame. Premultiplied alpha is off because everything here is drawn
     straight-alpha, and letting the browser assume otherwise fringes every sprite. */
  constructor(private canvas: HTMLCanvasElement, atlas: HTMLCanvasElement, transparent = false) {
    const gl = canvas.getContext('webgl', {
      alpha: transparent, antialias: true, depth: false, premultipliedAlpha: false,
    });
    if (!gl) { this.gl = null as never; this.prog = null as never; this.buf = null as never;
      this.data = new Float32Array(0); this.atlasTex = null as never; this.whiteTex = null as never;
      this.uRes = null as never; this.uTex = null as never; return; }
    this.gl = gl;
    this.prog = this.link(VERT, FRAG);
    this.data = new Float32Array(MAX_QUADS * 6 * FLOATS_PER_VERT);
    this.buf = gl.createBuffer()!;
    this.atlasTex = this.texFrom(atlas);
    this.whiteTex = this.white();
    this.uRes = gl.getUniformLocation(this.prog, 'uRes')!;
    this.uTex = gl.getUniformLocation(this.prog, 'uTex')!;
    gl.enable(gl.BLEND);
    this.ok = true;
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aUV');
    gl.bindAttribLocation(p, 2, 'aTint');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  private texFrom(src: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private white(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  /** The context, so a post-process pass can share it. */
  get context(): WebGLRenderingContext { return this.gl; }
  get size(): [number, number] { return [this.canvas.width, this.canvas.height]; }

  /** Swap the figure sheet — an era change redraws every machine, so the texture changes with it. */
  replaceAtlas(atlas: HTMLCanvasElement) {
    if (!this.ok) return;
    this.gl.deleteTexture(this.atlasTex);
    this.atlasTex = this.texFrom(atlas);
  }

  /* `clearAlpha` is 0 when this canvas is an overlay: the board underneath has to show through
     everywhere a machine isn't. The theatre clears to 1 because it owns the whole frame. */
  begin(w: number, h: number, clear: [number, number, number], clearAlpha = 1) {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(clear[0], clear[1], clear[2], clearAlpha);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.quads = 0; this.batches = []; this.cur = null;
  }

  private push(tex: 0 | 1, blend: Blend,
               pts: [number, number][], uvs: [number, number][],
               tint: [number, number, number, number]) {
    if (this.quads >= MAX_QUADS) return;
    if (!this.cur || this.cur.blend !== blend || this.cur.tex !== tex) {
      this.cur = { blend, tex, start: this.quads * 6, count: 0 };
      this.batches.push(this.cur);
    }
    const o = this.quads * 6 * FLOATS_PER_VERT;
    const order = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) {
      const k = order[i]!;
      const p = pts[k]!, uv = uvs[k]!;
      const b = o + i * FLOATS_PER_VERT;
      this.data[b] = p[0]; this.data[b + 1] = p[1];
      this.data[b + 2] = uv[0]; this.data[b + 3] = uv[1];
      this.data[b + 4] = tint[0]; this.data[b + 5] = tint[1];
      this.data[b + 6] = tint[2]; this.data[b + 7] = tint[3];
    }
    this.quads++; this.cur.count += 6;
  }

  /** A sprite from the atlas, centred on (x, y), scaled and rotated about its own centre. */
  sprite(cell: { x: number; y: number; w: number; h: number }, atlasW: number, atlasH: number,
         x: number, y: number, scale: number, rot: number,
         tint: [number, number, number, number], blend: Blend = 'normal', flip = false) {
    const hw = cell.w * scale * 0.5, hh = cell.h * scale * 0.5;
    const c = Math.cos(rot), s = Math.sin(rot);
    const corner = (dx: number, dy: number): [number, number] =>
      [x + dx * c - dy * s, y + dx * s + dy * c];
    let u0 = cell.x / atlasW, u1 = (cell.x + cell.w) / atlasW;
    const v0 = cell.y / atlasH, v1 = (cell.y + cell.h) / atlasH;
    if (flip) { const t = u0; u0 = u1; u1 = t; }      // mirror in place: facing is most of the read
    this.push(0, blend,
      [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)],
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], tint);
  }

  /** A sprite given an explicit width and height rather than a uniform scale. Beams need this:
      a bolt is as long as the gap it is crossing and as thin as its weapon, and those two numbers
      have nothing to do with each other. */
  stretched(cell: { x: number; y: number; w: number; h: number }, atlasW: number, atlasH: number,
            x: number, y: number, w: number, h: number, rot: number,
            tint: [number, number, number, number], blend: Blend = 'normal') {
    const hw = w * 0.5, hh = h * 0.5;
    const c = Math.cos(rot), s = Math.sin(rot);
    const corner = (dx: number, dy: number): [number, number] =>
      [x + dx * c - dy * s, y + dx * s + dy * c];
    const u0 = cell.x / atlasW, u1 = (cell.x + cell.w) / atlasW;
    const v0 = cell.y / atlasH, v1 = (cell.y + cell.h) / atlasH;
    this.push(0, blend,
      [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)],
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], tint);
  }

  /** A solid rectangle, centred and rotated — the basis for beams, flashes and shadows. */
  quad(x: number, y: number, w: number, h: number, rot: number,
       tint: [number, number, number, number], blend: Blend = 'normal') {
    const hw = w * 0.5, hh = h * 0.5;
    const c = Math.cos(rot), s = Math.sin(rot);
    const corner = (dx: number, dy: number): [number, number] =>
      [x + dx * c - dy * s, y + dx * s + dy * c];
    this.push(1, blend,
      [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)],
      [[0, 0], [1, 0], [1, 1], [0, 1]], tint);
  }

  /** A solid line between two points, given a thickness. */
  line(x0: number, y0: number, x1: number, y1: number, w: number,
       tint: [number, number, number, number], blend: Blend = 'add') {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    this.quad((x0 + x1) / 2, (y0 + y1) / 2, len, w, Math.atan2(dy, dx), tint, blend);
  }

  end() {
    if (!this.ok) return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.quads * 6 * FLOATS_PER_VERT), gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.uTex, 0);
    for (const b of this.batches) {
      gl.blendFunc(gl.SRC_ALPHA, b.blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, b.tex === 0 ? this.atlasTex : this.whiteTex);
      gl.drawArrays(gl.TRIANGLES, b.start, b.count);
    }
  }
}

/** '#RRGGBB' -> normalised rgba. */
export function rgba(hex: string, a = 1): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}
