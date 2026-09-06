/**
 * "Burner" connector for wagmi v3: a wallet backed by a local private key (no browser extension).
 *
 * Used for the no-wallet demo mode against the anvil fork. wagmi honours `connector.getClient`, so
 * every `useWriteContract` / `useWalletClient` call signs locally with viem's `privateKeyToAccount`
 * and broadcasts via `eth_sendRawTransaction` — it works for any key, not only anvil's unlocked ones.
 *
 * Env: NEXT_PUBLIC_DEMO_PRIVATE_KEY (default: anvil account #1).
 */
import { ChainNotConfiguredError, createConnector } from 'wagmi';
import {
  createWalletClient,
  hexToBigInt,
  http,
  numberToHex,
  SwitchChainError,
  type Account,
  type Address,
  type Chain,
  type EIP1193RequestFn,
  type Hex,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** Anvil's default mnemonic accounts (first three). */
export const ANVIL_ACCOUNTS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
] as const satisfies readonly { address: Address; privateKey: Hex }[];

export const ANVIL_ACCOUNT_1_PRIVATE_KEY: Hex = ANVIL_ACCOUNTS[1].privateKey;

/** Private key for demo mode: NEXT_PUBLIC_DEMO_PRIVATE_KEY or anvil account #1. */
export const DEMO_PRIVATE_KEY: Hex = (process.env.NEXT_PUBLIC_DEMO_PRIVATE_KEY as Hex | undefined) ?? ANVIL_ACCOUNT_1_PRIVATE_KEY;

export const BURNER_CONNECTOR_ID = 'burner';

export type BurnerParameters = {
  privateKey: Hex;
  /** Connector display name. */
  name?: string;
  /** Connector id (default 'burner'); change it if you register several burners. */
  id?: string;
};

type BurnerProvider = { request: EIP1193RequestFn };
type BurnerClient = WalletClient<Transport, Chain, Account>;

burner.type = 'burner' as const;

export function burner(parameters: BurnerParameters) {
  const account = privateKeyToAccount(parameters.privateKey);
  const storageKey = `${parameters.id ?? BURNER_CONNECTOR_ID}.connected`;
  const clients = new Map<number, BurnerClient>();
  let currentChainId: number | undefined;
  let connected = false;

  return createConnector<BurnerProvider>((config) => {
    const chainFor = (chainId?: number): Chain => {
      const id = chainId ?? currentChainId ?? config.chains[0].id;
      const chain = config.chains.find((c) => c.id === id);
      if (!chain) throw new SwitchChainError(new ChainNotConfiguredError());
      return chain;
    };

    const clientFor = (chainId?: number): BurnerClient => {
      const chain = chainFor(chainId);
      let client = clients.get(chain.id);
      if (!client) {
        client = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });
        clients.set(chain.id, client);
      }
      return client;
    };

    const switchTo = (chainId: number): Chain => {
      const chain = chainFor(chainId);
      currentChainId = chain.id;
      config.emitter.emit('change', { chainId: chain.id });
      return chain;
    };

    return {
      id: parameters.id ?? BURNER_CONNECTOR_ID,
      name: parameters.name ?? `Demo wallet (${account.address.slice(0, 6)}…${account.address.slice(-4)})`,
      type: burner.type,

      async setup() {
        currentChainId = config.chains[0].id;
      },

      async connect({ chainId, withCapabilities }: { chainId?: number; isReconnecting?: boolean; withCapabilities?: boolean } = {}) {
        const chain = chainFor(chainId);
        currentChainId = chain.id;
        connected = true;
        await config.storage?.setItem(storageKey, true);
        const accounts = withCapabilities ? [{ address: account.address, capabilities: {} }] : [account.address];
        return { accounts, chainId: chain.id } as never;
      },

      async disconnect() {
        connected = false;
        await config.storage?.removeItem(storageKey);
      },

      async getAccounts() {
        return [account.address] as readonly Address[];
      },

      async getChainId() {
        return currentChainId ?? config.chains[0].id;
      },

      async isAuthorized() {
        if (connected) return true;
        const persisted = await config.storage?.getItem(storageKey);
        return persisted === true;
      },

      async switchChain({ chainId }: { chainId: number }) {
        return switchTo(chainId);
      },

      async getClient({ chainId }: { chainId?: number } = {}) {
        return clientFor(chainId);
      },

      /** Minimal EIP-1193 shim: signs locally, forwards everything else to the chain RPC. */
      async getProvider({ chainId }: { chainId?: number } = {}) {
        const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
          const client = clientFor(chainId);
          const p = (params ?? []) as unknown[];
          switch (method) {
            case 'eth_accounts':
            case 'eth_requestAccounts':
              return [account.address];
            case 'eth_chainId':
              return numberToHex(currentChainId ?? client.chain.id);
            case 'wallet_switchEthereumChain': {
              const target = (p[0] as { chainId: Hex }).chainId;
              switchTo(Number(hexToBigInt(target)));
              return null;
            }
            case 'eth_sendTransaction': {
              const tx = p[0] as { to?: Address; data?: Hex; value?: Hex; gas?: Hex };
              return client.sendTransaction({
                to: tx.to,
                data: tx.data,
                value: tx.value ? hexToBigInt(tx.value) : undefined,
                gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
              });
            }
            case 'personal_sign':
              return account.signMessage({ message: { raw: p[0] as Hex } });
            case 'eth_signTypedData_v4':
              return account.signTypedData(JSON.parse(p[1] as string));
            default:
              return client.request({ method, params } as never);
          }
        };
        return { request: request as EIP1193RequestFn };
      },

      onAccountsChanged() {
        // single fixed account — nothing to do
      },
      onChainChanged(chainId: string) {
        config.emitter.emit('change', { chainId: Number(chainId) });
      },
      async onDisconnect() {
        connected = false;
        await config.storage?.removeItem(storageKey);
        config.emitter.emit('disconnect');
      },
    };
  });
}
