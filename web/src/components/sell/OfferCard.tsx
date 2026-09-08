'use client';

/**
 * The card. This is the product.
 *
 * Three fields and one button. Read top to bottom they form a sentence — *sell 10.4 WETH if it
 * reaches 2,600 by Fri 11 Sep* — and all three arrive pre-filled from the chain, so a person who
 * agrees with the defaults can publish without touching a control. Nothing on this surface says
 * strike, notional, implied volatility or leg; those words are correct and they are two clicks
 * away, under *Details*, where someone has asked for them.
 *
 * Every number is read from somewhere real:
 *
 *   how much      the wallet's own balance          `useTokenBalances` (a `balanceOf` multicall)
 *   what price    5% over today's, rounded          the Chainlink feed the manifest names
 *   by when       the next Friday, 08:00 UTC        the chain's block clock, never the browser's
 *   what you earn `stableFor` twice, differenced    `StrikelineViews` on the router
 *   what you risk the same two numbers              — as above
 *
 * Defaults are *derived*, not copied into state on arrival: `amountDraft ?? defaultAmount`. There is
 * therefore no render in which the field disagrees with where its number came from, no effect that
 * overwrites something typed a frame earlier, and no flash of an empty form.
 */
import { Alert, Button, NumberInput, Skeleton, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useCallback, useMemo, useState } from 'react';
import { useBlock, useConnection } from 'wagmi';
import { useDeploymentChain, useIsHydrated } from '@/components/shell';
import { useDeployments, useOraclePrice, useTokenBalances } from '@/hooks';
import { aquaFork } from '@/lib/chain';
import { addressLt } from '@/lib/swapvm';
import { formatUnits, parseDecimalInput, toDecimalString } from '@/lib/ui';
import { Details } from './Details';
import { Field } from './Field';
import { Outcome } from './Outcome';
import { Published } from './Published';
import {
  dateStringFor,
  daysUntil,
  formatByWhen,
  maturityForDateString,
  nextFridayAfter,
} from './expiry';
import { moneynessOf, strikeFrom } from './moneyness';
import classes from './sell.module.css';
import type { OfferPair, SizedOffer } from './types';
import { useOffer } from './useOffer';
import { usePublishOffer, type PublishResult } from './usePublish';
import { useRealisedVol } from './useRealisedVol';
import { ConnectModal, NetworkNotice } from './WalletButton';

/** How far above today's price the card opens. A price below it would be taken immediately. */
const DEFAULT_OVER_SPOT = 0.05;

/**
 * Where the volatility opens before the feed's history has been read.
 *
 * The one figure on the card that is not a chain read, so it does not get to pass for one: the
 * moment `useRealisedVol` returns a measurement this is replaced by it, and *Details* says which of
 * the two the field is showing. Someone who types their own number owns it from that keystroke on.
 */
const FALLBACK_VOL = '60';

