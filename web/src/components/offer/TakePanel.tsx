'use client';

/**
 * What a buyer pays right now, asked of the router at eight different sizes.
 *
 * Every row is one `quote()` inside a single multicall, so the price in it is the price a taker
 * would actually get in this block, guard band and coverage check included. Nothing here is an
 * average of anything: `amountIn / amountOut` is a division of two integers the chain returned.
 *
 * Rows that the router refuses are kept, because the refusal is the more interesting answer. Aqua
 * lets a maker advertise more depth than their wallet holds — `ship` checks no balance and
 * `safeBalances` never clamps — so the top of this ladder is where `Coverage` says how much of the
 * advertised size is real, and it says it as `NotCovered(needed, free)` with `free` being exactly
 * what to ask for instead.
 */
import { Alert, Badge, Group, Stack, Text, Tooltip } from '@mantine/core';
import { formatUnits } from '@/lib/ui';
import { Panel, Term } from './bits';
import type { QuoteRow } from './useTakeQuotes';

export interface TakePanelProps {
  rows: readonly QuoteRow[];
  isLoading: boolean;
  error?: Error | null;
  /** Token the taker receives. */
  outSymbol: string;
  outDecimals: number;
  /** Token the taker pays. */
  inSymbol: string;
  inDecimals: number;
  /** `coverage(maker, outToken)`: what the guard will really deliver, raw units. */
  deliverable?: bigint;
  /** What Aqua's ledger says the offer holds of the out token, raw units. */
  advertised: bigint;
  /** The strike, formatted, so a row can be read against the price the maker named. */
  strikeLabel: string;
}

/**
 * Stable raw units per one whole unit of the token that leaves.
 *
 * Integer arithmetic on two numbers the router returned, so the price column cannot drift from the
 * quote it came from.
 */
export function pricePerUnit(amountIn: bigint, amountOut: bigint, outDecimals: number): bigint {
  if (amountOut <= BigInt(0)) return BigInt(0);
  return (amountIn * BigInt(10) ** BigInt(outDecimals)) / amountOut;
}

