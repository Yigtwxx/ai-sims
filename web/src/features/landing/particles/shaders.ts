/**
 * GLSL ES 3.0 for the landing particles. Shapes use the canvas convention of
 * the original sketch: x right, y DOWN, +z AWAY from the viewer, one unit =
 * the sphere radius. The silhouette arrives y-up and facing +z (towards the
 * viewer), so it is turned 180 degrees about x here.
 *
 * Stages: 0 dust, 1 sphere, 2 wave, 3 ring, 4 lips, 5 silhouette.
 */
export const VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec3 aDust;
in vec3 aSphere;
in vec3 aSil;
in vec4 aP0; // strand, cluster, wx, u
in vec4 aP1; // v, upper, delay, accent
in vec4 aP2; // seed, offX, offY, offZ

uniform float uStage;
uniform float uTime;
uniform float uMotion;   // 1, or 0 under reduced motion (no autonomous movement)
uniform vec2 uRotation;  // yaw, pitch (radians)
uniform vec2 uCenter;    // css px
uniform vec2 uViewport;  // css px
uniform float uScale;    // css px per unit
uniform float uSilScale; // silhouette units per normalised unit
uniform float uFacing;   // 0..1: the silhouette turns to the viewer and calms
uniform float uGather;   // 0..1: points collapse into the chest
uniform float uLit;      // lit ring cluster
uniform float uDpr;
uniform float uPointSize;

out float vAlpha;
out float vHot;

const float TAU = 6.2831853;

vec3 silhouette() {
  vec3 p = vec3(aSil.x, -aSil.y, -aSil.z) * uSilScale;
  // Breath: the chest band widens and rises a touch.
  float chest = smoothstep(0.15, 0.4, aSil.y) * (1.0 - smoothstep(0.55, 0.72, aSil.y));
  float breath = uMotion * 0.014 * sin(uTime * 1.45);
  p.xz *= 1.0 + chest * breath;
  p.y -= chest * breath * 0.25 * uSilScale;
  // A faint shimmer keeps it alive; it settles while the visitor is about to start.
  float shimmer = uMotion * (1.0 - uFacing) * 0.006;
  float s = aP2.x * 40.0;
  p += shimmer * vec3(sin(uTime * 1.7 + s), sin(uTime * 1.3 + s * 1.7), sin(uTime * 1.1 + s * 2.3));
  return p;
}

vec3 shapeAt(int k) {
  float t = uTime;
  if (k == 0) {
    float s = aP2.x * TAU;
    return aDust + uMotion * 0.07 * vec3(sin(t * 0.23 + s), cos(t * 0.19 + s * 1.3), sin(t * 0.17 + s * 0.7));
  }
  if (k == 1) return aSphere;
  if (k == 2) {
    float x = aP0.z * 1.6;
    float strand = aP0.x;
    float envelope = exp(-x * x * 0.55) * (0.55 + 0.45 * sin(t * 2.1 + x * 1.7));
    float y = envelope * 0.62 * sin(x * 5.2 - t * 3.4 + strand * 0.38) * (0.6 + strand * 0.05);
    return vec3(x, y, (strand - 4.0) * 0.05);
  }
  if (k == 3) {
    float a = aP0.y / 15.0 * TAU + t * 0.18;
    return vec3(cos(a) * 1.05 + aP2.y, sin(a) * 1.05 + aP2.z, aP2.w);
  }
  if (k == 4) {
    float open = 0.08 + 0.5 * abs(sin(t * 5.1)) * abs(sin(t * 1.6 + 0.6));
    float x = aP0.w;
    float v = aP1.x;
    float w = max(0.0, 1.0 - x * x);
    float side = abs(x) - 0.2;
    float bow = 0.09 * exp(-(side * side) / 0.012) - 0.07 * exp(-(x * x) / 0.006);
    float y;
    if (aP1.y > 0.5) {
      float outer = -(0.3 * pow(w, 0.75) + bow);
      float inner = -open * 0.35 * w;
      y = inner + (outer - inner) * v;
    } else {
      float inner = open * 0.45 * w;
      float outer = 0.36 * pow(w, 0.7) + open * 0.45 * w;
      y = inner + (outer - inner) * v;
    }
    return vec3(x * 1.35, y * 1.35, 0.25 * w);
  }
  return silhouette();
}

void main() {
  int k0 = int(floor(uStage));
  int k1 = min(5, k0 + 1);
  float f = uStage - float(k0);
  // Each point leaves on its own delay, so shapes dissolve rather than slide.
  float m = clamp(f * 1.35 - aP1.z, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  vec3 p = mix(shapeAt(k0), shapeAt(k1), m);

  // Start: everything falls into the chest, fast at the end.
  float g = uGather * uGather;
  p = mix(p, vec3(0.0, -0.42 * uSilScale, 0.0), g);

  float cy = cos(uRotation.x), sy = sin(uRotation.x);
  float cx = cos(uRotation.y), sx = sin(uRotation.y);
  float x1 = p.x * cy + p.z * sy;
  float z1 = -p.x * sy + p.z * cy;
  float y1 = p.y * cx - z1 * sx;
  float z2 = p.y * sx + z1 * cx;
  float persp = 3.2 / (3.2 + z2);

  vec2 px = uCenter + vec2(x1, y1) * uScale * persp;
  gl_Position = vec4(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, 0.0, 1.0);

  float ring = 1.0 - step(0.5, abs(uStage - 3.0));
  float lit = 1.0 - step(0.5, abs(aP0.y - uLit));
  vHot = mix(aP1.w, lit, ring);
  float depth = clamp(0.7 - z2 * 0.35, 0.25, 1.0);
  vAlpha = depth * (1.0 - smoothstep(0.82, 1.0, uGather));
  gl_PointSize = uPointSize * uDpr * persp * (1.0 + 0.4 * vHot) * (1.0 + 0.18 * uFacing + 0.8 * g);
}
`;

export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision mediump float;

in float vAlpha;
in float vHot;
uniform vec3 uInk;
uniform vec3 uAccent;
out vec4 outColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = vAlpha * (1.0 - smoothstep(0.55, 1.0, d));
  // Premultiplied alpha over the paper behind the canvas.
  outColor = vec4(mix(uInk, uAccent, vHot) * a, a);
}
`;
