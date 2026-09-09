'use client';

/**
 * The ticket. Three controls, three figures, one button, and not one sentence.
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
 *   premium    `stableFor` at the date, minus at settlement        `StrikelineViews`
 *   capped at  strike + premium / amount                           — as above
 *   IV         trailing realised vol off the feed, or the maker's  `useRealisedVol`
 */
import { Loader, NumberInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { dateStringFor, daysUntil, maturityAt, type OfferPair } from '@/components/sell';
import { TokenAmount, TokenIcon } from '@/components/token';
import { explainError } from '@/lib/ui';
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

  const label = (() => {
    if (!hydrated) return 'Publish offer';
    if (!address) return 'Connect wallet';
    if (wrongNetwork) return 'Wrong network';
    if (running && active) return active.label;
    if (draft.blocked) return draft.blocked;
    return 'Publish offer';
  })();

  return (
    <aside className={classes.ticket} aria-label="Write a covered call">
      {/* --- amount ------------------------------------------------------- */}
      <div className={classes.group}>
        <div className={classes.legend}>
          <span>Sell</span>
          <span className={classes.legendFigure} title="Your balance, floored at the eighth place.">
            {draft.maxAmount ?? (hydrated && address ? <Bar width={44} /> : '—')}
          </span>
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
            decimalScale={pair?.risky.decimals ?? 18}
            style={{ flex: '1 1 auto', minWidth: 0 }}
          />
          {draft.maxAmount !== undefined ? (
            <button
              type="button"
              className={classes.maxButton}
              onClick={() => draft.setAmount(draft.maxAmount ?? '')}
            >
              MAX
            </button>
          ) : null}
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
              ? `${daysUntil(draft.maturity, nowSeconds)}d`
              : '—'}
          </span>
        </div>
        <div className={classes.expiryRow}>
          <div className={classes.dateWell}>
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

      {/* --- the figures -------------------------------------------------- */}
      <div className={classes.figures}>
        <FigureRow label="Premium">
          {draft.offer && stableSymbol ? (
            <TokenAmount
              value={draft.offer.earnedWad}
              decimals={18}
              symbol={stableSymbol}
              icon={false}
              sign="always"
              tone="money"
              className={classes.figureValue}
            />
          ) : (
            <Bar width={96} />
          )}
        </FigureRow>

        <FigureRow label="Capped at">
          {draft.offer && stableSymbol ? (
            <TokenAmount
              value={draft.offer.effectivePriceWad}
              decimals={18}
              symbol={stableSymbol}
              icon={false}
              className={classes.figureValue}
            />
          ) : (
            <Bar width={96} />
          )}
        </FigureRow>

        <FigureRow label="IV">
          <span className={classes.figureValue}>
            <input
              aria-label="Implied volatility, percent"
              className={classes.ivInput}
              inputMode="decimal"
              value={draft.vol}
              onChange={(event) => draft.setVol(event.target.value.replace(/[^0-9.]/g, ''))}
              title={
                draft.volIsMeasured
                  ? `Trailing realised volatility from the feed, over ${Math.round((draft.volSpanSeconds ?? 0) / 3600)}h.`
                  : draft.volUnavailable
              }
            />
            <span className={classes.figureUnit}>%</span>
          </span>
        </FigureRow>
      </div>

      <button
        type="button"
        className={classes.action}
        disabled={!running && hydrated && !!address && !wrongNetwork && !!draft.blocked}
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
        {running ? <Loader size={16} color="var(--accent-ink)" /> : null}
        {label}
      </button>

      {publisher.steps.length > 0 ? (
        <ol className={classes.steps}>
          {publisher.steps.map((step) => (
            <li key={step.id} className={classes.step} data-state={stateOf(step.status)}>
              <span className={classes.stepBar} />
              <span>{step.label}</span>
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

function stateOf(status: string): string {
  if (status === 'signing' || status === 'pending') return 'running';
  if (status === 'success' || status === 'skipped') return 'done';
  if (status === 'reverted' || status === 'error') return 'failed';
  return 'idle';
}
