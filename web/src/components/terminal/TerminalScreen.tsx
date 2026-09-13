'use client';

/**
 * The app. All of it.
 *
 * One route, three regions: a 56px bar naming the instrument, a chart beside a 380px ticket, and
 * the positions underneath. There is no navigation because there is nowhere to go — the offer
 * detail is the row and the positions view is the strip. The read-layer study and the markout
 * receipt that used to be `/surface` and `/receipt` are in the README; they were submission
 * artifacts, and a footer link to them put a second product one click from the terminal.
 *
 * **Every read on this screen is owned here**, and that is the point rather than a convenience.
 * `useBook` pins its two multicall rounds and the fill replay to the watched block; the oracle, the
 * balances and the ticket's `stableFor` all run against the same chain at the same time; and the
 * block that produced them is printed in the bar. A person watching a fill land sees the positions
 * row, the meter beside it and the promised-over-held figure move together in one commit, because
 * they are one snapshot — which is the whole claim the product makes about writing several offers
 * against a balance that never moved.
 *
 * The draft lives above both the chart and the ticket for the same reason: the curve on the left is
 * the offer the button on the right is about to publish, and they must not be able to disagree.
 */
import { useMemo, useState } from 'react';
import { useBlock, useConnection, useSwitchChain } from 'wagmi';
import { TerminalChart } from '@/components/charts/terminal';
import { ConnectModal, type OfferPair } from '@/components/sell';
import { useDeploymentChain, useIsHydrated } from '@/components/shell';
import { TokenIcon } from '@/components/token';
import { useBook } from '@/hooks/useBook';
import { useDeployments, useOraclePrice, useTokenBalances } from '@/hooks';
import { aquaFork, type SupportedChainId } from '@/lib/chain';
import { useTweenedBigInt } from '@/lib/motion';
import { addressLt } from '@/lib/swapvm';
import { formatUnits } from '@/lib/ui';
import { TerminalFooter } from './Footer';
import { TerminalHeader } from './Header';
import { Positions } from './Positions';
import classes from './terminal.module.css';
import { Ticket } from './Ticket';
import { useSpotWindow } from './useSpotWindow';
import { useTicketDraft } from './useTicketDraft';

