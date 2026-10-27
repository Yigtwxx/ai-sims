import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('keeps a custom type-ramp size next to a text colour', () => {
    expect(cn('text-primary-foreground', 'text-body-sm')).toBe(
      'text-primary-foreground text-body-sm',
    );
    expect(cn('text-ink', 'text-ui')).toBe('text-ink text-ui');
    expect(cn('text-kicker', 'text-ink-faint')).toBe('text-kicker text-ink-faint');
  });

  it('still lets a later size win over an earlier one', () => {
    expect(cn('text-ui', 'text-title')).toBe('text-title');
    expect(cn('rounded-tile', 'rounded-control')).toBe('rounded-control');
  });
});
