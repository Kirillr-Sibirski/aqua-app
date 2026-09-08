'use client';

/**
 * The app entry.
 *
 * It opens with the promise, the risk and the one action, in that order, because a blind
 * comprehension study found the app read worse than the README for exactly the reason DESIGN.md's
 * no-hero rule intended to prevent: a terminal that never says what it is for. Three lines of
 * purpose under a page title is a label, not a hero — no gradient, no glass, no 72px yield number,
 * no payoff cartoon. Everything below it is still the maker's own inventory and offers.
 *
 * Every figure here is a chain read. Wallet balances come from `useTokenBalances` (a multicall of
 * `balanceOf`/`decimals`/`symbol`), the offers come from Aqua's own `Shipped` logs decoded with the
 * verified encoder, and the depth column is `Aqua.rawBalances` for each leg's two tokens. Nothing
 * is modelled, defaulted or filled in.
 */
import { Layers } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import type { Address } from 'viem';
import type { SupportedChainId } from '@/lib/chain';
import { useBlock, useConnection } from 'wagmi';
import { AppShell, PageHeader, useDeploymentChain, useIsHydrated } from '@/components/shell';
import { addressUrl, explorerFor, isForkOfBase } from '@/components/shell/explorer';
import { ConnectButton } from '@/components/wallet';
import {
  Address as AddressText,
  Button,
  buttonVariants,
  Card,
  EmptyState,
  ErrorState,
  Pill,
  Skeleton,
  StatRow,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableSkeletonRows,
  TokenAmount,
} from '@/components/ui';
import { useDeployments, useShippedStrategies, useTokenBalances } from '@/hooks';
import { decodeLegProgram, formatCountdown, sigmaRatio } from '@/hooks/strikeline';
import { tokenInfo, type ShippedStrategy } from '@/lib/contracts';
import { formatPercent, formatUnits, truncateHash } from '@/lib/ui';

