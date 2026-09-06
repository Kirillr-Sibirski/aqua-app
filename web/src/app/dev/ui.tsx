'use client';

/** Tiny presentational helpers for the diagnostics page. Deliberately plain — not the product UI. */
import type { ReactNode } from 'react';
import type { TxStep } from '@/hooks';

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border border-black/15 dark:border-white/20 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="font-semibold">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

export function KV({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-44 shrink-0 opacity-60">{k}</span>
      <span className={mono ? 'font-mono break-all' : 'break-all'}>{v}</span>
    </div>
  );
}

export function Err({ error }: { error?: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <p className="text-red-600 whitespace-pre-wrap break-all">{message.split('\n').slice(0, 6).join('\n')}</p>;
}

/** Per-transaction progress: label → status → hash → receipt status/gas. */
export function TxSteps({ steps }: { steps: TxStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mt-2 space-y-1">
      {steps.map((s) => (
        <li key={s.id} className="font-mono text-xs break-all">
          <span className="inline-block w-40 opacity-70">{s.label}</span>
          <span
            className={
              s.status === 'success'
                ? 'text-green-700'
                : s.status === 'reverted' || s.status === 'error'
                  ? 'text-red-600'
                  : ''
            }
          >
            [{s.status}]
          </span>{' '}
          {s.hash ? <span title="transaction hash">{s.hash}</span> : null}
          {s.receipt ? (
            <span className="opacity-70">
              {' '}
              receipt={s.receipt.status} block={String(s.receipt.blockNumber)} gas={String(s.receipt.gasUsed)}
            </span>
          ) : null}
          {s.error ? <span className="text-red-600"> {s.error}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs opacity-60">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = 'border border-black/25 dark:border-white/30 bg-transparent px-1.5 py-0.5 font-mono text-sm';
export const buttonClass = 'border border-black/40 dark:border-white/40 px-2 py-0.5 disabled:opacity-40';
