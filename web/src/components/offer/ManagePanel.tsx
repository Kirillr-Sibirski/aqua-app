'use client';

/**
 * Move it later, or take it down. Neither moves a token.
 *
 * That is the surprising claim on this screen and it is made twice: once before you sign, as a
 * prediction, and once after, as a measurement. `Aqua.ship` writes a virtual balance and emits
 * `Shipped` + `Pushed`; `Aqua.dock` zeroes it and emits `Docked`. Neither performs a transfer and
 * neither checks a balance, so both receipts should contain exactly zero ERC-20 `Transfer` logs —
 * and after the transactions land this panel counts them and prints the count. A roll that moved
 * tokens would say so here rather than be described as if it had not.
 *
 * A roll is `ship(new)` then `dock(old)`, in that order and never the other way round.
 * `Aqua.safeBalances` reverts `SafeBalancesForTokenNotInActiveStrategy` on a docked strategy, so
 * docking first would kill every quote on the position for the length of one block — a window in
 * which an aggregator sees no liquidity and routes around it.
 *
 * The new offer keeps the price, the size and the volatility, and inherits the reserves the old one
 * currently holds — which is where its trades left it — so it starts on its own curve where the
 * market put it rather than at some remembered opening point. The stable side of that reserve is
 * re-read from `stableFor` at the NEW maturity, because the curve moved when the clock did. That
 * read is on a poll rather than fetched once: `StrikelineViews._sNow` reads `block.timestamp`, and
 * on the demo leg the answer drifts about 0.035 stable units a minute against a maker-favouring
 * guard band of about 0.06, so two minutes of staleness is already an offer shipped off its own
 * curve — and a shipped hash can never be repaired.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, SegmentedControl, Skeleton, Stack, Text } from '@mantine/core';
import { RotateCw, Trash2 } from 'lucide-react';
import { keccak256, type Address, type Hex } from 'viem';
import { useConnection, useReadContract, useWriteContract } from 'wagmi';
import {
  ASSIGNMENT_WINDOW_SECONDS,
  ProgramInspector,
  buildLegProgram,
  strikelineReadAbi,
  toRawReserve,
  type RmmArgs,
} from '@/components/curve';
import { countTransferLogs } from '@/components/tx/TxStepper';
import { EXPIRY_PRESETS, formatExpiry, maturityAt } from '@/components/sell/expiry';
import { aquaFork } from '@/lib/chain';
import { aquaAbi } from '@/lib/contracts';
import { buildAquaOrder, encodeStrategyForShip } from '@/lib/swapvm';
import { useTxFlow, type TxPlanStep } from '@/hooks';
import { formatUnits } from '@/lib/ui';
import { Num, Panel, Row } from './bits';
import { TxSteps } from './TxSteps';

export interface ManagePanelProps {
  aqua: Address;
  router: Address;
  maker: Address;
  strategyHash: Hex;
  tokens: readonly [Address, Address];
  rmm: RmmArgs;
  /** Live virtual reserves, raw units, in `(tokenA, tokenB)` order. */
  reserves: readonly [bigint, bigint];
  riskyIsTokenA: boolean;
  riskySymbol: string;
  riskyDecimals: number;
  stableSymbol: string;
  stableDecimals: number;
  chainNow?: number;
  chainId?: number;
  onDone?: () => void;
}

