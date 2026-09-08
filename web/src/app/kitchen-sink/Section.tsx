import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';

/**
 * One gallery section: a heading, an optional note about the decision the components encode, and a
 * hairline. Deliberately not a Card — the gallery would otherwise be a grid of identical cards,
 * which is the pattern DESIGN.md bans, and nesting the real Cards inside would break the
 * single-level rule the components enforce.
 */
export function Section({
  title,
  note,
  children,
  id,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="border-t border-line pt-6">
      <h2 className="text-title text-ink">{title}</h2>
      {note ? <p className="mt-1 max-w-prose text-meta leading-prose text-ink-3">{note}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A labelled specimen inside a section. The label names the state, not the component. */
export function Specimen({
  label,
  children,
  className,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', wide && 'col-span-full', className)}>
      <span className="text-micro uppercase text-ink-3">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** The default specimen layout: a responsive grid that keeps a row of controls on one line. */
export function SpecimenGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
