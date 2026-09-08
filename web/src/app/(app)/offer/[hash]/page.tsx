import type { Metadata } from 'next';
import { OfferScreen } from '@/components/offer';
import { truncateHash } from '@/lib/ui';

export async function generateMetadata({ params }: PageProps<'/offer/[hash]'>): Promise<Metadata> {
  const { hash } = await params;
  return {
    title: `Offer ${truncateHash(hash)}`,
    description:
      'One offer to sell ETH at a price its maker named: what it trades at now, what it becomes on its date, the gap that pays the maker, every trade against it, and the bytes it is stored as.',
  };
}

/**
 * `/offer/[hash]`.
 *
 * The strategy hash is the identity. `Aqua.ship` takes the strategy whole and `keccak256` of those
 * bytes is what every balance in the registry is keyed by, so an offer needs no database row and
 * this URL is stable for anyone, not only for its maker.
 */
export default async function OfferPage({ params }: PageProps<'/offer/[hash]'>) {
  const { hash } = await params;
  return <OfferScreen hash={hash} />;
}
