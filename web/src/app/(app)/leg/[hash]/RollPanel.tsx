'use client';

/**
 * Roll, and dock.
 *
 * A roll is `ship(new)` then `dock(old)`, in that order and never the other way round.
 * `Aqua.safeBalances` reverts `SafeBalancesForTokenNotInActiveStrategy` on a docked strategy, so
 * docking first would brick every quote on the position for the length of one block — a window in
 * which an aggregator sees no liquidity and routes around the book.
 *
 * Neither call moves a token. `ship` writes a virtual balance and emits `Shipped` + `Pushed`;
 * `dock` zeroes it and emits `Docked`. That is the claim the panel makes before signing, and the
 * one it verifies afterwards by counting ERC-20 `Transfer` logs across both receipts.
 *
 * The new leg keeps `K`, `sigma` and `L` and takes the reserves the old one currently holds — which
 * is where its fills left it — so it starts on its own curve at the moneyness the market handed it,
 * rather than at some remembered opening point. The stable side of that reserve comes from
 * `stableFor` at the *new* maturity, because the curve moved when the clock did.
 */
import { useCallback, useMemo, useState } from 'react';
import { RotateCw, Ship, Trash2 } from 'lucide-react';
import { keccak256, type Address, type Hex } from 'viem';
import { useConnection, useReadContract, useWriteContract } from 'wagmi';
import {
  Button,
  Callout,
  Card,
  CardRow,
  ErrorState,
  Pill,
  SegmentedControl,
  Skeleton,
  TokenAmount,
} from '@/components/ui';
import {
  ASSIGNMENT_WINDOW_SECONDS,
  ProgramInspector,
  buildLegProgram,
  strikelineReadAbi,
  toRawReserve,
  type RmmArgs,
} from '@/components/curve';
import { TxStepper, countTransferLogs } from '@/components/write/TxStepper';
import { EXPIRY_PRESETS, formatExpiry, maturityAt } from '@/components/write/expiry';
import { aquaFork } from '@/lib/chain';
import { aquaAbi } from '@/lib/contracts';
import { buildAquaOrder, encodeStrategyForShip } from '@/lib/swapvm';
import { useTxFlow, type TxPlanStep } from '@/hooks';

export interface RollPanelProps {
  aqua: Address;
  router: Address;
  maker: Address;
  strategyHash: Hex;
  tokens: readonly [Address, Address];
  rmm: RmmArgs;
  /** Live virtual reserves, raw units, in `(tokenA, tokenB)` order. */
  reserves: readonly [bigint, bigint];
  /** Which of the two tokens is the risky one. */
  riskyIsTokenA: boolean;
  riskySymbol: string;
  riskyDecimals: number;
  stableSymbol: string;
  stableDecimals: number;
  /** The chain's clock. */
  chainNow?: number;
  chainId?: number;
  /** False when the connected wallet is not this leg's maker. */
  canAct: boolean;
  onDone?: () => void;
}

