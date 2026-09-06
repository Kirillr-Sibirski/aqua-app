/**
 * `cn()` — conditional class names with Tailwind conflict resolution.
 *
 * tailwind-merge only dedupes classes it recognises, and it has no way to know about the tokens
 * declared in `globals.css`. Left unconfigured it would read `text-body` (a font size) as a text
 * colour and silently drop it next to `text-ink-3`. The extension below teaches it every custom
 * scale, so `cn('text-meta text-ink-3', 'text-body')` keeps the colour and swaps only the size.
 */
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { COLOR_TOKENS, TEXT_TOKENS } from './tokens';

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // `bg-surface`, `text-ink-2`, `border-line`, `fill-accent`, ...
      color: [...COLOR_TOKENS],
      // `text-body`, `text-title`, ... (font size, not colour)
      text: [...TEXT_TOKENS],
      leading: ['num', 'prose'],
      radius: ['card', 'control', 'pill'],
      shadow: ['overlay'],
      ease: ['out-quart'],
      container: ['page'],
    },
    classGroups: {
      // The semantic stacking scale; these must conflict with each other and with `z-10`.
      z: [{ z: ['dropdown', 'sticky', 'modal-backdrop', 'modal', 'toast', 'tooltip'] }],
      // `transition-state` is the app's standard state-change transition.
      transition: [{ transition: ['state'] }],
      // `tnum` sets tabular-nums + slashed-zero, so it supersedes `tabular-nums`.
      'fvn-spacing': ['tnum'],
    },
  },
});

/**
 * Merge class names, last conflicting utility wins.
 *
 * @example cn('rounded-card border border-line', isActive && 'border-accent', className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
