'use client';

/**
 * Write a book.
 *
 * Four sections in order — terms, ladder, review, ship — laid out on one page rather than behind a
 * stepper, because this is a terminal and a maker deciding on a strike wants the payoff and the
 * backing visible while they decide, not two clicks away. The sticky rail carries the only
 * irreversible action.
 *
 * The whole screen is a chain read except for the payoff chart, which is labelled "model". Spot
 * comes from the Chainlink feed the deployment names, the clock from the block, realised vol from
 * the feed's own round history, every leg's stable reserve from `router.stableFor`, and the
 * deliverable depth from `router.coverage`. Nothing is defaulted to a plausible number.
 */
import { Layers } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { parseUnits, type Address } from 'viem';
import { useBlock, useConnection } from 'wagmi';
import { useDeploymentChain, useIsHydrated } from '@/components/shell';
import { ConnectButton } from '@/components/wallet';
import {
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '@/components/ui';
import { ProgramInspector, rateFor, tauWad, useCoverage } from '@/components/curve';
import { useDeployments, useOraclePrice, useTokenBalances } from '@/hooks';
import { aquaFork } from '@/lib/chain';
import { addressLt } from '@/lib/swapvm';
import { formatUnits, toDecimalString } from '@/lib/ui';
import { MarginPreview, type MarginRow } from './MarginPreview';
import { PayoffChart } from './PayoffChart';
import { ShipPanel } from './ShipPanel';
import { StrikePicker } from './StrikePicker';
import { Terms, ivRatio } from './Terms';
import { maturityAt } from './expiry';
import { strikeFrom } from './moneyness';
import type { PayoffLeg } from './payoff';
import type { LegDraft, WritePair } from './types';
import { useLegSizing } from './useLegSizing';
import { useRealisedVol } from './useRealisedVol';
import { useShipBook } from './useShipBook';

const DEFAULT_EXPIRY_DAYS = 7;
/** Nothing is defaulted from thin air, but the field has to start somewhere; realised overwrites it. */
const DEFAULT_IV = '60';

export function WriteWizard() {
  const hydrated = useIsHydrated();
  const { address } = useConnection();
  const { deployments, isLoading: deploymentsLoading, error: deploymentsError } = useDeployments();
  const { chainId } = useDeploymentChain();

  const pairs = useMemo(() => (deployments ? buildPairs(deployments) : []), [deployments]);
  const [pairKey, setPairKey] = useState<string>('');
  const active = pairs.find((p) => p.key === pairKey) ?? pairs[0];
  const pair = active?.pair;

  const [expiryDays, setExpiryDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [iv, setIv] = useState(DEFAULT_IV);
  const [legs, setLegs] = useState<LegDraft[]>([]);
  const [shipped, setShipped] = useState<`0x${string}`[]>();

  // The chain's clock, not the browser's: a warped fork is genuinely closer to expiry.
  const block = useBlock({ chainId: aquaFork.id, watch: true, query: { staleTime: 4_000 } });
  const chainNow = block.data ? Number(block.data.timestamp) : undefined;
  const maturity = chainNow === undefined ? undefined : maturityAt(chainNow, expiryDays);
  const tau = maturity !== undefined && chainNow !== undefined
    ? Number(tauWad(maturity, chainNow)) / 1e18
    : undefined;

  const oracle = useOraclePrice(pair?.feed, { chainId: aquaFork.id });
  const spot = oracle.price?.price;

  const realised = useRealisedVol(pair?.feed, { chainId: aquaFork.id });
  const sigma = ivRatio(iv);
  const sigmaWad = sigma === undefined ? undefined : BigInt(Math.round(sigma * 1e18));

  const tokens = useMemo<Address[]>(
    () => (pair ? [pair.risky.address, pair.stable.address] : []),
    [pair],
  );
  const balances = useTokenBalances(address, tokens, { chainId: aquaFork.id, includeNative: false });
  const riskyBalance = balances.balances.find((b) => b.token === pair?.risky.address)?.balance;
  const stableBalance = balances.balances.find((b) => b.token === pair?.stable.address)?.balance;

  const coverage = useCoverage(deployments?.router, address, tokens, { chainId: aquaFork.id });

  const sizing = useLegSizing({
    router: deployments?.router,
    maker: address,
    pair,
    legs,
    sigmaWad,
    maturity,
    spot,
    tau,
  });

  const sizedById = useMemo(
    () => new Map(sizing.sized.map((leg) => [leg.draft.id, leg])),
    [sizing.sized],
  );

  const book = useShipBook();

  // --- editing -------------------------------------------------------------

  const toggleOffset = useCallback(
    (offset: number) => {
      if (spot === undefined || !pair) return;
      setLegs((current) => {
        if (current.some((leg) => leg.offset === offset)) {
          return current.filter((leg) => leg.offset !== offset);
        }
        const strike = strikeFrom(spot, offset);
        const kind = offset >= 0 ? ('call' as const) : ('put' as const);
        // A default that is a real balance rather than a round number. Calls draw on the risky
        // side; the put is stable-collateralised, so it starts at half the size and the maker
        // sizes it against what the stable balance can actually deliver.
        const base = riskyBalance ?? BigInt(0);
        const notionalRaw = kind === 'call' ? base : base / BigInt(2);
        return [
          ...current,
          {
            id: `${offset}-${current.length}-${Date.now()}`,
            offset,
            strike,
            strikeWad: BigInt(Math.round(strike * 1e6)) * BigInt(1e12),
            kind,
            notional: toDecimalString(notionalRaw, pair.risky.decimals),
            liquidityWad: notionalRaw * rateFor(pair.risky.decimals),
            salt: nextSalt(current.length),
          },
        ].sort((a, b) => a.strike - b.strike);
      });
    },
    [spot, pair, riskyBalance],
  );

  const changeNotional = useCallback(
    (id: string, next: string) => {
      if (!pair) return;
      setLegs((current) =>
        current.map((leg) =>
          leg.id === id
            ? {
                ...leg,
                notional: next,
                liquidityWad: safeParse(next, pair.risky.decimals) * rateFor(pair.risky.decimals),
              }
            : leg,
        ),
      );
    },
    [pair],
  );

  const removeLeg = useCallback((id: string) => {
    setLegs((current) => current.filter((leg) => leg.id !== id));
  }, []);

  // --- shipping ------------------------------------------------------------

  const onShip = useCallback(async () => {
    if (!deployments || !pair || sizing.sized.length === 0) return;
    setShipped(undefined);
    try {
      const result = await book.ship({
        aqua: deployments.aqua,
        router: deployments.router,
        pair,
        legs: sizing.sized,
        riskyNeeded: sizing.riskyNeeded,
        stableNeeded: sizing.stableNeeded,
      });
      setShipped(result.strategyHashes);
    } catch {
      // `useTxFlow` already recorded which step failed and why; the panel renders it.
    }
  }, [deployments, pair, sizing.sized, sizing.riskyNeeded, sizing.stableNeeded, book]);

  // --- render --------------------------------------------------------------

  if (!hydrated || deploymentsLoading) return <WizardSkeleton />;

  if (deploymentsError || !deployments || !pair || !active) {
    return (
      <ErrorState
        error={deploymentsError ?? new Error('No deployment manifest, so there is no router to write against.')}
        title="Could not load the deployment"
      />
    );
  }

  if (!address) {
    return (
      <EmptyState
        icon={Layers}
        title="Connect a wallet to write a book"
        description="A leg is written from the wallet that will back it, so the writer needs to know whose balance every quote will be margined against. Nothing is custodied and nothing moves until a fill."
        action={<ConnectButton size="md" />}
        note="No extension? The picker offers a demo wallet that signs locally against the Base fork."
      />
    );
  }

  const payoffLegs: PayoffLeg[] = sizing.sized.map((leg) => ({
    liquidity: Number(formatUnits(leg.rmm.liquidityWad, 18)),
    strike: leg.draft.strike,
    sigma: sigma ?? 0,
    tau: tau ?? 0,
    riskyReserve: Number(formatUnits(leg.xWad, 18)),
    stableReserve: Number(formatUnits(leg.yWad, 18)),
    kind: leg.draft.kind,
  }));

  const marginRows: MarginRow[] = [
    {
      symbol: pair.risky.symbol,
      decimals: pair.risky.decimals,
      wallet: riskyBalance ?? BigInt(0),
      deliverable: coverage.free[pair.risky.address.toLowerCase()],
      claims: sizing.sized
        .filter((leg) => leg.riskyRaw > BigInt(0))
        .map((leg) => ({ id: leg.draft.id, label: `K ${leg.draft.strike}`, amount: leg.riskyRaw })),
    },
    {
      symbol: pair.stable.symbol,
      decimals: pair.stable.decimals,
      wallet: stableBalance ?? BigInt(0),
      deliverable: coverage.free[pair.stable.address.toLowerCase()],
      claims: sizing.sized
        .filter((leg) => leg.stableRaw > BigInt(0))
        .map((leg) => ({ id: leg.draft.id, label: `K ${leg.draft.strike}`, amount: leg.stableRaw })),
    },
  ];

  const shipDisabledReason =
    sizing.sized.length === 0
      ? 'The router has not returned a reserve for these legs yet.'
      : sigma === undefined
        ? 'Set an implied volatility above zero.'
        : undefined;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-8">
        <Section index={1} title="Terms" description="Shared by every leg in the book.">
          <Terms
            pairs={pairs}
            pairKey={active.key}
            onPairChange={setPairKey}
            expiryDays={expiryDays}
            onExpiryChange={setExpiryDays}
            maturity={maturity}
            iv={iv}
            onIvChange={setIv}
            realised={realised.vol}
            realisedUnavailable={realised.unavailable}
            realisedLoading={realised.isLoading}
            spot={spot}
            spotSymbol={pair.stable.symbol}
          />
        </Section>

        <Section
          index={2}
          title="Ladder"
          description="Strikes by moneyness, sized in the risky asset. One balance backs all of them."
        >
          <StrikePicker
            pair={pair}
            spot={spot}
            legs={legs}
            sizedById={sizedById}
            sizingLoading={sizing.isLoading || sizing.isFetching}
            onToggleOffset={toggleOffset}
            onNotionalChange={changeNotional}
            onRemove={removeLeg}
            riskyBalance={riskyBalance}
          />
          {sizing.error ? (
            <ErrorState
              error={sizing.error}
              title="The router could not size these legs"
              onRetry={sizing.refetch}
              bare
            />
          ) : null}
        </Section>

        <Section index={3} title="Review" description="What the book is worth, and what backs it.">
          <div className="flex flex-col gap-6">
            <PayoffChart
              legs={payoffLegs}
              spot={spot ?? 0}
              riskySymbol={pair.risky.symbol}
              stableSymbol={pair.stable.symbol}
              state={oracle.error ? 'error' : 'ready'}
              errorMessage={oracle.error ? 'The price feed could not be read.' : undefined}
            />

            <MarginPreview rows={marginRows} loading={balances.isLoading} />

            {sizing.sized.length > 0 ? (
              <Card
                title="Program"
                description="The bytes Aqua will store. Aqua takes the strategy whole rather than pre-hashed, for data availability, so these terms are public and any resolver can quote the leg without an off-chain book."
                bodyClassName="pt-0"
              >
                <Tabs defaultValue={sizing.sized[0].draft.id}>
                  <TabList label="Legs in this book">
                    {sizing.sized.map((leg) => (
                      <Tab key={leg.draft.id} value={leg.draft.id}>
                        K {leg.draft.strike}
                      </Tab>
                    ))}
                  </TabList>
                  {sizing.sized.map((leg) => (
                    <TabPanel key={leg.draft.id} value={leg.draft.id}>
                      <ProgramInspector
                        program={leg.program}
                        strategyHash={leg.strategyHash}
                        title={`Leg · K ${leg.draft.strike}`}
                        description="Deadline, then Coverage wrapping the curve, then RmmSwap, then the salt that makes the hash unique."
                        className="mt-4"
                      />
                    </TabPanel>
                  ))}
                </Tabs>
              </Card>
            ) : null}
          </div>
        </Section>
      </div>

      <div className="lg:sticky lg:top-20">
        <Section index={4} title="Ship" description="Two approvals, then one transaction per leg.">
          <ShipPanel
            pair={pair}
            legs={sizing.sized}
            riskyNeeded={sizing.riskyNeeded}
            stableNeeded={sizing.stableNeeded}
            maturity={maturity}
            sigma={sigma}
            steps={book.steps}
            isRunning={book.isRunning}
            error={book.error}
            shipped={shipped}
            chainId={chainId}
            onShip={() => void onShip()}
            disabledReason={shipDisabledReason}
          />
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Section({
  index,
  title,
  description,
  children,
}: {
  index: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 place-items-center rounded-pill border border-line font-mono text-mini tnum text-ink-3"
        >
          {index}
        </span>
        <div className="min-w-0">
          <h2 className="text-lead font-medium text-ink">{title}</h2>
          <p className="mt-0.5 max-w-prose text-mini leading-prose text-ink-3">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function WizardSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:items-start">
      <div className="flex flex-col gap-8">
        <Skeleton className="h-48 w-full" radius="card" label="the writer" />
        <Skeleton className="h-64 w-full" radius="card" />
        <Skeleton className="h-80 w-full" radius="card" />
      </div>
      <Skeleton className="h-96 w-full" radius="card" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PairOption {
  key: string;
  label: string;
  pair: WritePair;
}

/**
 * The pairs this deployment can write against: whatever it names a price feed for.
 *
 * The feed is not in the pricing path — the curve reads no oracle at all, which is the direct answer
 * to every oracle-manipulated options venue — but it is what tells the writer where spot is, so a
 * pair with no feed has no way to choose a moneyness and is not offered.
 */
function buildPairs(d: {
  weth: Address;
  usdc: Address;
  cbBtc: Address;
  chainlink: { ethUsd: Address; cbBtcUsd?: Address; btcUsd?: Address };
}): PairOption[] {
  const stable = { address: d.usdc, symbol: 'USDC', decimals: 6 };
  const out: PairOption[] = [
    {
      key: 'weth-usdc',
      label: 'WETH / USDC',
      pair: {
        risky: { address: d.weth, symbol: 'WETH', decimals: 18 },
        stable,
        feed: d.chainlink.ethUsd,
        riskyIsTokenA: addressLt(d.weth, d.usdc),
      },
    },
  ];

  const btcFeed = d.chainlink.cbBtcUsd ?? d.chainlink.btcUsd;
  if (btcFeed) {
    out.push({
      key: 'cbbtc-usdc',
      label: 'cbBTC / USDC',
      pair: {
        risky: { address: d.cbBtc, symbol: 'cbBTC', decimals: 8 },
        stable,
        feed: btcFeed,
        riskyIsTokenA: addressLt(d.cbBtc, d.usdc),
      },
    });
  }

  return out;
}

/** Never throws on a half-typed amount; an empty field is zero, not `NaN`. */
function safeParse(value: string, decimals: number): bigint {
  try {
    return value === '' ? BigInt(0) : parseUnits(value, decimals);
  } catch {
    return BigInt(0);
  }
}

/**
 * A strictly monotonic salt.
 *
 * `Aqua.ship` requires `tokensCount == 0` and `dock` writes `0xff` forever, so a strategy hash is
 * single-use. Seconds since the epoch times a thousand, plus the leg's index, is monotonic within a
 * session and across sessions, and fits `uint64` until the year 586,000.
 */
function nextSalt(index: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000)) * BigInt(1000) + BigInt(index);
}
