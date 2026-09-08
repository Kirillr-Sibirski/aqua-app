'use client';

/**
 * Who has taken this offer, replayed from Aqua's own ledger.
 *
 * Not a database of fills. `Aqua.pull` decrements and `Aqua.push` increments the strategy's virtual
 * balance on every trade, so the reserve point walks across the curve by itself, with no maker
 * transaction and no keeper. Reading the two event streams back in order reconstructs both the
 * opening point and every point after it — for any maker, from the public log, with no cooperation
 * from them.
 *
 * The "you were paid" column is the honest one and it is deliberately absent: what a maker earns
 * from a trade is the gap that trade had to cross, and that is a property of the reserves at the
 * block it landed in rather than of the amounts in its own events. It is stated in the gap section
 * instead, where the number is read rather than inferred.
 */
import { Anchor, Group, Stack, Text } from '@mantine/core';
import { explorerFor, isForkOfBase, txUrl } from '@/components/shell';
import { tokenInfo } from '@/lib/contracts';
import { formatUnits, truncateHash } from '@/lib/ui';
import type { LegFill } from '@/components/curve';
import { Panel } from './bits';
import type { Deployments } from './useOffer';

export interface FillsPanelProps {
  fills: readonly LegFill[];
  isLoading: boolean;
  deployments: Deployments;
  chainId?: number;
}

export function FillsPanel({ fills, isLoading, deployments, chainId }: FillsPanelProps) {
  const explorer = explorerFor(chainId);
  const linkable = explorer && !isForkOfBase(chainId);

  return (
    <Panel
      title="Trades against this offer"
      description="Every trade moves the offer along its curve without the maker signing anything, which is why the numbers on this page change on their own."
      flush
    >
      {isLoading && fills.length === 0 ? (
        <Text size="sm" c="var(--ink-3)" px="md" pb="md">
          Reading the ledger…
        </Text>
      ) : fills.length === 0 ? (
        <Stack gap={4} px="md" pb="md">
          <Text size="sm" c="var(--ink-2)">
            Nobody has taken this offer yet, so nothing has been paid.
          </Text>
          <Text size="xs" c="var(--ink-3)" className="leading-prose">
            A trade has to be at least the size shown above before the offer will accept it, and that
            size is growing on its own.
          </Text>
        </Stack>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-meta">
            <caption className="sr-only">Trades against this offer, from Aqua&rsquo;s ledger</caption>
            <thead>
              <tr className="border-b border-line-strong text-left text-mini text-ink-2">
                <th scope="col" className="py-2 pr-3 pl-4 font-medium">
                  Transaction
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  They took
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  They paid
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Block
                </th>
              </tr>
            </thead>
            <tbody>
              {fills.map((fill) => {
                const out = tokenInfo(fill.outToken, deployments);
                const inTok = fill.inToken ? tokenInfo(fill.inToken, deployments) : undefined;
                return (
                  <tr
                    key={`${fill.transactionHash}-${fill.logIndex}`}
                    className="border-b border-line last:border-b-0"
                  >
                    <td className="py-2 pr-3 pl-4">
                      {linkable && explorer ? (
                        <Anchor
                          href={txUrl(explorer, fill.transactionHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-mini tnum"
                        >
                          {truncateHash(fill.transactionHash)}
                        </Anchor>
                      ) : (
                        <span className="font-mono text-mini tnum text-ink-2">
                          {truncateHash(fill.transactionHash)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tnum text-ink">
                      {formatUnits(fill.outAmount, out.decimals, { significantDigits: 6 })}{' '}
                      <span className="text-ink-3">{out.symbol}</span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tnum text-ink">
                      {inTok ? (
                        <>
                          {formatUnits(fill.inAmount, inTok.decimals, { maxFractionDigits: 2 })}{' '}
                          <span className="text-ink-3">{inTok.symbol}</span>
                        </>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tnum text-ink-2">
                      {fill.blockNumber.toString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Group px="md" py="sm">
            <Text size="xs" c="var(--ink-3)" className="leading-prose">
              Replayed from Aqua&rsquo;s <span className="font-mono">Pushed</span> and{' '}
              <span className="font-mono">Pulled</span> events. Each of these is a square on the
              curve above, at the reserves it left behind.
            </Text>
          </Group>
        </div>
      )}
    </Panel>
  );
}