export function OfferCard() {
  const hydrated = useIsHydrated();
  const { address, chainId: walletChainId } = useConnection();
  const { deployments, isLoading: deploymentsLoading, error: deploymentsError } = useDeployments();
  const deployment = useDeploymentChain();

  const pair = useMemo<OfferPair | undefined>(
    () =>
      deployments
        ? {
            risky: { address: deployments.weth, symbol: 'WETH', decimals: 18 },
            stable: { address: deployments.usdc, symbol: 'USDC', decimals: 6 },
            feed: deployments.chainlink.ethUsd,
            riskyIsTokenA: addressLt(deployments.weth, deployments.usdc),
          }
        : undefined,
    [deployments],
  );

  // The chain's clock, never the browser's: the demo fork is warped forward, and a date counted
  // against `Date.now()` would be wrong by days on it.
  const block = useBlock({ chainId: aquaFork.id, watch: true, query: { staleTime: 4_000 } });
  const nowSeconds = block.data ? Number(block.data.timestamp) : undefined;

  const oracle = useOraclePrice(pair?.feed, { chainId: aquaFork.id });
  const spot = oracle.price?.price;

  const tokens = useMemo(
    () => (pair ? [pair.risky.address, pair.stable.address] : []),
    [pair],
  );
  const balances = useTokenBalances(address, tokens, { chainId: aquaFork.id, includeNative: false });
  const riskyBalance = balances.balances.find((b) => b.token === pair?.risky.address)?.balance;

  const realised = useRealisedVol(pair?.feed, { chainId: aquaFork.id });

  // --- the three fields, defaulted rather than initialised ------------------

  const [amountDraft, setAmountDraft] = useState<string>();
  const [priceDraft, setPriceDraft] = useState<string>();
  const [dateDraft, setDateDraft] = useState<string | null>();
  const [volDraft, setVolDraft] = useState<string>();

  const defaultAmount =
    riskyBalance !== undefined && pair ? roundedDown(riskyBalance, pair.risky.decimals) : '';
  const amount = amountDraft ?? defaultAmount;

  const defaultPrice = spot === undefined ? '' : String(strikeFrom(spot, DEFAULT_OVER_SPOT));
  const price = priceDraft ?? defaultPrice;

  const defaultDate = nowSeconds === undefined ? null : dateStringFor(nextFridayAfter(nowSeconds));
  const dateValue = dateDraft ?? defaultDate;
  const maturity = maturityForDateString(dateValue);

  const measuredVol = realised.vol ? (realised.vol.sigma * 100).toFixed(1) : undefined;
  const vol = volDraft ?? measuredVol ?? FALLBACK_VOL;

  const amountRaw = pair ? (parseDecimalInput(amount, pair.risky.decimals) ?? BigInt(0)) : BigInt(0);
  const strikeWad = parseDecimalInput(price, 18) ?? undefined;
  const volWad = parseDecimalInput(vol, 18);
  const sigmaWad = volWad === null || volWad <= BigInt(0) ? undefined : volWad / BigInt(100);

  /**
   * The salt, anchored once per page load.
   *
   * A maker-owned monotonic nonce is what makes the strategy hash unique, and `Aqua.dock` writes a
   * docked hash off permanently — so it must never repeat, and it must not move while the offer is
   * being looked at, or the hash under *Details* would change under the reader every block. Anchored
   * lazily at mount and bumped once a publish lands, so publishing the same terms twice in a session
   * produces two shippable offers rather than a second `ship` that reverts.
   *
   * This is the one place the browser's clock is allowed anywhere near a shipped byte, and it is
   * allowed because a salt is an arbitrary number: it never reaches a price, a date or a size. The
   * chain's clock would be worse here — it is stable across a page reload, and two loads with the
   * same terms would collide.
   */
  const [saltAnchor] = useState(() => BigInt(Date.now()));
  const [nonce, setNonce] = useState(0);
  const salt = saltAnchor * BigInt(1_000) + BigInt(nonce);

  // --- the chain prices it -------------------------------------------------

  const { offer, isLoading: sizingLoading, error: sizingError } = useOffer({
    router: deployments?.router,
    maker: address,
    pair,
    amountRaw,
    strikeWad,
    sigmaWad,
    maturity,
    spot,
    nowSeconds,
    salt,
  });

  // --- publishing ----------------------------------------------------------

  const publisher = usePublishOffer();
  const [published, setPublished] = useState<{ result: PublishResult; sentence: string }>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const sentence = useMemo(
    () => describeOffer({ offer, pair, price, maturity }),
    [offer, pair, price, maturity],
  );

  const onPublish = useCallback(async () => {
    if (!deployments || !pair || !offer) return;
    try {
      const result = await publisher.publish({
        aqua: deployments.aqua,
        router: deployments.router,
        pair,
        offer,
      });
      setPublished({ result, sentence });
      setNonce((n) => n + 1);
    } catch {
      // `useTxFlow` recorded which step failed and why; the strip below the button renders it.
    }
  }, [deployments, pair, offer, publisher, sentence]);

  const onAgain = useCallback(() => {
    setPublished(undefined);
    publisher.reset();
  }, [publisher]);

  // --- what the button is, right now ---------------------------------------

  const wrongNetwork = hydrated && !!address && walletChainId !== deployment.chainId;
  const overBalance = riskyBalance !== undefined && amountRaw > riskyBalance;
  const priceNumber = Number(price);
  const belowSpot = spot !== undefined && Number.isFinite(priceNumber) && priceNumber > 0 && priceNumber <= spot;

  const blocked = ((): string | undefined => {
    if (!hydrated || deploymentsLoading) return 'Loading';
    if (!pair) return 'No deployment to publish against';
    if (amountRaw <= BigInt(0)) return 'Enter an amount';
    if (overBalance && pair)
      return `You hold ${formatUnits(riskyBalance ?? BigInt(0), pair.risky.decimals, { significantDigits: 8 })} ${pair.risky.symbol}`;
    if (strikeWad === undefined || strikeWad <= BigInt(0)) return 'Enter a price';
    if (belowSpot) return `Name a price above ${spot?.toFixed(2)}`;
    if (sigmaWad === undefined) return 'Set the movement under Details';
    if (!offer) return sizingLoading || !sizingError ? 'Pricing it on chain' : 'Could not price this';
    return undefined;
  })();

  const running = publisher.isRunning;
  const active = publisher.steps.find((s) => s.status === 'signing' || s.status === 'pending');
  const label = (() => {
    if (!hydrated) return 'Publish offer';
    if (!address) return 'Connect wallet';
    if (wrongNetwork) return `Switch to ${deployment.name}`;
    if (running && active) {
      return active.status === 'signing'
        ? `${active.label} — confirm in your wallet`
        : `${active.label} — waiting for the chain`;
    }
    if (blocked) return blocked;
    return 'Publish offer';
  })();

  // --- render --------------------------------------------------------------

  if (deploymentsError) {
    return (
      <div className={classes.card}>
        <Alert color="ember" variant="light" radius="lg" title="No deployment manifest">
          <Text size="sm">
            There is no router to publish against. Run <code>make bootstrap</code> and reload.
          </Text>
        </Alert>
      </div>
    );
  }

  if (published) {
    return (
      <div className={classes.card}>
        <Published result={published.result} sentence={published.sentence} onAgain={onAgain} />
      </div>
    );
  }

  return (
    <div className={classes.card}>
      <Field
        label="Sell"
        unit={pair?.risky.symbol ?? <Skeleton height={12} width={40} />}
        invalid={overBalance}
        hint={
          hydrated && riskyBalance !== undefined && pair ? (
            <>
              You hold {formatUnits(riskyBalance, pair.risky.decimals, { significantDigits: 8 })}{' '}
              {pair.risky.symbol}
            </>
          ) : hydrated && address ? (
            'Reading your balance'
          ) : (
            'Connect a wallet to sell your own'
          )
        }
        action={
          riskyBalance !== undefined && pair && riskyBalance > BigInt(0) ? (
            <button
              type="button"
              className={classes.maxButton}
              onClick={() => setAmountDraft(roundedDown(riskyBalance, pair.risky.decimals))}
            >
              Max
            </button>
          ) : null
        }
      >
        <NumberInput
          aria-label="How much to sell"
          variant="unstyled"
          classNames={{ input: classes.bigInput }}
          value={amount}
          onChange={(next) => setAmountDraft(String(next))}
          placeholder="0"
          min={0}
          hideControls
          allowNegative={false}
          decimalScale={pair?.risky.decimals ?? 18}
          thousandSeparator=","
          style={{ flex: '1 1 auto', minWidth: 0 }}
        />
      </Field>

      <div style={{ height: 6 }} />

      <Field
        label="if it reaches"
        unit={pair?.stable.symbol ?? <Skeleton height={12} width={40} />}
        invalid={belowSpot}
        hint={
          spot === undefined ? (
            oracle.error ? (
              "Today's price could not be read"
            ) : (
              "Reading today's price"
            )
          ) : belowSpot ? (
            `That is at or below today's ${spot.toFixed(2)}`
          ) : (
            <>
              {(moneynessOf(priceNumber, spot) * 100).toFixed(1)}% above today&rsquo;s {spot.toFixed(2)}
            </>
          )
        }
      >
        <NumberInput
          aria-label="The price you would sell at"
          variant="unstyled"
          classNames={{ input: classes.bigInput }}
          value={price}
          onChange={(next) => setPriceDraft(String(next))}
          placeholder="0"
          min={0}
          hideControls
          allowNegative={false}
          decimalScale={2}
          thousandSeparator=","
          style={{ flex: '1 1 auto', minWidth: 0 }}
        />
      </Field>

      <div style={{ height: 6 }} />

      <Field
        label="by"
        hint={
          maturity !== undefined && nowSeconds !== undefined
            ? `${daysUntil(maturity, nowSeconds)} days away, 08:00 UTC`
            : 'Reading the chain clock'
        }
      >
        <div className={classes.dateWrap}>
          <DatePickerInput
            aria-label="When the offer runs to"
            variant="unstyled"
            classNames={{ input: classes.dateInput }}
            value={dateValue}
            onChange={(next) => setDateDraft(typeof next === 'string' ? next : null)}
            valueFormat="ddd D MMM"
            placeholder="pick a date"
            minDate={nowSeconds !== undefined ? dateStringFor(nowSeconds + 86_400) : undefined}
            maxDate={nowSeconds !== undefined ? dateStringFor(nowSeconds + 180 * 86_400) : undefined}
            popoverProps={{ radius: 'lg', shadow: 'md' }}
          />
        </div>
      </Field>

      <Outcome
        offer={offer}
        riskySymbol={pair?.risky.symbol ?? ''}
        stableSymbol={pair?.stable.symbol ?? ''}
        riskyDecimals={pair?.risky.decimals ?? 18}
        strikeWad={strikeWad}
        loading={sizingLoading && !sizingError}
      />

      {hydrated && address && wrongNetwork ? (
        <div style={{ padding: '0 0.125rem 0.5rem' }}>
          <NetworkNotice />
        </div>
      ) : null}

      {sizingError ? (
        <Alert color="ember" variant="light" radius="lg" mb="xs">
          <Text size="sm">The chain refused to price this offer: {sizingError.message.split('\n')[0]}</Text>
        </Alert>
      ) : null}

      <Button
        className={classes.action}
        fullWidth
        size="lg"
        radius="lg"
        loading={running}
        disabled={hydrated && !!address && !wrongNetwork && (!!blocked || running)}
        onClick={() => {
          if (!address) {
            setConnectOpen(true);
            return;
          }
          void onPublish();
        }}
      >
        {label}
      </Button>

      {publisher.steps.length > 0 ? <Steps steps={publisher.steps} /> : null}

      {publisher.error ? (
        <Text size="xs" c="var(--neg)" mt={8} px={4} role="alert">
          {publisher.error}
        </Text>
      ) : null}

      <Details
        open={detailsOpen}
        onToggle={() => setDetailsOpen((v) => !v)}
        offer={offer}
        pair={pair}
        router={deployments?.router}
        maker={address}
        maturity={maturity}
        vol={vol}
        onVolChange={setVolDraft}
        realised={realised.vol}
        realisedUnavailable={realised.unavailable}
        volIsMeasured={volDraft === undefined && measuredVol !== undefined}
        onUseMeasured={() => setVolDraft(undefined)}
      />

      <ConnectModal opened={connectOpen} onClose={() => setConnectOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * What the click is doing, while it does it.
 *
 * A publish is one action to the person pressing the button and up to three transactions to the
 * chain: an allowance per token, then the ship. The approvals usually resolve to nothing — the step
 * reads the allowance first and sends no transaction when it is already sufficient — so the strip
 * marks them done rather than pretending a signature was needed.
 */
function Steps({ steps }: { steps: readonly { id: string; label: string; status: string }[] }) {
  return (
    <ol className={classes.steps}>
      {steps.map((step) => (
        <li key={step.id} className={classes.step} data-state={stateOf(step.status)}>
          <span className={classes.stepBar} />
          <span>
            {step.label}
            {step.status === 'skipped' ? ' · already allowed' : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

function stateOf(status: string): string {
  if (status === 'signing' || status === 'pending') return 'running';
  if (status === 'success' || status === 'skipped') return 'done';
  if (status === 'reverted' || status === 'error') return 'failed';
  return 'idle';
}

/** The sentence the card just made, for the result panel to restate. */
function describeOffer({
  offer,
  pair,
  price,
  maturity,
}: {
  offer?: SizedOffer;
  pair?: OfferPair;
  price: string;
  maturity?: number;
}): string {
  if (!offer || !pair || maturity === undefined) return 'Your offer is published.';
  const amount = formatUnits(offer.xWad, 18, { significantDigits: 10 });
  return `Sell ${amount} ${pair.risky.symbol} if it reaches ${price} ${pair.stable.symbol} by ${formatByWhen(maturity)}.`;
}

/**
 * A balance as an amount someone would type: truncated, never rounded up.
 *
 * Rounding a balance up produces a default the wallet cannot cover, and the failure would land as a
 * refused quote weeks later rather than as a validation message now.
 */
function roundedDown(raw: bigint, decimals: number, places = 6): string {
  const step = BigInt(10) ** BigInt(Math.max(0, decimals - places));
  return toDecimalString((raw / step) * step, decimals);
}
