'use client';

/**
 * The wallet corner. Three controls and no more: connect, the connected address, and a notice when
 * the wallet is on the wrong chain. This is not a wallet product.
 *
 * Built on the wagmi 3 config in `lib/chain` and dressed in Mantine. wagmi's connection state is
 * browser-only — the connectors have not announced themselves when the HTML is generated, and the
 * cookie the config reconnects from is read on mount — so both branches are gated behind
 * `useIsHydrated` and the server emits a placeholder of exactly the final size. Rendering either
 * branch during SSR would emit markup the hydration render disagrees with, and React repairs a
 * mismatch by throwing the server tree away.
 */
import { Alert, Button, Menu, Modal, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useState, type ReactNode } from 'react';
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi';
import { useDeploymentChain, useIsHydrated } from '@/components/shell';
import { BURNER_CONNECTOR_ID, type SupportedChainId } from '@/lib/chain';
import { truncateAddress } from '@/lib/ui';
import classes from './sell.module.css';

export interface WalletButtonProps {
  /** Rendered instead of the connect button once a wallet is attached. */
  size?: 'xs' | 'sm';
}

export function WalletButton({ size = 'sm' }: WalletButtonProps) {
  const hydrated = useIsHydrated();
  const { address } = useConnection();
  const [opened, { open, close }] = useDisclosure(false);

  if (!hydrated) return <Skeleton height={32} width={132} radius="md" />;

  if (!address) {
    return (
      <>
        <Button variant="default" size={size} radius="md" onClick={open}>
          Connect wallet
        </Button>
        <ConnectModal opened={opened} onClose={close} />
      </>
    );
  }

  return <AddressPill address={address} size={size} />;
}

