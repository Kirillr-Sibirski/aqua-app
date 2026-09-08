'use client';

/**
 * The transaction plan, and what actually happened to it.
 *
 * `useTxFlow` runs a sequence and records per-step state. *Skipped* is not a failure and is the
 * common case for an allowance step that was already sufficient. Hashes appear as soon as they
 * exist rather than after the receipt, because the seconds between the two are exactly when someone
 * wants to look the transaction up — and on the fork there is nowhere to look it up, so the hash
 * comes with a copy button instead of a dead link.
 */
import { ActionIcon, CopyButton, Group, Loader, Text, Tooltip } from '@mantine/core';
import { Check, CircleDashed, Copy, Minus, OctagonAlert } from 'lucide-react';
import { explorerFor, isForkOfBase, txUrl } from '@/components/shell';
import { truncateHash } from '@/lib/ui';
import type { TxStep, TxStepStatus } from '@/hooks';

export interface TxStepsProps {
  steps: readonly TxStep[];
  chainId?: number;
  /** Shown while nothing has been attempted yet. */
  plan?: readonly string[];
}

const LABEL: Record<TxStepStatus, string> = {
  idle: 'Queued',
  signing: 'Waiting for your signature',
  pending: 'Sent',
  success: 'Done',
  reverted: 'Reverted',
  error: 'Failed',
  skipped: 'Not needed',
};

const TONE: Record<TxStepStatus, string> = {
  idle: 'var(--ink-3)',
  signing: 'var(--accent)',
  pending: 'var(--accent)',
  success: 'var(--pos)',
  reverted: 'var(--neg)',
  error: 'var(--neg)',
  skipped: 'var(--ink-3)',
};

function Glyph({ status }: { status: TxStepStatus }) {
  const size = 14;
  if (status === 'signing' || status === 'pending') return <Loader size={12} color="var(--accent)" />;
  if (status === 'success') return <Check size={size} strokeWidth={2} color="var(--pos)" />;
  if (status === 'skipped') return <Minus size={size} strokeWidth={2} color="var(--ink-3)" />;
  if (status === 'reverted' || status === 'error')
    return <OctagonAlert size={size} strokeWidth={1.75} color="var(--neg)" />;
  return <CircleDashed size={size} strokeWidth={1.75} color="var(--ink-3)" />;
}

export function TxSteps({ steps, chainId, plan }: TxStepsProps) {
  const explorer = explorerFor(chainId);
  const linkable = explorer && !isForkOfBase(chainId);

  if (steps.length === 0) {
    if (!plan || plan.length === 0) return null;
    return (
      <ol className="flex flex-col gap-1.5">
        {plan.map((label) => (
          <li key={label} className="flex items-center gap-2">
            <CircleDashed size={14} strokeWidth={1.75} color="var(--ink-3)" />
            <Text size="xs" c="var(--ink-3)">
              {label}
            </Text>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step) => (
        <li key={step.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Glyph status={step.status} />
          <Text size="xs" c="var(--ink)" className="min-w-0">
            {step.label}
          </Text>
          <Text size="xs" c={TONE[step.status]}>
            {LABEL[step.status]}
          </Text>
          {step.hash ? (
            <Group gap={4} align="center" wrap="nowrap">
              {linkable && explorer ? (
                <a
                  href={txUrl(explorer, step.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-mini tnum text-accent underline underline-offset-2"
                >
                  {truncateHash(step.hash)}
                </a>
              ) : (
                <span className="font-mono text-mini tnum text-ink-3">{truncateHash(step.hash)}</span>
              )}
              <CopyButton value={step.hash} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copied' : 'Copy hash'} withArrow>
                    <ActionIcon size="xs" variant="subtle" color="gray" className="tap-44" onClick={copy}>
                      <Copy size={12} strokeWidth={1.75} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          ) : null}
          {step.error ? (
            <Text size="xs" c="var(--neg)" className="w-full font-mono break-all">
              {step.error}
            </Text>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
