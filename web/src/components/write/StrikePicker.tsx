'use client';

/**
 * Step two: the ladder.
 *
 * Chips pick strikes by moneyness rather than by price, because moneyness is the decision — "sell my
 * upside 10% out" survives a move in spot, "sell at 2,728" does not. The chip stays selected as
 * spot walks; the strike it produced does not move, because the strike is a term of a leg that has
 * already been written.
 *
 * Notional is per leg and denominated in the risky asset, since `L` is in risky units and a maker
 * thinks in "twelve ETH of upside", not in liquidity. Nothing here computes a reserve: the row shows
 * what the chain returned for this leg once `useLegSizing` has asked, and a dash before that.
 */
import { Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import {
  Button,
  EmptyState,
  IconButton,
  NumberInput,
  Pill,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableMessageRow,
  TableRow,
  TokenAmount,
} from '@/components/ui';
import { Layers } from 'lucide-react';
import { formatChartNumber } from '@/components/charts/format';
import { cn, formatPercent } from '@/lib/ui';
import { MONEYNESS_CHIPS, moneynessOf, strikeFrom } from './moneyness';
import type { LegDraft, SizedLeg, WritePair } from './types';

export interface StrikePickerProps {
  pair: WritePair;
  spot?: number;
  legs: readonly LegDraft[];
  /** Keyed by draft id. Absent until the router has been asked where the curve is. */
  sizedById: ReadonlyMap<string, SizedLeg>;
  sizingLoading?: boolean;
  onToggleOffset: (offset: number) => void;
  onNotionalChange: (id: string, next: string) => void;
  onRemove: (id: string) => void;
  /** Risky balance, for the notional field's Max shortcut. */
  riskyBalance?: bigint;
  className?: string;
}

const COLUMNS = 6;

export function StrikePicker({
  pair,
  spot,
  legs,
  sizedById,
  sizingLoading = false,
  onToggleOffset,
  onNotionalChange,
  onRemove,
  riskyBalance,
  className,
}: StrikePickerProps) {
  const selected = useMemo(() => new Set(legs.map((leg) => leg.offset)), [legs]);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {MONEYNESS_CHIPS.map((chip) => {
          const on = selected.has(chip.offset);
          const strike = spot !== undefined ? strikeFrom(spot, chip.offset) : undefined;
          return (
            <button
              key={chip.offset}
              type="button"
              aria-pressed={on}
              disabled={spot === undefined}
              onClick={() => onToggleOffset(chip.offset)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-pill border px-3 text-meta transition-state',
                on
                  ? 'border-accent-dim bg-accent/15 text-ink'
                  : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
                spot === undefined && 'cursor-not-allowed opacity-50',
              )}
            >
              <span className="font-mono tnum">{chip.label}</span>
              {strike !== undefined ? (
                <span className="font-mono tnum text-ink-3">
                  {formatChartNumber(strike, { significantDigits: 8, maxFractionDigits: 0 })}
                </span>
              ) : null}
              <span className="sr-only">
                {chip.kind === 'call' ? 'covered call' : 'cash-secured put'}
              </span>
            </button>
          );
        })}
      </div>

      <p className="max-w-prose text-mini leading-prose text-ink-3">
        Above spot the reserves start risky-heavy and the leg is a covered call; below spot they start
        stable-heavy and the same 62 bytes are a cash-secured put. Nothing in the program branches on
        which — put-call parity does the work.
      </p>

      {legs.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No legs yet"
          description="Pick a moneyness above. One balance can back several legs at once, which is the point of writing a ladder rather than a single position."
          action={
            spot === undefined ? undefined : (
              <Button variant="secondary" icon={Plus} onClick={() => onToggleOffset(0.1)}>
                Add the 10% call
              </Button>
            )
          }
        />
      ) : (
        <Table caption="Legs in this book" hideCaption minWidth="46rem">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Leg</TableHeaderCell>
              <TableHeaderCell numeric>Strike</TableHeaderCell>
              <TableHeaderCell numeric>Notional (L)</TableHeaderCell>
              <TableHeaderCell numeric>Risky reserve</TableHeaderCell>
              <TableHeaderCell numeric>Stable reserve</TableHeaderCell>
              <TableHeaderCell>
                <span className="sr-only">Remove</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {legs.map((leg) => (
              <LegRow
                key={leg.id}
                leg={leg}
                pair={pair}
                spot={spot}
                sized={sizedById.get(leg.id)}
                sizingLoading={sizingLoading}
                onNotionalChange={onNotionalChange}
                onRemove={onRemove}
                riskyBalance={riskyBalance}
              />
            ))}
            {legs.length > 0 && sizedById.size === 0 && !sizingLoading ? (
              <TableMessageRow colSpan={COLUMNS}>
                The router has not returned a reserve for these legs yet.
              </TableMessageRow>
            ) : null}
          </TableBody>
        </Table>
      )}

      {legs.length > 0 ? (
        <p className="max-w-prose text-mini leading-prose text-ink-3">
          The risky reserve is <span className="font-mono">x = L(1 - Phi(d1))</span>, picked here: it
          only chooses where on the curve the leg starts, and a neighbouring value is simply a
          differently-moneyed leg. The stable reserve is{' '}
          <span className="font-mono">router.stableFor(K, sigma, T, L, x)</span> and is never computed
          in the browser. One wei off the chain{"\u2019"}s own curve and every quote on the leg reverts
          for the rest of its life, with no way to re-ship the same hash.
        </p>
      ) : null}
    </div>
  );
}

