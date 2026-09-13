'use client';

/**
 * The ticket. Four controls, three figures, one button, and not one sentence.
 *
 * This is `sell/OfferCard` with the teaching removed. What it does not do has not changed: the
 * amount is what ships as the risky reserve, the strike and the date are arguments to the curve,
 * and the stable side is `StrikelineViews.stableFor` read from the router — never computed here.
 * All of that lives in `useTicketDraft`, which the screen owns so the chart beside this can draw
 * the same leg; this file is layout and nothing else.
 *
 *   amount     the wallet's balance, floored at the eighth place   `useTokenBalances`
 *   strike     5% over the feed's answer, rounded                  the Chainlink feed
 *   expiry     the next Friday, 08:00 UTC                          the chain's block clock
 *   IV         trailing realised vol off the feed, or the maker's  `useRealisedVol`
 *   premium    `stableFor` at the date, minus at settlement        `StrikelineViews`
 *   capped at  strike + premium / amount                           — as above
 *
 * IV is the fourth control, and the layout spec's "three controls" is now three plus it. It was drawn as
 * a bare 21px figure that grew a rule on hover, on the theory that a spec saying three should not
 * grow a fourth; the result was that the one number on this ticket the chain cannot supply — the
 * one the product brief says makers want to be theirs — was the only input on the screen a person could
 * not see was an input, and it failed the 24px target size on a phone, where there is no hover to
 * reveal it with. It gets the same well the other three have.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader, NumberInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { Minus, Plus } from 'lucide-react';
import { formatProtocolFee } from '@/components/curve';
import { formatOverSpot } from '@/components/charts/format';
import { dateStringFor, maturityAt, type OfferPair } from '@/components/sell';
import { TokenAmount, TokenIcon } from '@/components/token';
import { Reveal, useTweenedBigInt } from '@/lib/motion';
import { explainError, formatTenor } from '@/lib/ui';
import { Bar, FigureRow } from './bits';
import { Explain, Labelled } from './Explain';
import classes from './terminal.module.css';
import type { TicketDraft } from './useTicketDraft';

/** The three tenors on chips. Anything else is the date field. */
const TENORS = [
  { days: 7, label: '1w' },
  { days: 14, label: '2w' },
  { days: 30, label: '1m' },
] as const;

export interface TicketProps {
  /** The skip link's target: this element is the grid item, so it is what gets the id. */
  id?: string;
  draft: TicketDraft;
  pair?: OfferPair;
  /** The chain's clock, seconds, from the block every other figure was read at. */
  nowSeconds?: number;
  address?: string;
  /** True when the wallet is attached but on a different chain than the manifest names. */
  wrongNetwork?: boolean;
  hydrated: boolean;
  /** Called once a publish run finishes, so the positions strip re-reads. */
  onPublished?: () => void;
  /** Opens the wallet picker. The ticket does not own a modal. */
  onConnect?: () => void;
  /** Moves the wallet to the chain the manifest names. Absent when wagmi is not configured for it. */
  onSwitchNetwork?: () => void;
}

