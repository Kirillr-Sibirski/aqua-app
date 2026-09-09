'use client';

/**
 * A slot whose contents fade up when they change identity, and sit still when they do not.
 *
 * The whole component is the `key`. React reconciles a single child by type *and* key, so a
 * different `token` unmounts what was there and mounts what replaced it — which is what makes the
 * enter animation run on exactly the transitions that matter (a skeleton giving way to a figure,
 * one button label replacing another) and never on the twenty renders a streaming figure causes in
 * between. Nothing here is a timer and nothing here measures.
 *
 * It is a `<span>`, so it inherits alignment from whatever holds it: a flex item inside the primary
 * action, an inline run inside a right-aligned figure cell. It adds no box of its own.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';
import styles from './motion.module.css';

export interface RevealProps {
  /** The identity of what is being shown. A change is what triggers the transition. */
  token: string | number;
  children: ReactNode;
  className?: string;
}

export function Reveal({ token, children, className }: RevealProps) {
  return (
    <span key={token} className={cn(styles.reveal, className)}>
      {children}
    </span>
  );
}
