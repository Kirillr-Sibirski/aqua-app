/**
 * The whole read path, against a real chain.
 *
 * Deploys the official Aqua, two token mocks and the Strikeline router onto a bare anvil, ships a
 * four-leg book from two makers, and then runs exactly what the screen runs: pull the `Shipped`
 * logs through viem, decode them, group them into a surface, and price them with `SurfaceLens`
 * **deployless** — the contract's own init code inside one `eth_call`, never deployed.
 *
 * That last part is the claim worth testing. If deployless calls do not work, the priced columns
 * quietly go blank on a fork that was bootstrapped before the lens existed, and nothing else fails
 * loudly enough to notice.
 *
 *   anvil --silent &
 *   SURFACE_RPC_URL=http://127.0.0.1:8545 npx vitest run src/components/surface
 *
 * Skipped, not failed, without that variable — and the guard is above the `describe` body, because
 * vitest still *collects* a skipped suite and a dereference at collection time takes the file down
 * with it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createTestClient,
  createPublicClient,
  encodeAbiParameters,
  http,
  publicActions,
  walletActions,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { buildLegProgram, expiryFlagsFor, FLAG_RISKY_IS_TOKEN_A, rateFor } from '@/components/curve';
import { fetchShippedStrategiesDetailed } from '@/lib/contracts';
import { buildAquaOrder, encodeStrategyForShip } from '@/lib/swapvm';
import { censusOf, decodeSurface, groupSurface, impliedSpot } from '../decode';
import { pricingOf, readBook } from '../lens';

const RPC = process.env.SURFACE_RPC_URL;

// Anvil's first two accounts, which are public knowledge and hold nothing but test ether.
const DEPLOYER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const MAKER_TWO = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

const WAD = BigInt(10) ** BigInt(18);
const SIGMA = (WAD * BigInt(6)) / BigInt(10); // 60%
const SIGMA_WIDE = (WAD * BigInt(8)) / BigInt(10); // 80%

function artifact(path: string): { abi: readonly unknown[]; bytecode: { object: Hex } } {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../../contracts/out/${path}`, import.meta.url)), 'utf8'),
  );
}

interface World {
  client: ReturnType<typeof createTestClient> & ReturnType<typeof publicActions> & ReturnType<typeof walletActions>;
  aqua: Address;
  router: Address;
  weth: Address;
  usdc: Address;
  maturity: number;
  fromBlock: bigint;
}

describe.skipIf(!RPC)('the surface, read off a live chain', () => {
  let world: World;

  beforeAll(async () => {
    const transport = http(RPC);
    const client = createTestClient({ chain: foundry, mode: 'anvil', transport, account: DEPLOYER })
      .extend(publicActions)
      .extend(walletActions);

    const fromBlock = await client.getBlockNumber();

    const deploy = async (path: string, args: unknown[] = [], account = DEPLOYER): Promise<Address> => {
      const { abi, bytecode } = artifact(path);
      const hash = await client.deployContract({
        abi: abi as never,
        bytecode: bytecode.object,
        args: args as never,
        account,
        chain: foundry,
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) throw new Error(`no address for ${path}`);
      return receipt.contractAddress;
    };

    const aqua = await deploy('Aqua.sol/Aqua.json');
    const weth = await deploy('WETHMock.sol/WETHMock.json');
    const usdc = await deploy('TokenMockDecimals.sol/TokenMockDecimals.json', ['USD Coin', 'USDC', 6]);
    const router = await deploy('StrikelineRouter.sol/StrikelineRouter.json', [
      aqua,
      weth,
      DEPLOYER.address,
      'Strikeline',
      '1',
    ]);

    const block = await client.getBlock();
    const maturity = Number(block.timestamp) + 7 * 86_400;

    world = { client: client as World['client'], aqua, router, weth, usdc, maturity, fromBlock };

    // Fund both makers with irregular amounts, because round demo numbers read as fake.
    const erc20 = artifact('TokenMockDecimals.sol/TokenMockDecimals.json').abi;
    const wethAbi = artifact('WETHMock.sol/WETHMock.json').abi;

    for (const [account, eth, usd] of [
      [DEPLOYER, BigInt('10400000000000000000'), BigInt(24_850_000_000)],
      [MAKER_TWO, BigInt('4200000000000000000'), BigInt(9_000_000_000)],
    ] as const) {
      await client.waitForTransactionReceipt({
        hash: await client.writeContract({
          address: weth,
          abi: wethAbi as never,
          functionName: 'deposit',
          value: eth,
          account,
          chain: foundry,
        }),
      });
      await client.waitForTransactionReceipt({
        hash: await client.writeContract({
          address: usdc,
          abi: erc20 as never,
          functionName: 'mint',
          args: [account.address, usd],
          account: DEPLOYER,
          chain: foundry,
        }),
      });
      for (const token of [weth, usdc]) {
        await client.waitForTransactionReceipt({
          hash: await client.writeContract({
            address: token,
            abi: erc20 as never,
            functionName: 'approve',
            args: [aqua, (BigInt(1) << BigInt(255)) - BigInt(1)],
            account,
            chain: foundry,
          }),
        });
      }
    }

    // Four legs: three strikes from one maker, and a second maker quoting 2800 at a wider vol.
    const book: { maker: typeof DEPLOYER; strike: bigint; liquidity: bigint; x: bigint; sigma: bigint; salt: bigint }[] =
      [
        { maker: DEPLOYER, strike: BigInt(2600) * WAD, liquidity: BigInt(12) * WAD, x: BigInt('8410000000000000000'), sigma: SIGMA, salt: BigInt(1) },
        { maker: DEPLOYER, strike: BigInt(2800) * WAD, liquidity: BigInt(10) * WAD, x: BigInt('9220000000000000000'), sigma: SIGMA, salt: BigInt(2) },
        { maker: DEPLOYER, strike: BigInt(3000) * WAD, liquidity: BigInt(10) * WAD, x: BigInt('9880000000000000000'), sigma: SIGMA, salt: BigInt(3) },
        { maker: MAKER_TWO, strike: BigInt(2800) * WAD, liquidity: BigInt(4) * WAD, x: BigInt('3400000000000000000'), sigma: SIGMA_WIDE, salt: BigInt(4) },
      ];

    const riskyIsTokenA = weth.toLowerCase() < usdc.toLowerCase();
    const rateRisky = rateFor(18);
    const rateStable = rateFor(6);
    const viewsAbi = artifact('StrikelineRouter.sol/StrikelineRouter.json').abi;
    const aquaAbiJson = artifact('Aqua.sol/Aqua.json').abi;

    for (const leg of book) {
      const program = buildLegProgram({
        rmm: {
          flags: (riskyIsTokenA ? FLAG_RISKY_IS_TOKEN_A : 0) | expiryFlagsFor('call'),
          sigmaWad: leg.sigma,
          maturity,
          strikeWad: leg.strike,
          liquidityWad: leg.liquidity,
          rateRisky,
          rateStable,
        },
        deadline: maturity + 1800,
        salt: leg.salt,
      });
      const [tokenA, tokenB] = riskyIsTokenA ? [weth, usdc] : [usdc, weth];
      const order = buildAquaOrder({ maker: leg.maker.address, tokenA, tokenB, program });

      // The stable reserve comes from the chain's own approximated Phi. One wei off and the leg is
      // bricked forever, so nothing here computes it.
      const yWad = (await world.client.readContract({
        address: router,
        abi: viewsAbi as never,
        functionName: 'stableFor',
        args: [leg.strike, leg.sigma, maturity, leg.liquidity, leg.x],
      })) as bigint;

      const usdcAmount = yWad / rateStable;
      const amounts = riskyIsTokenA ? [leg.x, usdcAmount] : [usdcAmount, leg.x];

      await client.waitForTransactionReceipt({
        hash: await client.writeContract({
          address: aqua,
          abi: aquaAbiJson as never,
          functionName: 'ship',
          args: [router, encodeStrategyForShip(order), [tokenA, tokenB], amounts],
          account: leg.maker,
          chain: foundry,
        }),
      });
    }
  }, 120_000);

  /** Exactly what the screen does on its first render: pull the log, decode it, group it. */
  async function readSurface() {
    const publicClient = createPublicClient({ chain: foundry, transport: http(RPC) }) as PublicClient;
    const { strategies } = await fetchShippedStrategiesDetailed(publicClient, {
      aqua: world.aqua,
      app: world.router,
      fromBlock: world.fromBlock,
    });
    return { publicClient, strategies };
  }

  it('finds every leg in the log and decodes its terms', async () => {
    const { strategies } = await readSurface();
    const { legs, skipped } = decodeSurface(strategies, DEPLOYER.address);

    expect(legs).toHaveLength(4);
    expect(skipped['no-rmm']).toBe(0);
    expect(skipped.malformed).toBe(0);
    expect(legs.every((l) => l.guarded)).toBe(true);
    expect(new Set(legs.map((l) => l.strikeWad.toString())).size).toBe(3);
    expect(legs.filter((l) => l.mine)).toHaveLength(3);

    const census = censusOf(legs, 0);
    expect(census.makers).toBe(2);
    expect(census.writtenWad).toBe(BigInt(36) * WAD);

    // The reserves come back matched to the sides the curve names, straight from Aqua.
    const near = legs.find((l) => l.strikeWad === BigInt(2600) * WAD)!;
    expect(near.reserveRisky).toBe(BigInt('8410000000000000000'));
    expect(near.reserveStable).toBeGreaterThan(BigInt(0));
  });

  it('groups two makers at 2800 into one cell, best bid first', async () => {
    const { strategies } = await readSurface();
    const points = groupSurface(decodeSurface(strategies, DEPLOYER.address).legs);

    expect(points).toHaveLength(3);
    const at2800 = points.find((p) => p.strikeWad === BigInt(2800) * WAD)!;
    expect(at2800.liveLegs).toHaveLength(2);
    expect(at2800.liveLegs[0].sigmaWad).toBe(SIGMA_WIDE);
    expect(at2800.maxSigmaWad).toBe(SIGMA_WIDE);
    expect(at2800.minSigmaWad).toBe(SIGMA);
    expect(at2800.liveLiquidityWad).toBe(BigInt(14) * WAD);
  });

  it('prices the whole book through a lens that is never deployed', async () => {
    const { publicClient, strategies } = await readSurface();
    const legs = decodeSurface(strategies, DEPLOYER.address).legs;

    const result = await readBook(publicClient, {
      aqua: world.aqua,
      app: world.router,
      strategies: legs.map((l) => strategies.find((s) => s.strategyHash === l.strategyHash)!.strategy),
    });

    expect(result.via).toBe('deployless');
    expect(result.legs).toHaveLength(4);
    for (const row of result.legs) {
      expect(row.isLeg).toBe(true);
      expect(row.priced).toBe(true);
      expect(row.guarded).toBe(true);
      expect(row.live).toBe(true);
      // Every leg implies a spot near the reserve point it was shipped at, with no oracle involved.
      expect(row.markWad).toBeGreaterThan(BigInt(2000) * WAD);
      expect(row.markWad).toBeLessThan(BigInt(3000) * WAD);
      expect(row.premiumWad).toBeGreaterThan(BigInt(0));
      expect(row.deltaWad).toBeGreaterThan(BigInt(0));
      expect(row.deltaWad).toBeLessThan(WAD);
    }

    // One wallet backs three of the four legs, so they report the same free balance.
    const mine = result.legs.filter((r) => r.maker.toLowerCase() === DEPLOYER.address.toLowerCase());
    expect(mine).toHaveLength(3);
    expect(new Set(mine.map((r) => r.freeRisky.toString())).size).toBe(1);
    expect(mine[0].freeRisky).toBe(BigInt('10400000000000000000'));
    // Deliberately over-allocated: 27.51 WETH of virtual reserve against 10.4 real.
    expect(mine.reduce((sum, r) => sum + r.reserveRisky, BigInt(0))).toBeGreaterThan(mine[0].freeRisky);

    // The wider vol is the richer premium at the same strike and expiry: that is the best bid.
    const at2800 = result.legs.filter((r) => r.strikeWad === BigInt(2800) * WAD);
    expect(at2800).toHaveLength(2);
    const [wide, tight] = at2800.sort((a, b) => (a.sigmaWad > b.sigmaWad ? -1 : 1));
    expect(wide.sigmaWad).toBe(SIGMA_WIDE);
    expect(wide.premiumWad).toBeGreaterThan(tight.premiumWad);
  });

  it('agrees with a deployed lens, byte for byte', async () => {
    const { abi, bytecode } = artifact('SurfaceLens.sol/SurfaceLens.json');
    const hash = await world.client.deployContract({
      abi: abi as never,
      bytecode: bytecode.object,
      args: [world.aqua, world.router] as never,
      account: DEPLOYER,
      chain: foundry,
    });
    const { contractAddress } = await world.client.waitForTransactionReceipt({ hash });

    const { publicClient, strategies } = await readSurface();
    const payloads = strategies.map((s) => s.strategy);
    const blockNumber = await publicClient.getBlockNumber();

    const inline = await readBook(publicClient, { aqua: world.aqua, app: world.router, strategies: payloads, blockNumber });
    const deployed = await readBook(publicClient, {
      aqua: world.aqua,
      app: world.router,
      strategies: payloads,
      address: contractAddress!,
      blockNumber,
    });

    expect(inline.via).toBe('deployless');
    expect(deployed.via).toBe('deployed');
    expect(JSON.stringify(inline.legs, replacer)).toBe(JSON.stringify(deployed.legs, replacer));
  });

  it('reports a spot implied by the book alone, with no price feed anywhere', async () => {
    const { publicClient, strategies } = await readSurface();
    const legs = decodeSurface(strategies, DEPLOYER.address).legs;
    const priced = await readBook(publicClient, {
      aqua: world.aqua,
      app: world.router,
      strategies: strategies.map((s) => s.strategy),
    });

    const withPricing = legs.map((leg, i) => ({ ...leg, pricing: pricingOf(priced.legs[i]) }));
    const spot = impliedSpot(withPricing);

    expect(spot).not.toBeNull();
    expect(spot!.legs).toBe(4);
    expect(Number(spot!.markWad) / 1e18).toBeGreaterThan(2000);
    expect(Number(spot!.markWad) / 1e18).toBeLessThan(3000);
    // Four legs written on the same pair should not disagree about spot by more than a few percent.
    expect(Number(spot!.spreadWad) / Number(spot!.markWad)).toBeLessThan(0.1);
  });

  it('never writes: a read layer that mutates is not a read layer', async () => {
    // Nothing above sent a transaction except the deploys and the ships in `beforeAll`, so the
    // maker's wallet is exactly where they left it. The deployless call in particular leaves
    // nothing behind: no contract, no storage, no nonce.
    const { publicClient } = await readSurface();
    const balance = await publicClient.readContract({
      address: world.weth,
      abi: artifact('WETHMock.sol/WETHMock.json').abi as never,
      functionName: 'balanceOf',
      args: [DEPLOYER.address],
    });
    expect(balance).toBe(BigInt('10400000000000000000'));

    // And the constructor arguments the deployless path appends are the ones the lens reads back.
    const encoded = encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [world.aqua, world.router]);
    expect(encoded.length).toBe(2 + 128);
  });
});

function replacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}
