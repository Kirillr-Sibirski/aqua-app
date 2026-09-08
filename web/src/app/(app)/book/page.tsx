import type { Metadata } from 'next';
import { BookScreen } from './BookScreen';

export const metadata: Metadata = {
  title: 'Your offers',
  description:
    'Every offer you have open to sell your ETH at a price you named, and the one wallet balance standing behind all of them. How much you can actually sell is read from the guard that enforces it, and what you have been paid from the gap each past trade really had to clear.',
};

/**
 * The server half of the screen: the metadata, and nothing else.
 *
 * Everything below the fold reads a wallet, so `BookScreen` is a client module. Keeping the route
 * entry on the server is what lets the title and description live in the route rather than in a
 * `useEffect`, and it costs nothing: the shell renders on the server either way.
 */
export default function BookPage() {
  return <BookScreen />;
}
