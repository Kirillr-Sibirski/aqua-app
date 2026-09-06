'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/ui';
import { focusItem, rovingIndex } from './internal';
import { ICON_STROKE, type IconComponent } from './icon';

export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  icon?: IconComponent;
  disabled?: boolean;
  /** Why this option is unavailable, shown as a native tooltip. */
  disabledReason?: string;
}

export interface SegmentedControlProps<T extends string> {
  items: SegmentedItem<T>[];
  value: T;
  onValueChange: (next: T) => void;
  /** Names the group for assistive technology: "Price direction", "Range preset". */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A small set of mutually exclusive options, shown all at once.
 *
 * Built as a radio group rather than a row of buttons: the whole control is one tab stop, arrows
 * move between options, Home and End jump to the ends, and disabled options are skipped rather
 * than trapping focus. That is the pattern assistive technology already knows, and it matches how
 * a keyboard user expects a segmented control to behave.
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onValueChange,
  label,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = rovingIndex(
      event.key,
      activeIndex,
      items.length,
      'horizontal',
      (index) => Boolean(items[index]?.disabled),
    );
    if (next === null) return;
    event.preventDefault();
    onValueChange(items[next].value);
    focusItem(listRef, next);
  }

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex items-center gap-1 rounded-control border border-line bg-surface p-1',
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            data-roving-item=""
            aria-checked={selected}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled && !item.disabledReason}
            title={item.disabled ? item.disabledReason : undefined}
            // One tab stop for the group; arrows move within it.
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => {
              if (item.disabled) return;
              onValueChange(item.value);
            }}
            className={cn(
              'inline-flex select-none items-center gap-1.5 rounded-control transition-state',
              size === 'sm' ? 'h-6 px-2 text-mini' : 'h-8 px-3 text-meta',
              selected
                ? 'bg-surface-2 text-ink'
                : 'text-ink-2 hover:bg-surface-2/60 hover:text-ink',
              item.disabled && 'cursor-not-allowed text-ink-3 hover:bg-transparent hover:text-ink-3',
            )}
          >
            {Icon ? <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" /> : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
