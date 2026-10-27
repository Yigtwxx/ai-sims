import { describe, expect, it } from 'vitest';

import { CAMERA_PRESETS, resolveFocus } from './framing';

describe('resolveFocus', () => {
  it('follows the category when nothing else asks for a framing', () => {
    expect(resolveFocus(null, null, 'head')).toBe('head');
    expect(resolveFocus(null, null, 'legs')).toBe('legs');
  });

  it('lets a picked preset override the category', () => {
    expect(resolveFocus(null, 'body', 'head')).toBe('body');
    expect(resolveFocus(null, 'torso', 'feet')).toBe('torso');
  });

  it('gives the Done portrait priority over a picked preset', () => {
    expect(resolveFocus('torso', 'head', 'body')).toBe('torso');
    expect(resolveFocus('torso', null, 'feet')).toBe('torso');
  });

  it('offers the presets widest first', () => {
    expect(CAMERA_PRESETS).toEqual(['body', 'torso', 'head']);
  });
});
