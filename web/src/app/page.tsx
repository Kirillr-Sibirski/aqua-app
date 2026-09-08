'use client';

/**
 * The app entry. Not a landing page: a maker opens this to see what their inventory is doing, so
 * the first thing on screen is either their book or the one action that produces one.
 *
 * Every figure here is a chain read. Wallet balances come from `useTokenBalances` (a multicall of
 * `balanceOf`/`decimals`/`symbol`), the legs come from Aqua's own `Shipped` logs decoded with the
 * verified encoder, and the depth column is `Aqua.rawBalances` for each leg's two tokens. Nothing
 * is modelled, defaulted or filled in.
 */
import { Layers } from 'lucide-react';
import { useMemo } from 'react';
import type { Address } from 'viem';
import type { SupportedChainId } from '@/lib/chain';
import { useConnection } from 'wagmi';
import { AppShell, PageHeader, useDeploymentChain, useIsHydrated } from '@/components/shell';
import { addressUrl, explorerFor, isForkOfBase } from '@/components/shell/explorer';
import { ConnectButton } from '@/components/wallet';
import {
  Address as AddressText,
  Button,
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
import { tokenInfo, type ShippedStrategy } from '@/lib/contracts';
import { formatUnits } from '@/lib/ui';

export default function OverviewPage() {
  return (
    <AppShell>
      <PageHeader
        title="Overview"
        subtitle="Legs shipped from this wallet, and the inventory backing all of them at once."
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
 * What the wallet holds. This is the number every leg is margined against: `Coverage` reads exactly
 * this balance at quote time, so a fill on one leg shrinks what its siblings can deliver.
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
      <Card title="Inventory">
        <ErrorState
          error={error}
          title="Could not read wallet balances"
          onRetry={() => void refetch()}
          bare
        />
      </Card>
    );
  }

  const loading = isLoading || balances.length === 0;

  return (
    <Card
      title="Inventory"
      description="Read from the wallet, not from a vault. Coverage prices every leg against these balances."
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
          detail="Gas, not collateral"
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
              detail={entry.error ? 'Read failed' : 'Backing every leg'}
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

const COLUMNS = 5;

function Book() {
  const hydrated = useIsHydrated();
  const { address } = useConnection();
  const { chainId } = useDeploymentChain();
  const { strategies, isLoading, error, refetch } = useShippedStrategies(address);

  const explorer = explorerFor(chainId);
  const forkLocal = isForkOfBase(chainId);

  // The server render and the hydration render must agree, and wallet state exists in neither, so
  // the disconnected branch is what both emit until the first client commit.
  if (!hydrated) {
    return (
      <Card title="Book" flush>
        <BookTable>
          <TableSkeletonRows rows={3} columns={COLUMNS} label="book" />
        </BookTable>
      </Card>
    );
  }

  if (!address) {
    return (
      <EmptyState
        icon={Layers}
        title="Connect a wallet to see your book"
        description="Strikeline reads the legs you have shipped straight from Aqua's own logs, then prices each one's deliverable depth against the balance still sitting in your wallet. Nothing is custodied, so there is nothing to read until a wallet is connected."
        action={<ConnectButton size="md" />}
        note="No extension? The picker offers a demo wallet that signs locally against the Base fork."
      />
    );
  }

  if (error) {
    return (
      <Card title="Book">
        <ErrorState
          error={error}
          title="Could not read shipped strategies"
          onRetry={() => void refetch()}
          bare
        />
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card title="Book" flush>
        <BookTable>
          <TableSkeletonRows rows={3} columns={COLUMNS} label="book" />
        </BookTable>
      </Card>
    );
  }

  if (strategies.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No legs shipped from this wallet"
        description="A leg is a SwapVM program shipped to Aqua against tokens that never leave your wallet. Ship a ladder of them and one balance margins the whole book."
        action={
          <Button variant="secondary" onClick={() => void refetch()}>
            Check again
          </Button>
        }
        note="On the local fork, `make smoke` ships the demo ladder and this table fills in."
      />
    );
  }

  return (
    <Card
      title="Book"
      description={`${strategies.length} ${strategies.length === 1 ? 'leg' : 'legs'} shipped to the Strikeline router, read from Aqua's Shipped logs.`}
      flush
    >
      <BookTable>
        {strategies.map((strategy) => (
          <LegRow
            key={`${strategy.strategyHash}-${strategy.logIndex}`}
            strategy={strategy}
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
    <Table caption="Legs shipped from this wallet" hideCaption minWidth="52rem">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Leg</TableHeaderCell>
          <TableHeaderCell>Pair</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell numeric>Recorded in Aqua</TableHeaderCell>
          <TableHeaderCell numeric>Shipped at block</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function LegRow({ strategy, explorerUrl }: { strategy: ShippedStrategy; explorerUrl?: string }) {
  const { deployments } = useDeployments();
  const [tokenA, tokenB] = strategy.tokens;
  const a = tokenInfo(tokenA, deployments);
  const b = tokenInfo(tokenB, deployments);

  return (
    <TableRow>
      <TableCell>
        <AddressText
          value={strategy.strategyHash}
          kind="hash"
          what="strategy hash"
          href={explorerUrl}
        />
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
          <Pill tone="neutral" dot>
            Docked
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