function LegRow({
  leg,
  pair,
  spot,
  sized,
  sizingLoading,
  onNotionalChange,
  onRemove,
  riskyBalance,
}: {
  leg: LegDraft;
  pair: WritePair;
  spot?: number;
  sized?: SizedLeg;
  sizingLoading: boolean;
  onNotionalChange: (id: string, next: string) => void;
  onRemove: (id: string) => void;
  riskyBalance?: bigint;
}) {
  const moneyness = spot !== undefined ? moneynessOf(leg.strike, spot) : undefined;

  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-2">
          <Pill tone={leg.kind === 'call' ? 'accent' : 'neutral'} size="sm">
            {leg.kind === 'call' ? 'Call' : 'Put'}
          </Pill>
          {moneyness !== undefined ? (
            <span className="font-mono text-mini tnum text-ink-3">
              {formatPercent(moneyness, { fractionDigits: 1, sign: 'always' })}
            </span>
          ) : null}
        </span>
      </TableCell>

      <TableCell numeric>
        <span className="font-mono text-meta tnum text-ink">
          {formatChartNumber(leg.strike, { significantDigits: 10, maxFractionDigits: 2 })}
        </span>
      </TableCell>

      <TableCell numeric>
        <div className="ml-auto w-40">
          <NumberInput
            size="sm"
            value={leg.notional}
            onValueChange={(next) => onNotionalChange(leg.id, next)}
            decimals={pair.risky.decimals}
            symbol={pair.risky.symbol}
            balance={riskyBalance}
            aria-label={`Notional for the ${leg.strike} leg, in ${pair.risky.symbol}`}
          />
        </div>
      </TableCell>

      <TableCell numeric>
        {sized ? (
          <TokenAmount
            value={sized.riskyRaw}
            decimals={pair.risky.decimals}
            symbol={pair.risky.symbol}
            size="sm"
          />
        ) : sizingLoading ? (
          <Skeleton className="ml-auto h-3.5 w-20" />
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </TableCell>

      <TableCell numeric>
        {sized ? (
          <TokenAmount
            value={sized.stableRaw}
            decimals={pair.stable.decimals}
            symbol={pair.stable.symbol}
            size="sm"
          />
        ) : sizingLoading ? (
          <Skeleton className="ml-auto h-3.5 w-24" />
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </TableCell>

      <TableCell>
        <span className="flex justify-end">
          <IconButton
            icon={Trash2}
            label={`Remove the ${leg.strike} leg`}
            variant="ghost"
            size="sm"
            onClick={() => onRemove(leg.id)}
          />
        </span>
      </TableCell>
    </TableRow>
  );
}