export function ManagePanel({
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
  onDone,
}: ManagePanelProps) {
  const { address } = useConnection();
  const { mutateAsync: writeContract } = useWriteContract();
  const { run, steps, isRunning, error, reset } = useTxFlow(aquaFork.id);
  const [tenor, setTenor] = useState('7');
  const [done, setDone] = useState<'rolled' | 'withdrawn'>();
  /**
   * Taking an offer down cannot be undone by any later transaction. `Aqua.dock` writes `0xff` into
   * the strategy's token counts, so this exact hash is dead for good: the same terms can only come
   * back under a fresh salt, as a different offer with its own history. A button that irreversible
   * asks first.
   */
  const [confirming, setConfirming] = useState(false);
  /**
   * Bumped after every roll so a second roll in the same block still gets a fresh strategy hash.
   * The base is the chain's clock rather than the browser's: it is monotonic, it is a value this
   * component already reads, and reading `Date.now()` during render is an impurity React refuses.
   */
  const [saltNonce, setSaltNonce] = useState(0);

  const days = Number(tenor);
  const newMaturity = chainNow === undefined ? undefined : maturityAt(chainNow, days);

  const riskyRaw = riskyIsTokenA ? reserves[0] : reserves[1];
  const xWad = riskyRaw * rmm.rateRisky;

  const stableFor = useReadContract({
    address: router,
    abi: strikelineReadAbi,
    functionName: 'stableFor',
    args: [rmm.strikeWad, rmm.sigmaWad, newMaturity ?? 0, rmm.liquidityWad, xWad],
    chainId: aquaFork.id,
    query: {
      enabled: newMaturity !== undefined && rmm.liquidityWad > BigInt(0),
      staleTime: 4_000,
      refetchInterval: 8_000,
      retry: false,
    },
  });

  const next = useMemo(() => {
    if (newMaturity === undefined || stableFor.data === undefined) return undefined;
    const { raw: stableRaw } = toRawReserve(stableFor.data, rmm.rateStable);

    const program = buildLegProgram({
      rmm: { ...rmm, maturity: newMaturity },
      deadline: newMaturity + ASSIGNMENT_WINDOW_SECONDS,
      // A docked strategy hash is dead forever, so a roll to identical economics needs a fresh salt
      // or the new ship reverts against the corpse of the old one.
      salt: BigInt(chainNow ?? 0) * BigInt(1000) + BigInt(saltNonce),
    });
    const order = buildAquaOrder({ maker, tokenA: tokens[0], tokenB: tokens[1], program });
    const amounts: readonly [bigint, bigint] = riskyIsTokenA
      ? [riskyRaw, stableRaw]
      : [stableRaw, riskyRaw];

    return {
      maturity: newMaturity,
      program,
      order,
      amounts,
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
        label: `Publish it at the new date · ${formatExpiry(next.maturity)}`,
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
        label: 'Take the old one down',
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
      // The step list already carries which step failed and its decoded reason.
    }
  }, [next, reset, writeContract, aqua, router, tokens, strategyHash, run, onDone]);

  const withdraw = useCallback(async () => {
    setConfirming(false);
    reset();
    setDone(undefined);
    try {
      await run([
        {
          label: 'Take this offer down',
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
      setDone('withdrawn');
      onDone?.();
    } catch {
      // Same: the step list has it.
    }
  }, [reset, run, writeContract, aqua, router, strategyHash, tokens, onDone]);

  const transferLogs = countTransferLogs(steps);
  const notMaker =
    !address || address.toLowerCase() !== maker.toLowerCase()
      ? 'Only the wallet that published this offer can move it or take it down.'
      : undefined;

  return (
    <Panel
      title="Move it later, or take it down"
      description="Both are bookkeeping. Neither moves a token, and there is nothing to withdraw, because nothing was ever deposited."
    >
      <Stack gap="md">
        {/* The claim, before you sign, and then the measurement. */}
        <Alert
          variant="light"
          color={transferLogs === undefined ? 'petrol' : transferLogs === 0 ? 'moss' : 'ember'}
          radius="md"
          title={
            transferLogs === undefined
              ? 'No tokens will move'
              : transferLogs === 0
                ? 'No tokens moved'
                : `${transferLogs} token transfers happened`
          }
        >
          {transferLogs === undefined ? (
            <>
              Publishing writes a number into Aqua&rsquo;s ledger and taking down erases it. Your
              wallet is not touched by either, because your {riskySymbol} has been in it the whole
              time. Once these land, the receipts are counted here.
            </>
          ) : (
            <Group gap="xs" align="baseline">
              <Badge size="sm" variant="light" color={transferLogs === 0 ? 'moss' : 'ember'}>
                <Num>{transferLogs}</Num> ERC-20 Transfer logs
              </Badge>
              <Text size="xs" c="var(--ink-2)">
                counted across every receipt, not asserted.
              </Text>
            </Group>
          )}
        </Alert>

        <Stack gap={6}>
          <Text size="xs" c="var(--ink-2)">
            A new date
          </Text>
          <SegmentedControl
            value={tenor}
            onChange={setTenor}
            size="xs"
            radius="md"
            fullWidth
            data={EXPIRY_PRESETS.map((p) => ({ value: String(p.days), label: p.label }))}
          />
        </Stack>

        <dl className="flex flex-col">
          <Row label="Runs to">
            {next ? formatExpiry(next.maturity) : <Skeleton height={12} width={160} />}
          </Row>
          <Row label={`${riskySymbol} carried over`}>
            {formatUnits(riskyRaw, riskyDecimals, { significantDigits: 8 })}
          </Row>
          <Row label={`${stableSymbol} at the new date`}>
            {next ? (
              formatUnits(next.stableRaw, stableDecimals, { significantDigits: 10 })
            ) : (
              <Skeleton height={12} width={90} />
            )}
          </Row>
        </dl>

        <Text size="xs" c="var(--ink-3)" className="leading-prose">
          The new offer keeps the same price, the same size and the same volatility, and picks up
          wherever the trades so far have left this one.{' '}
          <em className="not-italic text-ink-2">Mechanically:</em> same K, sigma and L, inherited
          reserves, and a stable side taken from <span className="font-mono">stableFor</span> at the
          new maturity, read from the router rather than worked out here.
        </Text>

        <Group gap="xs">
          <Button
            leftSection={<RotateCw size={15} strokeWidth={1.75} />}
            loading={isRunning && done === undefined}
            disabled={!next || Boolean(notMaker)}
            title={notMaker ?? (next ? 'Roll' : 'Waiting for the router to price the new date.')}
            onClick={() => void roll()}
          >
            Move to a later date
          </Button>
          <Button
            variant="outline"
            color="ember"
            leftSection={<Trash2 size={15} strokeWidth={1.75} />}
            disabled={Boolean(notMaker)}
            title={notMaker ?? 'Dock'}
            onClick={() => setConfirming(true)}
          >
            Take it down
          </Button>
        </Group>

        {notMaker ? (
          <Text size="xs" c="var(--ink-3)">
            {notMaker}
          </Text>
        ) : null}

        <TxSteps
          steps={steps}
          chainId={chainId}
          plan={['Publish it at the new date', 'Take the old one down']}
        />

        {error ? (
          <Alert variant="light" color="ember" radius="md" title="That did not go through">
            <span className="font-mono text-mini break-all">{error}</span>
          </Alert>
        ) : null}

        {done === 'rolled' && next ? (
          <Alert variant="light" color="moss" radius="md" title="Moved">
            The old offer is gone for good: the chain writes <span className="font-mono">0xff</span>{' '}
            over it and will never accept it again. The new one is already quoting.
          </Alert>
        ) : null}

        {done === 'withdrawn' ? (
          <Alert variant="light" color="petrol" radius="md" title="Taken down">
            Nobody can take this offer any more. Your wallet is untouched: there was never anything
            held anywhere to give back.
          </Alert>
        ) : null}

        {next ? (
          <details className="rounded-card border border-line">
            <summary className="cursor-pointer list-none px-4 py-3 text-meta text-ink-2 transition-state hover:text-ink">
              The program this would publish
            </summary>
            <div className="px-4 pb-4">
              <ProgramInspector
                bare
                program={next.program}
                strategyHash={next.strategyHash}
                description="Same K, sigma and L; a new maturity, a new deadline, and a fresh salt so the hash does not collide with the offer it replaces."
              />
            </div>
          </details>
        ) : null}

        <Modal
          opened={confirming}
          onClose={() => setConfirming(false)}
          title="Take this offer down"
          size="md"
        >
          <Stack gap="sm">
            <Text size="sm" c="var(--ink-2)" className="leading-prose">
              Quoting stops in the block this lands in, and this offer can never be published again.
              The same price, size and date can only come back as a new offer with its own history.
            </Text>
            <Text size="sm" c="var(--ink-2)" className="leading-prose">
              No token moves, and there is nothing to withdraw: your wallet has held the whole amount
              the entire time. If you only want a later date, move it instead — that publishes the
              new offer first, so you are never absent from the market in between.
            </Text>
            <Group justify="flex-end" gap="xs" mt="sm">
              <Button variant="default" onClick={() => setConfirming(false)}>
                Keep it up
              </Button>
              <Button
                color="ember"
                leftSection={<Trash2 size={15} strokeWidth={1.75} />}
                onClick={() => void withdraw()}
              >
                Take it down
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Panel>
  );
}
