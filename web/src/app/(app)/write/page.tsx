import type { Metadata } from 'next';
import { AppShell, PageHeader } from '@/components/shell';
import { WriteWizard } from '@/components/write';

export const metadata: Metadata = {
  title: 'Write a book',
  description:
    'Write a ladder of option legs as SwapVM programs on 1inch Aqua. Every strike is sized through the router’s own curve, one wallet balance backs all of them, and no token moves until a fill.',
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
        title="Write a book"
        subtitle="A ladder of option legs, compiled to SwapVM programs and shipped to Aqua from this wallet. The tokens never move until someone fills."
      />
      <div className="mt-8">
        <WriteWizard />
      </div>
    </AppShell>
  );
}
