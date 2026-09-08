'use client';

/**
 * The offers, as rows. Five columns and no more.
 *
 * Every column answers a question the maker actually has, in that order: *what am I selling, at
 * what strike, by when, how much of it can somebody take right now, and what has it paid me.*
 *
 * The headers say `Strike`, `Expiry` and `Premium earned` on purpose. Nobody reaches this screen
 * without having published an offer first, so they have the context those words need, and the
 * comprehension study's own options trader read the precise vocabulary as the sign the maths was
 * real. What the study did kill was the vocabulary that means nothing without the implementation
 * open beside you: the screen this replaces had seven columns, three of them `moneyness`, `theta
 * band` and `X/L`. Those are gone rather than softened, and the numbers worth keeping from them
 * live in tooltips. Where a precise word appears first, the tooltip carries the plain gloss —
 * never the reverse.
 *
 * Two of the five are numbers no other venue can print:
 *
 *  - **Can be taken now** is not the balance Aqua advertises, which can be a lie: `ship()` checks no
 *    balance and `safeBalances()` does not clamp to the wallet. It is the bound the guard itself
 *    reported when the offer was probed for the whole of what it promises, at the pinned block.
 *  - **Premium earned** is realised, and only realised. It is the sum of the spreads past takers
 *    actually had to cross, replayed from the chain at each fill's own block. It stays at zero until
 *    somebody trades, and there is no model anywhere that could make it say otherwise.
 *
 * Withdrawn offers are not listed among the live ones. A withdrawn strategy hash can never be filled
 * again, so every number on such a row -- what can be taken, what it would pay -- would be a claim
 * about a trade that is structurally impossible. They collapse into one disclosure that says how
 * many there are, and open on request.
 */
