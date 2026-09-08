/**
 * Both sweeps, whole. Not the cell that flatters the book.
 *
 * A single seven-day run is an anecdote, and a single choice of implied volatility is a thumb on the
 * scale, so the Foundry test runs the same book at six volatilities and over eight start dates and writes
 * every result. This renders all of them, including the row where the book is beaten by an ordinary pool.
 * Hiding a losing row here would cost more credibility than the row itself does — so the losing cells are
 * not merely present, they are the only cells on the page painted `--neg`.
 */
import {
  Paper,
  Table,
  TableCaption,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from '@mantine/core';
import { Head, META, Signed } from './kit';
import {
  eth,
  sharePercent,
  usd,
  volPercent,
  type SigmaSweep,
  type WindowSweep,
} from './replay';

export function SigmaSweepTable({ sweep }: { sweep: SigmaSweep }) {
  return (
    <Paper withBorder radius="xl" className="overflow-hidden">
      <TableScrollContainer minWidth={840} type="native">
        <Table verticalSpacing="sm" horizontalSpacing="md" tabularNums fz={META}>
          <TableCaption className="px-4 pb-3 text-left">
            <Text fz="xs" c="var(--ink-3)">
              Simulation. The same book written at six different implied volatilities, on the same
              week of real Base prices. The {volPercent(1500, 0)} row loses to both pools and is
              published for that reason.
            </Text>
          </TableCaption>
          <TableThead>
            <TableTr>
              <TableTh>
                <Head
                  numeric
                  term="The implied volatility the book was written at: how big a move the maker chose to be paid for."
                >
                  Vol sold
                </Head>
              </TableTh>
              <TableTh>
                <Head numeric>Fills</Head>
              </TableTh>
              <TableTh>
                <Head
                  numeric
                  term="How much more ETH the wallet ended the week holding than it started with."
                >
                  Net ETH
                </Head>
              </TableTh>
              <TableTh>
                <Head
                  numeric
                  term="Time value written at the start: the premium on offer across the whole book, before anybody traded."
                >
                  Time value on offer
                </Head>
              </TableTh>
              <TableTh>
                <Head numeric>vs holding</Head>
              </TableTh>
              <TableTh>
                <Head numeric>vs 5 bp pool</Head>
              </TableTh>
              <TableTh>
                <Head numeric>vs 30 bp pool</Head>
              </TableTh>
              <TableTh>
                <Head
                  numeric
                  term="The difference from holding as a share of the time value on offer. Meaningless on a row with almost no time value to capture."
                >
                  Captured
                </Head>
              </TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {sweep.impliedVolBps.map((bps, i) => {
              const below = bps < sweep.realisedVolBps;
              return (
                <TableTr key={bps} bg={bps === 6000 ? 'var(--surface-2)' : undefined}>
                  <TableTd ta="right" fw={bps === 6000 ? 600 : undefined}>
                    {volPercent(bps, 0)}
                    {below ? (
                      <Text component="span" fz="xs" c="var(--ink-3)" ml={6}>
                        below realised
                      </Text>
                    ) : null}
                  </TableTd>
                  <TableTd ta="right">{sweep.fills[i].toLocaleString('en-US')}</TableTd>
                  <TableTd ta="right">{eth(sweep.netEth6[i], 3)}</TableTd>
                  <TableTd ta="right">{usd(sweep.timeValue6[i])}</TableTd>
                  <TableTd ta="right">
                    <Signed
                      micro={sweep.vsHold6[i]}
                      text={usd(sweep.vsHold6[i], { sign: 'always' })}
                    />
                  </TableTd>
                  <TableTd ta="right">
                    <Signed
                      micro={sweep.vsCpLow6[i]}
                      text={usd(sweep.vsCpLow6[i], { sign: 'always' })}
                    />
                  </TableTd>
                  <TableTd ta="right">
                    <Signed
                      micro={sweep.vsCpHigh6[i]}
                      text={usd(sweep.vsCpHigh6[i], { sign: 'always' })}
                    />
                  </TableTd>
                  <TableTd ta="right">
                    {sweep.timeValue6[i] === 0
                      ? '-'
                      : sharePercent(sweep.vsHold6[i] / sweep.timeValue6[i])}
                  </TableTd>
                </TableTr>
              );
            })}
          </TableTbody>
        </Table>
      </TableScrollContainer>
    </Paper>
  );
}

export function WindowSweepTable({ sweep }: { sweep: WindowSweep }) {
  return (
    <Paper withBorder radius="xl" className="overflow-hidden">
      <TableScrollContainer minWidth={740} type="native">
        <Table verticalSpacing="sm" horizontalSpacing="md" tabularNums fz={META}>
          <TableCaption className="px-4 pb-3 text-left">
            <Text fz="xs" c="var(--ink-3)">
              Simulation. The same book written on eight different days of the same price capture,
              twelve hours apart. Overlapping windows in one quiet fortnight, not eight independent
              trials.
            </Text>
          </TableCaption>
          <TableThead>
            <TableTr>
              <TableTh>
                <Head numeric>Started</Head>
              </TableTh>
              <TableTh>
                <Head numeric>ETH over the week</Head>
              </TableTh>
              <TableTh>
                <Head numeric>Fills</Head>
              </TableTh>
              <TableTh>
                <Head
                  numeric
                  term="Realised volatility: how much the price actually moved over that window."
                >
                  Vol it realised
                </Head>
              </TableTh>
              <TableTh>
                <Head numeric>vs holding</Head>
              </TableTh>
              <TableTh>
                <Head numeric>vs 5 bp pool</Head>
              </TableTh>
              <TableTh>
                <Head numeric>vs 30 bp pool</Head>
              </TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {sweep.offsetHours.map((hours, i) => (
              <TableTr key={hours} bg={hours === 0 ? 'var(--surface-2)' : undefined}>
                <TableTd ta="right" fw={hours === 0 ? 600 : undefined}>
                  {hours === 0 ? 'day 0' : `+${hours}h`}
                </TableTd>
                <TableTd ta="right">
                  {usd(sweep.startSpot6[i])} to {usd(sweep.endSpot6[i])}
                </TableTd>
                <TableTd ta="right">{sweep.fills[i].toLocaleString('en-US')}</TableTd>
                <TableTd ta="right">{volPercent(sweep.realisedVolBps[i])}</TableTd>
                <TableTd ta="right">
                  <Signed micro={sweep.vsHold6[i]} text={usd(sweep.vsHold6[i], { sign: 'always' })} />
                </TableTd>
                <TableTd ta="right">
                  <Signed
                    micro={sweep.vsCpLow6[i]}
                    text={usd(sweep.vsCpLow6[i], { sign: 'always' })}
                  />
                </TableTd>
                <TableTd ta="right">
                  <Signed
                    micro={sweep.vsCpHigh6[i]}
                    text={usd(sweep.vsCpHigh6[i], { sign: 'always' })}
                  />
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </TableScrollContainer>
    </Paper>
  );
}