export default function OverviewPage() {
  return (
    <AppShell>
      <PageHeader
        title="Name the price you'd sell at. Get paid to wait."
        subtitle={
          <>
            <span className="block">
              Covered calls written from the ETH in your own wallet. You pick the price and the
              date; every day nobody takes it, the next buyer pays more. Nothing is custodied — the
              tokens never move until someone fills.
            </span>
            <span className="mt-2 block">
              If ETH runs past your price, you sell at your price and keep what you were paid. That
              is the trade. If it moves more than the volatility you chose, you lose.
            </span>
            <span className="mt-2 block text-ink-3">
              You are not paid up front. What you earn accrues inside your own quote and only
              becomes real when somebody trades against it.
            </span>
          </>
        }
        actions={
          <Link href="/write" className={buttonVariants({ variant: 'primary', size: 'md' })}>
            Name your price
          </Link>
        }
      />
      <div className="mt-8 flex flex-col gap-8">
        <Inventory />
        <Book />
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/**
 * What the wallet holds. This is the number every offer is margined against: `Coverage` reads
 * exactly this balance at quote time, so a fill on one offer shrinks what the others can deliver.
 */
function Inventory() {
  const hydrated = useIsHydrated();
  const { address } = useConnection();
  const { deployments } = useDeployments();
  const { chainId, isConfigured } = useDeploymentChain();

  const tokens = useMemo<Address[]>(
    () => (deployments ? [deployments.weth, deployments.usdc, deployments.cbBtc] : []),
    [deployments],
  );

  const { balances, native, isLoading, error, refetch } = useTokenBalances(address, tokens, {
    chainId: isConfigured ? (chainId as SupportedChainId) : undefined,
  });

  if (!hydrated || !address) return null;

  if (error) {
    return (
      <Card title="What you hold">
        <ErrorState
          error={error}
          title="Could not read your wallet balances"
          onRetry={() => void refetch()}
          bare
        />
      </Card>
    );
  }

  const loading = isLoading || balances.length === 0;

  return (
    <Card
      title="What you hold"
      description="This is what you would be selling, and it stays where it is. Every offer you make is priced against these balances, and no token moves until somebody takes one."
    >
      <StatRow>
        <StatTile
          label="ETH"
          loading={loading && !native}
          value={
            native ? (
              <TokenAmount value={native.value} decimals={native.decimals} size="lg" />
            ) : undefined
          }
          unit={native?.symbol}
          detail="For gas. Not part of any offer."
        />
        {(loading ? [0, 1, 2] : balances).map((entry, i) =>
          typeof entry === 'number' ? (
            <StatTile key={i} label="—" loading />
          ) : (
            <StatTile
              key={entry.token}
              label={entry.symbol}
              value={<TokenAmount value={entry.balance} decimals={entry.decimals} size="lg" />}
              unit={entry.symbol}
              detail={entry.error ? 'Read failed' : 'Stands behind every offer'}
            />
          ),
        )}
      </StatRow>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------

const COLUMNS = 6;

function Book() {
  const hydrated = useIsHydrated();
  const { address } = useConnection();
  const { chainId } = useDeploymentChain();
  const { strategies, isLoading, error, refetch } = useShippedStrategies(address);
  // The chain's clock, never the browser's: the fork is warped, and an expiry counted against
  // `Date.now()` would be wrong by days on the demo.
  const { data: block } = useBlock({ chainId: chainId as SupportedChainId, watch: true, query: { enabled: hydrated } });
  const nowSeconds = block ? Number(block.timestamp) : undefined;

  const explorer = explorerFor(chainId);
  const forkLocal = isForkOfBase(chainId);

  // The server render and the hydration render must agree, and wallet state exists in neither, so
  // the disconnected branch is what both emit until the first client commit.
  if (!hydrated) {
    return (
      <Card title="Your offers" flush>
        <BookTable>
          <TableSkeletonRows rows={3} columns={COLUMNS} label="your offers" />
        </BookTable>
      </Card>
    );
  }

  if (!address) {
    return (
      <EmptyState
        icon={Layers}
        title="Connect a wallet to see your offers"
        description="An offer to sell your ETH at a price you choose. Your tokens stay in your wallet until someone takes it, so there is nothing to show until a wallet is connected."
        action={<ConnectButton size="md" />}
        // The one screen that shows something without a wallet, because it reads a public log
        // rather than an account. A visitor with nothing connected should not be at a dead end.
        secondaryAction={
          <Link href="/surface" className={buttonVariants({ variant: 'secondary', size: 'md' })}>
            See what everyone else is offering
          </Link>
        }
        note="No extension? The picker offers a demo wallet that signs locally against the Base fork."
      />
    );
  }

  if (error) {
    return (
      <Card title="Your offers">
        <ErrorState
          error={error}
          title="Could not read your offers"
          onRetry={() => void refetch()}
          bare
        />
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card title="Your offers" flush>
        <BookTable>
          <TableSkeletonRows rows={3} columns={COLUMNS} label="your offers" />
        </BookTable>
      </Card>
    );
  }

  if (strategies.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="You have not made an offer yet"
        description="An offer to sell your ETH at a price you choose. Your tokens stay in your wallet until someone takes it, and one balance can stand behind several offers at once."
        action={
          <Button variant="secondary" onClick={() => void refetch()}>
            Check again
          </Button>
        }
        note="On the local fork, `make smoke` publishes the demo offers and this table fills in."
      />
    );
  }

  return (
    <Card
      title="Your offers"
      description={`${strategies.length} ${strategies.length === 1 ? 'offer' : 'offers'} published from this wallet. The price and the date are read back out of the bytes the chain itself published, not out of a database beside the app.`}
      flush
    >
      <BookTable>
        {strategies.map((strategy) => (
          <LegRow
            key={`${strategy.strategyHash}-${strategy.logIndex}`}
            strategy={strategy}
            nowSeconds={nowSeconds}
            explorerUrl={
              explorer && !forkLocal ? addressUrl(explorer, strategy.app) : undefined
            }
          />
        ))}
      </BookTable>
    </Card>
  );
}

function BookTable({ children }: { children: React.ReactNode }) {
  return (
    <Table
      caption="Offers published from this wallet"
      hideCaption
      minWidth="56rem"
      scrollHint="size on offer, block"
    >
      <TableHead>
        <TableRow>
          <TableHeaderCell>Offer</TableHeaderCell>
          <TableHeaderCell title="Strike, implied volatility, time to expiry and notional L">
            You sell at
          </TableHeaderCell>
          <TableHeaderCell>Pair</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell numeric title="The strategy's virtual balances in Aqua">
            Size on offer
          </TableHeaderCell>
          <TableHeaderCell numeric>Published at block</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function LegRow({
  strategy,
  explorerUrl,
  nowSeconds,
}: {
  strategy: ShippedStrategy;
  explorerUrl?: string;
  nowSeconds?: number;
}) {
  const { deployments } = useDeployments();
  const [tokenA, tokenB] = strategy.tokens;
  const a = tokenInfo(tokenA, deployments);
  const b = tokenInfo(tokenB, deployments);
  // The price and the date are in the bytes Aqua published; a table that shows only the hash is
  // asking the reader to take the most interesting thing on the row on trust.
  const rmm = decodeLegProgram(strategy.program).rmm;
  const risky = rmm ? (rmm.flags & 1 ? a : b) : undefined;
  const stable = rmm ? (rmm.flags & 1 ? b : a) : undefined;

  return (
    <TableRow>
      <TableCell>
        {rmm ? (
          <Link
            href={`/leg/${strategy.strategyHash}`}
            className="rounded-control font-mono text-meta text-ink transition-state hover:text-accent hover:underline hover:underline-offset-2"
          >
            {truncateHash(strategy.strategyHash)}
          </Link>
        ) : (
          <AddressText
            value={strategy.strategyHash}
            kind="hash"
            what="strategy hash"
            href={explorerUrl}
          />
        )}
      </TableCell>

      <TableCell>
        {rmm ? (
          <span className="flex flex-col gap-0.5 leading-num">
            <span className="font-mono text-meta tnum text-ink">
              {formatUnits(rmm.strikeWad, 18, { significantDigits: 18, maxFractionDigits: 2 })}{' '}
              <span className="text-ink-2">{rmm.flags & 4 ? 'call' : 'put'}</span>
              {stable ? <span className="ml-1 text-ink-3">{stable.symbol}</span> : null}
            </span>
            <span className="font-mono text-mini tnum text-ink-3">
              {formatPercent(sigmaRatio(rmm.sigmaWad), { fractionDigits: 1 })} IV
              {nowSeconds !== undefined ? (
                <>
                  <span className="mx-1.5">·</span>
                  {rmm.maturity - nowSeconds > 0 ? formatCountdown(rmm.maturity - nowSeconds) : 'expired'}
                </>
              ) : null}
              {risky ? (
                <>
                  <span className="mx-1.5">·</span>
                  L {formatUnits(rmm.liquidityWad, 18, { significantDigits: 6 })} {risky.symbol}
                </>
              ) : null}
            </span>
          </span>
        ) : (
          <span className="text-mini text-ink-3">not a Strikeline offer</span>
        )}
      </TableCell>

      <TableCell>
        <span className="font-mono text-meta text-ink">
          {a.symbol}
          <span className="text-ink-3"> / </span>
          {b.symbol}
        </span>
      </TableCell>

      <TableCell>
        {strategy.docked ? (
          <Pill tone="neutral" dot title="Docked in Aqua">
            Withdrawn
          </Pill>
        ) : strategy.active ? (
          <Pill tone="positive" dot>
            Active
          </Pill>
        ) : (
          <Pill tone="warning" dot>
            Partial
          </Pill>
        )}
      </TableCell>

      <TableCell numeric>
        <div className="flex flex-col items-end gap-0.5">
          {strategy.balances.length === 0 ? (
            <Skeleton className="h-3.5 w-24" />
          ) : (
            strategy.balances.map((balance) => {
              const meta = tokenInfo(balance.token, deployments);
              return (
                <TokenAmount
                  key={balance.token}
                  value={balance.balance}
                  decimals={meta.decimals}
                  symbol={meta.symbol}
                  size="sm"
                />
              );
            })
          )}
        </div>
      </TableCell>

      <TableCell numeric>{formatUnits(strategy.blockNumber, 0)}</TableCell>
    </TableRow>
  );
}
