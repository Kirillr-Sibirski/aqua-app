import type { Metadata } from 'next';
import { BookScreen } from './BookScreen';

export const metadata: Metadata = {
  title: 'Book',
  description:
    'One wallet backing a ladder of option legs on 1inch Aqua. Deliverable depth comes from the Coverage instruction that enforces it, and realised theta from the decay band each fill actually cleared.',
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
