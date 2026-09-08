'use client';

import { cn, truncateAddress, truncateHash } from '@/lib/ui';
import { CopyButton } from './CopyButton';
import { ExplorerLink } from './ExplorerLink';

export interface AddressProps {
  /** The full value. EIP-55 checksum it upstream with viem's `getAddress`; this never re-cases. */
  value: string;
  /** A hash is an identity a maker reads off the screen, so it keeps more characters than an address. */
  kind?: 'address' | 'hash';
  /** Explorer URL. Omit for state that exists only on the local fork — a dead link is worse. */
  href?: string;
  /** Default true. */
  copy?: boolean;
  /** `meta` (13px) inside tables, `body` (14px) standing alone. */
  size?: 'mini' | 'meta' | 'body';
  /** Show the whole value instead of eliding it. For a detail panel with room for 42 characters. */
  full?: boolean;
  /** Names the value in the copy button's label: "maker address", "strategy hash". */
  what?: string;
  className?: string;
}

/**
 * An address or a hash, elided in the middle.
 *
 * Middle elision keeps both ends, which is what a person actually compares — the leading bytes
 * identify the contract and the trailing bytes catch a transposition. The untruncated value stays
 * on `title` and on the clipboard, so nothing is lost to the ellipsis.
 */
export function Address({
  value,
  kind = 'address',
  href,
  copy = true,
  size = 'meta',
  full = false,
  what,
  className,
}: AddressProps) {
  const shown = full ? value : kind === 'hash' ? truncateHash(value) : truncateAddress(value);
  const noun = what ?? (kind === 'hash' ? 'hash' : 'address');
  const type = size === 'mini' ? 'text-mini' : size === 'body' ? 'text-body' : 'text-meta';

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      {href ? (
        <ExplorerLink href={href} bare mono className={cn(type, 'text-ink-2 hover:text-accent')}>
          <span title={full ? undefined : value}>{shown}</span>
        </ExplorerLink>
      ) : (
        <span
          title={full ? undefined : value}
          className={cn('truncate font-mono tnum text-ink-2', type)}
        >
          {shown}
        </span>
      )}
      {copy ? <CopyButton value={value} what={noun} compact /> : null}
    </span>
  );
}
