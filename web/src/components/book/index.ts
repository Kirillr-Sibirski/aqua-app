/**
 * The book screen's own vocabulary.
 *
 * These are not primitives — they are the domain, and they exist only because this product has a
 * shape no generic dashboard component covers: a balance that several positions draw on at once.
 * The primitives they are built from all come from `@/components/ui`.
 */
export { SharedInventory } from './SharedInventory';
export type { SharedInventoryProps } from './SharedInventory';

export { InventoryBar } from './InventoryBar';
export type { InventoryBarProps } from './InventoryBar';

export { KpiStrip } from './KpiStrip';
export type { KpiStripProps } from './KpiStrip';

export { LegsTable } from './LegsTable';
export type { LegsTableProps } from './LegsTable';

export { DepthCell } from './DepthCell';
export type { DepthCellProps } from './DepthCell';

export { useCountTo } from './useCountTo';
export { HATCH, pct } from './visual';
