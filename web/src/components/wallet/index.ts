/**
 * The wallet surface.
 *
 * `WalletCluster` is the only thing the shell mounts; the rest are exported for screens that need
 * one piece on its own (an empty state offering `ConnectButton` as its single action, a settings
 * page reusing `NetworkGuard`).
 *
 * `ConnectWallet` is the unstyled control the `/dev` diagnostics page uses. It stays because that
 * page is a debugging surface where seeing every connector id and the raw connection status is the
 * point, and product chrome would get in the way.
 */
export { WalletCluster, ConnectButton } from './ConnectButton';
export type { ConnectButtonProps } from './ConnectButton';

export { WalletDialog } from './WalletDialog';
export type { WalletDialogProps } from './WalletDialog';

export { WalletMenu } from './WalletMenu';

export { NetworkGuard } from './NetworkGuard';
export type { NetworkGuardProps } from './NetworkGuard';

export { ConnectWallet, shortAddress } from './ConnectWallet';
export type { ConnectWalletProps } from './ConnectWallet';
