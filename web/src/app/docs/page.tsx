import type { Metadata } from 'next';
import Link from 'next/link';
import { WordmarkMark } from '@/components/shell/Wordmark';
import classes from './docs.module.css';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'What Strikeline does, who pays you, and how to read the screen.',
};

const REPO = 'https://github.com/Kirillr-Sibirski/strikeline';

export default function DocsPage() {
  return (
    <div className={classes.page}>
      <header className={classes.bar}>
        <Link href="/" className={classes.brand}>
          <WordmarkMark size={18} />
          strikeline
        </Link>
        <Link href="/app" className={classes.back}>
          Back to app
        </Link>
      </header>

      <main className={classes.body}>
        <section>
          <h1>How Strikeline works</h1>
          <p className={classes.lede}>
            You name a price you would be happy to sell your ETH at, and a date. Buyers who want that
            ETH pay you for having waited. Until someone actually buys, the ETH never leaves your
            wallet: your offer is a quote, not a deposit.
          </p>
        </section>

        <section>
          <h2>Who pays you, and why</h2>
          <p>
            Your offer is published as a quote on <strong>1inch Aqua</strong>, a shared liquidity layer
            that trades against makers&apos; wallets. Traders and arbitrage bots routing swaps through it
            can buy WETH from your quote.
          </p>
          <p>
            The quote is built so that <strong>time makes it more expensive to trade against</strong>. The
            day you publish, it sits exactly at its starting point. Every day nobody trades, a gap opens
            between that starting point and where the curve now is. A buyer only crosses when the market
            has moved far enough to be worth paying that gap, and the gap they pay is your{' '}
            <strong>premium</strong>.
          </p>
          <p>
            You are <strong>not paid up front</strong>. The premium is only collected when someone trades.
            If nobody does, you keep your ETH and earn nothing.
          </p>
        </section>

        <section>
          <h2>What happens at expiry</h2>
          <ul className={classes.list}>
            <li>
              <strong>ETH ends below your price:</strong> you keep your ETH, plus whatever trades along
              the way paid you.
            </li>
            <li>
              <strong>ETH ends above your price:</strong> your ETH is sold at your price. You keep what
              you were paid, and you miss the move above it.
            </li>
          </ul>
          <p>
            At expiry the quote turns into a plain limit order at your price, so selling is an ordinary
            swap: no settlement step, no option token.
          </p>
        </section>

        <section>
          <h2>Before expiry, the offer sells gradually</h2>
          <p>
            Your offer does not wait for the price to hit your strike and then sell everything. As
            buyers take more, each extra WETH sells at a higher price: the first ones near today&apos;s
            price, later ones above your strike. If the price falls, the offer buys WETH back. That
            gradual selling is what makes holding the offer behave exactly like a covered call.
          </p>
        </section>

        <section>
          <h2>Reading the screen</h2>
          <dl className={classes.terms}>
            <dt>Sell</dt>
            <dd>How much WETH the offer covers. It stays in your wallet.</dd>
            <dt>Strike</dt>
            <dd>The price you are willing to sell at, in USDC per WETH.</dd>
            <dt>Expiry</dt>
            <dd>When the offer becomes a plain order at your strike.</dd>
            <dt>IV</dt>
            <dd>
              Implied volatility: how big a price move you are pricing in. Higher means a bigger
              premium and a wider gap buyers must cross.
            </dd>
            <dt>Premium</dt>
            <dd>What buyers would pay you by expiry for the wait.</dd>
            <dt>Capped at</dt>
            <dd>Your strike plus the premium per WETH: the price above which holding would have won.</dd>
          </dl>
          <dl className={classes.terms}>
            <dt>premium</dt>
            <dd>How much extra a buyer pays you, against days since you posted.</dd>
            <dt>payoff</dt>
            <dd>What you end up with at expiry, with your offer against just holding, for each ETH price.</dd>
            <dt>price</dt>
            <dd>The price each WETH sells at as buyers take more of your offer.</dd>
          </dl>
          <dl className={classes.terms}>
            <dt>Badge</dt>
            <dd>Whether the offer sells WETH (a call) or buys it with USDC (a put).</dd>
            <dt>Size · Strike · IV · Expiry</dt>
            <dd>The terms you published.</dd>
            <dt>Earned</dt>
            <dd>What trades against this offer have paid you so far.</dd>
            <dt>Deliverable</dt>
            <dd>How much of the offer your wallet could hand over right now. It drops when a sibling offer fills.</dd>
            <dt>✕</dt>
            <dd>Withdraw the offer. The first click arms it, the second withdraws. No tokens move.</dd>
            <dt>Promised</dt>
            <dd>Total WETH offered across all your offers, against the WETH actually in your wallet.</dd>
          </dl>
        </section>

        <section>
          <h2>Why one wallet can back many offers</h2>
          <p>
            Every trade checks your real wallet balance and allowance before it is quoted, and refuses
            anything your wallet cannot actually deliver. All your offers read the same wallet, so a fill
            on one immediately shrinks what the others can deliver, in the same block.
          </p>
        </section>

        <section>
          <h2>Under the hood</h2>
          <p>
            Two custom SwapVM instructions run on a redeployed router that settles on the official Aqua
            registry <code>0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a</code>:
          </p>
          <ul className={classes.list}>
            <li>
              <code>RmmSwap</code> (opcode <code>0x55</code>) prices the offer with RMM-01, the covered-call
              curve from Angeris, Evans &amp; Chitra (
              <a href="https://arxiv.org/abs/2103.14769">arXiv 2103.14769</a>,{' '}
              <a href="https://arxiv.org/abs/2111.13740">arXiv 2111.13740</a>). Time left is read from
              the block clock, so the curve ages with no transaction.
            </li>
            <li>
              <code>Coverage</code> (opcode <code>0x93</code>) runs the curve first, then rejects a quote
              the maker&apos;s balance and allowance cannot cover.
            </li>
          </ul>
          <p>
            Code, tests and details are on <a href={REPO}>GitHub</a>.
          </p>
        </section>

        <section>
          <h2>Risks</h2>
          <ul className={classes.list}>
            <li>
              <strong>It is short volatility.</strong> If ETH moves more than the IV you chose, you would
              have done better holding.
            </li>
            <li>
              <strong>No up-front payment.</strong> You only earn when someone trades.
            </li>
            <li>
              <strong>Offers can be withdrawn at any time</strong>, so a buyer cannot rely on one like an
              exchange-listed option.
            </li>
            <li>
              <strong>This demo runs on a fork of Base mainnet</strong>, against the real Aqua registry and
              real WETH and USDC, not on a live network.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
