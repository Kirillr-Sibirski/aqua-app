'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/ui';
import { IconButton, Sheet } from '@/components/ui';
import { isNavItemActive, readyNavItems } from './nav';

/**
 * The nav below `sm`, where the horizontal bar does not fit.
 *
 * Without it the four anchors were still in the DOM at 390px and all four had zero width, so the
 * only way off a page was the wordmark, which always goes to the overview: four of the five product
 * routes were unreachable on a phone. A labelled button opening the existing bottom Sheet keeps one
 * nav definition (`nav.ts`) and inherits the overlay's focus trap, Escape and scroll lock rather
 * than growing a second set of them.
 */
export function MobileNav({ className }: { className?: string }) {
  const pathname = usePathname();
  // The route the sheet was opened on, rather than a boolean. Next keeps the shell mounted across
  // navigations, so a sheet opened to navigate would otherwise still be covering the page it
  // navigated to; deriving `open` from the path closes it on arrival, and on a browser Back too,
  // with no effect and no second source of truth.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const close = () => setOpenedOn(null);
  const items = readyNavItems();

  if (items.length < 2) return null;

  return (
    <div className={className}>
      <IconButton icon={Menu} label="Open navigation" size="sm" onClick={() => setOpenedOn(pathname)} />
      <Sheet side="bottom" open={open} onClose={close} title="Go to" bodyClassName="px-0 py-0">
        <nav aria-label="Primary">
          <ul>
            {items.map((item) => {
              const active = isNavItemActive(item, pathname);
              return (
                <li key={item.href} className="border-b border-line last:border-b-0">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={close}
                    className={cn(
                      'flex h-12 items-center gap-3 px-5 text-body transition-state',
                      active ? 'font-medium text-ink' : 'text-ink-2',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('h-4 w-px shrink-0', active ? 'bg-accent' : 'bg-transparent')}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </Sheet>
    </div>
  );
}
