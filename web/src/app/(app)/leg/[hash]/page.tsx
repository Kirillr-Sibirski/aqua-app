import type { Metadata } from 'next';
import { AppShell } from '@/components/shell';
import { truncateHash } from '@/lib/ui';
import { LegDetail } from './LegDetail';

export async function generateMetadata({ params }: PageProps<'/leg/[hash]'>): Promise<Metadata> {
  const { hash } = await params;
  return {
    title: `Leg ${truncateHash(hash)}`,
    description:
      'The trading curve of one Strikeline leg, sampled from the router, with the decay band it has accrued, the fills that walked its reserves, and the bytes it was shipped as.',
  };
}

/**
 * `/leg/[hash]`.
 *
 * The strategy hash is the identity: `Aqua.ship` takes the strategy whole and `keccak256` of those
 * bytes is what every balance in the registry is keyed by, so a leg needs no database row and this
 * URL is stable for anyone, not just its maker.
 */
export default async function LegPage({ params }: PageProps<'/leg/[hash]'>) {
  const { hash } = await params;
  return (
    <AppShell>
      <LegDetail hash={hash} />
    </AppShell>
  );
}
