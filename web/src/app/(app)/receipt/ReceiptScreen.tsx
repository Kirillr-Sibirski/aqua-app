import {
  Alert,
  Badge,
  Paper,
  SimpleGrid,
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
import { AlertTriangle, Info } from 'lucide-react';
import {
  Head,
  InventoryChart,
  META,
  PathChart,
  ReceiptLinks,
  Section,
  SigmaSweepTable,
  SimBadge,
  Stat,
  TapeChart,
  WindowSweepTable,
  REPLAY,
  SIGMA_SWEEP,
  WINDOW_SWEEP,
  eth,
  headlineOf,
  lowestSellStrike6,
  replayIsUsable,
  sharePercent,
  usd,
  volPercent,
} from '@/components/receipt';
import { AppChrome, PageHeader } from '@/components/shell';

/**
 * The one screen in this app whose numbers are not a chain read, and the one screen that says so in
 * every register it has.
 *
 * Two readers of this project asked for the same missing thing in almost the same words. An options
 * trader: "if they can show realised theta over a few hundred fills versus a straight hold, I'd look
 * again." A liquidity provider: "the thing I actually need is the comparison, and it is absent." This is
 * that comparison, and the honest version of it is not a flattering one, so the page is built to survive
 * being read sceptically:
 *
 *  - It opens with the words simulation and not a track record, in the title block, in a banner and in
 *    the page description, before a single figure. Every section carrying a modelled number repeats the
 *    label rather than letting the reader forget it four screens down.
 *  - It states what the reader sells, earns and risks in plain words before any mechanism word appears.
 *  - It shows the whole volatility sweep, including the row where an ordinary pool beats the book, and
 *    the whole window sweep rather than the best week.
 *  - It names the conditions under which the thing loses, in its own section, with the numbers from this
 *    very run attached.
 *
 * Nothing on the page is computed here. Every figure comes from `contracts/test/markout/MarkoutReplay.t.sol`
 * through `@/components/receipt/replay`, and a judge can reproduce the whole page with one command.
 */
export function ReceiptScreen() {
  if (!replayIsUsable(REPLAY)) {
    return (
      <AppChrome>
        <Alert
          variant="light"
          color="ember"
          radius="lg"
          icon={<AlertTriangle size={18} strokeWidth={1.75} />}
          title="The replay data is not readable"
        >
          <p className="leading-prose">
            web/src/components/receipt/data/replay.json is not the shape this screen expects. Re-run
            the Foundry replay and publish it again with scripts/markout/publish.ts.
          </p>
        </Alert>
      </AppChrome>
    );
  }

  const t = REPLAY.totals;
  const h = headlineOf(REPLAY);
  const days = REPLAY.expiryDays;

  return (
    <AppChrome>
      <PageHeader
        title="What a week of this was worth"
        subtitle="One wallet named a price to sell its ETH at, and a real week of Base ETH prices was replayed against it. This page marks that week against simply holding the same coins, and against putting them in an ordinary liquidity pool."
        meta={
          <>
            <Badge variant="filled" color="amber" size="sm" radius="sm">
              Simulation
            </Badge>
            <Text fz="xs" c="var(--ink-3)">
              Nobody has traded this book with real money.
            </Text>
          </>
        }
      />

      <div className="mt-8 flex flex-col gap-10">
        <Alert
          variant="light"
          color="amber"
          radius="lg"
          icon={<AlertTriangle size={18} strokeWidth={1.75} />}
          title="Simulation. Not a track record."
        >
          <p className="leading-prose">
            No capital was ever at risk producing these numbers. What is real: the price path, which is
            every Chainlink ETH/USD round published on Base in a {days}-day window, and the pricing,
            which runs through the same contracts the app ships. What is a model: the traders. Exactly
            one is simulated, an arbitrage bot that trades only when trading pays it, and it is the
            stingiest customer this book could have. A real book would also see ordinary buyers, which
            pay a market maker more, and real competition, which pays less. Neither is here.
          </p>
        </Alert>

        <Terms replay={REPLAY} versusHold6={h.versusHold6} />

        <Section title="The week in four numbers" badge={<SimBadge />}>
          <Paper withBorder radius="xl" p="lg">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="xl" verticalSpacing="lg">
              <Stat
                label="Ended ahead of holding"
                value={usd(h.versusHold6, { sign: 'always' })}
                detail={
                  <>
                    on {usd(t.start6)} of capital, over {days} days. One replayed week, not a yield.
                  </>
                }
              />
              <Stat
                label="Times somebody traded"
                value={t.fills.toLocaleString('en-US')}
                unit={`of ${t.attempts.toLocaleString('en-US')}`}
                detail="Every other chance to trade, the buyer walked away."
              />
              <Stat
                label="Movement you were paid for"
                value={volPercent(t.impliedVolBps)}
                detail={
                  <>
                    The week actually moved {volPercent(t.realisedVolBps)}. You keep the difference
                    when it is quieter than what you sold.
                  </>
                }
              />
              <Stat
                label="Of the premium on offer"
                value={sharePercent(h.capturedOfTimeValue)}
                detail={
                  <>
                    {usd(t.timeValueAtStart6)} of time value was written. The rest was never
                    collected.
                  </>
                }
              />
            </SimpleGrid>
          </Paper>
        </Section>

        <PathChart replay={REPLAY} />

        <div className="grid gap-6 lg:grid-cols-2">
          <TapeChart replay={REPLAY} />
          <InventoryChart replay={REPLAY} />
        </div>

        <Attribution replay={REPLAY} versusHold6={h.versusHold6} netEth6={h.netEth6} />

        <LegBreakdown replay={REPLAY} />

        <Section
          title="Every volatility, not the flattering one"
          badge={<SimBadge />}
          body={`The maker picks the number they are paid for. It is the one input that decides whether writing this book pays at all, so the same week was replayed at six of them and all six are here. Below the volatility the week actually did (${volPercent(SIGMA_SWEEP.realisedVolBps)}), the book sells movement too cheaply and an ordinary pool beats it. Above it, the book is paid well but hardly anybody crosses the spread, so most of what it was paid is never collected. The last column is a ratio of the two columns before it, so on the 15% row, where there is almost no time value to capture in the first place, it means nothing.`}
        >
          <SigmaSweepTable sweep={SIGMA_SWEEP} />
        </Section>

        <Section
          title="Every start date, not the good week"
          badge={<SimBadge />}
          body={`One seven-day path is an anecdote. The same book was written on eight different days of the same price capture, twelve hours apart. It ended ahead of holding in ${WINDOW_SWEEP.wins} of ${WINDOW_SWEEP.offsetHours.length}. The windows overlap and cover a single quiet stretch of one market, so they are eight views of one regime, not eight independent trials.`}
        >
          <WindowSweepTable sweep={WINDOW_SWEEP} />
        </Section>

        <LosingConditions replay={REPLAY} />

        <Reproduce replay={REPLAY} />
      </div>
    </AppChrome>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** What you sell, what you earn, what you risk. Before any mechanism word on the page. */
function Terms({ replay, versusHold6 }: { replay: typeof REPLAY; versusHold6: number }) {
  const rows: Array<[string, string]> = [
    [
      'You sell',
      `Your ETH, at a price you name, and only if the price gets there. In this week it did not, so the wallet still had ${eth(replay.totals.endWeth6, 2)} WETH at the end.`,
    ],
    [
      'You earn',
      'What a buyer pays to cross your offer. You are not paid on day one, and if nobody ever trades against you, you earn nothing at all.',
    ],
    [
      'You risk',
      'ETH runs past your price, you sell at your price, and you would have made more by holding. On a week that moves more than you were paid for, you lose.',
    ],
  ];

  return (
    <Section title="What this is, in one screen">
      <Paper withBorder radius="xl" className="overflow-hidden">
        <dl className="flex flex-col divide-y divide-line">
          {rows.map(([term, body]) => (
            <div key={term} className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-6">
              <Text component="dt" fz={META} fw={600} c="var(--ink)" className="shrink-0 sm:w-28">
                {term}
              </Text>
              <Text component="dd" fz="sm" lh={1.5} c="var(--ink-2)" className="max-w-prose">
                {body}
              </Text>
            </div>
          ))}
        </dl>
      </Paper>
      <Text fz="sm" lh={1.5} c="var(--ink-2)" className="max-w-prose">
        Over the {replay.expiryDays} replayed days the book finished{' '}
        <span className="font-mono tnum text-ink">{usd(versusHold6, { sign: 'always' })}</span>{' '}
        against holding the same {eth(replay.walletWeth6, 1)} WETH and {usd(replay.walletUsdc6)}{' '}
        untouched, on <span className="font-mono tnum text-ink">{usd(replay.totals.start6)}</span> of
        capital. That is one week of one market. It is not annualised anywhere on this page, on
        purpose.
      </Text>
    </Section>
  );
}

/**
 * The decomposition, which is an identity rather than an argument, and the one place the page has to
 * contradict the intuition a reader arrives with.
 */
function Attribution({
  replay,
  versusHold6,
  netEth6,
}: {
  replay: typeof REPLAY;
  versusHold6: number;
  netEth6: number;
}) {
  const t = replay.totals;
  return (
    <Section
      title="Where the difference came from"
      badge={<SimBadge />}
      body="A maker's mark is the ETH they hold times the price, plus their dollars. That splits the week into exactly two parts with nothing left over, and the Foundry test asserts the split holds to within one wei per step of the replay."
    >
      <Paper withBorder radius="xl" className="overflow-hidden">
        <TableScrollContainer minWidth={420} type="native">
          <Table verticalSpacing="sm" horizontalSpacing="md" tabularNums fz={META}>
            <TableCaption className="sr-only">
              Simulated difference from holding, split into its two parts
            </TableCaption>
            <TableThead>
              <TableTr>
                <TableTh>
                  <Head>Part</Head>
                </TableTh>
                <TableTh>
                  <Head numeric>USD</Head>
                </TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              <TableTr>
                <TableTd>Cash from the trades themselves</TableTd>
                <TableTd ta="right">
                  <Text component="span" c="var(--neg)" className="tnum">
                    {usd(t.markout6, { sign: 'always' })}
                  </Text>
                </TableTd>
              </TableTr>
              <TableTr>
                <TableTd>Price moves on the ETH it traded</TableTd>
                <TableTd ta="right">
                  <Text component="span" c="var(--pos)" className="tnum">
                    {usd(t.upside6, { sign: 'always' })}
                  </Text>
                </TableTd>
              </TableTr>
              <TableTr bg="var(--surface-2)">
                <TableTd fw={600}>Ahead of holding</TableTd>
                <TableTd ta="right" fw={600}>
                  {usd(versusHold6, { sign: 'always' })}
                </TableTd>
              </TableTr>
            </TableTbody>
          </Table>
        </TableScrollContainer>
      </Paper>
      <Text fz="sm" lh={1.5} c="var(--ink-2)" className="max-w-prose">
        The first line is negative, and against this customer it always will be. The only trader
        modelled here is an arbitrage bot, and a bot only trades when the trade makes it money, so its
        profit and the maker&rsquo;s cash markout are the same number with opposite signs: it took{' '}
        <span className="font-mono tnum text-ink">{usd(t.takerProfit6)}</span>. What the maker is
        actually paid shows up in the second line: the book sold ETH as the price rose and bought it
        back as the price fell, and ended the week holding{' '}
        <span className="font-mono tnum text-ink">{eth(netEth6, 3)}</span> WETH more than it started
        with, at a better average price than holding would have given. That is the premium. It is not
        a credit that lands in your wallet on day one, and this page would be lying if it drew one.
      </Text>
    </Section>
  );
}

function LegBreakdown({ replay }: { replay: typeof REPLAY }) {
  const legs = replay.legs;
  return (
    <Section
      title="Which offers got taken"
      badge={<SimBadge />}
      body="Four offers stood on one wallet for the whole week. The closest one to the market did most of the trading, which is what a book is supposed to do. Every one of them shows negative cash for the reason the section above gives, and none of them is left out here."
    >
      <Paper withBorder radius="xl" className="overflow-hidden">
        <TableScrollContainer minWidth={560} type="native">
          <Table verticalSpacing="sm" horizontalSpacing="md" tabularNums fz={META}>
            <TableCaption className="sr-only">
              Simulated fills and cash markout per offer
            </TableCaption>
            <TableThead>
              <TableTr>
                <TableTh>
                  <Head>Offer</Head>
                </TableTh>
                <TableTh>
                  <Head numeric term="The strike, K: the price this offer would trade at.">
                    Your price
                  </Head>
                </TableTh>
                <TableTh>
                  <Head numeric term="Notional, L: how much the offer was written across.">
                    Size
                  </Head>
                </TableTh>
                <TableTh>
                  <Head numeric>Times taken</Head>
                </TableTh>
                <TableTh>
                  <Head
                    numeric
                    term="Cash markout: what the fills themselves paid, marked at the reference price. Negative against an arbitrage-only taker by construction."
                  >
                    Cash from the trades
                  </Head>
                </TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {legs.label.map((label, i) => (
                <TableTr key={label}>
                  <TableTd>{label.startsWith('put') ? 'Buy ETH at' : 'Sell ETH at'}</TableTd>
                  <TableTd ta="right">{usd(legs.strike6[i])}</TableTd>
                  <TableTd ta="right">{eth(legs.liquidity6[i], 0)} WETH</TableTd>
                  <TableTd ta="right">{legs.fills[i]}</TableTd>
                  <TableTd ta="right">
                    <Text component="span" c="var(--neg)" className="tnum">
                      {usd(legs.markout6[i], { sign: 'always' })}
                    </Text>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </TableScrollContainer>
      </Paper>
    </Section>
  );
}

function LosingConditions({ replay }: { replay: typeof REPLAY }) {
  const t = replay.totals;
  return (
    <Section title="When this loses" badge={<SimBadge />}>
      <div className="flex flex-col gap-3">
        <Alert
          variant="light"
          color="petrol"
          radius="lg"
          icon={<Info size={18} strokeWidth={1.75} />}
          title="You were paid for less movement than the market delivered."
        >
          <p className="leading-prose">
            The book is short volatility. This week moved {volPercent(t.realisedVolBps)} annualised
            against the {volPercent(t.impliedVolBps)} the book was paid for, which is the favourable
            side of that trade. The {volPercent(1500, 0)} row of the sweep above is the other side: it
            finishes behind both pools.
          </p>
        </Alert>
        <Alert
          variant="light"
          color="petrol"
          radius="lg"
          icon={<Info size={18} strokeWidth={1.75} />}
          title="The price runs past your price and keeps going."
        >
          <p className="leading-prose">
            In this week ETH peaked at {usd(t.peakSpot6)} against the lowest price the book offered to
            sell at, {usd(lowestSellStrike6(replay.legs))}, so nothing was ever sold at a strike. A
            week that runs through your price and keeps climbing sells your ETH at your price and
            leaves the rest of the move on the table. That is the trade, and this capture never tested
            it.
          </p>
        </Alert>
        <Alert
          variant="light"
          color="petrol"
          radius="lg"
          icon={<Info size={18} strokeWidth={1.75} />}
          title="Nobody shows up."
        >
          <p className="leading-prose">
            {t.declinedByTaker.toLocaleString('en-US')} times out of{' '}
            {t.attempts.toLocaleString('en-US')} the price was there and the buyer still walked away,
            because the spread was wider than their edge. The premium in this design lives inside the
            spread; it is not a credit. A book nobody trades against earns nothing, keeps its ETH, and
            that is the whole of it.
          </p>
        </Alert>
      </div>
    </Section>
  );
}

function Reproduce({ replay }: { replay: typeof REPLAY }) {
  return (
    <Section
      title="Run it yourself"
      body="Every number on this page is printed by one command, against the committed price capture. The screen imports what that command writes and renders nothing else."
    >
      <Paper withBorder radius="xl" p="md" className="overflow-x-auto">
        <pre className="font-mono text-meta leading-num text-ink-2">
          <code>{`cd contracts\nforge test --match-path 'test/markout/*' -vv`}</code>
        </pre>
      </Paper>
      <Text fz="sm" lh={1.5} c="var(--ink-2)" className="max-w-prose">
        The tape is <span className="font-mono">{replay.tape.source}</span>,{' '}
        {replay.tape.rounds.toLocaleString('en-US')} rounds from feed{' '}
        <span className="font-mono">{replay.tape.feed}</span> on chain{' '}
        <span className="font-mono tnum">{replay.tape.chainId}</span>, read at block{' '}
        <span className="font-mono tnum">{replay.tape.readAtBlock.toLocaleString('en-US')}</span>. The
        test re-reads that file and checks its hash before it uses a single price, so a tape edited to
        make this page look better fails the test instead.
      </Text>
      <ReceiptLinks />
    </Section>
  );
}
