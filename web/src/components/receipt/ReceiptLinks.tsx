'use client';

/**
 * The two links off the bottom of the receipt.
 *
 * Their own module purely because `buttonVariants` lives in a client module, and the receipt page is a
 * server component on purpose: the whole comparison, tables included, is in the HTML before any
 * JavaScript runs. One small client island for two anchors is cheaper than hydrating the page to style
 * them.
 */
import Link from 'next/link';
import { buttonVariants } from '@/components/ui';

export function ReceiptLinks() {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/write" className={buttonVariants({ variant: 'primary', size: 'md' })}>
        Name your own price
      </Link>
      <Link href="/book" className={buttonVariants({ variant: 'secondary', size: 'md' })}>
        See a live book
      </Link>
    </div>
  );
}
