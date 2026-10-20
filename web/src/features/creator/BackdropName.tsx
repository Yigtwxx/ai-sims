'use client';

import { Text } from '@react-three/drei';
import { Suspense } from 'react';

const FONT_URL = '/fonts/BigShoulders-Display-ExtraBold.woff';

/**
 * The character's name set huge on the backdrop wall behind them, tone on
 * tone like premiere key art. Lives in the 3D scene so the character stands
 * in front of the letters; it does not turn with the turntable.
 */
export function BackdropName({
  name,
  height = 1.6,
  locale,
}: {
  name: string;
  height?: number;
  locale: string;
}) {
  const text = name.trim().toLocaleUpperCase(locale);
  if (!text) return null;
  // Long names shrink to keep roughly the same visual width.
  const size = Math.min(height * 0.62, (height * 3.4) / Math.max(text.length, 4));
  return (
    <Suspense fallback={null}>
      <Text
        font={FONT_URL}
        fontSize={size}
        letterSpacing={0.02}
        position={[0, height * 0.66, -2.2]}
        anchorX="center"
        anchorY="middle"
        color="#2a272d"
        maxWidth={height * 5}
        renderOrder={-2}
      >
        {text}
      </Text>
    </Suspense>
  );
}
