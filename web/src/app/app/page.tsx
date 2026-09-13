import type { Metadata } from 'next';
import { TerminalScreen } from '@/components/terminal';

export const metadata: Metadata = {
  /* Spelled out rather than left to the root layout's `%s · Strikeline`: a title template does not
     apply to the segment that declares it, and `app/page.tsx` is that segment, so relying on it
     puts a bare `WETH/USDC` in the tab. The pair leads because that is what someone with nine tabs
     open is scanning for. */
  title: 'WETH/USDC · Strikeline',
  description:
    'Write covered calls as price curves inside 1inch Aqua. The collateral never leaves the wallet, several offers stand behind one balance, and every figure is read from the router at one block.',
};

/**
 * The terminal, at `/app`. `/` is the landing page.
 *
 * There is no `/offers`, no `/offer/[hash]`, no `/write`, no `/book`, no `/surface` and no
 * `/receipt`: the positions view is the strip at the bottom of this screen, the offer detail is a
 * row on it, and the ticket is beside the chart the way it is on every trading terminal. The read
 * layer and the markout study were submission artifacts rather than product screens, so they are in
 * the README and this file is the only route the app has.
 *
 * The route entry stays on the server so the title lives in the route rather than in an effect;
 * everything below it reads a wallet and a chain, so it is a client module.
 */
export default function TerminalPage() {
  return <TerminalScreen />;
}
