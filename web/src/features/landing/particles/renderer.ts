import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';
import { PARAM_STRIDE, type ParticleData } from './shapes';

/** Everything a frame needs; the CPU writes these and the GPU does the rest. */
export interface ParticleFrame {
  stage: number;
  time: number;
  motion: number;
  yaw: number;
  pitch: number;
  centerX: number;
  centerY: number;
  scale: number;
  silScale: number;
  facing: number;
  gather: number;
  lit: number;
  pointSize: number;
  /** Points to draw (a prefix of the data: the data is shuffled, so any prefix is even). */
  count: number;
}

const UNIFORMS = [
  'uStage',
  'uTime',
  'uMotion',
  'uRotation',
  'uCenter',
  'uViewport',
  'uScale',
  'uSilScale',
  'uFacing',
  'uGather',
  'uLit',
  'uDpr',
  'uPointSize',
  'uInk',
  'uAccent',
] as const;
type UniformName = (typeof UNIFORMS)[number];

/** Ink #171a21 and cobalt #2d4bd3 (DESIGN.md), as 0..1 sRGB. */
const INK = [0x17 / 255, 0x1a / 255, 0x21 / 255] as const;
const ACCENT = [0x2d / 255, 0x4b / 255, 0xd3 / 255] as const;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log ?? ''}`);
  }
  return shader;
}

/**
 * A single WebGL2 program drawing every particle in one `drawArrays(POINTS)`.
 * Survives a lost context: it rebuilds from the last data once restored.
 */
export class ParticleRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private uniforms = new Map<UniformName, WebGLUniformLocation | null>();
  private data: ParticleData | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private lost = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
  ) {
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.init();
  }

  /** Undefined when WebGL2 is unavailable or the shaders do not compile. */
  static create(canvas: HTMLCanvasElement): ParticleRenderer | undefined {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return undefined;
    try {
      return new ParticleRenderer(canvas, gl);
    } catch {
      return undefined;
    }
  }

  private init() {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error('createProgram failed');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    this.program = program;
    for (const name of UNIFORMS) this.uniforms.set(name, gl.getUniformLocation(program, name));
    this.vao = gl.createVertexArray();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.data) this.upload(this.data);
  }

  private onLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
  };

  private onRestored = () => {
    this.lost = false;
    this.buffers = [];
    try {
      this.init();
    } catch {
      this.lost = true;
    }
  };

  setData(data: ParticleData) {
    this.data = data;
    if (!this.lost) this.upload(data);
  }

  private upload(data: ParticleData) {
    const gl = this.gl;
    const program = this.program;
    if (!program) return;
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    this.buffers = [];
    gl.bindVertexArray(this.vao);

    // Binds the buffer bound last; strides and offsets are in floats.
    const attribute = (name: string, size: number, stride = 0, offset = 0) => {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) return;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
    };
    const buffer = (array: Float32Array) => {
      const id = gl.createBuffer();
      if (!id) throw new Error('createBuffer failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, id);
      gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      this.buffers.push(id);
    };

    buffer(data.dust);
    attribute('aDust', 3);
    buffer(data.sphere);
    attribute('aSphere', 3);
    buffer(data.silhouette);
    attribute('aSil', 3);
    buffer(data.params);
    attribute('aP0', 4, PARAM_STRIDE, 0);
    attribute('aP1', 4, PARAM_STRIDE, 4);
    attribute('aP2', 4, PARAM_STRIDE, 8);
    gl.bindVertexArray(null);
  }

  /** CSS size and device pixel ratio; resizes the drawing buffer only when it changes. */
  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    const w = Math.round(this.width * dpr);
    const h = Math.round(this.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(frame: ParticleFrame) {
    const gl = this.gl;
    if (this.lost || !this.program || !this.data) return;
    const u = (name: UniformName) => this.uniforms.get(name) ?? null;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform1f(u('uStage'), frame.stage);
    gl.uniform1f(u('uTime'), frame.time);
    gl.uniform1f(u('uMotion'), frame.motion);
    gl.uniform2f(u('uRotation'), frame.yaw, frame.pitch);
    gl.uniform2f(u('uCenter'), frame.centerX, frame.centerY);
    gl.uniform2f(u('uViewport'), this.width, this.height);
    gl.uniform1f(u('uScale'), frame.scale);
    gl.uniform1f(u('uSilScale'), frame.silScale);
    gl.uniform1f(u('uFacing'), frame.facing);
    gl.uniform1f(u('uGather'), frame.gather);
    gl.uniform1f(u('uLit'), frame.lit);
    gl.uniform1f(u('uDpr'), this.dpr);
    gl.uniform1f(u('uPointSize'), frame.pointSize);
    gl.uniform3f(u('uInk'), INK[0], INK[1], INK[2]);
    gl.uniform3f(u('uAccent'), ACCENT[0], ACCENT[1], ACCENT[2]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, Math.min(frame.count, this.data.count));
    gl.bindVertexArray(null);
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const gl = this.gl;
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    this.buffers = [];
    this.program = null;
    this.vao = null;
  }
}
