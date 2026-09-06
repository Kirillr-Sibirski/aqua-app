'use client';

/**
 * Wallet picker.
 *
 * Built on the native `<dialog>` element, so the focus trap, the Escape key, the top layer and the
 * `::backdrop` come from the platform rather than from a hand-rolled portal.
 *
 * The connector list is mounted only while the dialog is open. `useConnectors()` returns the same
 * snapshot on the server and on the client, and EIP-6963 wallets announce themselves before React
 * hydrates — so rendering that list during SSR would produce server HTML with no wallets and a
 * hydration render with MetaMask in it. Keeping it behind the open flag means the list is only ever
 * built in the browser, from what the browser actually announced.
 */
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useConnect, useConnectors } from 'wagmi';
import { BURNER_CONNECTOR_ID, type SupportedChainId } from '@/lib/chain';
import { cn } from '@/lib/ui';
import { ShellCallout, ShellIconButton, ShellPill } from '@/components/shell/primitives';

export interface WalletDialogProps {
  open: boolean;
  onClose: () => void;
  /** Chain to connect on. Defaults to whatever wagmi picks. */
  chainId?: SupportedChainId;
}

export function WalletDialog({ open, onClose, chainId }: WalletDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // A click that lands on the dialog box itself is a click on the backdrop: the box is fully
        // covered by its own children.
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="wallet-dialog-title"
      className={cn(
        'm-auto w-[min(26rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-0 text-ink',
        'shadow-overlay [&::backdrop]:bg-scrim',
        'transition-[opacity,translate,display,overlay] transition-discrete duration-(--duration-slow) ease-out-quart',
        'starting:open:translate-y-1 starting:open:opacity-0',
      )}
    >
      {open ? <WalletDialogBody onClose={onClose} chainId={chainId} /> : null}
    </dialog>
  );
}

function WalletDialogBody({ onClose, chainId }: { onClose: () => void; chainId?: SupportedChainId }) {
  const connectors = useConnectors();
  const { mutate: connect, isPending, variables, error, reset } = useConnect();

  const burner = connectors.find((c) => c.id === BURNER_CONNECTOR_ID);
  const rest = connectors.filter((c) => c.id !== BURNER_CONNECTOR_ID);
  // EIP-6963 connectors are keyed by rdns and carry a name and an icon. The generic `injected()`
  // connector is the same wallet a second time whenever any of them announced, so it is only shown
  // when nothing did.
  const announced = rest.filter((c) => c.id !== 'injected');
  const generic = rest.find((c) => c.id === 'injected');
  const wallets = announced.length > 0 ? announced : generic ? [generic] : [];

  const rejected = error?.name === 'UserRejectedRequestError';

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 id="wallet-dialog-title" className="text-lead font-medium text-ink">
            Connect a wallet
          </h2>
          <p className="mt-1 text-mini leading-prose text-ink-3">
            Signing stays in the wallet you pick. Aqua never takes custody of the tokens you ship.
          </p>
        </div>
        <ShellIconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </ShellIconButton>
      </div>

      <div className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
        {wallets.length === 0 ? (
          <p className="px-3 py-4 text-meta leading-prose text-ink-3">
            No browser wallet announced itself. Install MetaMask or Rabby and reload, or use the demo
            wallet below.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {wallets.map((connector) => (
              <li key={connector.uid}>
                <ConnectorRow
                  name={connector.name}
                  detail={rdnsOf(connector.rdns)}
                  icon={connector.icon}
                  pending={isPending && variables?.connector === connector}
                  onClick={() => {
                    reset();
                    connect({ connector, chainId });
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {burner ? (
          <>
            <p className="mt-3 mb-1 px-3 text-mini text-ink-3">No extension installed?</p>
            <ConnectorRow
              name="Demo wallet (local fork)"
              detail="Signs locally with the fork's maker key"
              badge={<ShellPill tone="accent">Fork</ShellPill>}
              pending={isPending && variables?.connector === burner}
              onClick={() => {
                reset();
                connect({ connector: burner, chainId });
              }}
            />
          </>
        ) : null}
      </div>

      {error ? (
        <div className="px-3 pb-3">
          {rejected ? (
            <p className="px-2 text-meta text-ink-2">
              Connection cancelled in the wallet. Pick a wallet to try again.
            </p>
          ) : (
            <ShellCallout tone="error" title="Could not connect">
              {error.message}
            </ShellCallout>
          )}
        </div>
      ) : null}
    </>
  );
}

function rdnsOf(rdns: string | readonly string[] | undefined): string | undefined {
  if (typeof rdns === 'string') return rdns;
  if (Array.isArray(rdns)) return rdns[0];
  return undefined;
}

interface ConnectorRowProps {
  name: string;
  detail?: string;
  icon?: string;
  badge?: ReactNode;
  pending: boolean;
  onClick: () => void;
}

function ConnectorRow({ name, detail, icon, badge, pending, onClick }: ConnectorRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition-state',
        'hover:bg-surface-2 disabled:pointer-events-none',
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-control border border-line bg-surface-2">
        {icon ? (
          // Wallet icons arrive as data URIs from the EIP-6963 announcement; there is no remote URL
          // for next/image to optimise and no build-time size to give it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" width={32} height={32} className="size-8 object-cover" />
        ) : (
          <span aria-hidden="true" className="font-mono text-meta text-ink-3">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-ink">{name}</span>
        {detail ? <span className="block truncate text-mini text-ink-3">{detail}</span> : null}
      </span>
      {pending ? (
        <span className="shrink-0 text-mini text-ink-3">Waiting on wallet</span>
      ) : (
        badge
      )}
    </button>
  );
}
