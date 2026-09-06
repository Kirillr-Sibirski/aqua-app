'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/ui';
import { isNavItemActive, readyNavItems } from './nav';

/**
 * Primary nav. The active item is marked twice — ink weight and a 1px accent rule sitting on the
 * bar's own bottom hairline — so it survives a screenshot at any zoom and does not depend on colour.
 */
export function NavBar({ className }: { className?: string }) {
  const pathname = usePathname();
  const items = readyNavItems();

  if (items.length < 2) return null;

  return (
    <nav aria-label="Primary" className={cn('h-full', className)}>
      <ul className="flex h-full items-stretch gap-1">
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center rounded-control px-3 text-meta transition-state',
                  'after:absolute after:inset-x-3 after:-bottom-px after:h-px after:content-[""]',
                  active
                    ? 'font-medium text-ink after:bg-accent'
                    : 'text-ink-2 hover:text-ink after:bg-transparent',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
