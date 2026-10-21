import { describe, expect, it } from 'vitest';

import { StageSwap } from './swap';

const instance = (name: string) => ({ name });

describe('StageSwap', () => {
  it('promotes the mounted incoming instance once it settles for the requested key', () => {
    const swap = new StageSwap<{ name: string }>();
    const h2 = instance('h2');
    swap.request('H2', true);
    swap.setIncoming(h2);
    swap.unsettle(h2);
    expect(swap.canPromote(h2, 'H2')).toBe(false);
    swap.settle(h2, 'H2');
    expect(swap.canPromote(h2, 'H2')).toBe(true);
  });

  it('ignores a late settle from an incoming instance that was unmounted and remounted', () => {
    // H1 -> H2 -> H1 -> H2: the first H2 unmounts, a second one mounts in its place.
    const swap = new StageSwap<{ name: string }>();
    const stale = instance('h2 first');
    swap.request('H2', true);
    swap.setIncoming(stale);
    swap.request('H1', false);
    swap.setIncoming(null);
    swap.request('H2', true);
    const fresh = instance('h2 second');
    swap.setIncoming(fresh);
    swap.settle(stale, 'H2');
    expect(swap.canPromote(stale, 'H2')).toBe(false);
    // Even before the remount is attached.
    swap.setIncoming(null);
    expect(swap.canPromote(stale, 'H2')).toBe(false);
  });

  it('does not promote a character the stage has moved past', () => {
    const swap = new StageSwap<{ name: string }>();
    const h2 = instance('h2');
    swap.request('H2', true);
    swap.setIncoming(h2);
    // H3 asked for before H2 unmounts.
    swap.request('H3', true);
    swap.settle(h2, 'H2');
    expect(swap.canPromote(h2, 'H2')).toBe(false);
  });

  it('is caught up only when the on-screen instance settled for the requested key', () => {
    const swap = new StageSwap<{ name: string }>();
    const h1 = instance('h1');
    const h2 = instance('h2');
    swap.request('H1', false);
    swap.setOnScreen(h1);
    expect(swap.caughtUp).toBe(false);
    swap.settle(h1, 'H1');
    expect(swap.caughtUp).toBe(true);

    // A new face: behind while it assembles off screen.
    swap.request('H2', true);
    swap.setIncoming(h2);
    swap.settle(h2, 'H2');
    expect(swap.caughtUp).toBe(false);

    // Promoted, but the old one is still the one on screen until it is swapped.
    swap.request('H2', false);
    expect(swap.caughtUp).toBe(false);
    swap.setIncoming(null);
    swap.setOnScreen(null);
    swap.setOnScreen(h2);
    expect(swap.caughtUp).toBe(true);
  });

  it('falls behind while the on-screen character reloads a part', () => {
    const swap = new StageSwap<{ name: string }>();
    const h1 = instance('h1');
    swap.request('H1', false);
    swap.setOnScreen(h1);
    swap.settle(h1, 'H1');
    swap.unsettle(h1);
    expect(swap.caughtUp).toBe(false);
    swap.settle(h1, 'H1');
    expect(swap.caughtUp).toBe(true);
  });
});
