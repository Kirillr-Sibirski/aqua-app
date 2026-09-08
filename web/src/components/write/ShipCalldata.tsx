'use client';

/**
 * The transaction a maker is about to sign, before they sign it.
 *
 * `ProgramInspector` shows the program — what the leg *is*. This shows the call that puts it on
 * chain: `Aqua.ship(app, strategy, tokens, amounts)`, selector and all, with every argument decoded
 * beside it.
 *
 * It is here because the product's central claim is checkable from this blob and nowhere else on
 * the screen. `ship` takes four arguments; none of them is a recipient, none is a transfer, and the
 * `amounts` are the *virtual* reserves Aqua will credit the strategy with. There is no path from
 * this calldata to a token movement — the wallet is only touched later, by `Aqua.pull`, when
 * somebody actually fills. A maker who reads the four arguments does not have to take that on
 * trust, and a judge reading it over their shoulder can see the same thing in ten seconds.
 *
 * The bytes come from the same `Order` the wizard will pass to `writeContract`, encoded through the
 * same ABI, so this is the transaction rather than a rendering of it.
 */
import { encodeFunctionData, size, type Address } from 'viem';
import { CopyButton } from '@/components/ui';
import { aquaAbi } from '@/lib/contracts';
import { encodeStrategyForShip } from '@/lib/swapvm';
import { cn, formatUnits, truncateHash } from '@/lib/ui';
import type { SizedLeg, WritePair } from './types';

export interface ShipCalldataProps {
  /** The Aqua registry the call goes to. */
  aqua: Address;
  /** The app argument: our router, which is what Aqua will run the program on. */
  router: Address;
  leg: SizedLeg;
  pair: WritePair;
  className?: string;
}

export function ShipCalldata({ aqua, router, leg, pair, className }: ShipCalldataProps) {
  const strategy = encodeStrategyForShip(leg.order);
  const data = encodeFunctionData({
    abi: aquaAbi,
    functionName: 'ship',
    args: [router, strategy, [...leg.tokens], [...leg.amounts]],
  });

  const decimalsFor = (token: Address) =>
    token.toLowerCase() === pair.risky.address.toLowerCase()
      ? pair.risky.decimals
      : pair.stable.decimals;
  const symbolFor = (token: Address) =>
    token.toLowerCase() === pair.risky.address.toLowerCase() ? pair.risky.symbol : pair.stable.symbol;

  return (
    <details className={cn('rounded-card border border-line', className)}>
      <summary className="cursor-pointer list-none px-4 py-3 text-meta text-ink-2 transition-state hover:text-ink">
        The transaction this leg will be shipped in
        <span className="ml-2 font-mono text-mini tnum text-ink-3">
          {size(data)} bytes to {truncateHash(aqua)}
        </span>
      </summary>

      <div className="flex flex-col gap-4 px-4 pb-4">
        <dl className="flex flex-col gap-2">
          <Arg name="app" type="address" value={router}>
            The router Aqua will run the program on. Ours, deployed against the official registry.
          </Arg>
          <Arg name="strategy" type="bytes" value={`${size(strategy)} bytes`}>
            The order, whole and unhashed. Aqua takes it that way for data availability, which is why
            K, sigma, T and L are public and any resolver can quote this leg with no off-chain book.
          </Arg>
          <Arg name="tokens" type="address[2]" value={leg.tokens.map((token) => truncateHash(token)).join('  ')}>
            {symbolFor(leg.tokens[0])} and {symbolFor(leg.tokens[1])}, in the order the maker traits
            require: tokenA below tokenB.
          </Arg>
          <Arg
            name="amounts"
            type="uint256[2]"
            value={leg.amounts
              .map(
                (amount, i) =>
                  `${formatUnits(amount, decimalsFor(leg.tokens[i]), { significantDigits: 8 })} ${symbolFor(leg.tokens[i])}`,
              )
              .join('  ')}
          >
            The virtual reserves Aqua credits the strategy with. Not a transfer and not a deposit:
            the wallet still holds every one of these tokens after this transaction, and only{' '}
            <span className="font-mono">Aqua.pull</span> moves any of them, later, when somebody
            fills.
          </Arg>
        </dl>

        <div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-mini text-ink-3">Calldata</p>
            <CopyButton value={data} what="ship calldata" compact />
          </div>
          <p className="mt-1.5 font-mono text-mini tnum leading-prose break-all text-ink-2">
            <span className="text-accent">{data.slice(0, 10)}</span>
            {data.slice(10)}
          </p>
        </div>
      </div>
    </details>
  );
}

function Arg({
  name,
  type,
  value,
  children,
}: {
  name: string;
  type: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2 last:border-b-0">
      <dt className="flex w-40 shrink-0 items-baseline gap-2">
        <span className="font-mono text-meta text-ink">{name}</span>
        <span className="font-mono text-mini text-ink-3">{type}</span>
      </dt>
      <dd className="min-w-0 font-mono text-mini tnum break-all text-ink-2">{value}</dd>
      <dd className="w-full text-mini leading-prose text-ink-3">{children}</dd>
    </div>
  );
}
