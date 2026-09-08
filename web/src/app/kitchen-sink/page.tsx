import type { Metadata } from 'next';
import { AppShell, PageHeader } from '@/components/shell';
import { Callout, Pill } from '@/components/ui';
import { Gallery } from './Gallery';

export const metadata: Metadata = {
  title: 'Kitchen sink',
  description: 'Every primitive in every state, rendered server-side with no wallet connected.',
  robots: { index: false, follow: false },
};

/**
 * The component gallery.
 *
 * The page itself is a server component, which is what keeps `metadata` here and the shell out of
 * the client bundle. The specimens live in one client module below, because a lucide icon and an
 * `onRetry` callback are a function and a component reference, and neither survives the server /
 * client boundary — the very constraint every real screen in this app hits. They are still rendered
 * on the server: a primitive that touches `window` during render fails the production build on this
 * route rather than in someone's tab.
 *
 * No wallet, no connectors and no RPC are needed to render it, which is also the fastest way to see
 * all five states of a data surface side by side.
 */
export default function KitchenSinkPage() {
  return (
    <AppShell>
      <PageHeader
        title="Kitchen sink"
        subtitle="Every primitive in every state. Rendered server-side, with no wallet connected."
        meta={
          <>
            <Pill tone="warning" dot>
              Fixture values
            </Pill>
            <Pill tone="neutral">Not linked from the nav</Pill>
          </>
        }
      />

      <div className="mt-6">
        <Callout tone="warning" title="The numbers on this page are fixtures, not chain reads">
          This is the one screen in the app exempt from the no-fake-data rule, because its subject is
          the components rather than a position. The values are shaped like real ones &mdash; a
          checksummed 42-character address, a 66-character hash, amounts at irregular magnitudes
          &mdash; and the token figures are the ones the contract suite measured: 0.338 WETH of theta
          over a leg&rsquo;s life, a 133.49 USDC decay band after two days, the demo book&rsquo;s
          10.4 WETH of backing. Every other screen renders only what the chain returned.
        </Callout>
      </div>

      <Gallery />
    </AppShell>
  );
}