import { Anchor, Badge, Collapse, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { Hex } from 'viem';
import { formatCountdown, sigmaRatio } from '@/hooks/strikeline';
import type { BookLeg, BookTokenView } from '@/hooks/useBook';
import { cn, formatPercent, formatTokenAmount } from '@/lib/ui';
import { amountText, depthCaption, formatExpiryDate, formatExpiryExact, offerAction, offerStatus } from './copy';

const ZERO = BigInt(0);

export interface OffersTableProps {
  live: BookLeg[];
  withdrawn: BookLeg[];
  highlight?: Hex;
  onHighlight?: (hash: Hex | undefined) => void;
}

const HEAD = [
  { key: 'offer', label: 'Offer', numeric: false, width: '26%' },
  { key: 'price', label: 'Strike', numeric: true, width: '14%' },
  { key: 'when', label: 'Expiry', numeric: true, width: '16%' },
  { key: 'depth', label: 'Can be taken now', numeric: true, width: '22%' },
  { key: 'earned', label: 'Premium earned', numeric: true, width: '22%' },
] as const;

export function OffersTable({ live, withdrawn, highlight, onHighlight }: OffersTableProps) {
  const [showWithdrawn, setShowWithdrawn] = useState(false);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <Table.ScrollContainer minWidth={760} type="native">
        <Table
          highlightOnHover
          tabularNums
          verticalSpacing="sm"
          horizontalSpacing="md"
          borderColor="var(--line)"
          highlightOnHoverColor="var(--surface-2)"
          styles={{ table: { fontSize: 'var(--text-meta)' } }}
        >
          <Table.Caption className="sr-only">Offers you have published from this wallet</Table.Caption>
          <Table.Thead>
            <Table.Tr>
              {HEAD.map((col) => (
                <Table.Th
                  key={col.key}
                  w={col.width}
                  className={cn(
                    'text-micro text-ink-3 uppercase',
                    col.numeric && 'text-right',
                  )}
                  style={{ fontWeight: 500 }}
                >
                  {col.label}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {live.map((leg) => (
              <OfferRow key={leg.key} leg={leg} highlight={highlight} onHighlight={onHighlight} />
            ))}

            {live.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={HEAD.length}>
                  <Text size="sm" c="var(--ink-2)" py="md">
                    Nothing live. Every offer this wallet published has been withdrawn.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : null}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <p className="border-t border-line px-4 py-2 text-mini text-ink-3 sm:hidden">
        Scroll the table sideways for what can be taken and what it has earned.
      </p>

      {withdrawn.length > 0 ? (
        <>
          <UnstyledButton
            onClick={() => setShowWithdrawn((v) => !v)}
            aria-expanded={showWithdrawn}
            className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-meta text-ink-2 transition-state hover:bg-surface-2 hover:text-ink"
          >
            <ChevronDown
              size={14}
              strokeWidth={1.5}
              aria-hidden="true"
              className={cn('shrink-0 text-ink-3 transition-state', !showWithdrawn && '-rotate-90')}
            />
            <span className="font-mono tnum">{withdrawn.length}</span>
            <span>{withdrawn.length === 1 ? 'withdrawn offer' : 'withdrawn offers'}</span>
            <span className="hidden text-mini text-ink-3 sm:inline">
              {showWithdrawn ? 'shown below' : 'taken down. Nobody can take these.'}
            </span>
          </UnstyledButton>

          <Collapse expanded={showWithdrawn} transitionDuration={200}>
            <Table.ScrollContainer minWidth={760} type="native">
              <Table
                tabularNums
                verticalSpacing="sm"
                horizontalSpacing="md"
                borderColor="var(--line)"
                styles={{ table: { fontSize: 'var(--text-meta)' } }}
              >
                <Table.Caption className="sr-only">Offers you have withdrawn</Table.Caption>
                <Table.Tbody>
                  {withdrawn.map((leg) => (
                    <OfferRow key={leg.key} leg={leg} withdrawn />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Collapse>
        </>
      ) : null}
    </div>
  );
}

function OfferRow({
  leg,
  highlight,
  onHighlight,
  withdrawn = false,
}: {
  leg: BookLeg;
  highlight?: Hex;
  onHighlight?: (hash: Hex | undefined) => void;
  withdrawn?: boolean;
}) {
  const action = offerAction(leg);
  const status = offerStatus(leg);
  const delivers = leg.deliversRisky ? leg.risky : leg.stable;
  const receives = leg.deliversRisky ? leg.stable : leg.risky;
  const on = !withdrawn && highlight === leg.strategyHash;

  return (
    <Table.Tr
      bg={on ? 'var(--accent-soft)' : undefined}
      onMouseEnter={() => onHighlight?.(leg.strategyHash)}
      onMouseLeave={() => onHighlight?.(undefined)}
      style={{ transition: 'background-color var(--duration-base) var(--ease-out-quart)' }}
    >
      {/* The offer, as a sentence. */}
      <Table.Th scope="row" style={{ fontWeight: 400 }}>
        <span className="flex flex-col gap-1">
          <Anchor
            component={Link}
            href={`/offer/${leg.strategyHash}`}
            underline="never"
            className="text-body text-ink hover:text-accent hover:underline hover:underline-offset-2"
          >
            {action.verb}{' '}
            {/* A withdrawn or fully-taken offer has zero reserves, and "Sell 0 WETH" is a sentence
                about nothing. The size is dropped and the badge beside it says why. */}
            {leg.depth.written === ZERO ? null : (
              <>
                <span className="font-mono tnum">{amountText(leg.depth.written, delivers.decimals)}</span>{' '}
              </>
            )}
            {delivers.symbol}
          </Anchor>
          <span className="flex items-center gap-2 text-mini text-ink-3">
            paid in {receives.symbol}
            {status ? (
              <Badge
                size="xs"
                radius="sm"
                variant="light"
                color={status.tone === 'warn' ? 'amber' : 'slate'}
                title={status.title}
                style={{ fontWeight: 500, textTransform: 'none' }}
              >
                {status.label}
              </Badge>
            ) : null}
            {leg.guarded ? null : (
              <Badge
                size="xs"
                radius="sm"
                variant="light"
                color="ember"
                title="No Coverage instruction wraps this offer, so its size is advertised rather than margined."
                style={{ fontWeight: 500, textTransform: 'none' }}
              >
                Wallet not checked
              </Badge>
            )}
          </span>
        </span>
      </Table.Th>

      {/* Strike — the precise word, with the plain gloss carried in the tooltip beside it. */}
      <Table.Td align="right">
        <Tooltip
          multiline
          w={260}
          withArrow
          label={`The strike: this offer hands over ${delivers.symbol} once ETH ${action.kind === 'call' ? 'reaches' : 'falls to'} $${leg.strikeLabel}. Priced at ${formatPercent(sigmaRatio(leg.rmm.sigmaWad), { fractionDigits: 1 })} implied volatility (IV) — the movement it assumes between now and expiry.`}
        >
          <span className="flex flex-col items-end gap-1 leading-num">
            <span className="font-mono text-body tnum text-ink">${leg.strikeLabel}</span>
            <span className="text-mini text-ink-3">{action.trigger}</span>
          </span>
        </Tooltip>
      </Table.Td>

      {/* Expiry — read off the chain's clock, never the browser's. */}
      <Table.Td align="right">
        <span className="flex flex-col items-end gap-1 leading-num" title={formatExpiryExact(leg.rmm.maturity)}>
          <span className="font-mono text-body tnum text-ink">{formatExpiryDate(leg.rmm.maturity)}</span>
          <span className="text-mini text-ink-3">
            {Number.isNaN(leg.secondsLeft)
              ? '—'
              : leg.secondsLeft > 0
                ? `in ${formatCountdown(leg.secondsLeft)}`
                : 'expired'}
          </span>
        </span>
      </Table.Td>

      {/* How much can actually be taken, from the guard that enforces it. */}
      <Table.Td align="right">
        <DepthValue leg={leg} withdrawn={withdrawn} />
      </Table.Td>

      {/* Premium earned. Realised, from fills. Never a model number. */}
      <Table.Td align="right">
        <EarnedValue leg={leg} />
      </Table.Td>
    </Table.Tr>
  );
}

function DepthValue({ leg, withdrawn }: { leg: BookLeg; withdrawn: boolean }) {
  const token = leg.deliversRisky ? leg.risky : leg.stable;

  if (withdrawn || leg.status === 'docked') {
    return (
      <span className="flex flex-col items-end gap-1 leading-num">
        <span className="text-body text-ink-3">nothing</span>
        <span className="text-mini text-ink-3">withdrawn</span>
      </span>
    );
  }

  if (leg.depth.written === ZERO) {
    return (
      <span className="flex flex-col items-end gap-1 leading-num">
        <span className="text-body text-ink-3">nothing</span>
        <span className="text-mini text-ink-3">all taken</span>
      </span>
    );
  }

  // The guard's own number wins when it gave one: same quantity, straight from the enforcer.
  const amount = leg.probe.bound ?? leg.depth.amount;
  const note = depthCaption(leg);

  return (
    <span className="flex flex-col items-end gap-1 leading-num">
      <span
        className="font-mono text-body tnum text-ink"
        title={formatTokenAmount(amount, token.decimals, { symbol: token.symbol })}
      >
        {amountText(amount, token.decimals)}
        <span className="ml-1 text-ink-3">{token.symbol}</span>
      </span>
      <span title={note.title} className={cn('text-mini', note.tone === 'warn' ? 'text-warn' : 'text-ink-3')}>
        {note.text}
      </span>
    </span>
  );
}

function EarnedValue({ leg }: { leg: BookLeg }) {
  const theta = leg.theta;
  const amounts = theta
    ? ([
        theta.risky > ZERO ? { token: leg.risky, amount: theta.risky } : undefined,
        theta.stable > ZERO ? { token: leg.stable, amount: theta.stable } : undefined,
      ].filter(Boolean) as { token: BookTokenView; amount: bigint }[])
    : [];

  if (amounts.length === 0) {
    return (
      <span className="flex flex-col items-end gap-1 leading-num">
        <span className="font-mono text-body tnum text-ink-3">{theta?.pending ? '…' : '0'}</span>
        <span className="text-mini text-ink-3">
          {theta?.pending ? 'reading past fills' : 'nobody has taken it yet'}
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1 leading-num">
      {amounts.map((entry) => (
        <span key={entry.token.address} className="font-mono text-body tnum text-pos">
          {amountText(entry.amount, entry.token.decimals)}
          <span className="ml-1 text-ink-3">{entry.token.symbol}</span>
        </span>
      ))}
      <span className="text-mini text-ink-3">
        from {theta?.fills} {theta?.fills === 1 ? 'fill' : 'fills'}
        {theta?.incomplete ? ', one unread' : null}
      </span>
    </span>
  );
}
