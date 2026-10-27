'use client';

import { useEffect, useState } from 'react';

/** Any of these anywhere on the page counts as someone using it. */
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const;

/**
 * True once the page has had no pointer, wheel or key input for `afterMs`.
 * Starts awake, so the first moments on a page (and a character coming on
 * stage) run at the full rate. Listens in the capture phase so inputs that a
 * control stops from bubbling still count.
 */
export function useInputIdle(afterMs: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let last = performance.now();
    let timer = 0;
    const check = () => {
      const left = afterMs - (performance.now() - last);
      if (left > 0) {
        timer = window.setTimeout(check, left);
        return;
      }
      timer = 0;
      setIdle(true);
    };
    // One pending timeout at a time: a pointer move only stamps the time.
    const wake = () => {
      last = performance.now();
      setIdle(false);
      if (!timer) timer = window.setTimeout(check, afterMs);
    };
    timer = window.setTimeout(check, afterMs);
    for (const type of INPUT_EVENTS) {
      window.addEventListener(type, wake, { capture: true, passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const type of INPUT_EVENTS) {
        window.removeEventListener(type, wake, { capture: true });
      }
    };
  }, [afterMs]);
  return idle;
}
