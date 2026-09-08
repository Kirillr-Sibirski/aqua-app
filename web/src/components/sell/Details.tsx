'use client';

/**
 * Everything the card deliberately does not say.
 *
 * Collapsed by default and never opened for you. The rule the rest of the card lives under — no
 * strike, no implied volatility, no notional, no bytes — stops at this boundary, because someone
 * who has opened a disclosure marked "Details" has asked for the precise words, and giving them a
 * simplified paraphrase instead would be its own kind of dishonesty.
 *
 * Two of the rows are extra chain reads, made only once this is open: `bandFor` for the spread the
 * decay has opened, and `coverage` for what the wallet can actually deliver. Neither is on the
 * landing path, so neither costs a first-time visitor anything.
 */
import { Anchor, Collapse, CopyButton, NumberInput, Text } from '@mantine/core';
import { useId } from 'react';
import type { Address } from 'viem';
import { useCoverage, useThetaBand } from '@/components/curve';
import { aquaFork } from '@/lib/chain';
import { formatUnits, truncateHash } from '@/lib/ui';
import { formatExpiry } from './expiry';
import classes from './sell.module.css';
import type { OfferPair, SizedOffer } from './types';
import type { RealisedVol } from './useRealisedVol';

export interface DetailsProps {
  open: boolean;
  onToggle: () => void;
  offer?: SizedOffer;
  pair?: OfferPair;
  router?: Address;
  maker?: Address;
  maturity?: number;
  /** The volatility field, as typed. Percent. */
  vol: string;
  onVolChange: (next: string) => void;
  /** What the feed's own round history measured, when it could be measured. */
  realised?: RealisedVol;
  realisedUnavailable?: string;
  /** True while the field is still tracking the measurement rather than a typed number. */
  volIsMeasured: boolean;
  onUseMeasured: () => void;
}

export function Details({
  open,
  onToggle,
  offer,
  pair,
  router,
  maker,
  maturity,
  vol,
  onVolChange,
  realised,
  realisedUnavailable,
  volIsMeasured,
  onUseMeasured,
}: DetailsProps) {
  const panelId = useId();

  const bandParams =
    offer && maturity !== undefined
      ? {
          strikeWad: offer.rmm.strikeWad,
          sigmaWad: offer.rmm.sigmaWad,
          maturity,
          liquidityWad: offer.rmm.liquidityWad,
          xWad: offer.xWad,
          yWad: offer.yWad,
        }
      : undefined;

  const { band } = useThetaBand(open ? router : undefined, bandParams, {
    chainId: aquaFork.id,
    refetchInterval: open ? 12_000 : false,
  });

  const tokens = pair && open ? [pair.risky.address, pair.stable.address] : [];
  const { free } = useCoverage(open ? router : undefined, maker, tokens, {
    chainId: aquaFork.id,
    refetchInterval: open ? 12_000 : false,
  });

  return (
    <>
      <button
        type="button"
        className={classes.detailsToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        Details
        <svg className={classes.chevron} width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>

      <Collapse expanded={open}>
        <div id={panelId} className={classes.detailsBody}>
          <NumberInput
            label="Implied volatility"
            description={
              realised
                ? `How much movement the offer is priced for, annualised. The feed's own round history measures ${(realised.sigma * 100).toFixed(1)}% over the last ${Math.round(realised.spanSeconds / 3_600)}h.`
                : (realisedUnavailable ??
                  'How much movement the offer is priced for, annualised. Sell below what the market actually does and an arbitrageur takes more than the decay pays.')
            }
            value={vol}
            onChange={(next) => onVolChange(String(next))}
            suffix="%"
            min={1}
            max={400}
            step={5}
            decimalScale={1}
            size="sm"
            radius="lg"
            mb="xs"
          />
          {realised && !volIsMeasured ? (
            <Text size="xs" mb="sm">
              <Anchor component="button" type="button" onClick={onUseMeasured}>
                Use the measured {(realised.sigma * 100).toFixed(1)}%
              </Anchor>
            </Text>
          ) : null}

          <Row label="Strike, K" value={offer ? formatUnits(offer.rmm.strikeWad, 18, { significantDigits: 12, maxFractionDigits: 2 }) : '—'} />
          <Row label="Expiry" value={maturity !== undefined ? formatExpiry(maturity) : '—'} />
          <Row
            label="Assignment window closes"
            value={offer ? formatExpiry(offer.rmm.maturity + 1_800) : '—'}
          />
          <Row
            label="Notional, L"
            value={
              offer && pair
                ? `${formatUnits(offer.rmm.liquidityWad, 18, { significantDigits: 10 })} ${pair.risky.symbol}`
                : '—'
            }
          />
          <Row
            label="Reserves shipped"
            value={
              offer && pair
                ? `${formatUnits(offer.xWad, 18, { significantDigits: 10 })} ${pair.risky.symbol} · ${formatUnits(offer.yWad, 18, { significantDigits: 12, maxFractionDigits: 2 })} ${pair.stable.symbol}`
                : '—'
            }
          />
          <Row
            label="At expiry the curve holds"
            value={
              offer && pair
                ? `${formatUnits(offer.settlementWad, 18, { significantDigits: 12, maxFractionDigits: 2 })} ${pair.stable.symbol}`
                : '—'
            }
          />
          <Row
            label="Smallest trade that clears"
            value={
              band && pair
                ? `${formatUnits(band.minStableIn, 18, { significantDigits: 6, maxFractionDigits: 4 })} ${pair.stable.symbol} in · ${formatUnits(band.minRiskyIn, 18, { significantDigits: 6 })} ${pair.risky.symbol} in`
                : open
                  ? 'reading…'
                  : '—'
            }
          />
          <Row
            label="Your wallet can deliver"
            value={
              pair && free[pair.risky.address.toLowerCase()] !== undefined
                ? `${formatUnits(free[pair.risky.address.toLowerCase()], pair.risky.decimals, { significantDigits: 10 })} ${pair.risky.symbol} · ${formatUnits(free[pair.stable.address.toLowerCase()] ?? BigInt(0), pair.stable.decimals, { significantDigits: 12, maxFractionDigits: 2 })} ${pair.stable.symbol}`
                : open
                  ? 'reading…'
                  : '—'
            }
          />
          <Row label="Strategy hash" value={offer ? truncateHash(offer.strategyHash) : '—'} />

          {offer ? (
            <>
              <Text size="xs" c="dimmed" mt="sm" lh={1.5}>
                The compiled program, {(offer.program.length - 2) / 2} bytes. Aqua stores the strategy whole
                rather than pre-hashed, for data availability, so the price, the date and the size below
                are public on chain and anyone can quote this offer without an order book beside the app.
              </Text>
              <code className={classes.bytes}>{offer.program}</code>
              <Text size="xs" mt={6}>
                <CopyButton value={offer.program}>
                  {({ copied, copy }) => (
                    <Anchor component="button" type="button" onClick={copy}>
                      {copied ? 'Copied' : 'Copy the bytes'}
                    </Anchor>
                  )}
                </CopyButton>
              </Text>
            </>
          ) : null}

          <Text size="xs" c="dimmed" mt="sm" lh={1.5}>
            Every figure on this card is a call to the router: <code>stableFor</code> for the reserve and
            for the settlement value, <code>bandFor</code> for the spread, <code>coverage</code> for what
            the wallet can deliver. There is no pricing model in this page.
          </Text>
        </div>
      </Collapse>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={classes.detailRow}>
      <span className={classes.detailKey}>{label}</span>
      <span className={classes.detailValue}>{value}</span>
    </div>
  );
}
