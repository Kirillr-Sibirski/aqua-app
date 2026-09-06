import { cn } from '@/lib/ui';
import styles from './motion.module.css';

export interface SpinnerProps {
  /** 16px inside controls, 20px standing alone. */
  size?: 16 | 20;
  className?: string;
}

/**
 * The busy indicator. Always `aria-hidden`: the state is announced by `aria-busy` on the control
 * that owns it, so a screen reader hears it once rather than twice.
 *
 * DESIGN.md rules out spinners for *data* loading (that is what Skeleton is for). This one exists
 * only for a control that has been pressed and is waiting on a signature or a receipt.
 */
export function Spinner({ size = 16, className }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn(styles.spin, 'shrink-0', className)}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.28" />
      <path
        d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
