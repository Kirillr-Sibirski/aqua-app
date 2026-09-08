'use client';

/**
 * The smallest trade this offer will take, published and then measured.
 *
 * `StrikelineViews.bandFor` publishes the gap. That is a claim, and this panel checks it: it sends
 * the published figure to `quote()` and sends one raw unit less, and prints what came back. The
 * distinction is not academic. `RmmSwap.exec` does not clear a trade *at* the curve — it requires
 * the new output reserve to sit a guard band (`EPS`, 2e-6 of the offer) inside what the offer
 * holds — so a screen that printed the curve gap alone would be printing an amount that reverts.
 * `bandFor` was corrected to include that guard; this is how the screen knows it stayed corrected.
 *
 * If the two ever disagree, the number shown is the one that clears, never the one that reverts,
 * and the sentence underneath says which is which.
 */
import { Alert, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { formatUnits } from '@/lib/ui';
import { Figure, Num, Term } from './bits';
import type { SmallestFill } from './useTakeQuotes';

export interface GapReadoutProps {
  /** `bandFor`'s minimum on the side a taker pays, in raw units of that token. */
  publishedIn?: bigint;
  /** The same on the other side, for the second figure. */
  publishedOther?: bigint;
  inSymbol: string;
  inDecimals: number;
  otherSymbol: string;
  otherDecimals: number;
  fill?: SmallestFill;
  /** True while the numbers come from a time the reader dragged to rather than now. */
  scrubbed?: boolean;
  /** How much time is left at that position, in words. */
  whenLabel?: string;
}

export function GapReadout({
  publishedIn,
  publishedOther,
  inSymbol,
  inDecimals,
  otherSymbol,
  otherDecimals,
  fill,
  scrubbed = false,
  whenLabel,
}: GapReadoutProps) {
  // Always the amount that clears when we know one; the published figure only when no probe has
  // come back yet. Never an amount the router refused.
  const headline = fill?.clears ?? publishedIn;
  /** The published figure reverts and something above it fills: the screen must show the latter. */
  const understated = fill !== undefined && fill.clears !== undefined && !fill.publishedClears;
  /** The published figure fills and so does the unit below it: conservative by a unit, not wrong. */
  const overstated = fill !== undefined && fill.publishedClears && !fill.oneBelowRefused;

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
        <Figure
          size="lg"
          tone="warn"
          label={
            scrubbed && whenLabel
              ? `Smallest ${inSymbol} trade with ${whenLabel} left`
              : `Smallest ${inSymbol} trade it will take`
          }
          value={
            headline === undefined
              ? '—'
              : formatUnits(headline, inDecimals, { significantDigits: 9, maxFractionDigits: 6 })
          }
          unit={inSymbol}
          // Only claim the floor is tight when the probe proved it. In the overstated case all we
          // know is that this amount filled, not that the one below it would not have.
          detail={
            fill === undefined || fill.oneBelowRefused
              ? 'Anything smaller is refused'
              : 'The smallest amount we got filled'
          }
        />
        <Figure
          size="lg"
          tone="warn"
          label={`Smallest ${otherSymbol} trade, the other way`}
          value={
            publishedOther === undefined
              ? '—'
              : formatUnits(publishedOther, otherDecimals, {
                  significantDigits: 9,
                  maxFractionDigits: 8,
                })
          }
          unit={otherSymbol}
          detail="The same gap, crossed from the other side"
        />
      </SimpleGrid>

      {scrubbed ? (
        <Text size="xs" c="var(--ink-3)" className="leading-prose">
          Both figures are <span className="font-mono">bandFor</span> asked about an offer with the
          same price, the same size and that much less time left, so it is a read rather than a projection. The
          router will only agree to fill something at the block it is in, so the measured check comes
          back when the slider does.
        </Text>
      ) : fill === undefined ? (
        <Text size="xs" c="var(--ink-3)" className="leading-prose">
          Checking the figure against the router…
        </Text>
      ) : understated ? (
        <Alert variant="light" color="amber" radius="md" title="Showing what clears">
          <Text size="xs" c="var(--ink-2)" className="leading-prose">
            The router publishes{' '}
            <Num>{formatUnits(fill.published, inDecimals, { significantDigits: 9 })}</Num> {inSymbol}{' '}
            as the minimum, and refuses it. The first amount we asked for that it actually filled is{' '}
            <Num>{formatUnits(fill.clears ?? BigInt(0), inDecimals, { significantDigits: 9 })}</Num>{' '}
            {inSymbol}, which is the number above. The difference is the{' '}
            <Term precise="RmmSwap.EPS = 2e-6 of the leg, held back so a trade cannot land exactly on the curve and leave the next quote one wei off it.">
              guard band
            </Term>{' '}
            the instruction holds back on the output side.
          </Text>
        </Alert>
      ) : overstated ? (
        <Alert variant="light" color="amber" radius="md" title="Showing what clears">
          <Text size="xs" c="var(--ink-2)" className="leading-prose">
            The router publishes{' '}
            <Num>{formatUnits(fill.published, inDecimals, { significantDigits: 9 })}</Num> {inSymbol}
            , and that fills. So does the unit below it, which is the number above. The
            published minimum is rounded a unit to the maker&rsquo;s side of the{' '}
            <Term precise="RmmSwap.EPS = 2e-6 of the leg, held back on the output side so a trade cannot land exactly on the curve. bandFor reads the band off the guarded reserve, and the two roundings need not land on the same raw unit.">
              guard band
            </Term>
            . Either amount will trade; the smaller one is the honest floor.
          </Text>
        </Alert>
      ) : fill.clears === undefined ? (
        <Alert variant="light" color="amber" radius="md" title="Nothing we tried cleared">
          <Text size="xs" c="var(--ink-2)" className="leading-prose">
            None of the amounts we asked the router to fill went through, so the figure above is the
            published one rather than a measured one. Most often this is coverage rather than the
            gap: the wallet behind the offer cannot deliver right now.
          </Text>
        </Alert>
      ) : (
        <Group gap={6} align="baseline" wrap="wrap">
          <Text size="xs" c="var(--pos)" fw={500}>
            Measured, not asserted.
          </Text>
          <Text size="xs" c="var(--ink-3)" className="leading-prose">
            We asked the router to fill exactly this and it did
            {fill.buys !== undefined ? (
              <>
                , buying{' '}
                <Num>{formatUnits(fill.buys, otherDecimals, { significantDigits: 4 })}</Num>{' '}
                {otherSymbol}, which is dust: at the threshold the whole trade is the gap
              </>
            ) : null}
            {fill.oneBelowRefused ? (
              <>
                . One unit less and it refuses
                {fill.refusedAs ? (
                  <>
                    , with <span className="font-mono">{fill.refusedAs}</span>
                  </>
                ) : null}
                , so the bound is exact to the last unit the token has
              </>
            ) : null}
            .
          </Text>
        </Group>
      )}
    </Stack>
  );
}
