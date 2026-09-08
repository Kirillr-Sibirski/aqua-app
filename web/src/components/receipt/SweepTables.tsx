/**
 * Both sweeps, whole. Not the cell that flatters the book.
 *
 * A single seven-day run is an anecdote, and a single choice of implied volatility is a thumb on the
 * scale, so the Foundry test runs the same book at six volatilities and over eight start dates and writes
 * every result. This renders all of them, including the row where the book is beaten by an ordinary pool.
 * Hiding a losing row here would cost more credibility than the row itself does.
 */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import {
  eth,
  sharePercent,
  usd,
  volPercent,
  type SigmaSweep,
  type WindowSweep,
} from './replay';

/** A signed dollar figure, coloured only where the sign is the point. */
function Signed({ micro }: { micro: number }) {
  const tone = micro > 0 ? 'text-pos' : micro < 0 ? 'text-neg' : 'text-ink-3';
  return <span className={tone}>{usd(micro, { sign: 'always' })}</span>;
}

export function SigmaSweepTable({ sweep }: { sweep: SigmaSweep }) {
  return (
    <Table
      caption="The same book written at six different implied volatilities, on the same week"
      minWidth="52rem"
      scrollHint="difference from holding, from each pool, and the share of time value captured"
    >
      <TableHead>
        <TableRow>
          <TableHeaderCell numeric>Vol sold</TableHeaderCell>
          <TableHeaderCell numeric>Fills</TableHeaderCell>
          <TableHeaderCell numeric>Net ETH</TableHeaderCell>
          <TableHeaderCell numeric>Time value on offer</TableHeaderCell>
          <TableHeaderCell numeric>vs holding</TableHeaderCell>
          <TableHeaderCell numeric>vs 5 bp pool</TableHeaderCell>
          <TableHeaderCell numeric>vs 30 bp pool</TableHeaderCell>
          <TableHeaderCell numeric>Captured</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {sweep.impliedVolBps.map((bps, i) => {
          const below = bps < sweep.realisedVolBps;
          return (
            <TableRow key={bps} highlighted={bps === 6000}>
              <TableCell numeric>
                {volPercent(bps, 0)}
                {below ? <span className="ml-1 text-mini text-ink-3">below realised</span> : null}
              </TableCell>
              <TableCell numeric>{sweep.fills[i].toLocaleString('en-US')}</TableCell>
              <TableCell numeric>{eth(sweep.netEth6[i], 3)}</TableCell>
              <TableCell numeric>{usd(sweep.timeValue6[i])}</TableCell>
              <TableCell numeric>
                <Signed micro={sweep.vsHold6[i]} />
              </TableCell>
              <TableCell numeric>
                <Signed micro={sweep.vsCpLow6[i]} />
              </TableCell>
              <TableCell numeric>
                <Signed micro={sweep.vsCpHigh6[i]} />
              </TableCell>
              <TableCell numeric>
                {sweep.timeValue6[i] === 0
                  ? '-'
                  : sharePercent(sweep.vsHold6[i] / sweep.timeValue6[i])}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function WindowSweepTable({ sweep }: { sweep: WindowSweep }) {
  return (
    <Table
      caption="The same book written on eight different days of the same price capture"
      minWidth="46rem"
      scrollHint="realised volatility and the difference from holding and from a pool"
    >
      <TableHead>
        <TableRow>
          <TableHeaderCell numeric>Started</TableHeaderCell>
          <TableHeaderCell numeric>ETH over the week</TableHeaderCell>
          <TableHeaderCell numeric>Fills</TableHeaderCell>
          <TableHeaderCell numeric>Vol it realised</TableHeaderCell>
          <TableHeaderCell numeric>vs holding</TableHeaderCell>
          <TableHeaderCell numeric>vs 5 bp pool</TableHeaderCell>
          <TableHeaderCell numeric>vs 30 bp pool</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {sweep.offsetHours.map((hours, i) => (
          <TableRow key={hours} highlighted={hours === 0}>
            <TableCell numeric>{hours === 0 ? 'day 0' : `+${hours}h`}</TableCell>
            <TableCell numeric>
              {usd(sweep.startSpot6[i])} to {usd(sweep.endSpot6[i])}
            </TableCell>
            <TableCell numeric>{sweep.fills[i].toLocaleString('en-US')}</TableCell>
            <TableCell numeric>{volPercent(sweep.realisedVolBps[i])}</TableCell>
            <TableCell numeric>
              <Signed micro={sweep.vsHold6[i]} />
            </TableCell>
            <TableCell numeric>
              <Signed micro={sweep.vsCpLow6[i]} />
            </TableCell>
            <TableCell numeric>
              <Signed micro={sweep.vsCpHigh6[i]} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
