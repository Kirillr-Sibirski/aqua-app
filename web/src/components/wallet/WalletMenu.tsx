'use client';

/**
 * The connected-wallet control: truncated address, native balance, and a menu.
 *
 * The menu is hand-rolled rather than native, because a `<select>` cannot hold a link and a
 * `<details>` gives no roving focus. It implements the parts that matter: `aria-haspopup`/
 * `aria-expanded` on the trigger, `role="menu"` with `role="menuitem"` children, Up/Down/Home/End
 * to move, Escape and Tab to dismiss with focus returned to the trigger, and a pointerdown listener
 * for clicks outside.
 */
import { ChevronDown, Copy, ExternalLink, LogOut } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useBalance, useConnection, useDisconnect } from 'wagmi';
import type { SupportedChainId } from '@/lib/chain';
import { addressUrl, explorerFor } from '@/components/shell/explorer';
import { useDeploymentChain } from '@/components/shell/useDeploymentChain';
import { ICON_STROKE } from '@/components/ui';
import { cn, formatTokenAmount, truncateAddress } from '@/lib/ui';

export function WalletMenu({ className }: { className?: string }) {
  const { address, chainId, connector } = useConnection();
  const { mutate: disconnect } = useDisconnect();
  const deployment = useDeploymentChain();
  const menuId = useId();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The balance is only meaningful while the wallet is on the chain the terminal reads; on any
  // other chain it would be a number from somewhere else, so it is not shown at all.
  const onDeploymentChain = chainId === deployment.chainId;
  const { data: balance } = useBalance({
    address,
    chainId: onDeploymentChain ? (deployment.chainId as SupportedChainId) : undefined,
    query: { enabled: Boolean(address) && onDeploymentChain },
  });

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const focusItem = useCallback((index: number) => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;
    const clamped = ((index % items.length) + items.length) % items.length;
    items[clamped]?.focus();
  }, []);

  useEffect(() => {
    if (open) focusItem(0);
  }, [open, focusItem]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      default:
        break;
    }
  };

  if (!address) return null;

  const explorer = explorerFor(chainId);
  const copyAddress = () => {
    void navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div
      className={cn('relative', className)}
      onBlur={(event: ReactFocusEvent<HTMLDivElement>) => {
        // Tab out of the last item (or any other focus move away from the cluster) dismisses it.
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Wallet ${truncateAddress(address)}, open menu`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-2 rounded-control border border-line bg-surface pr-2 pl-3',
          'transition-state hover:border-line-strong hover:bg-surface-2',
        )}
      >
        <span className="font-mono text-meta tnum text-ink">{truncateAddress(address)}</span>
        {balance ? (
          <>
            <span aria-hidden="true" className="hidden h-3 w-px bg-line sm:block" />
            <span className="hidden font-mono text-meta tnum text-ink-3 sm:inline">
              {formatTokenAmount(balance.value, balance.decimals, {
                symbol: balance.symbol,
                significantDigits: 5,
              })}
            </span>
          </>
        ) : null}
        <ChevronDown
          size={16}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
          className={cn('shrink-0 text-ink-3 transition-state', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Wallet"
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute right-0 z-dropdown mt-2 w-64 overflow-hidden rounded-card border border-line bg-surface p-1',
            'shadow-overlay',
          )}
        >
          <div className="border-b border-line px-3 pt-2 pb-3">
            <p className="font-mono text-meta tnum break-all text-ink-2">{address}</p>
            <p className="mt-1.5 text-mini text-ink-3">
              {connector?.name ?? 'Unknown wallet'}
              {' · '}
              {onDeploymentChain ? deployment.name : `chain ${chainId ?? '?'}`}
            </p>
          </div>

          <MenuItem icon={<Copy size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />} onClick={copyAddress}>
            {copied ? 'Address copied' : 'Copy address'}
          </MenuItem>

          {explorer ? (
            <MenuItem
              as="a"
              href={addressUrl(explorer, address)}
              icon={<ExternalLink size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />}
              onClick={() => setOpen(false)}
            >
              View account on {explorer.name}
            </MenuItem>
          ) : null}

          <MenuItem
            icon={<LogOut size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />}
            onClick={() => {
              setOpen(false);
              disconnect();
            }}
            tone="danger"
          >
            Disconnect wallet
          </MenuItem>
        </div>
      ) : null}

      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Address copied' : ''}
      </span>
    </div>
  );
}

interface MenuItemProps {
  children: ReactNode;
  icon: ReactNode;
  onClick?: () => void;
  as?: 'button' | 'a';
  href?: string;
  tone?: 'default' | 'danger';
}

function MenuItem({ children, icon, onClick, as = 'button', href, tone = 'default' }: MenuItemProps) {
  const className = cn(
    'flex w-full cursor-pointer items-center gap-2.5 rounded-control px-3 py-2 text-left text-meta transition-state',
    tone === 'danger' ? 'text-neg hover:bg-neg/10' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  );

  if (as === 'a' && href) {
    return (
      <a
        role="menuitem"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={onClick}
        className={className}
      >
        <span className="shrink-0 text-ink-3">{icon}</span>
        <span className="flex-1">{children}</span>
      </a>
    );
  }

  return (
    <button role="menuitem" type="button" onClick={onClick} className={className}>
      <span className={cn('shrink-0', tone === 'danger' ? 'text-neg' : 'text-ink-3')}>{icon}</span>
      <span className="flex-1">{children}</span>
    </button>
  );
}
