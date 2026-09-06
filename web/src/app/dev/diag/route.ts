/**
 * GET /dev/diag — server-side twin of the /dev page's read paths, so the plumbing can be checked
 * with `curl` (CI, orchestration, headless verification) without a browser or a wallet.
 *
 * Query params: `?maker=0x…` filters strategies (default: every maker), `?limit=n` caps the list.
 */
import { createPublicClient, http, isAddress, type Address, type PublicClient } from 'viem';
import { aggregatorV3Abi } from '@/lib/contracts/abis';
import { loadDeploymentsFromFile } from '@/lib/contracts/deployments.server';
import { fetchShippedStrategiesDetailed, serializeStrategy } from '@/lib/contracts/strategies';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const makerParam = url.searchParams.get('maker');
  const maker = makerParam && isAddress(makerParam, { strict: false }) ? (makerParam as Address) : undefined;
  const limit = Number(url.searchParams.get('limit') ?? 20);

  try {
    const { deployments, source, url: manifestPath, fileError } = await loadDeploymentsFromFile();
    const client = createPublicClient({ transport: http(deployments.rpcUrl) }) as PublicClient;
    const [chainId, blockNumber, routerCode] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.getCode({ address: deployments.router }),
    ]);
    const { strategies, skipped, fromBlock, toBlock } = await fetchShippedStrategiesDetailed(client, {
      aqua: deployments.aqua,
      app: deployments.router,
      maker,
      fromBlock: BigInt(deployments.blockNumber),
    });
    const [, ethAnswer, , ethUpdatedAt] = await client.readContract({
      address: deployments.chainlink.ethUsd,
      abi: aggregatorV3Abi,
      functionName: 'latestRoundData',
    });

    return Response.json({
      ok: true,
      manifest: { source, path: manifestPath, fileError },
      fork: {
        rpcUrl: deployments.rpcUrl,
        chainId,
        blockNumber: blockNumber.toString(),
        routerDeployed: !!routerCode && routerCode !== '0x',
        routerCodeSize: routerCode ? (routerCode.length - 2) / 2 : 0,
      },
      addresses: {
        aqua: deployments.aqua,
        router: deployments.router,
        officialRouter: deployments.officialRouter,
        weth: deployments.weth,
        usdc: deployments.usdc,
        cbBtc: deployments.cbBtc,
      },
      oracle: { ethUsd: deployments.chainlink.ethUsd, answer: ethAnswer.toString(), updatedAt: ethUpdatedAt.toString() },
      strategies: {
        scannedFrom: fromBlock.toString(),
        scannedTo: toBlock.toString(),
        makerFilter: maker ?? null,
        count: strategies.length,
        skipped: skipped.length,
        items: strategies.slice(0, Number.isFinite(limit) ? limit : 20).map(serializeStrategy),
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
