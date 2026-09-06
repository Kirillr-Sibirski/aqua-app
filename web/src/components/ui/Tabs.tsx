'use client';

import {
  createContext,
  useContext,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/ui';
import { useControllableState, focusItem, rovingIndex } from './internal';
import { ICON_STROKE, type IconComponent } from './icon';

interface TabsContextValue {
  baseId: string;
  value: string;
  setValue: (next: string) => void;
  register: (value: string, disabled: boolean) => number;
  order: { value: string; disabled: boolean }[];
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`<${component}> must be rendered inside <Tabs>`);
  return context;
}

export interface TabsProps {
  /** Controlled selection. Pair with `onValueChange`. */
  value?: string;
  /** Uncontrolled starting selection. */
  defaultValue?: string;
  onValueChange?: (next: string) => void;
  className?: string;
  children: ReactNode;
}

/**
 * Tabs over one surface: Overview / Program / Activity on a position, never top-level navigation
 * (that is a link and a URL).
 *
 * Selection follows focus, which is the WAI-ARIA "automatic activation" pattern. It is the right
 * choice here because every panel is already-fetched local state, so arrowing through tabs costs
 * nothing; a tab that triggered a request per keystroke would need manual activation instead.
 */
export function Tabs({ value, defaultValue, onValueChange, className, children }: TabsProps) {
  const baseId = useId();
  const [current, setCurrent] = useControllableState(value, defaultValue ?? '', onValueChange);
  const order = useRef<{ value: string; disabled: boolean }[]>([]);

  // Tabs register on render so arrow keys know the DOM order without children having to declare it.
  order.current = [];
  const register = (tabValue: string, disabled: boolean) => {
    const index = order.current.length;
    order.current.push({ value: tabValue, disabled });
    return index;
  };

  return (
    <TabsContext.Provider
      value={{ baseId, value: current, setValue: setCurrent, register, order: order.current }}
    >
      <div className={cn('flex flex-col', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  /** Names the set for assistive technology: "Position sections". */
  label: string;
  className?: string;
  children: ReactNode;
}

export function TabList({ label, className, children }: TabListProps) {
  const { value, setValue, order } = useTabs('TabList');
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(
    0,
    order.findIndex((tab) => tab.value === value),
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = rovingIndex(
      event.key,
      activeIndex,
      order.length,
      'horizontal',
      (index) => Boolean(order[index]?.disabled),
    );
    if (next === null) return;
    event.preventDefault();
    setValue(order[next].value);
    focusItem(listRef, next);
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn('flex items-stretch gap-4 border-b border-line', className)}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  value: string;
  icon?: IconComponent;
  /** A count beside the label: unread fills, open positions. Rendered mono. */
  count?: number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function Tab({ value, icon: Icon, count, disabled = false, className, children }: TabProps) {
  const context = useTabs('Tab');
  const index = context.register(value, disabled);
  const selected = context.value === value;

  return (
    <button
      type="button"
      role="tab"
      data-roving-item=""
      id={`${context.baseId}-tab-${value}`}
      aria-controls={`${context.baseId}-panel-${value}`}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      tabIndex={selected ? 0 : -1}
      onClick={() => setSelected(context, value, disabled)}
      className={cn(
        // -1px pulls the indicator onto the list's own hairline instead of stacking two rules.
        'relative -mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-2 text-body transition-state',
        selected
          ? 'border-accent text-ink'
          : 'border-transparent text-ink-2 hover:border-line-strong hover:text-ink',
        disabled && 'cursor-not-allowed border-transparent text-ink-3 hover:border-transparent hover:text-ink-3',
        className,
      )}
      data-index={index}
    >
      {Icon ? <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" /> : null}
      {children}
      {count !== undefined ? (
        <span className={cn('font-mono tnum text-mini', selected ? 'text-ink-2' : 'text-ink-3')}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function setSelected(context: TabsContextValue, value: string, disabled: boolean) {
  if (disabled) return;
  context.setValue(value);
}

export interface TabPanelProps {
  value: string;
  className?: string;
  children: ReactNode;
}

export function TabPanel({ value, className, children }: TabPanelProps) {
  const context = useTabs('TabPanel');
  const selected = context.value === value;

  return (
    <div
      role="tabpanel"
      id={`${context.baseId}-panel-${value}`}
      aria-labelledby={`${context.baseId}-tab-${value}`}
      hidden={!selected}
      // The panel takes focus when tabbed into, so a keyboard user lands on the content itself.
      tabIndex={0}
      className={cn('pt-4 focus-visible:outline-offset-4', className)}
    >
      {selected ? children : null}
    </div>
  );
}
