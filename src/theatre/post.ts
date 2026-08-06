/* Light.
 *
 * The stage draws into a texture rather than the screen, and the texture goes through
 *
 *   bright pass -> horizontal blur -> vertical blur -> composite
 *
 * Bloom is doing the heavy lifting: beams, muzzle flashes and sparks are already the brightest
 * things in the frame, so a threshold picks them out with no cooperation from the drawing code,
 * and the blur is what turns a bright line into something that looks like it is emitting. Without
 * it a beam is a coloured bar. With it, it is a beam.
 *
 * The composite also grades the frame — a slight cool lift in the shadows, grain, and a vignette —
 * so the picture reads as one photograph rather than as a pile of sprites.
 */

const VERT =
  'attribute vec2 p; varying vec2 uv;' +
  'void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';

const BRIGHT =
  'precision mediump float; varying vec2 uv; uniform sampler2D src;' +
  'void main(){' +
  '  vec3 c = texture2D(src, uv).rgb;' +
  '  float l = dot(c, vec3(0.299, 0.587, 0.114));' +
  '  gl_FragColor = vec4(c * smoothstep(0.48, 0.95, l), 1.0);' +
  '}';

const BLUR =
  'precision mediump float; varying vec2 uv; uniform sampler2D src; uniform vec2 dir;' +
  'void main(){' +
  '  vec3 c = texture2D(src, uv).rgb * 0.2270270270;' +
  '  c += texture2D(src, uv + dir * 1.3846153846).rgb * 0.3162162162;' +
  '  c += texture2D(src, uv - dir * 1.3846153846).rgb * 0.3162162162;' +
  '  c += texture2D(src, uv + dir * 3.2307692308).rgb * 0.0702702703;' +
  '  c += texture2D(src, uv - dir * 3.2307692308).rgb * 0.0702702703;' +
  '  gl_FragColor = vec4(c, 1.0);' +
  '}';

const COMP =
  'precision mediump float; varying vec2 uv;' +
  'uniform sampler2D src; uniform sampler2D bloom;' +
  'uniform vec2 res; uniform float time; uniform float flash;' +
  'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }' +
  'void main(){' +
  '  vec2 c = uv - 0.5;' +
  '  float r2 = dot(c, c);' +
  '  vec2 ab = c * r2 * 0.012;' +
  '  vec3 col;' +
  '  col.r = texture2D(src, uv + ab).r;' +
  '  col.g = texture2D(src, uv).g;' +
  '  col.b = texture2D(src, uv - ab).b;' +
  '  vec3 bl = texture2D(bloom, uv).rgb;' +
  '  col += bl * 1.35;' +
  // a white-out that rises on a heavy hit, so a crit is felt rather than merely drawn
  '  col += bl * flash * 1.05;' +
  '  col = mix(col, col * vec3(0.94, 0.99, 1.10), 0.35);' +   // cool the shadows
  '  col += (hash(uv * res + time) - 0.5) * 0.020;' +
  '  col *= 1.0 - r2 * 0.50;' +
  '  gl_FragColor = vec4(col, 1.0);' +
  '}';

/* The overlay composite.
 *
 * On the tactical display this pass is not grading a photograph — the board underneath is the
 * photograph, and this layer only holds the machines and what they are shooting at each other.
 * So: no vignette, no grain, no aberration, and alpha is carried through so the grid shows between
 * the feet. Bloom is the entire point of running it at all. */
const COMP_OVERLAY =
  'precision mediump float; varying vec2 uv;' +
  'uniform sampler2D src; uniform sampler2D bloom;' +
  'void main(){' +
  '  vec4 s = texture2D(src, uv);' +
  '  vec3 bl = texture2D(bloom, uv).rgb;' +
  '  vec3 col = s.rgb + bl * 1.25;' +
  '  float bloomA = clamp(dot(bl, vec3(0.299, 0.587, 0.114)) * 2.2, 0.0, 1.0);' +
  '  gl_FragColor = vec4(col, clamp(max(s.a, bloomA), 0.0, 1.0));' +
  '}';

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }

export class Post {
  private bright!: WebGLProgram;
  private blur!: WebGLProgram;
  private comp!: WebGLProgram;
  private quad!: WebGLBuffer;
  private scene!: Target;
  private a!: Target;
  private b!: Target;
  private w = 0; private h = 0;
  readonly ok: boolean;

  constructor(private gl: WebGLRenderingContext, private mode: 'scene' | 'overlay' = 'scene') {
    try {
      this.bright = this.link(BRIGHT);
      this.blur = this.link(BLUR);
      this.comp = this.link(mode === 'overlay' ? COMP_OVERLAY : COMP);
      this.quad = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.ok = true;
    } catch { this.ok = false; }
  }

  private link(fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (t: number, src: string) => {
      const s = gl.createShader(t)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? '');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? '');
    return p;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  private resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    for (const t of [this.scene, this.a, this.b]) {
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    }
    this.scene = this.target(w, h);
    this.a = this.target(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.b = this.target(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.w = w; this.h = h;
  }

  /** Point the stage at an offscreen texture instead of the screen. */
  bindScene(w: number, h: number) {
    if (!this.ok) return;
    this.resize(w, h);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, this.mode === 'overlay' ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private pass(prog: WebGLProgram, to: Target | null, texes: WebGLTexture[],
               set: (loc: (n: string) => WebGLUniformLocation | null) => void) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fbo : null);
    gl.viewport(0, 0, to ? to.w : this.w, to ? to.h : this.h);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    texes.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); });
    set(n => gl.getUniformLocation(prog, n));
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
  }

  /** Bloom the scene and put it on the screen. `flash` whites the frame out on a heavy hit. */
  present(time: number, flash: number) {
    if (!this.ok) return;
    const gl = this.gl;
    this.pass(this.bright, this.a, [this.scene.tex], l => gl.uniform1i(l('src'), 0));
    this.pass(this.blur, this.b, [this.a.tex], l => {
      gl.uniform1i(l('src'), 0); gl.uniform2f(l('dir'), 1 / this.a.w, 0);
    });
    this.pass(this.blur, this.a, [this.b.tex], l => {
      gl.uniform1i(l('src'), 0); gl.uniform2f(l('dir'), 0, 1 / this.b.h);
    });
    this.pass(this.comp, null, [this.scene.tex, this.a.tex], l => {
      gl.uniform1i(l('src'), 0); gl.uniform1i(l('bloom'), 1);
      if (this.mode === 'scene') {
        gl.uniform2f(l('res'), this.w, this.h);
        gl.uniform1f(l('time'), time);
        gl.uniform1f(l('flash'), flash);
      }
    });
  }
}