/** The connected account, and the two things anyone ever wants to do with it. */
function AddressPill({ address, size }: { address: `0x${string}`; size: 'xs' | 'sm' }) {
  const { mutate: disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);

  return (
    <Menu position="bottom-end" width={200} radius="md" shadow="md">
      <Menu.Target>
        <Button variant="default" size={size} radius="md" className={classes.mono}>
          {truncateAddress(address)}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          onClick={() => {
            void navigator.clipboard?.writeText(address).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1_400);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy address'}
        </Menu.Item>
        <Menu.Item onClick={() => disconnect()}>Disconnect</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The picker.
 *
 * Mounted only while open. `useConnectors()` returns the same snapshot on the server and on the
 * client, and EIP-6963 wallets announce themselves before React hydrates, so a list rendered during
 * SSR would have no wallets in it and the hydration render would have MetaMask.
 */
export function ConnectModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Connect a wallet" size="sm" centered radius="xl">
      {opened ? <ConnectorList onClose={onClose} /> : null}
    </Modal>
  );
}

function ConnectorList({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors();
  const { mutate: connect, isPending, variables, error, reset } = useConnect();
  const { chainId, isConfigured } = useDeploymentChain();
  const target = isConfigured ? (chainId as SupportedChainId) : undefined;

  const burner = connectors.find((c) => c.id === BURNER_CONNECTOR_ID);
  const rest = connectors.filter((c) => c.id !== BURNER_CONNECTOR_ID);
  /*
   * The generic `injected()` connector, and the two things wrong with showing it.
   *
   * It is the same wallet a second time whenever any EIP-6963 wallet announced, so it only appears
   * when nothing did — and that is exactly the case where clicking it fails, because there is no
   * provider for it to reach. It also arrives named "Injected", which is a wagmi implementation
   * detail rather than a wallet, and it was the first option a first-timer saw. So it is shown only
   * when a provider is actually on `window`, and it is shown under a name that names a thing.
   *
   * This list is mounted only while the modal is open, which is client-only, so `window` is real.
   */
  const announced = rest.filter((c) => c.id !== 'injected');
  const generic = rest.find((c) => c.id === 'injected');
  const hasProvider = typeof window !== 'undefined' && 'ethereum' in window;
  const wallets = announced.length > 0 ? announced : generic && hasProvider ? [generic] : [];

  const rejected = error?.name === 'UserRejectedRequestError';

  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed" mb={4}>
        Signing stays in the wallet you pick. Nothing here ever holds the tokens behind your offer.
      </Text>

      {wallets.length === 0 ? (
        <Text size="sm" c="dimmed" px="xs" py="sm">
          No browser wallet announced itself. Install one and reload, or use the demo wallet below.
        </Text>
      ) : (
        wallets.map((connector) => (
          <ConnectorRow
            key={connector.uid}
            name={connector.id === 'injected' ? 'Browser wallet' : connector.name}
            icon={connector.icon}
            pending={isPending && variables?.connector === connector}
            onClick={() => {
              reset();
              connect({ connector, chainId: target }, { onSuccess: onClose });
            }}
          />
        ))
      )}

      {burner ? (
        <>
          <Text size="xs" c="dimmed" mt="xs" px="xs">
            No extension installed?
          </Text>
          <ConnectorRow
            name="Demo wallet"
            detail="Signs locally with the fork's own key. Never use it on a live network."
            pending={isPending && variables?.connector === burner}
            onClick={() => {
              reset();
              connect({ connector: burner, chainId: target }, { onSuccess: onClose });
            }}
          />
        </>
      ) : null}

      {error ? (
        <Alert color={rejected ? 'slate' : 'ember'} variant="light" mt="xs" radius="lg">
          {rejected ? 'Connection cancelled in the wallet. Pick one to try again.' : error.message}
        </Alert>
      ) : null}
    </Stack>
  );
}

function ConnectorRow({
  name,
  detail,
  icon,
  pending,
  onClick,
}: {
  name: string;
  detail?: string;
  icon?: string;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton className={classes.connector} onClick={onClick} disabled={pending} data-pending={pending || undefined}>
      <span className={classes.connectorIcon} aria-hidden="true">
        {icon ? (
          // Wallet icons arrive as data URIs from the EIP-6963 announcement; there is no remote URL
          // for next/image to optimise and no build-time size to give it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" width={28} height={28} />
        ) : (
          name.slice(0, 1).toUpperCase()
        )}
      </span>
      <span className={classes.connectorText}>
        <Text size="sm">{name}</Text>
        {/* Wraps rather than truncates: the demo connector's detail is a safety string, and a
            warning is the one string that must never be ellipsized. */}
        {detail ? (
          <Text size="xs" c="dimmed" lh={1.4}>
            {detail}
          </Text>
        ) : null}
      </span>
      {pending ? (
        <Text size="xs" c="dimmed">
          Waiting
        </Text>
      ) : null}
    </UnstyledButton>
  );
}

/**
 * Wrong-network notice, inline rather than modal.
 *
 * Every number on the card is read from the chain the deployment manifest names, not from the
 * wallet's, so they are all still correct — only publishing would fail. The notice says so and
 * offers the one control that fixes it.
 */
export function NetworkNotice({ children }: { children?: ReactNode }) {
  const hydrated = useIsHydrated();
  const { address, chainId, chain } = useConnection();
  const deployment = useDeploymentChain();
  const { mutate: switchChain, isPending } = useSwitchChain();

  if (!hydrated || !address || deployment.isLoading) return null;
  if (chainId === deployment.chainId) return null;

  return (
    <Alert color="amber" variant="light" radius="lg" title={`Your wallet is on ${chain?.name ?? `chain ${chainId}`}`}>
      <Text size="sm" mb={deployment.isConfigured ? 'xs' : 0}>
        {deployment.isConfigured
          ? `The prices here are read from ${deployment.name}, so they are right. Publishing will fail until the wallet is on the same network.`
          : `This app is not configured for chain ${deployment.chainId}, which is where the offers live.`}
      </Text>
      {deployment.isConfigured ? (
        <Button
          size="xs"
          variant="default"
          radius="md"
          loading={isPending}
          onClick={() => switchChain({ chainId: deployment.chainId as SupportedChainId })}
        >
          Switch to {deployment.name}
        </Button>
      ) : null}
      {children}
    </Alert>
  );
}
