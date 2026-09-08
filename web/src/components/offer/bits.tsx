'use client';

/**
 * The small pieces this screen repeats: a titled panel, a labelled number, a definition row, and
 * the one component the jargon policy turns on.
 *
 * `Term` is that one. The rule for this app is *first contact is plain, depth is available*: the
 * label a reader meets is the plain phrase, and the precise word — strike, implied volatility,
 * theta, deliverable depth — arrives in the tooltip behind it, never the other way round. A
 * newcomer is never asked to guess a word to get through the screen; an options trader is never
 * asked to accept that the product does not know the real one.
 */
import type { ReactNode } from 'react';
import { Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { cn } from '@/lib/ui';

export interface PanelProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Drop the inner padding, for a panel whose body is a full-bleed table. */
  flush?: boolean;
  className?: string;
  id?: string;
}

export function Panel({ title, description, actions, children, flush, className, id }: PanelProps) {
  return (
    <Paper
      id={id}
      component="section"
      withBorder
      bg="var(--surface)"
      className={cn('overflow-hidden', className)}
    >
      <div className={cn('flex flex-col gap-1 px-4 pt-4', flush ? 'pb-3' : 'pb-0')}>
        <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
          <Text component="h2" fw={500} size="md" c="var(--ink)">
            {title}
          </Text>
          {actions}
        </Group>
        {description ? (
          <Text size="xs" c="var(--ink-2)" className="max-w-prose leading-prose">
            {description}
          </Text>
        ) : null}
      </div>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </Paper>
  );
}

/**
 * A plain phrase with the precise term underneath it.
 *
 * Rendered as a dotted underline rather than an icon: an icon is a second thing to notice, and the
 * underline reads as "there is more here" in every document convention a person already has.
 */
export function Term({ children, precise }: { children: ReactNode; precise: ReactNode }) {
  return (
    <Tooltip
      label={precise}
      multiline
      w={280}
      withArrow
      openDelay={120}
      events={{ hover: true, focus: true, touch: true }}
    >
      <span
        tabIndex={0}
        className="cursor-help rounded-control underline decoration-line-strong decoration-dotted underline-offset-4 focus-visible:focus-ring"
      >
        {children}
      </span>
    </Tooltip>
  );
}

export interface FigureProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  detail?: ReactNode;
  /** Colour the number takes: money colours are earned, never decoration. */
  tone?: 'ink' | 'pos' | 'neg' | 'warn' | 'accent';
  size?: 'md' | 'lg';
}

const TONE: Record<NonNullable<FigureProps['tone']>, string> = {
  ink: 'var(--ink)',
  pos: 'var(--pos)',
  neg: 'var(--neg)',
  warn: 'var(--warn)',
  accent: 'var(--accent)',
};

export function Figure({ label, value, unit, detail, tone = 'ink', size = 'md' }: FigureProps) {
  return (
    <Stack gap={2} className="min-w-0">
      <Text size="xs" c="var(--ink-3)">
        {label}
      </Text>
      <Text
        ff="var(--font-mono)"
        c={TONE[tone]}
        className={cn('tnum leading-num', size === 'lg' ? 'text-title' : 'text-lead')}
      >
        {value}
        {unit ? <span className="ml-1.5 text-meta text-ink-3">{unit}</span> : null}
      </Text>
      {detail ? (
        <Text size="xs" c="var(--ink-3)" className="leading-prose">
          {detail}
        </Text>
      ) : null}
    </Stack>
  );
}

/**
 * A section's name and its one sentence, on the page ground rather than inside a card.
 *
 * Charts arrive already carded — `ChartFrame` draws its own border and surface — and DESIGN.md
 * rules out nesting one card inside another, so the heading that introduces a pair of charts sits
 * on the ground above them instead of wrapping them.
 */
export function SectionHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Text component="h2" fw={500} size="md" c="var(--ink)">
        {title}
      </Text>
      {children ? (
        <Text size="sm" c="var(--ink-2)" className="max-w-prose leading-prose">
          {children}
        </Text>
      ) : null}
    </div>
  );
}

/** One line of a definition list: a plain label on the left, a mono value on the right. */
export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <dt className="min-w-0 text-meta text-ink-2">{label}</dt>
      <dd className="shrink-0 text-right font-mono text-meta tnum text-ink">{children}</dd>
    </div>
  );
}

/** Numbers, monospace and tabular, wherever they appear inside a sentence. */
export function Num({ children }: { children: ReactNode }) {
  return <span className="font-mono tnum">{children}</span>;
}
