/**
 * The primitive vocabulary.
 *
 * Everything a screen is allowed to draw with. `internal.ts` is deliberately not re-exported: the
 * focus trap, the anchored positioner and the roving index are implementation details of these
 * components, not part of the app's vocabulary.
 *
 * Import from the barrel (`@/components/ui`), not from the file, so a component can be split or
 * renamed without touching every screen.
 */

export { Button, buttonVariants } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';

export { Input, ControlShell, controlShell } from './Input';
export type { InputProps, ControlShellProps, ControlSize } from './Input';

export { NumberInput, sanitizeDecimalInput } from './NumberInput';
export type { NumberInputProps } from './NumberInput';

export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';

export { Field, useFieldControl } from './Field';
export type { FieldProps, ControlAria } from './Field';

export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentedItem } from './SegmentedControl';

export { Tabs, TabList, Tab, TabPanel } from './Tabs';
export type { TabsProps, TabListProps, TabProps, TabPanelProps } from './Tabs';

export { Card, CardRow } from './Card';
export type { CardProps } from './Card';

export { Dialog, Sheet } from './Dialog';
export type { DialogProps, SheetProps, DialogSize, OverlayProps } from './Dialog';

export { Tooltip } from './Tooltip';
export type { TooltipProps } from './Tooltip';

export { Pill, pillVariants } from './Pill';
export type { PillProps, PillTone, PillSize } from './Pill';

export { Skeleton, SkeletonText } from './Skeleton';
export type { SkeletonProps } from './Skeleton';

export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';

export {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableHeaderCell,
  TableMessageRow,
  TableSkeletonRows,
} from './Table';
export type {
  TableProps,
  TableHeadProps,
  TableRowProps,
  TableCellProps,
  TableHeaderCellProps,
} from './Table';

export { Toaster, notify } from './Toast';
export type { NotifyOptions } from './Toast';

export { CopyButton } from './CopyButton';
export type { CopyButtonProps } from './CopyButton';

export { ExplorerLink } from './ExplorerLink';
export type { ExplorerLinkProps } from './ExplorerLink';

export { Address } from './Address';
export type { AddressProps } from './Address';

export { TokenAmount } from './TokenAmount';
export type { TokenAmountProps } from './TokenAmount';

export { Delta } from './Delta';
export type { DeltaProps } from './Delta';

export { StatTile, StatRow } from './StatTile';
export type { StatTileProps } from './StatTile';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { ErrorState } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';

export { Callout, calloutVariants } from './Callout';
export type { CalloutProps, CalloutTone } from './Callout';

export { describeError } from './error';
export type { DescribedError } from './error';

export { ICON_SIZE, ICON_STROKE } from './icon';
export type { IconComponent } from './icon';
