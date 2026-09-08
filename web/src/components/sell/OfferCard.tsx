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
import { Alert, Button, Loader, NumberInput, Skeleton, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useCallback, useMemo, useState } from 'react';
import { useBlock, useConnection } from 'wagmi';
import { useDeploymentChain, useIsHydrated } from '@/components/shell';
import { useDeployments, useOraclePrice, useTokenBalances } from '@/hooks';
import { aquaFork } from '@/lib/chain';
import { addressLt } from '@/lib/swapvm';
import { explainError, formatUnits, parseDecimalInput, toDecimalString } from '@/lib/ui';
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
import { FALLBACK_VOL, MIN_VOL_SPAN_SECONDS, useRealisedVol } from './useRealisedVol';
import { ConnectModal, NetworkNotice } from './WalletButton';

/** How far above today's price the card opens. A price below it would be taken immediately. */
const DEFAULT_OVER_SPOT = 0.05;

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
  // Grouped and two-placed from the feed's own integer answer, not from the float beside it: this
  // is the number the person is comparing their price against and it should read like money.
  const spotLabel = oracle.price
    ? formatUnits(oracle.price.answer, oracle.price.decimals, {
        significantDigits: 14,
        maxFractionDigits: 2,
        minFractionDigits: 2,
      })
    : undefined;

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

  /**
   * What the field opens at, and why it is never blank.
   *
   * With a wallet: the whole balance, floored at the eighth place. Nothing moves when an offer is
   * published and it can be withdrawn at any moment, so offering all of it is a real default rather
   * than a dare — and the line above the button now says both of those things.
   *
   * Without one: 1. `stableFor` is a view and needs no signer, so the card can price a real offer
   * for a visitor who has connected nothing, and it should — a swap page that quotes you before you
   * connect is the reason you stay on it. One unit is the amount that makes the two lines under the
   * fields read as a rate.
   */
  const defaultAmount =
    riskyBalance !== undefined && pair ? roundedDown(riskyBalance, pair.risky.decimals) : '1';
  const amount = amountDraft ?? defaultAmount;

  const defaultPrice = spot === undefined ? '' : String(strikeFrom(spot, DEFAULT_OVER_SPOT));
  const price = priceDraft ?? defaultPrice;

  const defaultDate = nowSeconds === undefined ? null : dateStringFor(nextFridayAfter(nowSeconds));
  const dateValue = dateDraft ?? defaultDate;
  const maturity = maturityForDateString(dateValue);

  const volSpanIsEnough = !!realised.vol && realised.vol.spanSeconds >= MIN_VOL_SPAN_SECONDS;
  const measuredVol = volSpanIsEnough ? (realised.vol!.sigma * 100).toFixed(1) : undefined;
  const vol = volDraft ?? measuredVol ?? FALLBACK_VOL;

  const amountRaw = pair ? (parseDecimalInput(amount, pair.risky.decimals) ?? BigInt(0)) : BigInt(0);
  const overBalance = riskyBalance !== undefined && amountRaw > riskyBalance;

  /**
   * What the chain is asked to price, which is never an offer that cannot be published.
   *
   * Typing more than the wallet holds used to send the typed number straight through, so the most
   * motivating line on the card advertised a five-figure payout for a trade the button was already
   * refusing — a quote for something that does not exist, on a page whose whole claim is that every
   * number is a chain read of something that does. The quote is clamped to the balance instead, the
   * outcome block is dimmed and says so, and the button says what to type.
   */
  const quotedRaw = overBalance && riskyBalance !== undefined ? riskyBalance : amountRaw;
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
    amountRaw: quotedRaw,
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

  // Plain, not memoised: the React Compiler holds it steady, and a manual dependency list here was
  // one it declined to preserve.
  const sentence = describeOffer({ offer, pair, strikeWad, maturity });

  /*
   * Plain functions rather than `useCallback`/`useMemo`.
   *
   * The React Compiler memoizes both automatically, and once the quote is clamped to the balance it
   * declines to preserve the hand-written dependency lists — a skipped compilation for the whole
   * component, which costs more than the lists were buying.
   */
  const onPublish = async () => {
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
  };

  const onAgain = useCallback(() => {
    setPublished(undefined);
    publisher.reset();
  }, [publisher]);

  // --- what the button is, right now ---------------------------------------

  const wrongNetwork = hydrated && !!address && walletChainId !== deployment.chainId;
  const priceNumber = Number(price);
  const belowSpot = spot !== undefined && Number.isFinite(priceNumber) && priceNumber > 0 && priceNumber <= spot;

  const blocked = ((): string | undefined => {
    if (!hydrated || deploymentsLoading) return 'Loading';
    if (!pair) return 'No deployment to publish against';
    if (amountRaw <= BigInt(0)) return 'Enter an amount';
    // An instruction, not a balance. `roundedDown` rather than `formatUnits` so the number here and
    // the one in the field's own caption four lines above are produced by the same function: they
    // used to be 9.3364125 and 9.33641248, which reads as a bug.
    if (overBalance && pair && riskyBalance !== undefined)
      return `Enter ${roundedDown(riskyBalance, pair.risky.decimals)} or less`;
    if (strikeWad === undefined || strikeWad <= BigInt(0)) return 'Enter a price';
    if (belowSpot) return `Name a price above ${spotLabel}`;
    if (sigmaWad === undefined) return 'Set the movement under Details';
    // Without a spot there is no reserve point to choose `L` at, so no offer is ever produced and
    // the branch below would sit on "Pricing it on chain" forever, describing an activity that is
    // not happening. The button names the blocker instead.
    if (spot === undefined) return oracle.error ? "Today's price could not be read" : "Reading today's price";
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
        ? `${active.label} · confirm in your wallet`
        : `${active.label} · waiting for the chain`;
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
              You hold {roundedDown(riskyBalance, pair.risky.decimals)} {pair.risky.symbol}
            </>
          ) : hydrated && address ? (
            'Reading your balance'
          ) : (
            // Not "connect a wallet" — the card has already priced this amount against the chain
            // and the two lines below it are real. What is missing is the balance, not the quote.
            'Priced for anyone. Connect to publish it.'
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
          // The field steps down a size rather than scrolling: at 390px a fourteen-character amount
          // scrolled its own left edge out of view, so the card displayed a different number than
          // the one that had just been typed.
          classNames={{ input: classes.bigInput }}
          data-len={amount.length > 17 ? 'xl' : amount.length > 11 ? 'l' : undefined}
          value={amount}
          onChange={(next) => setAmountDraft(String(next))}
          placeholder="0"
          min={0}
          hideControls
          allowNegative={false}
          decimalScale={pair?.risky.decimals ?? 18}
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
            `That is at or below today's ${spotLabel}`
          ) : (
            <>
              {(moneynessOf(priceNumber, spot) * 100).toFixed(1)}% above today&rsquo;s {spotLabel}
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
        clamped={overBalance}
      />

      {hydrated && address && wrongNetwork ? (
        <div style={{ padding: '0 0.125rem 0.5rem' }}>
          <NetworkNotice />
        </div>
      ) : null}

      {sizingError ? (
        <Alert color="ember" variant="light" radius="lg" mb="xs">
          {/* The decoded custom error, not viem's generic restatement of it: an offer the router
              refuses to size refuses with `RmmOutOfDomain` or `RmmInsideSpread`, and the name is
              the whole answer. */}
          <Text size="sm">The chain refused to price this offer: {explainError(sizingError)}</Text>
        </Alert>
      ) : null}

      {/* The sentence that answers the question that stops a first-timer, in the place they ask it.
          It used to appear once, on the receipt, which is exactly backwards: the reassurance has to
          land before the commitment, not after it. */}
      <p className={classes.assurance}>
        Your {pair?.risky.symbol ?? 'ETH'} stays in your wallet. Nothing moves until somebody takes
        the offer, and you can take it down at any time.
      </p>

      {/* Not Mantine's `loading`, which swaps the label for a spinner: the label is the only place
          that says which of the three transactions is live and whether it is waiting on the wallet
          or on the chain, and that is exactly the moment it is worth reading. A leading loader and
          a class that stops clicks give the same guarantee without taking the sentence away. */}
      <Button
        className={classes.action}
        data-busy={running || undefined}
        fullWidth
        size="lg"
        radius="lg"
        leftSection={running ? <Loader size={18} color="var(--accent-ink)" /> : undefined}
        disabled={!running && hydrated && !!address && !wrongNetwork && !!blocked}
        onClick={() => {
          if (running) return;
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
        realisedUsable={volSpanIsEnough}
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
  strikeWad,
  maturity,
}: {
  offer?: SizedOffer;
  pair?: OfferPair;
  strikeWad?: bigint;
  maturity?: number;
}): string {
  if (!offer || !pair || maturity === undefined || strikeWad === undefined) {
    return 'Your offer is published.';
  }
  const amount = formatUnits(offer.xWad, 18, { significantDigits: 12 });
  const at = formatUnits(strikeWad, 18, {
    significantDigits: 14,
    maxFractionDigits: 2,
    minFractionDigits: 2,
  });
  return `Sell ${amount} ${pair.risky.symbol} if it reaches ${at} ${pair.stable.symbol} by ${formatByWhen(maturity)}.`;
}

/**
 * A balance as an amount someone would type: truncated at the eighth place, never rounded up.
 *
 * Rounding up produces a default the wallet cannot cover, and the failure would land as a refused
 * quote weeks later rather than as a message now. The hint beside the field is rendered through
 * this same helper rather than through `formatUnits`, which rounds: the two numbers sit one line
 * apart and disagreeing in the last digit reads as a bug, where a floor of one part in a hundred
 * million reads as nothing at all.
 */
function roundedDown(raw: bigint, decimals: number, places = 8): string {
  const step = BigInt(10) ** BigInt(Math.max(0, decimals - places));
  return toDecimalString((raw / step) * step, decimals);
}
