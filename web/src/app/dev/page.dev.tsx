'use client';

/**
 * /dev — diagnostics for the wallet + contract plumbing. NOT the product UI: everything here is
 * plain HTML so the read/write paths (deployments, balances, Shipped-event discovery, quote, ship,
 * swap, dock, oracle) can be exercised against the local Base fork and eyeballed.
 */
import { useCallback, useMemo, useState } from 'react';
import { formatUnits, parseUnits, type Address, type Hex } from 'viem';
import { useConnection } from 'wagmi';
import { getBlock } from 'wagmi/actions';
import { useConfig } from 'wagmi';

import { useDeployments, useDock, useOraclePrice, useShippedStrategies, useTokenBalances } from '@/hooks';
/* Deep imports, not the barrel: these four are the taker path and the raw ship, and they belong to
   this page rather than to the app. See `hooks/index.ts`. */
import { useAquaBalances } from '@/hooks/useAquaBalances';
import { useQuote } from '@/hooks/useQuote';
import { useShip } from '@/hooks/useShip';
import { useSwap } from '@/hooks/useSwap';
import { aquaFork, FORK_RPC_URL } from '@/lib/chain';
import { tokenInfo } from '@/lib/contracts';
import { buildAquaOrder, buildTakerTraits, ix, program, type Order } from '@/lib/swapvm';
import { buttonClass, Err, Field, inputClass, KV, Section, TxSteps } from './ui';
import { ConnectWallet, shortAddress } from './wallet';

const fmt = (v: bigint | undefined, decimals: number) => (v === undefined ? '—' : formatUnits(v, decimals));

