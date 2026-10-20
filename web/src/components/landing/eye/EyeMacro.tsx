'use client';

/*
 * Realism close-up poster: a procedural eye in macro under a studio softbox.
 * The eyeball carries a painted iris (eyeTexture.ts) with a shader-driven
 * pupil; a separate corneal bulge renders specular light only (additive), so
 * the softbox catchlight sits on a wet, curved surface. The gaze follows the
 * pointer with small saccades; the pupil narrows when the "light" layer is in
 * focus. Replaced by the live character's face close-up once it exists.
 */
import { Environment, Lightformer } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { createEyeTextures, IRIS_RADIUS_UV, PUPIL_RATIO_IN_TEXTURE } from './eyeTexture';

export type EyeFocus = 'skin' | 'eyes' | 'hair' | 'light';

interface EyeMacroProps {
  focus: EyeFocus;
  /** Render continuously (in view). When false the canvas renders on demand only. */
  active: boolean;
  reduceMotion: boolean;
  /** Called once the WebGL context exists and the first frame is queued. */
  onReady?: () => void;
}

const PUPIL_BY_FOCUS: Record<EyeFocus, number> = {
  skin: 0.36,
  eyes: 0.4,
  hair: 0.36,
  light: 0.25,
};

const MAP_PATCH = /* glsl */ `
#ifdef USE_MAP
  vec2 irisUv = vMapUv;
  vec2 fromCentre = irisUv - 0.5;
  float radius = length(fromCentre);
  if (radius < uIrisR) {
    float t = radius / uIrisR;
    float s = t < uPupil
      ? t * (uPupilTex / uPupil)
      : uPupilTex + (t - uPupil) * (1.0 - uPupilTex) / (1.0 - uPupil);
    irisUv = 0.5 + (radius > 1e-5 ? fromCentre / radius : vec2(0.0)) * s * uIrisR;
  }
  vec4 sampledDiffuseColor = texture2D( map, irisUv );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

function damp(current: number, target: number, lambda: number, delta: number): number {
  return THREE.MathUtils.damp(current, target, lambda, delta);
}

interface PupilUniforms {
  uIrisR: { value: number };
  uPupil: { value: number };
  uPupilTex: { value: number };
}

/** The pupil uniforms live on the eyeball material's userData (set in buildEyeAssets). */
function pupilUniforms(mesh: THREE.Mesh): PupilUniforms | null {
  const material = mesh.material;
  if (Array.isArray(material)) return null;
  return (material.userData.pupil as PupilUniforms | undefined) ?? null;
}

/** Eyeball (painted iris, shader-driven pupil) and corneal bulge, built once per mount. */
function buildEyeAssets() {
  const uniforms: PupilUniforms = {
    uIrisR: { value: IRIS_RADIUS_UV },
    uPupil: { value: PUPIL_BY_FOCUS.eyes },
    uPupilTex: { value: PUPIL_RATIO_IN_TEXTURE },
  };
  const textures = createEyeTextures(1024);
  const map = new THREE.CanvasTexture(textures.color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bumpMap = new THREE.CanvasTexture(textures.bump);

  // Front projection: the iris is a circle around UV (0.5, 0.5) on +Z.
  const ball = new THREE.SphereGeometry(1, 128, 96);
  const position = ball.attributes.position;
  const uv = ball.attributes.uv;
  for (let i = 0; i < position.count; i += 1) {
    uv.setXY(i, 0.5 + position.getX(i) * 0.5, 0.5 + position.getY(i) * 0.5);
  }
  uv.needsUpdate = true;

  const eyeMaterial = new THREE.MeshPhysicalMaterial({
    map,
    bumpMap,
    bumpScale: 1.4,
    roughness: 0.38,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
  });
  eyeMaterial.userData.pupil = uniforms;
  eyeMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader =
      'uniform float uIrisR;\nuniform float uPupil;\nuniform float uPupilTex;\n' +
      shader.fragmentShader.replace('#include <map_fragment>', MAP_PATCH);
  };

  // Corneal bulge: a smaller sphere cap in front of the iris, specular only.
  const corneaRadius = 0.65;
  const cap = new THREE.SphereGeometry(corneaRadius, 96, 48, 0, Math.PI * 2, 0, 0.9);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, 0, 0.45);
  const capMaterial = new THREE.MeshPhysicalMaterial({
    // Zero diffuse: with additive blending the cap contributes reflections only.
    color: new THREE.Color(0, 0, 0),
    roughness: 0.02,
    metalness: 0,
    envMapIntensity: 3,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return {
    eyeball: ball,
    cornea: cap,
    material: eyeMaterial,
    corneaMaterial: capMaterial,
    maps: [map, bumpMap],
  };
}

function Eye({ focus, reduceMotion }: { focus: EyeFocus; reduceMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const saccade = useRef({ x: 0, y: 0, next: 1.5 });

  const eyeMesh = useRef<THREE.Mesh>(null);
  const { eyeball, cornea, material, corneaMaterial, maps } = useMemo(() => buildEyeAssets(), []);

  useEffect(
    () => () => {
      eyeball.dispose();
      cornea.dispose();
      material.dispose();
      corneaMaterial.dispose();
      maps.forEach((texture) => texture.dispose());
    },
    [eyeball, cornea, material, corneaMaterial, maps],
  );

  useEffect(() => {
    if (reduceMotion) return undefined;
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduceMotion]);

  useFrame((state, delta) => {
    const eye = group.current;
    if (!eye) return;
    const time = state.clock.elapsedTime;
    const s = saccade.current;
    if (!reduceMotion && time > s.next) {
      s.x = (Math.random() - 0.5) * 0.08;
      s.y = (Math.random() - 0.5) * 0.05;
      s.next = time + 1.1 + Math.random() * 2.8;
    }
    const lookX = reduceMotion ? 0 : pointer.current.x * 0.3 + s.x;
    const lookY = reduceMotion ? 0 : pointer.current.y * 0.2 + s.y;
    eye.rotation.y = damp(eye.rotation.y, lookX, 14, delta);
    eye.rotation.x = damp(eye.rotation.x, lookY, 14, delta);

    const unrest = reduceMotion ? 0 : Math.sin(time * 0.9) * 0.012 + Math.sin(time * 2.3) * 0.006;
    const uniforms = eyeMesh.current ? pupilUniforms(eyeMesh.current) : null;
    if (uniforms) {
      uniforms.uPupil.value = damp(
        uniforms.uPupil.value,
        PUPIL_BY_FOCUS[focus] + unrest,
        2.4,
        delta,
      );
    }
  });

  return (
    <group ref={group}>
      <mesh ref={eyeMesh} geometry={eyeball} material={material} />
      <mesh geometry={cornea} material={corneaMaterial} renderOrder={1} />
    </group>
  );
}

export default function EyeMacro({ focus, active, reduceMotion, onReady }: EyeMacroProps) {
  const keyLight = focus === 'light' ? 3.4 : 2.2;

  return (
    <Canvas
      frameloop={active && !reduceMotion ? 'always' : 'demand'}
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: THREE.AgXToneMapping,
        powerPreference: 'high-performance',
      }}
      camera={{ fov: 20, position: [0, 0.05, 5.2], near: 0.1, far: 40 }}
      aria-hidden="true"
      onCreated={() => onReady?.()}
    >
      <ambientLight intensity={0.1} />
      <directionalLight position={[-3, 3.2, 5]} intensity={keyLight} color="#fff0d8" />
      <directionalLight position={[4, -1, 2]} intensity={0.35} color="#ffe2b0" />
      <Environment resolution={256} frames={1}>
        <Lightformer
          form="rect"
          intensity={6}
          color="#fff1dc"
          position={[-2.4, 2.4, 5]}
          scale={[3.4, 2.3, 1]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={1.4}
          color="#ffe2b0"
          position={[3.6, -0.6, 3.2]}
          scale={[0.5, 3.4, 1]}
          target={[0, 0, 0]}
        />
      </Environment>
      <Eye focus={focus} reduceMotion={reduceMotion} />
    </Canvas>
  );
}
