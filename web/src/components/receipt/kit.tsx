/**
 * The primitives the receipt draws with, on Mantine.
 *
 * No `'use client'`: the receipt is a server component on purpose, so the whole comparison — every
 * table, every uncomfortable row — is in the HTML before a line of JavaScript runs. Mantine's own
 * components carry their `'use client'` directive and still server-render, so the page keeps that
 * property. The one thing deliberately not used here is Mantine's `Tooltip`, which needs a mounted
 * listener: a column header that wants to name its precise term does it with a `title` attribute,
 * which works with scripting off.
 */
import type { ReactNode } from 'react';
import { Badge, Group, Stack, Text } from '@mantine/core';

/** 13px: the dense table step, between Mantine's `xs` (12) and `sm` (14). */
export const META = 13;

/**
 * The label this page can never be read without.
 *
 * It is on the title block, on the banner, on every section that carries a modelled figure and in
 * the caption of every table. That is not over-labelling: the numbers are good enough to be
 * mistaken for a track record, and no capital has ever traded this book.
 */
export function SimBadge({ children = 'Simulation' }: { children?: ReactNode }) {
  return (
    <Badge variant="light" color="amber" size="sm" radius="sm">
      {children}
    </Badge>
  );
}

/** A section: one heading, optionally a plain-English paragraph, then the numbers. */
export function Section({
  title,
  body,
  badge,
  children,
}: {
  title: string;
  body?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="max-w-prose">
        <Group gap="xs" align="center" wrap="wrap">
          <Text component="h2" fz="lg" fw={600} c="var(--ink)">
            {title}
          </Text>
          {badge}
        </Group>
        {body ? (
          <Text mt={6} fz="sm" lh={1.5} c="var(--ink-2)">
            {body}
          </Text>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * One figure with its label.
 *
 * 20px mono, not a display step. DESIGN.md bans hero metrics, and on a page whose whole argument is
 * "this is a model, read it sceptically" a shouted number would be working against the text.
 */
export function Stat({
  label,
  value,
  unit,
  detail,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <Stack gap={4} className="min-w-0">
      <Text fz="xs" c="var(--ink-3)">
        {label}
      </Text>
      <Group gap={6} align="baseline" wrap="nowrap">
        <Text ff="monospace" fz="lg" fw={500} c="var(--ink)" className="tnum truncate">
          {value}
        </Text>
        {unit ? (
          <Text ff="monospace" fz="xs" c="var(--ink-3)" className="tnum shrink-0">
            {unit}
          </Text>
        ) : null}
      </Group>
      {detail ? (
        <Text fz="xs" lh={1.4} c="var(--ink-3)">
          {detail}
        </Text>
      ) : null}
    </Stack>
  );
}

/**
 * A column header, with the precise term on `title` for whoever wants it.
 *
 * Plain words on screen, the trader's word one hover away — and, because it is an attribute rather
 * than a mounted popover, it survives the page being read with scripting off.
 */
export function Head({
  children,
  term,
  numeric = false,
}: {
  children: ReactNode;
  term?: string;
  numeric?: boolean;
}) {
  return (
    <Text
      component="span"
      fz="xs"
      fw={500}
      c="var(--ink-3)"
      title={term}
      className={[
        numeric ? 'block text-right' : 'block',
        term ? 'cursor-help underline decoration-dotted underline-offset-4' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Text>
  );
}

/** A signed dollar figure, coloured only where the sign is the whole point. */
export function Signed({ text, micro }: { text: string; micro: number }) {
  const c = micro > 0 ? 'var(--pos)' : micro < 0 ? 'var(--neg)' : 'var(--ink-3)';
  return (
    <Text component="span" c={c} className="tnum">
      {text}
    </Text>
  );
}
