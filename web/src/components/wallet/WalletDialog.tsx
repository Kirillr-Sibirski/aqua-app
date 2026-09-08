'use client';

/**
 * Wallet picker.
 *
 * The connector list is mounted only while the dialog is open. `useConnectors()` returns the same
 * snapshot on the server and on the client, and EIP-6963 wallets announce themselves before React
 * hydrates — so rendering that list during SSR would produce server HTML with no wallets and a
 * hydration render with MetaMask in it. Keeping it behind the open flag means the list is only ever
 * built in the browser, from what the browser actually announced.
 */
import type { ReactNode } from 'react';
import { useConnect, useConnectors } from 'wagmi';
import { BURNER_CONNECTOR_ID, type SupportedChainId } from '@/lib/chain';
import { cn } from '@/lib/ui';
import { Callout, Dialog, Pill, Spinner } from '@/components/ui';

export interface WalletDialogProps {
  open: boolean;
  onClose: () => void;
  /** Chain to connect on. Defaults to whatever wagmi picks. */
  chainId?: SupportedChainId;
}

export function WalletDialog({ open, onClose, chainId }: WalletDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Connect a wallet"
      description="Signing stays in the wallet you pick. Aqua never takes custody of the tokens backing your legs."
      bodyClassName="px-2 py-2"
    >
      {open ? <WalletList onClose={onClose} chainId={chainId} /> : null}
    </Dialog>
  );
}

function WalletList({ onClose, chainId }: { onClose: () => void; chainId?: SupportedChainId }) {
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
      {wallets.length === 0 ? (
        <p className="px-3 py-4 text-meta leading-prose text-ink-3">
          No browser wallet announced itself. Install MetaMask or Rabby and reload, or use the demo
          wallet below.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {wallets.map((connector) => (
            <li key={connector.uid}>
              <ConnectorRow
                name={connector.name}
                detail={rdnsOf(connector.rdns)}
                icon={connector.icon}
                pending={isPending && variables?.connector === connector}
                onClick={() => {
                  reset();
                  connect({ connector, chainId }, { onSuccess: onClose });
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
            detail="Signs locally with the fork's maker key. Never use it on a live network."
            badge={<Pill tone="accent">Fork</Pill>}
            pending={isPending && variables?.connector === burner}
            onClick={() => {
              reset();
              connect({ connector: burner, chainId }, { onSuccess: onClose });
            }}
          />
        </>
      ) : null}

      {error ? (
        <div className="px-1 pt-3">
          {rejected ? (
            <p className="px-2 text-meta leading-prose text-ink-2">
              Connection cancelled in the wallet. Pick a wallet to try again.
            </p>
          ) : (
            <Callout tone="error" title="Could not connect">
              {error.message}
            </Callout>
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
        {/* Wraps. The demo connector's detail is a safety string -- "Signs locally with the fork's
            maker key. Never use it on a live network." -- and `truncate` cut it at "Never u…",
            which is exactly the clause that matters. A warning is the one string that must not be
            ellipsized. */}
        {detail ? <span className="block text-mini leading-prose text-ink-3">{detail}</span> : null}
      </span>
      {pending ? (
        <span className="flex shrink-0 items-center gap-2 text-mini text-ink-3">
          <Spinner />
          Waiting on wallet
        </span>
      ) : (
        badge
      )}
    </button>
  );
}
