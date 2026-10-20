'use client';

import { useMemo } from 'react';
import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from 'three';

const HALF_WIDTH = 8;

/**
 * Seamless studio backdrop: a floor that curves up into a back wall, so there
 * is no visible horizon line behind the character. Built by sweeping a (z, y)
 * profile across the x axis.
 */
export function Cyclorama({
  color = '#f4f3f0',
  glow = 0.55,
}: {
  color?: string;
  /** Self-illumination that pushes the backdrop to a high-key white like a lit studio cyc. */
  glow?: number;
}) {
  const geometry = useMemo(() => {
    const profile = new CatmullRomCurve3([
      new Vector3(0, 0, 8),
      new Vector3(0, 0, -1.6),
      new Vector3(0, 0.3, -2.7),
      new Vector3(0, 1.3, -3.3),
      new Vector3(0, 7, -3.5),
    ]).getPoints(96);

    const positions: number[] = [];
    for (const p of profile) positions.push(-HALF_WIDTH, p.y, p.z, HALF_WIDTH, p.y, p.z);

    // Wind triangles so the front face points towards +z / +y (the camera).
    const indices: number[] = [];
    for (let i = 0; i < profile.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={glow}
        roughness={0.92}
        metalness={0}
      />
    </mesh>
  );
}
