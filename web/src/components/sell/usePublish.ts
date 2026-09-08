'use client';

/**
 * Publishing, as one action.
 *
 * Three transactions can be involved and the person pressing the button should not have to know
 * that. One approval per token to the **official Aqua registry** — not to our router, because
 * `Aqua.pull` is what calls `transferFrom(maker, taker, amount)` at fill time — and then one
 * `Aqua.ship`. Each approval reads its allowance first and returns without sending anything when it
 * is already sufficient, so the common case really is a single signature and the progress strip
 * says "already allowed" rather than asking for a redundant one.
 *
 * Both tokens are approved, not just the one being sold. The offer is a two-sided quote: a taker
 * can buy the asset from it, which is the sale, or sell into it, which is how the offer buys back
 * cheaper than it sold. `Coverage` reads the allowance as half of what it will let out, so an
 * unapproved token is simply a direction that refuses — safe, and less than the offer is worth.
 *
 * `ship` moves no tokens. It writes the virtual balance and emits `Shipped` plus a `Pushed` per
 * token; the wallet is untouched until somebody actually fills. The receipt check on the result
 * panel counts the ERC-20 `Transfer` logs rather than repeating the claim.
 */
import { useCallback } from 'react';
import { erc20Abi, maxUint256, type Address, type Hex } from 'viem';
import { useConfig, useConnection, useWriteContract } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { aquaFork } from '@/lib/chain';
import { aquaAbi } from '@/lib/contracts';
import { encodeStrategyForShip } from '@/lib/swapvm';
import { useTxFlow, type TxPlanStep } from '@/hooks';
import type { OfferPair, SizedOffer } from './types';

export interface PublishParams {
  aqua: Address;
  router: Address;
  pair: OfferPair;
  offer: SizedOffer;
}

export interface PublishResult {
  strategyHash: Hex;
  /** The hash of the `ship` itself, which is the one worth showing. */
  shipHash?: Hex;
  /** Every hash the run produced, approvals included. */
  hashes: Hex[];
  /** ERC-20 `Transfer` logs across all of them. The claim is zero. */
  transfers: number;
}

/** `Transfer(address,address,uint256)`. */
const ERC20_TRANSFER_TOPIC: Hex = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export function usePublishOffer() {
  const chainId = aquaFork.id;
  const config = useConfig();
  const { address } = useConnection();
  const { mutateAsync: writeContract } = useWriteContract();
  const { run, steps, isRunning, error, reset } = useTxFlow(chainId);

  const publish = useCallback(
    async ({ aqua, router, pair, offer }: PublishParams): Promise<PublishResult> => {
      if (!address) throw new Error('wallet not connected');

      const approvals: TxPlanStep[] = (
        [
          [pair.risky, offer.riskyRaw],
          [pair.stable, offer.stableRaw],
        ] as const
      )
        .filter(([, needed]) => needed > BigInt(0))
        .map(([token, needed]) => ({
          label: `Allow ${token.symbol}`,
          send: async () => {
            const allowance = await readContract(config, {
              address: token.address,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [address, aqua],
              chainId,
            });
            // The allowance is half of what `Coverage` will let out, so an existing sufficient one
            // is left alone rather than reset and re-granted.
            if (allowance >= needed) return undefined;
            return writeContract({
              address: token.address,
              abi: erc20Abi,
              functionName: 'approve',
              args: [aqua, maxUint256],
              chainId,
            });
          },
        }));

      const ship: TxPlanStep = {
        label: 'Publish the offer',
        send: () =>
          writeContract({
            address: aqua,
            abi: aquaAbi,
            functionName: 'ship',
            args: [router, encodeStrategyForShip(offer.order), [...offer.tokens], [...offer.amounts]],
            chainId,
          }),
      };

      const done = await run([...approvals, ship]);
      const hashes = done.filter((s) => s.hash).map((s) => s.hash as Hex);
      return {
        strategyHash: offer.strategyHash,
        shipHash: done.at(-1)?.hash,
        hashes,
        transfers: done.reduce(
          (sum, step) =>
            sum + (step.receipt?.logs.filter((log) => log.topics[0] === ERC20_TRANSFER_TOPIC).length ?? 0),
          0,
        ),
      };
    },
    [address, config, writeContract, run, chainId],
  );

  return { publish, steps, isRunning, error, reset };
}
