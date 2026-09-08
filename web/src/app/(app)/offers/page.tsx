import type { Metadata } from 'next';
import { OffersScreen } from '@/components/offers';

export const metadata: Metadata = {
  title: 'Your offers',
  description:
    'Every offer you have published to sell your ETH at a price you named, and the one wallet balance standing behind all of them. How much can actually be taken is read from the guard that enforces it; what you have earned is the spread past buyers really had to cross.',
};

/**
 * The server half of the second tab: the metadata, and nothing else.
 *
 * Everything below reads a wallet, so `OffersScreen` is a client module. Keeping the route entry on
 * the server is what lets the title and description live in the route rather than in an effect, and
 * it costs nothing.
 */
export default function OffersPage() {
  return <OffersScreen />;
}
