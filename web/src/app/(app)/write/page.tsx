import type { Metadata } from 'next';
import { AppShell, PageHeader } from '@/components/shell';
import { WriteWizard } from '@/components/write';

export const metadata: Metadata = {
  title: 'Name your price',
  description:
    'Name the prices you would sell your ETH at, and the date the offers run to. Whoever takes one pays you for the wait, one wallet balance stands behind all of them, and no token moves until somebody fills.',
};

/**
 * `/write`.
 *
 * A server shell around a client wizard: the page itself has nothing to render on the server, since
 * every number on it is a chain read, and keeping the route static means the metadata and the frame
 * ship in the first byte while the wallet and the router are still being reached.
 */
export default function WritePage() {
  return (
    <AppShell>
      <PageHeader
        title="Name your price"
        subtitle={
          <>
            <span className="block">
              Name the price you would sell your ETH at, and the date the offer runs to. Whoever
              takes it pays you for the wait. If ETH runs past your price you sell at your price and
              keep what you were paid; if it moves more than the volatility you choose, you lose.
            </span>
            <span className="mt-2 block text-ink-3">
              You are not paid up front. The payment accrues inside your own quote and only becomes
              real when somebody trades against it. The tokens never leave this wallet.
            </span>
            <span className="mt-2 block text-ink-3">
              <em className="not-italic text-ink-2">If you already trade options:</em> a covered-call
              ladder written as RMM-01 price curves, one SwapVM program per strike, shipped to Aqua
              from this wallet against tokens it never takes custody of.
            </span>
          </>
        }
      />
      <div className="mt-8">
        <WriteWizard />
      </div>
    </AppShell>
  );
}