export function RollPanel({
  aqua,
  router,
  maker,
  strategyHash,
  tokens,
  rmm,
  reserves,
  riskyIsTokenA,
  riskySymbol,
  riskyDecimals,
  stableSymbol,
  stableDecimals,
  chainNow,
  chainId,
  canAct,
  onDone,
}: RollPanelProps) {
  const { address } = useConnection();
  const { mutateAsync: writeContract } = useWriteContract();
  const { run, steps, isRunning, error, reset } = useTxFlow(aquaFork.id);
  const [tenor, setTenor] = useState(7);
  const [done, setDone] = useState<'rolled' | 'docked'>();
  /**
   * Bumped after every roll so a second roll in the same block still gets a fresh strategy hash.
   * The base is the chain's clock rather than the browser's: it is monotonic, it is a value this
   * component already reads, and reading `Date.now()` during render is an impurity React rightly
   * refuses.
   */
  const [saltNonce, setSaltNonce] = useState(0);

  const newMaturity = chainNow === undefined ? undefined : maturityAt(chainNow, tenor);

  // The reserves the old leg holds now, normalised. The risky side carries straight over; the
  // stable side has to be re-read, because the curve is a different curve at the new maturity.
  const riskyRaw = riskyIsTokenA ? reserves[0] : reserves[1];
  const xWad = riskyRaw * rmm.rateRisky;

  const stableFor = useReadContract({
    address: router,
    abi: strikelineReadAbi,
    functionName: 'stableFor',
    args: [rmm.strikeWad, rmm.sigmaWad, newMaturity ?? 0, rmm.liquidityWad, xWad],
    chainId: aquaFork.id,
    query: { enabled: newMaturity !== undefined && rmm.liquidityWad > BigInt(0), retry: false },
  });

  const next = useMemo(() => {
    if (newMaturity === undefined || stableFor.data === undefined) return undefined;
    const { raw: stableRaw } = toRawReserve(stableFor.data, rmm.rateStable);

    const rolled: RmmArgs = { ...rmm, maturity: newMaturity };
    const program = buildLegProgram({
      rmm: rolled,
      deadline: newMaturity + ASSIGNMENT_WINDOW_SECONDS,
      // A docked strategy hash is dead forever, so a roll to identical economics needs a fresh
      // salt or the new ship reverts StrategiesMustBeImmutable against the corpse of the old one.
      salt: BigInt(chainNow ?? 0) * BigInt(1000) + BigInt(saltNonce),
    });
    const order = buildAquaOrder({
      maker,
      tokenA: tokens[0],
      tokenB: tokens[1],
      program,
    });
    const amounts: readonly [bigint, bigint] = riskyIsTokenA
      ? [riskyRaw, stableRaw]
      : [stableRaw, riskyRaw];

    return {
      maturity: newMaturity,
      program,
      order,
      amounts,
      riskyRaw,
      stableRaw,
      strategyHash: keccak256(encodeStrategyForShip(order)),
    };
  }, [newMaturity, stableFor.data, rmm, maker, tokens, riskyIsTokenA, riskyRaw, chainNow, saltNonce]);

  const roll = useCallback(async () => {
    if (!next) return;
    reset();
    setDone(undefined);
    const plan: TxPlanStep[] = [
      {
        label: `Ship the rolled leg · ${formatExpiry(next.maturity)}`,
        send: () =>
          writeContract({
            address: aqua,
            abi: aquaAbi,
            functionName: 'ship',
            args: [router, encodeStrategyForShip(next.order), [...tokens], [...next.amounts]],
            chainId: aquaFork.id,
          }),
      },
      {
        label: 'Dock the old leg',
        send: () =>
          writeContract({
            address: aqua,
            abi: aquaAbi,
            functionName: 'dock',
            args: [router, strategyHash, [...tokens]],
            chainId: aquaFork.id,
          }),
      },
    ];
    try {
      await run(plan);
      setSaltNonce((n) => n + 1);
      setDone('rolled');
      onDone?.();
    } catch {
      // The stepper already carries which step failed and its decoded reason.
    }
  }, [next, reset, writeContract, aqua, router, tokens, strategyHash, run, onDone]);

  const dock = useCallback(async () => {
    reset();
    setDone(undefined);
    try {
      await run([
        {
          label: 'Dock this leg',
          send: () =>
            writeContract({
              address: aqua,
              abi: aquaAbi,
              functionName: 'dock',
              args: [router, strategyHash, [...tokens]],
              chainId: aquaFork.id,
            }),
        },
      ]);
      setDone('docked');
      onDone?.();
    } catch {
      // Same: the stepper has it.
    }
  }, [reset, run, writeContract, aqua, router, strategyHash, tokens, onDone]);

  const transferLogs = countTransferLogs(steps);
  const notMaker =
    !canAct || !address || address.toLowerCase() !== maker.toLowerCase()
      ? 'Only the maker of this leg can roll or dock it.'
      : undefined;

  return (
    <Card
      title="Roll or retire"
      description="Both are pure accounting in Aqua. Ship writes a virtual balance, dock zeroes it, and neither performs a transfer."
      footer={
        transferLogs === undefined ? (
          <span className="font-mono tnum">0 tokens will move</span>
        ) : (
          <span className="flex items-center gap-2">
            <Pill tone={transferLogs === 0 ? 'positive' : 'warning'} size="sm">
              {transferLogs} ERC-20 Transfer logs
            </Pill>
            <span>across both receipts</span>
          </span>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          label="New tenor"
          size="sm"
          items={EXPIRY_PRESETS.map((p) => ({ value: String(p.days), label: p.label }))}
          value={String(tenor)}
          onValueChange={(v) => setTenor(Number(v))}
        />

        <dl className="flex flex-col">
          <CardRow label="New expiry">
            <span className="font-mono tnum">
              {next ? formatExpiry(next.maturity) : <Skeleton className="h-3.5 w-40" />}
            </span>
          </CardRow>
          <CardRow label={`${riskySymbol} carried over`}>
            <TokenAmount value={riskyRaw} decimals={riskyDecimals} size="sm" />
          </CardRow>
          <CardRow label={`${stableSymbol} on the new curve`}>
            {next ? (
              <TokenAmount value={next.stableRaw} decimals={stableDecimals} size="sm" />
            ) : (
              <Skeleton className="ml-auto h-3.5 w-24" />
            )}
          </CardRow>
        </dl>

        <p className="text-mini leading-prose text-ink-3">
          The rolled leg keeps K, sigma and L and inherits the reserves this one holds right now, so it
          opens at the moneyness the fills left rather than at a remembered starting point. Its stable
          side is <span className="font-mono">stableFor</span> at the new maturity, read from the router.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            icon={RotateCw}
            loading={isRunning && done === undefined}
            loadingLabel="Rolling"
            disabled={!next || Boolean(notMaker)}
            disabledReason={notMaker ?? 'Waiting for the router to price the new curve.'}
            onClick={() => void roll()}
          >
            Roll
          </Button>
          <Button
            variant="danger"
            icon={Trash2}
            disabled={Boolean(notMaker)}
            disabledReason={notMaker}
            onClick={() => void dock()}
          >
            Dock
          </Button>
        </div>

        <TxStepper
          steps={steps}
          chainId={chainId}
          plan={['Ship the rolled leg', 'Dock the old leg']}
        />

        {error ? <ErrorState error={error} title="The roll did not complete" bare /> : null}

        {done === 'rolled' && next ? (
          <Callout tone="positive" title="Rolled" icon={Ship}>
            The old hash is dead for good — Aqua writes <span className="font-mono">0xff</span> on dock
            and never lets it be shipped again — and the new leg is already quoting.
          </Callout>
        ) : null}

        {done === 'docked' ? (
          <Callout tone="info" title="Docked">
            The virtual balances are zero and the strategy can no longer be filled. The wallet is
            untouched; there was never anything in Aqua to withdraw.
          </Callout>
        ) : null}

        {next ? (
          <details className="rounded-card border border-line">
            <summary className="cursor-pointer list-none px-4 py-3 text-meta text-ink-2 transition-state hover:text-ink">
              The program the roll would ship
            </summary>
            <div className="px-4 pb-4">
              <ProgramInspector
                bare
                program={next.program}
                strategyHash={next.strategyHash}
                title="Rolled leg"
                description="Same K, sigma and L; a new maturity, a new deadline, and a fresh salt so the hash does not collide with the leg it replaces."
              />
            </div>
          </details>
        ) : null}
      </div>
    </Card>
  );
}