export function Ticket({
  id,
  draft,
  pair,
  nowSeconds,
  address,
  wrongNetwork = false,
  hydrated,
  onPublished,
  onConnect,
  onSwitchNetwork,
}: TicketProps) {
  const riskySymbol = pair?.risky.symbol;
  const stableSymbol = pair?.stable.symbol;
  const buying = draft.side === 'buy';
  /* The token the amount field is in: what this side puts on offer. */
  const offeredSymbol = buying ? stableSymbol : riskySymbol;
  const { publisher } = draft;
  const running = publisher.isRunning;
  const active = publisher.steps.find((s) => s.status === 'signing' || s.status === 'pending');
  const steps = useStepsInView(publisher.steps.length);
  const actionRef = useRef<HTMLButtonElement>(null);
  const placed = useOfferPlaced();

  /*
   * The two figures, moving.
   *
   * These are the numbers a maker is actually steering: raising the strike lowers the premium and
   * raises the cap, and stepping the volatility does the opposite. Replacing one string with
   * another between two frames says a number is different; travelling from one to the other says
   * which way the control the maker just touched pushed it, which is the entire reason the control
   * is there. What is tweened is the router's own WAD integer, so every frame is a quantity
   * `stableFor` could have returned and the last one is the quantity it did.
   */
  const quote = useHeldQuote(draft);
  const premiumWad = useTweenedBigInt(quote?.premium);
  const premiumInRisky =
    buying && premiumWad !== undefined && riskySymbol
      ? formatOverSpot(Number(premiumWad) / 1e18, draft.spot, 4)
      : undefined;
  const cappedWad = useTweenedBigInt(quote?.capped);
  /* A quote the router refused is a figure that is never coming, so it says so instead of shimmering. */
  const quoteRefused =
    quote === undefined && !draft.sizing.isLoading && draft.sizing.error ? 'router refused this quote' : undefined;

  const label = (() => {
    if (!hydrated) return 'Publish offer';
    if (!address) return 'Connect wallet';
    if (wrongNetwork) return 'Wrong network';
    if (running && active) return active.label;
    if (draft.blocked) return draft.blocked;
    return 'Publish offer';
  })();

  return (
    <aside id={id} className={classes.ticket} aria-label={buying ? 'Write a buy offer' : 'Write a sell offer'}>
      {/* --- side --------------------------------------------------------- */}
      {/* Two ways to use the same curve: sell WETH above today's price, or buy it below. The
          contract is identical; only which reserve the offer starts heavy in differs. */}
      <div className={classes.group}>
        <div className={classes.chips} role="group" aria-label="Offer side">
          {(
            [
              ['sell', `Sell ${riskySymbol ?? 'WETH'}`],
              ['buy', `Buy ${riskySymbol ?? 'WETH'}`],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              className={classes.chip}
              style={{ flex: '1 1 0' }}
              aria-pressed={draft.side === value}
              disabled={running}
              onClick={() => draft.setSide(value)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {/* --- amount ------------------------------------------------------- */}
      <div className={classes.group}>
        <div className={classes.legend}>
          <span>{buying ? 'Spend' : 'Sell'}</span>
          {/*
            * The balance, once, and it is the button that fills the field with it.
            *
            * It used to be printed twice: here as a readout and again 45px below as the field's
            * value the moment MAX was pressed — and the readout printed the deep eight-place string
            * trimmed, so `10.4` sat above `10.4000` in the positions column and `10.40` in the
            * promised ratio. One figure now, at this token's own four places like every other WETH
            * figure on the screen, and the affordance is the figure rather than a separate chip:
            * the balance IS what MAX means.
            */}
          {/*
            * With no wallet there is no balance, and the legend says nothing rather than `—`.
            *
            * An em dash is a figure that failed to arrive. A first-time visitor has not failed to
            * arrive at anything: they have not connected, the ticket is quoting one WETH because
            * that is a size, and the right-hand end of this legend has no business on the screen
            * until there is a balance to put in it.
            */}
          {draft.maxAmount !== undefined ? (
            <button
              type="button"
              className={classes.maxButton}
              onClick={() => draft.setAmount(draft.maxAmount ?? '')}
            >
              Max
              <span className={classes.maxFigure}>{draft.maxAmountLabel ?? draft.maxAmount}</span>
            </button>
          ) : hydrated && address ? (
            /* 76px, which is what `Max 10.4000` measures. A 56px placeholder in the slot of an
               80px figure is a skeleton of the wrong width, and the rule is that it is the right
               one — the strip's left edge jumped 20px when the balance landed. */
            <span className={classes.legendFigure}>
              <Bar width={76} />
            </span>
          ) : null}
        </div>
        <div className={classes.well} data-invalid={draft.overBalance || undefined}>
          <span className={classes.wellUnit}>
            {offeredSymbol ? <TokenIcon symbol={offeredSymbol} size={18} /> : <Bar width={18} />}
            {offeredSymbol ?? ''}
          </span>
          <NumberInput
            aria-label={buying ? 'Amount to spend' : 'Amount to sell'}
            variant="unstyled"
            classNames={{ input: classes.input }}
            data-len={draft.amount.length > 17 ? 'xl' : draft.amount.length > 11 ? 'l' : undefined}
            value={draft.amount}
            onChange={(next) => draft.setAmount(String(next))}
            placeholder="0"
            min={0}
            hideControls
            allowNegative={false}
            thousandSeparator=","
            decimalScale={(buying ? pair?.stable.decimals : pair?.risky.decimals) ?? 18}
            style={{ flex: '1 1 auto', minWidth: 0 }}
          />
        </div>
      </div>

      {/* --- strike ------------------------------------------------------- */}
      <div className={classes.group}>
        <div className={classes.legend}>
          <span>{buying ? 'Buy at' : 'Strike'}</span>
        </div>
        <div className={classes.well} data-invalid={draft.belowSpot || undefined}>
          <span className={classes.wellUnit}>
            {stableSymbol ? <TokenIcon symbol={stableSymbol} size={18} /> : <Bar width={18} />}
            {stableSymbol ?? ''}
          </span>
          <NumberInput
            aria-label={buying ? 'Price to buy at' : 'Strike price'}
            variant="unstyled"
            classNames={{ input: classes.input }}
            value={draft.strike}
            onChange={(next) => draft.setStrike(String(next))}
            placeholder="0"
            min={0}
            hideControls
            allowNegative={false}
            thousandSeparator=","
            decimalScale={2}
            style={{ flex: '1 1 auto', minWidth: 0 }}
          />
          <span
            className={classes.wellEnd}
            data-tone={draft.belowSpot ? 'neg' : undefined}
            title="Distance from the feed's current answer."
          >
            {draft.moneyness === undefined ? (
              <Bar width={38} />
            ) : (
              `${draft.moneyness >= 0 ? '+' : '−'}${(Math.abs(draft.moneyness) * 100).toFixed(1)}%`
            )}
          </span>
        </div>
      </div>

      {/* --- expiry ------------------------------------------------------- */}
      <div className={classes.group}>
        <div className={classes.legend}>
          <span>Expiry</span>
          <span className={classes.legendFigure} title="08:00 UTC, on the chain's clock.">
            {draft.maturity !== undefined && draft.clockSeconds !== undefined
              ? formatTenor(draft.maturity - draft.clockSeconds)
              : '—'}
          </span>
        </div>
        <div className={classes.expiryRow}>
          <div className={`${classes.well} ${classes.wellDate}`}>
            <DatePickerInput
              aria-label="Expiry date"
              variant="unstyled"
              classNames={{ input: classes.dateInput }}
              value={draft.date}
              onChange={(next) => draft.setDate(typeof next === 'string' ? next : null)}
              valueFormat="D MMM"
              placeholder="date"
              minDate={draft.minDate}
              maxDate={
                draft.clockSeconds !== undefined ? dateStringFor(draft.clockSeconds + 180 * 86_400) : undefined
              }
              popoverProps={{ radius: 'md', shadow: 'md' }}
              style={{ width: '100%' }}
            />
          </div>
          <div className={classes.chips}>
            {TENORS.map((tenor) => {
              const target =
                draft.clockSeconds === undefined
                  ? undefined
                  : dateStringFor(maturityAt(draft.clockSeconds, tenor.days));
              return (
                <button
                  key={tenor.days}
                  type="button"
                  className={classes.chip}
                  aria-pressed={target !== undefined && target === draft.date}
                  disabled={target === undefined}
                  onClick={() => target && draft.setDate(target)}
                >
                  {tenor.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* --- implied volatility -------------------------------------------- */}
      {/*
        * The fourth control, and the only number on this ticket the chain cannot supply.
        *
        * The legend carries the feed's own trailing realised vol as the affordance, exactly the way
        * SELL carries the balance: the chain's number is a button, the well holds what the maker
        * decided, and pressing the button adopts the measurement. Symmetric with the row three
        * groups above it, which is the point — a maker learns one gesture, not two.
        */}
      <div className={classes.group}>
        <div className={classes.legend}>
          <Labelled>
            <span>IV</span>
            <Explain term="Implied volatility" position="top-start">
              <p>{`How much you expect ${riskySymbol ?? 'the price'} to move. Higher means a bigger premium.`}</p>
            </Explain>
          </Labelled>
          {/* `Realised`, not `Real`. One is the opposite of implied, which is what this figure is;
              the other is the opposite of fake, which is not a distinction anything here draws. */}
          {draft.measuredVol !== undefined ? (
            <button
              type="button"
              className={classes.maxButton}
              disabled={draft.vol === draft.measuredVol}
              title={
                draft.volSpanSeconds
                  ? `Trailing realised volatility from the feed, over ${formatTenor(draft.volSpanSeconds)}.`
                  : undefined
              }
              onClick={() => draft.setVol(draft.measuredVol ?? '')}
            >
              Realised
              <span className={classes.maxFigure}>{draft.measuredVol}</span>
            </button>
          ) : draft.volUnavailable ? (
            /* The chain would not serve enough history to measure one. A skeleton here shimmers
               forever for a figure that is never coming. */
            null
          ) : (
            /* `Realised 25.2` measures 84. */
            <span className={classes.legendFigure}>
              <Bar width={84} />
            </span>
          )}
        </div>
        <div className={classes.well}>
          <NumberInput
            aria-label="Implied volatility, percent"
            variant="unstyled"
            classNames={{ input: classes.input }}
            value={draft.vol}
            onChange={(next) => draft.setVol(String(next))}
            placeholder="0"
            min={0}
            max={400}
            step={5}
            hideControls
            allowNegative={false}
            decimalScale={1}
            style={{ flex: '1 1 auto', minWidth: 0 }}
          />
          <span className={classes.wellEnd}>%</span>
          <span className={classes.stepper}>
            <button
              type="button"
              aria-label="Lower implied volatility"
              onClick={() => draft.setVol(stepVol(draft.vol, -5))}
            >
              <Minus size={13} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Raise implied volatility"
              onClick={() => draft.setVol(stepVol(draft.vol, 5))}
            >
              <Plus size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        </div>
      </div>

      {/* --- the figures -------------------------------------------------- */}
      {/*
        * Dimmed whenever the field above them has been refused.
        *
        * Two cases, one treatment. Over the balance, the quote below is clamped, so these describe
        * the largest offer that could actually be published rather than the number in the field.
        * Below spot, they describe an offer that would be taken the instant it was published — the
        * router prices it happily, because the arithmetic is real, but the button will not ship it
        * and the chart refuses to draw it. Leaving `Premium +1.82` and `Capped at 1.18` in full ink
        * beside a disabled button reading `Strike below spot` was the ticket contradicting itself.
        */}
      <div
        className={classes.figures}
        data-clamped={draft.overBalance || draft.belowSpot || undefined}
      >
        <FigureRow
          label="Premium"
          unit={draft.offer ? stableSymbol : undefined}
          explain={
            <Explain term="Premium" position="top-start">
              <p>What buyers pay you in total if they take the whole offer by expiry.</p>
            </Explain>
          }
        >
          <Reveal token={premiumWad === undefined ? 'pending' : 'settled'}>
            {premiumWad !== undefined && stableSymbol ? (
              <TokenAmount
                value={premiumWad}
                decimals={18}
                symbol={stableSymbol}
                icon={false}
                unit="none"
                sign="always"
                tone="money"
              />
            ) : quoteRefused ? (
              <span className={classes.legendFigure}>{quoteRefused}</span>
            ) : (
              <Bar width={96} />
            )}
          </Reveal>
        </FigureRow>
        {/* A buy offer's premium is quoted here in USDC but earned in WETH, which is the unit the
            premium chart and the positions strip count it in. Both units, on both surfaces. */}
        {premiumInRisky ? <p className={classes.figureNote}>{`${premiumInRisky} ${riskySymbol} at spot`}</p> : null}

        <FigureRow
          label={buying ? 'Buys at' : 'Capped at'}
          unit={draft.offer ? stableSymbol : undefined}
          explain={
            buying ? (
              <Explain term="Buys at" position="top-start">
                <p>{`Below this ${riskySymbol ?? ''} price you'd have done better just holding ${stableSymbol ?? ''}.`}</p>
              </Explain>
            ) : (
              <Explain term="Capped at" position="top-start">
                <p>{`Above this ${riskySymbol ?? ''} price you'd have done better just holding.`}</p>
              </Explain>
            )
          }
        >
          <Reveal token={cappedWad === undefined ? 'pending' : 'settled'}>
            {cappedWad !== undefined && stableSymbol ? (
              <TokenAmount
                value={cappedWad}
                decimals={18}
                symbol={stableSymbol}
                icon={false}
                unit="none"
              />
            ) : quoteRefused ? (
              <span className={classes.legendFigure}>{quoteRefused}</span>
            ) : (
              <Bar width={96} />
            )}
          </Reveal>
        </FigureRow>

        {draft.protocolFee ? (
          <FigureRow
            label="Protocol fee"
            wide
            explain={
              <Explain term="Protocol fee" position="top-start">
                <p>Paid by the buyer on each fill, on top of your premium.</p>
              </Explain>
            }
          >
            {`${formatProtocolFee(draft.protocolFee.feeBps)} of each fill`}
          </FigureRow>
        ) : null}
      </div>

      {/*
        * The primary action, and it reports on itself.
        *
        * It used to stay enabled, keep its label and expose no `aria-busy` for the whole nineteen
        * seconds a publish takes on a fork — the offer landed and the only sign of it was a new row
        * appearing in the strip below. A run now disables the button (there is nothing a second
        * click can do but confuse the flow), names the step that is actually in flight, and says so
        * to assistive technology.
        */}
      <button
        type="button"
        ref={actionRef}
        className={classes.action}
        aria-busy={running || undefined}
        disabled={running || (hydrated && !!address && !wrongNetwork && !!draft.blocked)}
        onClick={() => {
          if (running) return;
          if (!address) {
            onConnect?.();
            return;
          }
          /* Every figure above is read from the chain the manifest names, so they are all still
             right on the wrong network; only the signature would fail. The button switches rather
             than explains. */
          if (wrongNetwork) {
            onSwitchNetwork?.();
            return;
          }
          /* The figures are read before the flow starts, so the moment names the offer that was sent
             and not whatever the ticket re-quotes to after it. */
          const figures = placedFigures(draft.side, draft.amount, draft.strike, draft.maturity, (buying ? stableSymbol : riskySymbol) ?? '');
          void draft.publish().then((shipped) => {
            if (!shipped) return;
            placed.play(figures);
            onPublished?.();
          });
        }}
      >
        {running ? <Loader size={16} color="var(--ink-3)" /> : null}
        {/* The label moves between its states rather than swapping between them: `Approve WETH`
            gives way to `Ship offer` over the same 170ms every other state change on this screen
            takes, keyed on the word so it runs once per step and not once per render. */}
        <Reveal token={label}>{label}</Reveal>
      </button>

      {/*
        * The steps, and the reason this is a live region rather than a list that appears.
        *
        * Each `<li>` wears its own status — idle, running, done, failed — so a plan whose two
        * approvals were skipped and whose ship is still in flight does not draw three identical
        * markers. The strip is announced politely as those statuses change, which is the only
        * running commentary this screen has and the only one it needs.
        */}
      {publisher.steps.length > 0 ? (
        <ol ref={steps} className={classes.steps} aria-live="polite">
          {publisher.steps.map((step) => (
            <li key={step.id} className={classes.step} data-state={stateOf(step.status)}>
              <span className={classes.stepBar} />
              <span>{step.label}</span>
              <span className={classes.stepState}>
                <Reveal token={stateOf(step.status)}>{STEP_STATE_LABEL[stateOf(step.status)]}</Reveal>
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {placed.node}

      {publisher.error ? (
        <p className={classes.error} role="alert">
          {publisher.error}
        </p>
      ) : null}

      {draft.sizing.error ? (
        <p className={classes.error} role="alert">
          {explainError(draft.sizing.error)}
        </p>
      ) : null}
    </aside>
  );
}

/** `SELL 10.4000 WETH · AT 2,600 · 18 SEP`, from the draft as it was sent. */
function placedFigures(
  side: string | undefined,
  amount: string,
  strike: string,
  maturity: number | undefined,
  symbol: string,
): string {
  const date =
    maturity !== undefined
      ? `${new Date(maturity * 1000).getUTCDate()} ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][new Date(maturity * 1000).getUTCMonth()]}`
      : undefined;
  const price = Number(strike.replace(/,/g, ''));
  const strikeLabel = Number.isFinite(price) && strike !== '' ? price.toLocaleString('en-US') : strike;
  const size = side === 'buy' ? `BUY WITH ${amount} ${symbol}` : `SELL ${amount} ${symbol}`;
  return [size, `AT ${strikeLabel}`, date].filter(Boolean).join(' · ');
}

/**
 * The moment an offer lands, across the whole screen: the ground dims, the wordmark's rising stroke
 * draws, its flat cyan stroke — the strike line — launches off the right edge, and "Offer placed"
 * rises above it with the offer's own figures. About 1.8s, dismissed early by a click or Esc, and a
 * static toast under reduced motion. Rendered in a portal so nothing in the terminal can clip it.
 */
function useOfferPlaced(): { play: (figures: string) => void; node: ReactNode } {
  const [shot, setShot] = useState<{ key: number; figures: string; still: boolean } | null>(null);

  useEffect(() => {
    if (!shot) return;
    const t = window.setTimeout(() => setShot(null), shot.still ? 1500 : 1850);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShot(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [shot]);

  const play = (figures: string) => {
    if (typeof window === 'undefined') return;
    const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setShot({ key: Date.now(), figures, still });
  };

  const node =
    shot && typeof document !== 'undefined'
      ? createPortal(
          <div
            key={shot.key}
            className={classes.placed}
            data-still={shot.still || undefined}
            role="status"
            aria-live="polite"
            onClick={() => setShot(null)}
          >
            <svg className={classes.placedArt} viewBox="0 0 1000 400" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
              <path className={classes.placedRise} d="M120 330 L300 200" pathLength={1} />
            </svg>
            <span className={classes.placedLine} aria-hidden="true" />
            <div className={classes.placedLabel}>
              <span className={classes.placedCheck} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M6 12.5l4 4 8-9" pathLength={1} />
                </svg>
              </span>
              <div>
                <div className={classes.placedTitle}>Offer placed</div>
                <div className={classes.placedFigures}>{shot.figures}</div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return { play, node };
}

/**
 * The last quote the router gave, held across the next one.
 *
 * `useOffer` re-keys its `stableFor` pair on every argument the maker touches, and react-query has
 * no data under a key it has never fetched — so `draft.offer` is `undefined` for the hundred and
 * fifty milliseconds a re-quote takes, and the two figures used to collapse to skeletons and come
 * back. That is right the first time, when there is genuinely nothing to show, and wrong every time
 * after it: a figure that blanks cannot travel, so the one thing a maker most wants to see about
 * the control they just moved — which way it pushed the premium, and by how much — was the one
 * thing the ticket refused to show them.
 *
 * The previous reading is held instead, and the new one arrives by travelling to it. Nothing is
 * invented: what is on the screen during that gap is the last number `stableFor` actually returned,
 * the button beside it reads `Pricing` for exactly that window, and the block in the bar says which
 * block everything else was read at. The moment the quote errors or the ticket stops being able to
 * price at all, the hold is dropped and the skeletons come back.
 */
function useHeldQuote(draft: TicketDraft): { premium: bigint; capped: bigint } | undefined {
  const [held, setHeld] = useState<{ premium: bigint; capped: bigint }>();
  const offer = draft.offer;

  /* Adjusted during render rather than in an effect: this is state derived from a new reading, not
     a subscription to anything, and the strip below does the same with the row count it holds
     across a re-read. React re-runs this component with the new value before it commits, so a
     figure is never painted one reading behind. */
  if (offer && (held?.premium !== offer.earnedWad || held?.capped !== offer.effectivePriceWad)) {
    setHeld({ premium: offer.earnedWad, capped: offer.effectivePriceWad });
  } else if (!offer && !draft.sizing.isLoading && held !== undefined) {
    setHeld(undefined);
  }

  return held;
}

/**
 * Bring the step strip into view the moment it exists.
 *
 * The ticket is a 380px column bounded by the grid row, so anything a publish adds to it scrolls
 * inside the ticket rather than growing the page — which is what keeps the chart and the book from
 * moving mid-transaction. The cost of that is this: on a 900px window the column is already full,
 * so the three rows a run appends land below the fold and the primary action reports on itself
 * somewhere the person who pressed it cannot see. On a local fork the whole plan settles in about
 * three hundred milliseconds, which made a correct, disabled, relabelled, `aria-busy` button look
 * from the outside exactly like a button that does nothing.
 *
 * `block: 'nearest'` scrolls the ticket's own scroller and no ancestor, so the page does not move.
 */
function useStepsInView(count: number) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (count > 0) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);
  return ref;
}

type StepState = 'idle' | 'running' | 'done' | 'failed';

function stateOf(status: string): StepState {
  if (status === 'signing' || status === 'pending') return 'running';
  if (status === 'success' || status === 'skipped') return 'done';
  if (status === 'reverted' || status === 'error') return 'failed';
  return 'idle';
}

/** One word per marker, so the strip is legible without reading a colour. */
const STEP_STATE_LABEL: Record<StepState, string> = {
  idle: 'queued',
  running: 'signing',
  done: 'done',
  failed: 'failed',
};

/** One step of the IV field, clamped and kept at one decimal place so the well never jitters. */
function stepVol(current: string, delta: number): string {
  const parsed = Number.parseFloat(current);
  const next = (Number.isFinite(parsed) ? parsed : 0) + delta;
  return Math.min(400, Math.max(0, Math.round(next * 10) / 10)).toFixed(1);
}
