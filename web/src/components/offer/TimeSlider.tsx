'use client';

/**
 * Drag to look ahead. Nothing moves on chain.
 *
 * Each position asks the router for the curve and the gap of an offer with that much less time
 * left, so what is on screen at any position is a real chain read rather than an interpolation
 * between two of them. Positions are quantised to a small number of steps, which is what makes a
 * drag land on samples react-query already has instead of firing a multicall per frame.
 *
 * Mantine's `Slider` carries the keyboard behaviour for free — arrows, Home, End, Page Up/Down —
 * and `label` is what a screen reader and a hovering pointer both get, so it says the thing a
 * reader cares about (the time left) rather than "17".
 */
import { Group, Slider, Stack, Text, UnstyledButton } from '@mantine/core';
import { TAU_FLOOR_SECONDS } from '@/components/curve';
import { formatDuration } from '@/components/curve/duration';

export interface TimeSliderProps {
  /** 0 = now, 1 = the date on the offer. */
  value: number;
  onChange: (next: number) => void;
  /** Seconds of life left at position 0. */
  remainingSeconds: number;
  steps?: number;
  disabled?: boolean;
  disabledReason?: string;
}

export function TimeSlider({
  value,
  onChange,
  remainingSeconds,
  steps = 24,
  disabled = false,
  disabledReason,
}: TimeSliderProps) {
  const position = Math.round(value * steps);
  const left = Math.round(remainingSeconds * (1 - value));
  const atNow = position === 0;
  // Inside the floor the instruction stops shortening tau, so the curve holds still even though the
  // clock does not. Saying so is the difference between a control that looks stuck and one that is
  // showing the contract's own behaviour.
  const floored = left > 0 && left < TAU_FLOOR_SECONDS;

  return (
    <Stack gap={6}>
      <Group justify="space-between" align="baseline" gap="sm" wrap="nowrap">
        <Text size="xs" c="var(--ink-2)">
          Time left. Drag to look ahead.
        </Text>
        <Group gap={8} align="baseline" wrap="nowrap">
          <Text ff="var(--font-mono)" size="sm" c="var(--ink)" className="tnum">
            {formatDuration(left)}
          </Text>
          {atNow ? (
            <Text size="xs" c="var(--ink-3)">
              live
            </Text>
          ) : (
            <UnstyledButton
              onClick={() => onChange(0)}
              className="rounded-control px-1.5 py-0.5 text-mini text-accent transition-state hover:bg-accent-soft"
            >
              back to now
            </UnstyledButton>
          )}
        </Group>
      </Group>

      <Slider
        value={position}
        onChange={(next) => onChange(next / steps)}
        min={0}
        max={steps}
        step={1}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        label={(v) => `${formatDuration(Math.round(remainingSeconds * (1 - v / steps)))} left`}
        color="petrol"
        size="sm"
        thumbSize={18}
        marks={[
          { value: 0, label: 'now' },
          { value: steps, label: 'its date' },
        ]}
        styles={{
          track: { '--slider-track-bg': 'var(--surface-3)' },
          markLabel: { color: 'var(--ink-3)', fontSize: 'var(--text-mini)' },
        }}
      />

      <Text size="xs" c="var(--ink-3)" mt={14} className="leading-prose">
        {floored ? (
          <>
            Inside the last <span className="font-mono">{formatDuration(TAU_FLOOR_SECONDS)}</span>{' '}
            the offer stops re-pricing as the clock runs, then snaps to its settlement line when the
            date actually passes. That floor is what keeps the last hour from going wild.
          </>
        ) : (
          <>
            Every position is a fresh read from the router, not an interpolation. Dragging changes
            nothing on chain and costs nothing.
          </>
        )}
      </Text>
    </Stack>
  );
}
