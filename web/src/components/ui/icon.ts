/**
 * The icon contract.
 *
 * One set (Lucide), one stroke width (1.5), two sizes (16 and 20). Nothing in the app renders an
 * emoji, a second icon library, or an icon at an off-scale size. Components take the icon
 * *component* rather than a rendered element, so they control size, stroke and `aria-hidden`
 * themselves and a caller cannot smuggle in a 24px 2px-stroke icon.
 */
import type { LucideIcon } from 'lucide-react';

/** Any Lucide icon: `import { Wallet } from 'lucide-react'` then `<Button icon={Wallet} />`. */
export type IconComponent = LucideIcon;

/** 16px inside controls and table cells; 20px only where an icon carries a block on its own. */
export const ICON_SIZE = { sm: 16, md: 20 } as const;

/** Lucide ships 2; the design system draws at 1.5 so icons weigh the same as a hairline. */
export const ICON_STROKE = 1.5;
