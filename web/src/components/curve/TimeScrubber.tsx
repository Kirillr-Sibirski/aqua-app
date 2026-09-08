'use client';

/**
 * The time scrubber: drag `tau` toward zero and watch the curve become the settlement line.
 *
 * It moves nothing on chain. Each position asks the router for the curve of a leg maturing that
 * much sooner, so what is on screen at any position is a real `stableFor` sample rather than an
 * interpolation between two of them. Positions are quantised to a small number of steps, which is
 * what makes a drag land on cached samples instead of a new multicall per frame.
 *
 * Built on `<input type="range">` on purpose: arrows, Home, End, Page Up and Page Down all work
 * without a line of key handling, and the accessible value is a real number a screen reader reads
 * out. `aria-valuetext` carries the thing a maker actually cares about — the remaining time — since
 * "37" would be meaningless.
 */
import { useId } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/ui';

export interface TimeScrubberProps {
  /** 0 = now, 1 = matured. */
  value: number;
  onValueChange: (next: number) => void;
  /** Number of positions between the ends. More steps means more distinct multicalls. */
  steps?: number;
  /** Seconds of time value left at position 0, used for the readout. */
  remainingSeconds: number;
  /**
   * `RmmSwap.TAU_FLOOR`. Inside it the instruction stops shortening tau, so the curve the router
   * returns stops changing even though the clock has not stopped. Saying so is the difference
   * between a scrubber that looks stuck and one that is showing the contract's own behaviour.
   */
  floorSeconds?: number;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

/** `6d 4h`, `4h 12m`, `38m`. Two units is enough to steer by. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'matured';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export function TimeScrubber({
  value,
  onValueChange,
  steps = 24,
  remainingSeconds,
  floorSeconds,
  disabled = false,
  disabledReason,
  className,
}: TimeScrubberProps) {
  const id = useId();
  const position = Math.round(value * steps);
  const left = Math.round(remainingSeconds * (1 - value));
  const atNow = position === 0;
  const floored = floorSeconds !== undefined && left > 0 && left < floorSeconds;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-mini text-ink-2">
          Time to maturity
        </label>
        <span className="font-mono text-meta tnum text-ink">
          {formatDuration(left)}
          {atNow ? <span className="ml-2 text-mini text-ink-3">live</span> : null}
          {floored ? (
            <span className="ml-2 text-mini text-warn">
              tau floored at {formatDuration(floorSeconds)}
            </span>
          ) : null}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* The ring lives on this wrapper, not on the input.
            `focus-visible:[&::-webkit-slider-thumb]:outline-…` is what was here, and it draws
            nothing a person can see: walking four ancestor levels from the focused input, every one
            reported `outlineStyle: none`. The scrubber is the app's most interactive control and
            the one PRODUCT.md singles out as keyboard operable, so it cannot be the single
            focusable in the app with no visible focus (WCAG 2.4.7). */}
        <span className="flex min-w-0 flex-1 rounded-control has-[:focus-visible]:focus-ring">
        <input
          id={id}
          type="range"
          min={0}
          max={steps}
          step={1}
          value={position}
          disabled={disabled}
          onChange={(event) => onValueChange(Number(event.target.value) / steps)}
          aria-valuetext={`${formatDuration(left)} left`}
          title={disabled ? disabledReason : undefined}
          className={cn(
            'h-8 w-full min-w-0 cursor-pointer appearance-none bg-transparent',
            'focus-visible:outline-none',
            // Track and thumb have to be styled per engine; both branches use the same tokens.
            '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-pill [&::-webkit-slider-runnable-track]:bg-surface-2',
            '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-pill [&::-moz-range-track]:bg-surface-2',
            '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-4',
            '[&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-accent-dim [&::-webkit-slider-thumb]:bg-accent',
            '[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-pill [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-accent-dim [&::-moz-range-thumb]:bg-accent',
            'focus-visible:[&::-webkit-slider-thumb]:outline focus-visible:[&::-webkit-slider-thumb]:outline-2 focus-visible:[&::-webkit-slider-thumb]:outline-offset-2 focus-visible:[&::-webkit-slider-thumb]:outline-(--focus-ring)',
            'focus-visible:[&::-moz-range-thumb]:outline focus-visible:[&::-moz-range-thumb]:outline-2 focus-visible:[&::-moz-range-thumb]:outline-offset-2 focus-visible:[&::-moz-range-thumb]:outline-(--focus-ring)',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        />
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCcw}
          onClick={() => onValueChange(0)}
          disabled={atNow}
          disabledReason={atNow ? 'The curve is already at the current block.' : undefined}
        >
          Now
        </Button>
      </div>

      <p className="text-mini leading-prose text-ink-3">
        {floored ? (
          <>
            Inside the last <span className="font-mono">{formatDuration(floorSeconds)}</span> the
            instruction stops shortening tau, so the curve holds here until maturity actually passes
            and then snaps to the settlement line. The floor is what keeps gamma finite in the final
            hour, and the snap is the honest edge of it.
          </>
        ) : (
          <>
            Every position is a fresh <span className="font-mono">stableFor</span> sample from the
            router, not an interpolation. Nothing moves on chain.
          </>
        )}
      </p>
    </div>
  );
}
