/**
 * What every scene needs to know, assembled once.
 *
 * Scenes are separate processes so a presenter can re-run one of them; this is the bit they all repeat.
 * It also does the pre-flight that is worth failing on before a camera is rolling: the fork is the fork
 * we think it is, the router is ours and points at the official registry, the encoders still match the
 * Solidity, and the tape is anchored.
 */
import type { Address, Hex } from 'viem';
import { Tape, loadSeries } from '../arb/tape.ts';
import { ADDR, assertFork, type Deployments } from '../fork/lib.ts';
import { assertEncoderPinned, pairFor, type Pair } from './book.ts';
import { assertLiveStrategiesPinned } from './live.ts';
import { deployments, fail, labelDeployment, loadState, type StoryState } from './lib.ts';

export interface Wallet {
  address: Address;
  privateKey: Hex;
}

export interface Ctx {
  d: Deployments;
  state: StoryState;
  pair: Pair;
  tape: Tape;
  maker: Wallet;
  arb: Wallet;
  taker: Wallet;
  fork: { chainId: number; blockNumber: bigint; timestamp: bigint };
}

export async function context(): Promise<Ctx> {
  assertEncoderPinned();
  assertLiveStrategiesPinned();

  const fork = await assertFork();
  const d = deployments();
  const state = loadState();
  if (state.router.toLowerCase() !== d.router.toLowerCase()) {
    fail(`the story was set up against router ${state.router} but the manifest says ${d.router} -- re-run \`make story-setup\``);
  }
  if (d.aqua.toLowerCase() !== ADDR.aqua.toLowerCase()) fail(`manifest Aqua ${d.aqua} is not the official registry`);
  labelDeployment(d, state);

  const wallet = (address: Address): Wallet => {
    const a = d.accounts.find((x) => x.address.toLowerCase() === address.toLowerCase());
    if (!a?.privateKey) fail(`no private key for ${address} in the deployment manifest`);
    return { address: a.address, privateKey: a.privateKey };
  };

  return {
    d,
    state,
    pair: pairFor(d.weth, d.usdc),
    tape: new Tape(loadSeries(), state.anchor),
    maker: wallet(state.maker),
    arb: wallet(state.arb),
    taker: wallet(state.taker),
    fork,
  };
}
