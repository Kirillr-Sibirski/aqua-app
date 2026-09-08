'use client';

/**
 * The primitives this screen draws with, on Mantine.
 *
 * Deliberately small and local. `components/ui` is being retired as screens migrate, so nothing
 * here reaches back into it; everything is a Mantine component over the token bridge in
 * `components/theme/theme.ts`. What is not Mantine — the bigint formatters in `lib/ui/format` — is
 * imported and never reimplemented, because those are the only functions in the app allowed to turn
 * a chain value into a string.
 *
 * Mantine's font scale is the theme's: xs 12, sm 14, md 16, lg 20, xl 26. The 13px table step has
 * no key, so it is passed as a number, which Mantine converts to rem.
 */
import type { ReactNode } from 'react';
import {
  ActionIcon,
  Badge,
  CopyButton,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { Check, Copy } from 'lucide-react';
import { formatTokenAmount, toDecimalString, truncateAddress } from '@/lib/ui';
import classes from './surface.module.css';

/** 13px: the dense table step, between `xs` and `sm`. */
export const META = 13;

/**
 * A titled white panel.
 *
 * The one elevated object type on the page: hairline, 16px radius, and the card shadow, which on a
 * light theme is how a surface leaves the page. `flush` drops the body padding for a panel whose
 * whole content is a table that should bleed to the hairline.
 */
export function Panel({
  title,
  lede,
  badge,
  controls,
  footer,
  flush = false,
  children,
}: {
  title: ReactNode;
  /** One plain sentence saying what the panel means, before any label inside it. */
  lede?: ReactNode;
  badge?: ReactNode;
  controls?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <Paper withBorder radius="xl" shadow="sm" className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          {/* Wraps rather than shrinks: at 390px a nowrap row squeezed the badge until it read
              "THE GR…", which is a label that has stopped being a label. */}
          <Group gap="xs" wrap="wrap" align="center">
            <Text component="h2" fz="md" fw={600} c="var(--ink)" className="min-w-0">
              {title}
            </Text>
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </Group>
          {lede ? (
            <Text mt={6} fz="sm" lh={1.45} c="var(--ink-2)" className="max-w-prose">
              {lede}
            </Text>
          ) : null}
        </div>
        {controls ? <div className="shrink-0">{controls}</div> : null}
      </div>

      <div className={flush ? '' : 'px-5 pb-5'}>{children}</div>

      {footer ? (
        <div className="border-t border-line bg-surface-2 px-5 py-3">
          <Text fz="xs" lh={1.45} c="var(--ink-3)" className="max-w-prose">
            {footer}
          </Text>
        </div>
      ) : null}
    </Paper>
  );
}

/**
 * One figure with its label.
 *
 * 20px mono, not a 34px display step: DESIGN.md bans hero metrics, and the strip these sit in is
 * orientation, not a scoreboard.
 */
export function Stat({
  label,
  value,
  unit,
  detail,
  aside,
  loading = false,
}: {
  label: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  detail?: ReactNode;
  aside?: ReactNode;
  loading?: boolean;
}) {
  return (
    <Stack gap={4} className="min-w-0">
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Text fz="xs" c="var(--ink-3)" className="truncate">
          {label}
        </Text>
        {aside}
      </Group>
      {loading ? (
        <Skeleton height={22} width={104} radius="sm" />
      ) : (
        <Group gap={6} align="baseline" wrap="nowrap">
          <Text ff="monospace" fz="lg" fw={500} c="var(--ink)" className="tnum truncate">
            {value ?? <Text component="span" c="var(--ink-3)">&mdash;</Text>}
          </Text>
          {unit ? (
            <Text ff="monospace" fz="xs" c="var(--ink-3)" className="tnum shrink-0">
              {unit}
            </Text>
          ) : null}
        </Group>
      )}
      {detail ? (
        <Text fz="xs" lh={1.35} c="var(--ink-3)">
          {detail}
        </Text>
      ) : null}
    </Stack>
  );
}

/**
 * A token amount, rounded for reading, with the exact chain value on `title`.
 *
 * `formatTokenAmount` never collapses a non-zero balance to `0` — it emits a `<` bound instead — so
 * the screen cannot claim an amount is gone when it is not.
 */
export function Amount({
  value,
  decimals,
  symbol,
  size = META,
}: {
  value: bigint;
  decimals: number;
  symbol?: string;
  size?: number | 'xs' | 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      className="tnum whitespace-nowrap"
      title={`${toDecimalString(value, decimals)}${symbol ? ` ${symbol}` : ''}`}
    >
      <Text component="span" ff="monospace" fz={size} c="var(--ink)">
        {formatTokenAmount(value, decimals, { significantDigits: 6 })}
      </Text>
      {symbol ? (
        <Text component="span" ff="monospace" fz={size} c="var(--ink-3)">
          {' '}
          {symbol}
        </Text>
      ) : null}
    </span>
  );
}

/** An address, elided in the middle, with the whole value on the clipboard. */
export function MakerAddress({ value }: { value: string }) {
  return (
    <Group gap={4} wrap="nowrap" className="min-w-0">
      <Text
        component="span"
        ff="monospace"
        fz={META}
        c="var(--ink-2)"
        className="tnum truncate"
        title={value}
      >
        {truncateAddress(value)}
      </Text>
      <CopyButton value={value} timeout={1400}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copied' : 'Copy address'} withArrow fz="xs">
            <ActionIcon
              onClick={copy}
              variant="subtle"
              color={copied ? 'moss' : 'slate'}
              size="sm"
              className={classes.tap}
              aria-label={copied ? 'Address copied' : `Copy address ${value}`}
            >
              {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

/**
 * A column header that carries the precise term for someone who wants it.
 *
 * Plain words on screen, the trader's word in the tooltip. That is the jargon rule applied to a
 * table: a newcomer is never made to learn a vocabulary to read a column, and the term is one hover
 * away rather than deleted.
 */
export function Head({
  children,
  term,
  numeric = false,
}: {
  children: ReactNode;
  /** The precise name, and one sentence saying what it means. */
  term?: ReactNode;
  numeric?: boolean;
}) {
  const label = (
    <Text
      component="span"
      fz="xs"
      fw={500}
      c="var(--ink-3)"
      className={term ? 'cursor-help underline decoration-dotted underline-offset-4' : undefined}
    >
      {children}
    </Text>
  );

  return (
    <span className={numeric ? 'block text-right' : 'block'}>
      {term ? (
        <Tooltip label={term} withArrow multiline w={280} fz="xs" position="top" openDelay={120}>
          {label}
        </Tooltip>
      ) : (
        label
      )}
    </span>
  );
}

/** A number the chain has not returned is absent, never a zero. */
export function Blank({ why }: { why?: string }) {
  return (
    <Text component="span" c="var(--ink-3)" aria-label={why}>
      &mdash;
    </Text>
  );
}

/** Live / withdrawn / past-date, in one vocabulary across both tables on this screen. */
export function StateBadge({
  tone,
  children,
  title,
}: {
  tone: 'live' | 'muted' | 'warn' | 'mine';
  children: ReactNode;
  title?: string;
}) {
  const color =
    tone === 'live' ? 'moss' : tone === 'warn' ? 'amber' : tone === 'mine' ? 'petrol' : 'slate';
  return (
    <Badge
      variant="light"
      color={color}
      size="sm"
      radius="sm"
      title={title}
      classNames={{ root: classes.badge, label: classes.badgeLabel }}
    >
      {children}
    </Badge>
  );
}
