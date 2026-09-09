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
 * IV is the fourth control, and LAYOUT.md's "three controls" is now three plus it. It was drawn as
 * a bare 21px figure that grew a rule on hover, on the theory that a spec saying three should not
 * grow a fourth; the result was that the one number on this ticket the chain cannot supply — the
 * one PRODUCT.md says makers want to be theirs — was the only input on the screen a person could
 * not see was an input, and it failed the 24px target size on a phone, where there is no hover to
 * reveal it with. It gets the same well the other three have.
 */
import { useEffect, useRef } from 'react';
import { Loader, NumberInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { Minus, Plus } from 'lucide-react';
import { dateStringFor, maturityAt, type OfferPair } from '@/components/sell';
import { TokenAmount, TokenIcon } from '@/components/token';
import { explainError, formatTenor } from '@/lib/ui';
import { Bar, FigureRow } from './bits';
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
  const { publisher } = draft;
  const running = publisher.isRunning;
  const active = publisher.steps.find((s) => s.status === 'signing' || s.status === 'pending');
  const steps = useStepsInView(publisher.steps.length);

  const label = (() => {
    if (!hydrated) return 'Publish offer';
    if (!address) return 'Connect wallet';
    if (wrongNetwork) return 'Wrong network';
    if (running && active) return active.label;
    if (draft.blocked) return draft.blocked;
    return 'Publish offer';
  })();

  return (
    <aside id={id} className={classes.ticket} aria-label="Write a covered call">
      {/* --- amount ------------------------------------------------------- */}
      <div className={classes.group}>
        <div className={classes.legend}>
          <span>Sell</span>
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
          {draft.maxAmount === undefined ? (
            <span className={classes.legendFigure}>
              {hydrated && address ? <Bar width={56} /> : '—'}
            </span>
          ) : (
            <button
              type="button"
              className={classes.maxButton}
              onClick={() => draft.setAmount(draft.maxAmount ?? '')}
            >
              Max
              <span className={classes.maxFigure}>{draft.maxAmountLabel ?? draft.maxAmount}</span>
            </button>
          )}
        </div>
        <div className={classes.well} data-invalid={draft.overBalance || undefined}>
          <span className={classes.wellUnit}>
            {riskySymbol ? <TokenIcon symbol={riskySymbol} size={18} /> : <Bar width={18} />}
            {riskySymbol ?? ''}
          </span>
          <NumberInput
            aria-label="Amount to sell"
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
            decimalScale={pair?.risky.decimals ?? 18}
            style={{ flex: '1 1 auto', minWidth: 0 }}
          />
        </div>
      </div>

      {/* --- strike ------------------------------------------------------- */}
      <div className={classes.group}>
        <div className={classes.legend}>
          <span>Strike</span>
        </div>
        <div className={classes.well} data-invalid={draft.belowSpot || undefined}>
          <span className={classes.wellUnit}>
            {stableSymbol ? <TokenIcon symbol={stableSymbol} size={18} /> : <Bar width={18} />}
            {stableSymbol ?? ''}
          </span>
          <NumberInput
            aria-label="Strike price"
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
            style={draft.belowSpot ? { color: 'var(--neg)' } : undefined}
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
            {draft.maturity !== undefined && nowSeconds !== undefined
              ? formatTenor(draft.maturity - nowSeconds)
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
              minDate={nowSeconds !== undefined ? dateStringFor(nowSeconds + 86_400) : undefined}
              maxDate={nowSeconds !== undefined ? dateStringFor(nowSeconds + 180 * 86_400) : undefined}
              popoverProps={{ radius: 'md', shadow: 'md' }}
              style={{ width: '100%' }}
            />
          </div>
          <div className={classes.chips}>
            {TENORS.map((tenor) => {
              const target =
                nowSeconds === undefined ? undefined : dateStringFor(maturityAt(nowSeconds, tenor.days));
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
          <span>IV</span>
          {draft.measuredVol === undefined ? (
            <span className={classes.legendFigure}>{hydrated ? <Bar width={56} /> : '—'}</span>
          ) : (
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
              Real
              <span className={classes.maxFigure}>{draft.measuredVol}</span>
            </button>
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
        <FigureRow label="Premium" unit={draft.offer ? stableSymbol : undefined}>
          {draft.offer && stableSymbol ? (
            <TokenAmount
              value={draft.offer.earnedWad}
              decimals={18}
              symbol={stableSymbol}
              icon={false}
              unit="none"
              sign="always"
              tone="money"
            />
          ) : (
            <Bar width={96} />
          )}
        </FigureRow>

        <FigureRow label="Capped at" unit={draft.offer ? stableSymbol : undefined}>
          {draft.offer && stableSymbol ? (
            <TokenAmount
              value={draft.offer.effectivePriceWad}
              decimals={18}
              symbol={stableSymbol}
              icon={false}
              unit="none"
            />
          ) : (
            <Bar width={96} />
          )}
        </FigureRow>
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
          void draft.publish().then(() => onPublished?.());
        }}
      >
        {running ? <Loader size={16} color="var(--ink-3)" /> : null}
        {label}
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
              <span className={classes.stepState}>{STEP_STATE_LABEL[stateOf(step.status)]}</span>
            </li>
          ))}
        </ol>
      ) : null}

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
