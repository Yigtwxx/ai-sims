'use client';

import { useMemo } from 'react';
import { LatheGeometry, Vector2 } from 'three';

/** Low studio plinth the character stands on (metres); its top is the y = 0 floor. */
export const PLATFORM_HEIGHT = 0.05;
const RADIUS = 0.6;
/** Rounded top edge: it catches the key light, so the plinth reads on a dark stage. */
const BEVEL = 0.012;
const BEVEL_STEPS = 8;

/**
 * A round plinth under the character: the dark stage floor is near black, so
 * without it the feet look like they float. Its top sits at y = 0 (where the
 * feet are) and the stage floor is lowered by PLATFORM_HEIGHT to meet its base.
 */
export function Platform({ color = '#2a2826' }: { color?: string }) {
  const geometry = useMemo(() => {
    // (radius, y) profile, from the centre of the top out and down the side.
    const profile = [new Vector2(0, 0), new Vector2(RADIUS - BEVEL, 0)];
    for (let i = 1; i <= BEVEL_STEPS; i++) {
      const angle = (i / BEVEL_STEPS) * (Math.PI / 2);
      profile.push(
        new Vector2(RADIUS - BEVEL + Math.sin(angle) * BEVEL, -BEVEL + Math.cos(angle) * BEVEL),
      );
    }
    profile.push(new Vector2(RADIUS, -PLATFORM_HEIGHT));
    // Lathe winds the profile so the outside faces out only when it runs bottom to top.
    return new LatheGeometry(profile.reverse(), 128);
  }, []);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.5} metalness={0} />
    </mesh>
  );
}
