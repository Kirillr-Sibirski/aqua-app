import type { Metadata } from 'next';
import { TerminalScreen } from '@/components/terminal';

export const metadata: Metadata = {
  title: 'WETH/USDC',
  description:
    'Write covered calls as price curves inside 1inch Aqua. The collateral never leaves the wallet, several offers stand behind one balance, and every figure is read from the router at one block.',
};

/**
 * The only route.
 *
 * There is no `/offers`, no `/offer/[hash]`, no `/write` and no `/book`: the positions view is the
 * strip at the bottom of this screen, the offer detail is a row on it, and the ticket is beside the
 * chart the way it is on every trading terminal. `/surface` and `/receipt` still exist as read-layer
 * artifacts and are reachable only from the one line in the footer.
 *
 * The route entry stays on the server so the title lives in the route rather than in an effect;
 * everything below it reads a wallet and a chain, so it is a client module.
 */
export default function TerminalPage() {
  return <TerminalScreen />;
}
