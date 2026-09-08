import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';
import { Toaster } from '@/components/ui';
import { NetworkGuard, WalletCluster } from '@/components/wallet';
import { Footer } from './Footer';
import { MobileNav } from './MobileNav';
import { NavBar } from './NavBar';
import { NetworkPill } from './NetworkPill';
import { Wordmark } from './Wordmark';

export interface AppShellProps {
  children: ReactNode;
  /** Drops the max-width column, for a screen that manages its own full-bleed layout. */
  bleed?: boolean;
  className?: string;
}

/**
 * The frame every screen sits in: a sticky 56px bar carrying the mark, the nav, the chain's
 * liveness and the wallet, then the content column, then the footer.
 *
 * `NetworkGuard` sits directly under the bar as an inline banner rather than a modal. A maker on
 * the wrong chain can still read their book — the numbers on screen are read from the deployment
 * chain, not from the wallet's — so blocking the page to tell them would hide the very thing they
 * came to check. The guard states the problem and offers the one control that fixes it.
 */
export function AppShell({ children, bleed = false, className }: AppShellProps) {
  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#content"
        className={cn(
          'sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-toast',
          'focus:rounded-control focus:border focus:border-line focus:bg-surface focus:px-3 focus:py-2',
          'focus:text-meta focus:text-ink',
        )}
      >
        Skip to content
      </a>

      {/* Opaque, and one z step above `--z-sticky`: a sticky table header pins to `--header-h` and
          has to pass UNDER this bar, not through it. No blur — DESIGN.md rules out glass. */}
      <header className="sticky top-0 z-app-bar border-b border-line bg-bg">
        <div className="mx-auto flex h-header w-full max-w-page items-center gap-6 px-6">
          <Wordmark />
          <NavBar className="hidden sm:block" />
          <div className="ml-auto flex items-center gap-2">
            <NetworkPill className="hidden lg:flex" />
            <WalletCluster />
            <MobileNav className="sm:hidden" />
          </div>
        </div>
      </header>

      <NetworkGuard className="mx-auto w-full max-w-page px-6 pt-4" />

      <main
        id="content"
        tabIndex={-1}
        className={cn(
          'flex-1 focus-visible:outline-none',
          bleed ? 'w-full' : 'mx-auto w-full max-w-page px-6 py-8',
          className,
        )}
      >
        {children}
      </main>

      <span data-probe>{typeof window === 'undefined' ? 'SERVER' : 'CLIENT'}</span>
      <Footer />
      <Toaster />
    </div>
  );
}