export function TerminalScreen() {
  const hydrated = useIsHydrated();
  const { address, chainId: walletChainId } = useConnection();
  const { deployments } = useDeployments();
  const deployment = useDeploymentChain();
  const { mutate: switchChain } = useSwitchChain();
  const [connectOpen, setConnectOpen] = useState(false);

  const pair = useMemo<OfferPair | undefined>(
    () =>
      deployments
        ? {
            risky: { address: deployments.weth, symbol: 'WETH', decimals: 18 },
            stable: { address: deployments.usdc, symbol: 'USDC', decimals: 6 },
            feed: deployments.chainlink.ethUsd,
            riskyIsTokenA: addressLt(deployments.weth, deployments.usdc),
          }
        : undefined,
    [deployments],
  );

  /* The chain's clock, never the browser's: the demo fork is warped forward, and a date counted
     against `Date.now()` would be wrong by days on it. */
  const block = useBlock({ chainId: aquaFork.id, watch: true, query: { staleTime: 4_000 } });
  const nowSeconds = block.data ? Number(block.data.timestamp) : undefined;

  const oracle = useOraclePrice(pair?.feed, { chainId: aquaFork.id });
  const spot = oracle.price?.price;
  /*
   * The mark, and the one figure on the bar that moves.
   *
   * Grouped and two-placed from the feed's own integer answer, not from the float beside it — and
   * the integer is what is tweened, so every frame between two readings is a real answer in the
   * feed's own units and the last one is the answer itself. Tweening the label would have meant
   * tweening a float parsed back out of a string; tweening the answer means `formatUnits` prints
   * the same way it always did and the only thing that changed is which integer it was handed.
   */
  const spotAnswer = useTweenedBigInt(oracle.price?.answer);
  const spotLabel =
    oracle.price && spotAnswer !== undefined
      ? formatUnits(spotAnswer, oracle.price.decimals, {
          significantDigits: 14,
          maxFractionDigits: 2,
          minFractionDigits: 2,
        })
      : undefined;

  const spotWindow = useSpotWindow({
    feed: pair?.feed,
    decimals: oracle.price?.decimals,
    now: oracle.price ? { price: oracle.price.price, at: Number(oracle.price.updatedAt) } : undefined,
    floorBlock: deployments ? BigInt(deployments.blockNumber) : undefined,
    enabled: hydrated,
  });

  const tokens = useMemo(() => (pair ? [pair.risky.address, pair.stable.address] : []), [pair]);
  const balances = useTokenBalances(address, tokens, { chainId: aquaFork.id, includeNative: false });
  /* `useTokenBalances` keys tokens lowercased, and USDC's checksummed address has letters in it. */
  const balanceOf = (token?: string) =>
    token ? balances.balances.find((b) => b.token.toLowerCase() === token.toLowerCase())?.balance : undefined;
  const riskyBalance = balanceOf(pair?.risky.address);
  const stableBalance = balanceOf(pair?.stable.address);

  const book = useBook(address, { enabled: hydrated });

  const wrongNetwork = hydrated && !!address && walletChainId !== deployment.chainId;

  const draft = useTicketDraft({
    pair,
    deployments,
    spot,
    address,
    nowSeconds,
    riskyBalance,
    stableBalance,
    hydrated,
    wrongNetwork,
  });

  /* The leg the chart draws is the leg the button ships: same K, sigma, maturity, L, and the same
     reserve point `stableFor` returned. Absent until the router has answered, which is the chart's
     `empty` state rather than a curve drawn from a guess. */
  const leg = draft.offer
    ? {
        side: draft.offer.side,
        strikeWad: draft.offer.rmm.strikeWad,
        sigmaWad: draft.offer.rmm.sigmaWad,
        maturity: draft.offer.rmm.maturity,
        liquidityWad: draft.offer.rmm.liquidityWad,
        xWad: draft.offer.xWad,
        yWad: draft.offer.yWad,
      }
    : undefined;

  return (
    <div className={classes.shell}>
      <a href="#ticket" className={classes.skip}>
        Skip to the ticket
      </a>

      <TerminalHeader
        base={pair?.risky.symbol ?? 'WETH'}
        quote={pair?.stable.symbol ?? 'USDC'}
        spot={spotLabel}
        window={spotWindow.window}
        blockNumber={book.blockNumber ?? block.data?.number}
      />

      <div className={classes.body}>
        <div className={classes.top}>
          {/* Named for what the region is, not for the three views inside it. The label used to
              list them — "Payoff, curve and decay" — which meant renaming a view silently made the
              accessible name of this landmark wrong, and a landmark whose name is a stale list is
              worse than one with a plain name. */}
          <section className={classes.chartPane} aria-label="The offer, drawn">
            <TerminalChart
              router={deployments?.router}
              leg={leg}
              risky={{
                symbol: pair?.risky.symbol ?? 'WETH',
                decimals: pair?.risky.decimals ?? 18,
                icon: <TokenIcon symbol={pair?.risky.symbol ?? 'WETH'} size={14} />,
              }}
              stable={{
                symbol: pair?.stable.symbol ?? 'USDC',
                decimals: pair?.stable.decimals ?? 6,
                icon: <TokenIcon symbol={pair?.stable.symbol ?? 'USDC'} size={14} />,
              }}
              spot={spot}
              nowSeconds={nowSeconds}
              state={
                draft.offer
                  ? 'ready'
                  : draft.sizing.error
                    ? 'error'
                    : draft.sizing.isLoading || !hydrated
                      ? 'loading'
                      : 'empty'
              }
              errorMessage={draft.sizing.error?.name}
              /* The router will happily price a strike under spot — it is a view, and the arithmetic
                 is real. The offer is not: it would be taken the instant it was published, and the
                 button says so. The chart says the same thing rather than plotting it. */
              refusedMessage={draft.strikeRefusal?.toLowerCase()}
              className={classes.chart}
            />
          </section>

          {/* The `aside` is the grid item itself. It used to sit inside a plain wrapper `div`, which
              is the sort of detail that costs nothing until it costs everything: the wrapper was
              the item the row sized and stretched, the ticket inside it kept its own content height,
              and the three rows a publish adds grew the grid row anyway. */}
          <Ticket
            id="ticket"
            draft={draft}
            pair={pair}
            nowSeconds={nowSeconds}
            address={address}
            wrongNetwork={wrongNetwork}
            hydrated={hydrated}
            onPublished={() => book.refetch()}
            onConnect={() => setConnectOpen(true)}
            onSwitchNetwork={
              deployment.isConfigured
                ? () => switchChain({ chainId: deployment.chainId as SupportedChainId })
                : undefined
            }
          />
        </div>

        <Positions book={book} connected={hydrated && !!address} hydrated={hydrated} />
      </div>

      <TerminalFooter />

      <ConnectModal opened={connectOpen} onClose={() => setConnectOpen(false)} />
    </div>
  );
}