export function TakePanel({
  rows,
  isLoading,
  error,
  outSymbol,
  outDecimals,
  inSymbol,
  inDecimals,
  deliverable,
  advertised,
  strikeLabel,
}: TakePanelProps) {
  const walletBound = deliverable !== undefined && deliverable < advertised;

  return (
    <Panel
      title="What a buyer pays right now"
      description={`Eight sizes, priced by the router in this block. The bigger the trade, the further along the curve it walks, so the price per ${outSymbol} moves as it goes.`}
      flush
    >
      <Stack gap="sm" px="md" pb="md">
        {error ? (
          <Alert variant="light" color="ember" radius="md" title="The router did not price this offer">
            <span className="font-mono text-mini break-all">{error.message}</span>
          </Alert>
        ) : null}

        <div className="overflow-x-auto">
          {/* 19rem, not 30: at 390px the three columns still fit, and a price table that has to be
              scrolled sideways to reach the price is a price table nobody reads. */}
          <table className="w-full min-w-[19rem] border-collapse text-meta">
            <caption className="sr-only">
              Quoted prices at eight sizes, and the reason for any the router refused
            </caption>
            <thead>
              <tr className="border-b border-line-strong text-left text-mini text-ink-2">
                <th scope="col" className="py-2 pr-3 font-medium">
                  They take
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  They pay
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  <Term
                    precise={`amountIn / amountOut from the same quote. Against your strike of ${strikeLabel}, this is what you would actually sell at.`}
                  >
                    Price each
                  </Term>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && rows.length === 0
                ? [0, 1, 2, 3].map((i) => (
                    <tr key={i} className="border-b border-line">
                      <td className="py-2 pr-3" colSpan={3}>
                        <span className="block h-3 w-full animate-pulse rounded-control bg-surface-2 motion-reduce:animate-none" />
                      </td>
                    </tr>
                  ))
                : rows.map((row) => (
                    <tr key={row.request.toString()} className="border-b border-line last:border-b-0">
                      <td className="py-2 pr-3 font-mono tnum text-ink">
                        {formatUnits(row.request, outDecimals, { significantDigits: 6 })}{' '}
                        <span className="text-ink-3">{outSymbol}</span>
                      </td>
                      {row.amountIn !== undefined && row.amountOut !== undefined ? (
                        <>
                          <td className="py-2 pr-3 text-right font-mono tnum text-ink">
                            {formatUnits(row.amountIn, inDecimals, { maxFractionDigits: 2 })}{' '}
                            <span className="text-ink-3">{inSymbol}</span>
                          </td>
                          <td className="py-2 text-right font-mono tnum text-ink">
                            {formatUnits(pricePerUnit(row.amountIn, row.amountOut, outDecimals), inDecimals, {
                              maxFractionDigits: 2,
                            })}
                          </td>
                        </>
                      ) : (
                        <td className="py-2 text-right" colSpan={2}>
                          <Refusal row={row} outSymbol={outSymbol} outDecimals={outDecimals} />
                        </td>
                      )}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        <Group gap="xs" align="baseline" wrap="wrap">
          <Text size="xs" c="var(--ink-3)">
            <Term precise="Aqua's virtual balance for this strategy: the size the offer advertises, which ship() never checks against a wallet.">
              On offer
            </Term>{' '}
            <span className="font-mono tnum text-ink-2">
              {formatUnits(advertised, outDecimals, { significantDigits: 6 })} {outSymbol}
            </span>
          </Text>
          <Text size="xs" c="var(--ink-3)">
            ·{' '}
            <Term precise="coverage(maker, token) on the router: min(balanceOf, allowance) for the maker's wallet. This is the deliverable depth Coverage enforces inside the same call that prices a trade, and it is shared with every other offer from this wallet.">
              Can actually be taken
            </Term>{' '}
            <span className={`font-mono tnum ${walletBound ? 'text-warn' : 'text-ink-2'}`}>
              {deliverable === undefined
                ? '—'
                : `${formatUnits(deliverable, outDecimals, { significantDigits: 6 })} ${outSymbol}`}
            </span>
          </Text>
          {walletBound ? (
            <Badge size="xs" variant="light" color="amber" radius="sm">
              wallet-bound
            </Badge>
          ) : null}
        </Group>

        <Text size="xs" c="var(--ink-3)" className="leading-prose">
          {walletBound
            ? `This offer advertises more ${outSymbol} than the wallet behind it currently holds, and that is allowed on purpose: one balance can stand behind several offers at once. The guard checks the wallet inside the same call that prices the trade, so a fill on any other offer from this wallet shrinks this number in the same block.`
            : `The wallet behind this offer can currently deliver everything it advertises. That number is shared with every other offer from the same wallet, so a fill elsewhere lowers it here in the same block, with no keeper and no message passed.`}
        </Text>
      </Stack>
    </Panel>
  );
}

/** A refusal, said in words, with the number the router handed back. */
function Refusal({
  row,
  outSymbol,
  outDecimals,
}: {
  row: QuoteRow;
  outSymbol: string;
  outDecimals: number;
}) {
  const bound = row.refusedArgs?.[1];
  const plain =
    row.refusedAs === 'NotCovered'
      ? 'more than the wallet can deliver'
      : row.refusedAs === 'RmmExceedsReserve'
        ? 'more than this offer holds'
        : row.refusedAs === 'RmmInsideSpread'
          ? 'too small to clear the gap'
          : 'refused';

  return (
    <Tooltip
      label={`${row.refusedAs ?? 'refused'}${
        bound === undefined
          ? ''
          : `. The second argument is the honest maximum: ${formatUnits(bound, outDecimals, { significantDigits: 8 })} ${outSymbol}`
      }`}
      multiline
      w={280}
      withArrow
    >
      <span className="cursor-help text-mini text-warn">
        {plain}
        {bound !== undefined ? (
          <span className="ml-1.5 font-mono tnum">
            max {formatUnits(bound, outDecimals, { significantDigits: 5 })} {outSymbol}
          </span>
        ) : null}
      </span>
    </Tooltip>
  );
}
