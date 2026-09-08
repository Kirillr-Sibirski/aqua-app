'use client';

/**
 * One clause of the sentence.
 *
 * Read top to bottom the three of these say "Sell 10.4 WETH / if it reaches 2,600 / by Fri 11 Sep",
 * so the label is the connective word rather than a form caption, and the control is the only thing
 * on its line. The foot carries whatever makes the number checkable — the balance, the distance
 * from today's price, how far away the date is — because that is what someone looks at before they
 * change it.
 */
import type { ReactNode } from 'react';
import classes from './sell.module.css';

export interface FieldProps {
  label: string;
  /** The control, on its own line, at display size. */
  children: ReactNode;
  /** The denomination. Static text: this is not a token picker. */
  unit?: ReactNode;
  /** Left of the foot: what the number is being compared against. */
  hint?: ReactNode;
  /** Right of the foot: at most one action, e.g. "Max". */
  action?: ReactNode;
  invalid?: boolean;
}

export function Field({ label, children, unit, hint, action, invalid }: FieldProps) {
  return (
    <div className={classes.field} data-invalid={invalid || undefined}>
      <span className={classes.fieldLabel}>{label}</span>
      <div className={classes.fieldRow}>
        {children}
        {unit ? <span className={classes.unit}>{unit}</span> : null}
      </div>
      <div className={classes.fieldFoot}>
        <span>{hint}</span>
        {action}
      </div>
    </div>
  );
}
