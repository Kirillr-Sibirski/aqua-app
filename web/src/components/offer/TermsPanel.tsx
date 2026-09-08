'use client';

/**
 * The exact terms, in the words a trader would use, behind a disclosure.
 *
 * This is the half of the jargon policy that is not "say it plainly": once someone has opened a
 * section called *the exact terms*, they have asked for the precise word and hiding it from them
 * would be the condescending choice. Strike, implied volatility, liquidity, tau and the raw bytes
 * live here, each next to the plain phrase used for it upstairs.
 *
 * Every value is decoded from the offer's own published program, not stored beside the app.
 */
import { Anchor, Stack, Text } from '@mantine/core';
import { ProgramInspector, formatDuration } from '@/components/curve';
import { formatExpiry } from '@/components/sell/expiry';
import { addressUrl, explorerFor, isForkOfBase } from '@/components/shell';
import { formatPercent, formatUnits, truncateAddress } from '@/lib/ui';
import { Row } from './bits';
import type { Offer } from './useOffer';

export interface TermsPanelProps {
  offer: Offer;
  /** `tauNow` straight from the router, WAD years. */
  tauWad?: bigint;
  chainId?: number;
}

export function TermsPanel({ offer, tauWad, chainId }: TermsPanelProps) {
  const explorer = explorerFor(chainId);
  const linkable = explorer && !isForkOfBase(chainId);
  const { rmm, risky, stable } = offer;

  // Where on its own curve the offer is sitting, as a fraction of L. Under a half means most of the
  // risky side has already been sold; a fresh call sits high.
  const onCurve =
    rmm.liquidityWad > BigInt(0)
      ? Number((offer.xWad * BigInt(10_000)) / rmm.liquidityWad) / 10_000
      : undefined;

  return (
    <Stack gap="md">
      <dl className="flex flex-col">
        <Row label="Strike, K">
          {formatUnits(rmm.strikeWad, 18, { significantDigits: 18, maxFractionDigits: 2 })}{' '}
          <span className="text-ink-3">{stable.symbol}</span>
        </Row>
        <Row label="Implied volatility, sigma">
          {formatPercent(Number(rmm.sigmaWad) / 1e18, { fractionDigits: 2 })}
        </Row>
        <Row label="Liquidity, L">
          {formatUnits(rmm.liquidityWad, 18, { significantDigits: 10 })}{' '}
          <span className="text-ink-3">{risky.symbol}</span>
        </Row>
        <Row label="Maturity">{formatExpiry(rmm.maturity)}</Row>
        <Row label="Time to expiry">
          {offer.remainingSeconds === undefined ? '—' : formatDuration(offer.remainingSeconds)}
        </Row>
        <Row label="tau, from the router">
          {tauWad === undefined ? '—' : `${(Number(tauWad) / 1e18).toFixed(6)} y`}
        </Row>
        <Row label="Reserves, X / Y">
          {formatUnits(offer.riskyRaw, risky.decimals, { significantDigits: 10 })}{' '}
          <span className="text-ink-3">{risky.symbol}</span>
          <span className="mx-1.5 text-ink-3">/</span>
          {formatUnits(offer.stableRaw, stable.decimals, { significantDigits: 12 })}{' '}
          <span className="text-ink-3">{stable.symbol}</span>
        </Row>
        <Row label="X / L">{onCurve === undefined ? '—' : onCurve.toFixed(4)}</Row>
        <Row label="Settlement">
          {offer.kind === 'call'
            ? 'one-way, taker receives the risky asset'
            : offer.kind === 'put'
              ? 'one-way, taker receives the stable asset'
              : 'two-way after expiry'}
        </Row>
        <Row label="Maker">
          {linkable && explorer ? (
            <Anchor
              href={addressUrl(explorer, offer.strategy.maker)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-meta tnum"
            >
              {truncateAddress(offer.strategy.maker)}
            </Anchor>
          ) : (
            truncateAddress(offer.strategy.maker)
          )}
        </Row>
      </dl>

      <Text size="xs" c="var(--ink-3)" className="leading-prose">
        By put-call parity the same 62 bytes are both a covered call and a cash-secured put:{' '}
        <span className="font-mono">V(S) = L·(S − C_BS) = L·(K − P_BS)</span>. Which one the maker is
        holding was decided only by whether the reserves started risky-heavy or stable-heavy. The
        one-way flags above are what the instruction enforces in the assignment window, so they are
        the honest answer to which it is.
      </Text>

      <ProgramInspector program={offer.strategy.program} strategyHash={offer.strategy.strategyHash} />
    </Stack>
  );
}
