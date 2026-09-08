import type { Metadata } from 'next';
import { ReceiptScreen } from './ReceiptScreen';

export const metadata: Metadata = {
  title: 'Receipt',
  description:
    'SIMULATION, not a track record. A real week of Base ETH/USD prices replayed through one Strikeline book on the shipped contracts, marked against holding the same coins and against a constant-product pool on identical capital, with the whole volatility sweep and every start date published.',
};

/**
 * The route entry, and nothing else.
 *
 * The screen reads a file the Foundry replay wrote, so unlike every other screen in this app it needs
 * no wallet, no chain and no client state to render its numbers. Keeping the page a server component
 * means the whole comparison is in the HTML: a judge with JavaScript disabled still gets the tables,
 * and only the two charts and the sweep tables' scroll affordance hydrate.
 */
export default function ReceiptPage() {
  return <ReceiptScreen />;
}