export default function DevPage() {
  const config = useConfig();
  const { address, chain, chainId, connector, status } = useConnection();
  const { deployments, contracts, source, url, fileError, error: deploymentsError, isLoading, refetch: refetchDeployments } = useDeployments();

  // ------------------------------------------------------------------ balances
  const tokenList = useMemo<Address[]>(
    () => (deployments ? [deployments.weth, deployments.usdc, deployments.cbBtc] : []),
    [deployments],
  );
  const { balances, native, error: balancesError } = useTokenBalances(address, tokenList);

  // ------------------------------------------------------------------ strategies
  const [showAll, setShowAll] = useState(false);
  const {
    strategies,
    skipped,
    fromBlock,
    toBlock,
    error: strategiesError,
    isFetching: strategiesFetching,
    refetch: refetchStrategies,
  } = useShippedStrategies(address, { all: showAll });

  const [selectedHash, setSelectedHash] = useState<Hex | undefined>();
  const selected = useMemo(
    () => strategies.find((s) => s.strategyHash === selectedHash) ?? strategies[0],
    [strategies, selectedHash],
  );

  const selectedBalances = useAquaBalances(selected?.maker, deployments?.router, selected?.strategyHash, selected?.tokens ?? []);

  // ------------------------------------------------------------------ ship
  const { ship, steps: shipSteps, isRunning: shipping, error: shipError } = useShip();
  const [liqWeth, setLiqWeth] = useState('10');
  const [liqUsdc, setLiqUsdc] = useState('25000');
  const [feeBps, setFeeBps] = useState('30000');
  const [shipResult, setShipResult] = useState<string>();

  const onShip = useCallback(async () => {
    setShipResult(undefined);
    if (!deployments || !address) return;
    const { weth, usdc } = deployments;
    const wethIsA = BigInt(weth) < BigInt(usdc);
    const [tokenA, tokenB] = wethIsA ? [weth, usdc] : [usdc, weth];
    const wethAmount = parseUnits(liqWeth || '0', 18);
    const usdcAmount = parseUnits(liqUsdc || '0', 6);
    const amounts = (wethIsA ? [wethAmount, usdcAmount] : [usdcAmount, wethAmount]) as [bigint, bigint];
    // FeeFlatIn(fee of 1e7) | XYCSwap | Salt(now) — the salt keeps every ship a fresh strategy hash.
    const prog = program(ix.feeFlatIn(BigInt(feeBps || '0')), ix.xycSwap(), ix.salt(BigInt(Date.now())));
    const order: Order = buildAquaOrder({ maker: address, tokenA, tokenB, program: prog });
    try {
      const res = await ship({ order, amounts });
      setShipResult(`shipped ${res.strategyHash} (tx ${res.hash})`);
      setSelectedHash(res.strategyHash);
      await refetchStrategies();
    } catch {
      /* surfaced through shipError / shipSteps */
    }
  }, [deployments, address, liqWeth, liqUsdc, feeBps, ship, refetchStrategies]);

  // ------------------------------------------------------------------ quote + swap
  const [isAToB, setIsAToB] = useState(true);
  const [isExactIn, setIsExactIn] = useState(true);
  const [amountText, setAmountText] = useState('0.1');
  const [slippagePct, setSlippagePct] = useState('1');

  const tokenIn = selected ? (isAToB ? selected.tokens[0] : selected.tokens[1]) : undefined;
  const tokenOut = selected ? (isAToB ? selected.tokens[1] : selected.tokens[0]) : undefined;
  const inInfo = tokenIn ? tokenInfo(tokenIn, deployments) : undefined;
  const outInfo = tokenOut ? tokenInfo(tokenOut, deployments) : undefined;
  const amountDecimals = (isExactIn ? inInfo?.decimals : outInfo?.decimals) ?? 18;

  const amountWei = useMemo(() => {
    try {
      return amountText ? parseUnits(amountText, amountDecimals) : undefined;
    } catch {
      return undefined;
    }
  }, [amountText, amountDecimals]);

  // Quote traits carry no threshold and no deadline so quoting never reverts on those checks.
  const quoteTraits = useMemo(
    () => (address ? buildTakerTraits({ taker: address, isExactIn, isAToB, useTransferFromAndAquaPush: true }) : undefined),
    [address, isExactIn, isAToB],
  );
  const { quote, error: quoteError, isFetching: quoteFetching, refetch: refetchQuote } = useQuote(selected?.order, amountWei, quoteTraits, {
    taker: address,
    refetchInterval: 8000,
  });

  const { swap, steps: swapSteps, isRunning: swapping, error: swapError } = useSwap();
  const [swapResult, setSwapResult] = useState<string>();

  const onSwap = useCallback(async () => {
    setSwapResult(undefined);
    if (!selected || amountWei === undefined || !quote) return;
    const slipBps = BigInt(Math.round(Number(slippagePct || '0') * 100));
    const threshold = isExactIn
      ? (quote.amountOut * (BigInt(10000) - slipBps)) / BigInt(10000)
      : (quote.amountIn * (BigInt(10000) + slipBps)) / BigInt(10000);
    // The fork clock is independent of the browser clock — take the deadline from the chain.
    const block = await getBlock(config, { chainId: aquaFork.id });
    try {
      const res = await swap({
        order: selected.order,
        amount: amountWei,
        isAToB,
        isExactIn,
        threshold,
        deadline: block.timestamp + BigInt(3600),
      });
      setSwapResult(
        `swap ${res.hash}: in ${fmt(res.amountIn, inInfo?.decimals ?? 18)} ${inInfo?.symbol ?? ''} → out ${fmt(res.amountOut, outInfo?.decimals ?? 18)} ${outInfo?.symbol ?? ''}`,
      );
      await Promise.all([refetchStrategies(), refetchQuote(), selectedBalances.refetch()]);
    } catch {
      /* surfaced through swapError / swapSteps */
    }
  }, [selected, amountWei, quote, slippagePct, isExactIn, isAToB, config, swap, inInfo, outInfo, refetchStrategies, refetchQuote, selectedBalances]);

  // ------------------------------------------------------------------ dock
  const { dock, steps: dockSteps, isRunning: docking, error: dockError } = useDock();
  const onDock = useCallback(
    async (strategyHash: Hex, tokens: readonly Address[]) => {
      try {
        await dock({ strategyHash, tokens });
        await refetchStrategies();
      } catch {
        /* surfaced through dockError / dockSteps */
      }
    },
    [dock, refetchStrategies],
  );

  // ------------------------------------------------------------------ oracles
  const ethUsd = useOraclePrice(deployments?.chainlink.ethUsd);
  const btcUsd = useOraclePrice(deployments?.chainlink.btcUsd);
  const cbBtcUsd = useOraclePrice(deployments?.chainlink.cbBtcUsd);
  const usdcUsd = useOraclePrice(deployments?.chainlink.usdcUsd);

  const wrongChain = !!address && chainId !== aquaFork.id;

  return (
    <main className="flex flex-col gap-4 p-4 text-sm max-w-5xl w-full mx-auto">
      <h1 className="text-lg font-semibold">Strikeline — dev diagnostics</h1>

      <Section title="Wallet">
        <ConnectWallet />
        <div className="mt-2 space-y-0.5">
          <KV k="status" v={status} />
          <KV k="address" v={address ?? '—'} />
          <KV k="connector" v={connector?.name ?? '—'} />
          <KV k="chain" v={`${chain?.name ?? '—'} (${chainId ?? '—'})`} />
          <KV k="expected chain" v={`${aquaFork.name} (${aquaFork.id}) @ ${FORK_RPC_URL}`} />
          <KV k="native balance" v={native ? `${formatUnits(native.value, native.decimals)} ${native.symbol}` : '—'} />
        </div>
        {wrongChain && <p className="text-amber-600 mt-1">connected to chain {chainId} — switch to {aquaFork.id} for reads/writes to work</p>}
      </Section>

      <Section
        title="Deployments"
        right={
          <button type="button" className={buttonClass} onClick={() => refetchDeployments()}>
            reload
          </button>
        }
      >
        {isLoading && <p>loading…</p>}
        <Err error={deploymentsError} />
        {fileError && <p className="text-amber-600">file failed ({fileError}) — using env fallback</p>}
        {deployments && (
          <div className="space-y-0.5">
            <KV k="source" v={`${source} (${url})`} />
            <KV k="chainId / block" v={`${deployments.chainId} / ${deployments.blockNumber}`} />
            <KV k="rpcUrl" v={deployments.rpcUrl} />
            <KV k="Aqua (official)" v={deployments.aqua} />
            <KV k="router (ours)" v={deployments.router} />
            <KV k="official router" v={deployments.officialRouter} />
            <KV k="WETH / USDC / cbBTC" v={`${deployments.weth} / ${deployments.usdc} / ${deployments.cbBtc}`} />
            <KV k="accounts" v={deployments.accounts.map((a) => `${a.role ?? a.name ?? ''} ${shortAddress(a.address)}`).join(' · ') || '—'} />
            <KV k="contracts loaded" v={contracts ? Object.keys(contracts).join(', ') : '—'} />
          </div>
        )}
      </Section>

      <Section title="Token balances (wallet)">
        <Err error={balancesError} />
        {!address && <p className="opacity-70">connect a wallet</p>}
        <table className="font-mono">
          <tbody>
            {balances.map((b) => (
              <tr key={b.token}>
                <td className="pr-4">{b.symbol}</td>
                <td className="pr-4">{b.formatted}</td>
                <td className="opacity-60">{b.token}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Chainlink oracles (fork)">
        <table className="font-mono">
          <tbody>
            {[
              ['ETH/USD', ethUsd],
              ['BTC/USD', btcUsd],
              ['cbBTC/USD', cbBtcUsd],
              ['USDC/USD', usdcUsd],
            ].map(([label, o]) => {
              const feed = o as ReturnType<typeof useOraclePrice>;
              return (
                <tr key={String(label)}>
                  <td className="pr-4">{String(label)}</td>
                  <td className="pr-4">{feed.price ? feed.price.formatted : '—'}</td>
                  <td className="pr-4 opacity-60">{feed.price ? `updatedAt ${String(feed.price.updatedAt)}` : ''}</td>
                  <td className="opacity-60">{feed.price?.feed ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Ship an XYC WETH/USDC strategy">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="WETH liquidity">
            <input className={inputClass} value={liqWeth} onChange={(e) => setLiqWeth(e.target.value)} size={10} />
          </Field>
          <Field label="USDC liquidity">
            <input className={inputClass} value={liqUsdc} onChange={(e) => setLiqUsdc(e.target.value)} size={10} />
          </Field>
          <Field label="fee (of 1e7; 30000 = 0.3%)">
            <input className={inputClass} value={feeBps} onChange={(e) => setFeeBps(e.target.value)} size={10} />
          </Field>
          <button type="button" className={buttonClass} disabled={!address || !deployments || shipping} onClick={onShip}>
            {shipping ? 'shipping…' : 'approve + ship'}
          </button>
        </div>
        <p className="opacity-60 mt-1">program: FeeFlatIn({feeBps}) | XYCSwap | Salt(now) — maker = connected account, app = our router</p>
        <TxSteps steps={shipSteps} />
        {shipResult && <p className="font-mono break-all mt-1 text-green-700">{shipResult}</p>}
        <Err error={shipError} />
      </Section>

      <Section
        title={`Shipped strategies (${strategies.length})`}
        right={
          <span className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> all makers
            </label>
            <button type="button" className={buttonClass} onClick={() => refetchStrategies()}>
              {strategiesFetching ? 'refreshing…' : 'refresh'}
            </button>
          </span>
        }
      >
        <p className="opacity-60">
          Aqua `Shipped` logs {String(fromBlock ?? '—')} → {String(toBlock ?? '—')}, filtered client-side by app == router{showAll ? '' : ' and maker == you'}
        </p>
        <Err error={strategiesError} />
        {skipped.length > 0 && <p className="text-amber-600">skipped {skipped.length} undecodable log(s)</p>}
        {strategies.length === 0 && <p className="opacity-70">none yet</p>}
        <ul className="space-y-2 mt-2">
          {strategies.map((s) => (
            <li key={`${s.transactionHash}-${s.logIndex}`} className="border-t border-black/10 dark:border-white/15 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name="strategy"
                  checked={selected?.strategyHash === s.strategyHash}
                  onChange={() => setSelectedHash(s.strategyHash)}
                />
                <span className="font-mono break-all">{s.strategyHash}</span>
                <span className={s.docked ? 'text-red-600' : 'text-green-700'}>{s.docked ? 'docked' : s.active ? 'active' : 'unknown'}</span>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={docking || s.docked || s.maker.toLowerCase() !== (address ?? '').toLowerCase()}
                  onClick={() => onDock(s.strategyHash, s.tokens)}
                >
                  dock
                </button>
              </div>
              <div className="font-mono text-xs opacity-80 break-all">
                maker {shortAddress(s.maker)} · block {String(s.blockNumber)} · hashMatches {String(s.hashMatches)} · program {s.program}
              </div>
              <div className="font-mono text-xs">
                {s.balances.map((b) => {
                  const info = tokenInfo(b.token, deployments);
                  return (
                    <span key={b.token} className="mr-4">
                      {info.symbol} {fmt(b.balance, info.decimals)} (tokensCount {b.tokensCount})
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        <TxSteps steps={dockSteps} />
        <Err error={dockError} />
      </Section>

      <Section title="Quote + swap">
        {!selected && <p className="opacity-70">ship or select a strategy first</p>}
        {selected && (
          <>
            <div className="space-y-0.5 mb-2">
              <KV k="strategy" v={selected.strategyHash} />
              <KV k="maker" v={selected.maker} />
              <KV
                k="virtual balances"
                v={selectedBalances.balances
                  .map((b) => `${tokenInfo(b.token, deployments).symbol} ${fmt(b.balance, tokenInfo(b.token, deployments).decimals)}`)
                  .join(' · ')}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="direction">
                <select className={inputClass} value={isAToB ? 'ab' : 'ba'} onChange={(e) => setIsAToB(e.target.value === 'ab')}>
                  <option value="ab">
                    {tokenInfo(selected.tokens[0], deployments).symbol} → {tokenInfo(selected.tokens[1], deployments).symbol}
                  </option>
                  <option value="ba">
                    {tokenInfo(selected.tokens[1], deployments).symbol} → {tokenInfo(selected.tokens[0], deployments).symbol}
                  </option>
                </select>
              </Field>
              <Field label="mode">
                <select className={inputClass} value={isExactIn ? 'in' : 'out'} onChange={(e) => setIsExactIn(e.target.value === 'in')}>
                  <option value="in">exact in</option>
                  <option value="out">exact out</option>
                </select>
              </Field>
              <Field label={`amount (${isExactIn ? inInfo?.symbol : outInfo?.symbol} — ${amountDecimals} dec)`}>
                <input className={inputClass} value={amountText} onChange={(e) => setAmountText(e.target.value)} size={12} />
              </Field>
              <Field label="slippage %">
                <input className={inputClass} value={slippagePct} onChange={(e) => setSlippagePct(e.target.value)} size={5} />
              </Field>
              <button type="button" className={buttonClass} onClick={() => refetchQuote()} disabled={!amountWei}>
                {quoteFetching ? 'quoting…' : 'quote'}
              </button>
              <button type="button" className={buttonClass} disabled={!address || !quote || swapping} onClick={onSwap}>
                {swapping ? 'swapping…' : 'approve + swap'}
              </button>
            </div>
            <div className="mt-2 space-y-0.5">
              <KV k="quote.amountIn" v={`${fmt(quote?.amountIn, inInfo?.decimals ?? 18)} ${inInfo?.symbol ?? ''}`} />
              <KV k="quote.amountOut" v={`${fmt(quote?.amountOut, outInfo?.decimals ?? 18)} ${outInfo?.symbol ?? ''}`} />
              <KV k="quote.orderHash" v={quote?.orderHash ?? '—'} />
            </div>
            <Err error={quoteError} />
            <TxSteps steps={swapSteps} />
            {swapResult && <p className="font-mono break-all mt-1 text-green-700">{swapResult}</p>}
            <Err error={swapError} />
          </>
        )}
      </Section>
    </main>
  );
}
