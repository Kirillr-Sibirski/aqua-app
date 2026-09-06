/**
 * `cn` is only useful if tailwind-merge knows the project's scales. Without the extension in
 * `cn.ts`, `text-body` looks like a colour to it and gets dropped next to `text-ink-3` — a failure
 * that produces no error, just the wrong type size on a page nobody thinks to re-check.
 */
import { describe, expect, it } from 'vitest';
import { cn } from '../cn';

describe('cn', () => {
  it('keeps a font size and a text colour side by side', () => {
    expect(cn('text-body', 'text-ink-3')).toBe('text-body text-ink-3');
    expect(cn('text-ink-3', 'text-body')).toBe('text-ink-3 text-body');
  });

  it('resolves conflicts inside each custom scale', () => {
    expect(cn('text-meta', 'text-title')).toBe('text-title');
    expect(cn('text-ink-2', 'text-accent')).toBe('text-accent');
    expect(cn('bg-surface', 'bg-surface-2')).toBe('bg-surface-2');
    expect(cn('border-line', 'border-line-strong')).toBe('border-line-strong');
    expect(cn('rounded-control', 'rounded-card')).toBe('rounded-card');
    expect(cn('leading-num', 'leading-prose')).toBe('leading-prose');
    expect(cn('ease-out', 'ease-out-quart')).toBe('ease-out-quart');
  });

  it('treats the semantic z scale as one stacking axis', () => {
    expect(cn('z-dropdown', 'z-modal')).toBe('z-modal');
    expect(cn('z-10', 'z-tooltip')).toBe('z-tooltip');
    expect(cn('z-toast', 'z-10')).toBe('z-10');
  });

  it('lets tnum supersede tabular-nums', () => {
    expect(cn('tabular-nums', 'tnum')).toBe('tnum');
  });

  it('resolves the standard transition group against transition-state', () => {
    expect(cn('transition-colors', 'transition-state')).toBe('transition-state');
    expect(cn('transition-state', 'transition-none')).toBe('transition-none');
  });

  it('still handles the Tailwind defaults and clsx conditionals', () => {
    expect(cn('px-3 py-2', 'px-4')).toBe('py-2 px-4');
    expect(cn('border', false && 'border-accent', undefined, ['gap-2'])).toBe('border gap-2');
  });
});
