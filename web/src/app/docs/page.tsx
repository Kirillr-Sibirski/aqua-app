import type { Metadata } from 'next';
import Link from 'next/link';
import { Reveal } from '@/components/docs/Reveal';
import { WordmarkMark } from '@/components/shell/Wordmark';
import classes from './docs.module.css';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'What Strikeline does, who pays you, and how it works — in seven panels.',
};

const REPO = 'https://github.com/Kirillr-Sibirski/strikeline';
const AQUA = '0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a';

/** An arrowhead shared by every drawing on the page. */
function Defs() {
  return (
    <svg width="0" height="0" aria-hidden="true" className={classes.defs}>
      <defs>
        <marker id="docs-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
        <marker id="docs-arrow-ink" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--ink-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
    </svg>
  );
}

function Panel({
  n,
  title,
  children,
  art,
  flip = false,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  art: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <Reveal className={classes.panelWrap}>
      <section className={classes.panel} data-flip={flip || undefined} aria-labelledby={`panel-${n}`}>
        <div className={classes.art}>{art}</div>
        <div className={classes.copy}>
          <span className={classes.badge} aria-hidden="true">
            {n}
          </span>
          <h2 id={`panel-${n}`}>{title}</h2>
          <div className={classes.bubble}>{children}</div>
        </div>
      </section>
    </Reveal>
  );
}

/** A loose, hand-drawn connector between two panels. */
function Connector({ flip = false }: { flip?: boolean }) {
  return (
    <svg className={classes.connector} viewBox="0 0 400 70" preserveAspectRatio="none" aria-hidden="true" data-flip={flip || undefined}>
      <path
        className={classes.draw}
        d="M60 6 C 120 60, 260 10, 340 58"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeDasharray="5 6"
        strokeLinecap="round"
        markerEnd="url(#docs-arrow)"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ---------------------------------------------------------------- drawings */

function WalletArt() {
  return (
    <svg viewBox="0 0 320 220" role="img" aria-label="A wallet keeps its ETH while a price tag floats out of it">
      <rect x="40" y="80" width="170" height="110" rx="14" className={classes.ln} />
      <path d="M40 104 H210" className={classes.ln} />
      <rect x="160" y="118" width="62" height="36" rx="8" className={classes.ln} />
      <circle cx="178" cy="136" r="5" className={classes.acFill} />
      <path d="M95 128 l18 -26 l18 26 l-18 11 z M95 134 l18 11 l18 -11 l-18 26 z" className={classes.ln} />
      <text x="58" y="178" className={classes.tiny}>10.4 WETH</text>
      <path d="M200 76 C 222 40, 244 34, 262 38" className={`${classes.ac} ${classes.draw}`} markerEnd="url(#docs-arrow)" />
      <g className={classes.float}>
        <path d="M232 20 h66 a6 6 0 0 1 6 6 v30 a6 6 0 0 1 -6 6 h-66 l-14 -21 z" className={classes.acStroke} />
        <circle cx="236" cy="41" r="3" className={classes.acFill} />
        <text x="248" y="46" className={classes.tag}>2,600</text>
      </g>
    </svg>
  );
}

function PayArt() {
  const stacks = [1, 2, 3, 5];
  return (
    <svg viewBox="0 0 320 220" role="img" aria-label="Each day on the calendar, a buyer has to bring a taller stack of coins">
      {stacks.map((h, i) => {
        const x = 44 + i * 64;
        return (
          <g key={i}>
            <rect x={x - 22} y="24" width="48" height="44" rx="6" className={classes.ln} />
            <path d={`M${x - 22} 36 H${x + 26}`} className={classes.ln} />
            <text x={x + 2} y="60" textAnchor="middle" className={classes.tiny}>
              day {i + 1}
            </text>
            {Array.from({ length: h }).map((_, j) => (
              <ellipse key={j} cx={x + 2} cy={188 - j * 12} rx="17" ry="5" className={classes.coin} />
            ))}
          </g>
        );
      })}
      <path d="M36 180 C 110 170, 190 150, 290 96" className={`${classes.ac} ${classes.draw}`} markerEnd="url(#docs-arrow)" />
      <text x="206" y="92" className={classes.tagSmall}>premium</text>
    </svg>
  );
}

function LadderArt() {
  const steps = [0, 1, 2, 3, 4];
  return (
    <svg viewBox="0 0 320 220" role="img" aria-label="A staircase of prices rises to the strike line, with a flag at expiry">
      <path d="M24 70 H300" className={classes.acDash} />
      <text x="26" y="62" className={classes.tagSmall}>your price · 2,600</text>
      {steps.map((i) => (
        <g key={i}>
          <path d={`M${36 + i * 44} ${196 - i * 26} h44 v-26`} className={classes.ln} />
          <ellipse cx={58 + i * 44} cy={188 - i * 26} rx="9" ry="3.5" className={classes.coin} />
        </g>
      ))}
      <path d="M268 70 V26" className={classes.ln} />
      <path d="M268 26 l30 9 l-30 9 z" className={classes.acFill} />
      <text x="26" y="106" className={classes.tiny}>expiry: the rest</text>
      <text x="26" y="120" className={classes.tiny}>sells at 2,600</text>
    </svg>
  );
}

function PayoffArt() {
  return (
    <svg viewBox="0 0 320 220" role="img" aria-label="Just holding rises forever; with your offer the line goes flat after break-even">
      <path d="M30 196 H300 M30 196 V18" className={classes.axis} />
      <path d="M30 186 L300 40" className={classes.dash} />
      <path d="M30 186 L190 100 H300" className={classes.acThick} />
      <circle cx="190" cy="100" r="5" className={classes.acFill} />
      <path d="M150 42 C 168 52, 180 70, 186 90" className={`${classes.inkArrow} ${classes.draw}`} markerEnd="url(#docs-arrow-ink)" />
      <text x="100" y="36" className={classes.tag}>break-even</text>
      <text x="206" y="120" className={classes.tiny}>with your offer</text>
      <text x="214" y="46" className={classes.tiny}>just holding</text>
      <text x="120" y="212" className={classes.tiny}>ETH price at expiry →</text>
    </svg>
  );
}

function CoverageArt() {
  return (
    <svg viewBox="0 0 320 220" role="img" aria-label="One wallet backs three offer tags, guarded by a Coverage shield">
      <rect x="22" y="84" width="104" height="72" rx="12" className={classes.ln} />
      <text x="36" y="126" className={classes.tiny}>one wallet</text>
      {[40, 110, 180].map((y, i) => (
        <g key={y}>
          <path d={`M126 120 C 170 120, 180 ${y + 16}, 214 ${y + 16}`} className={`${classes.ac} ${classes.draw}`} markerEnd="url(#docs-arrow)" />
          <path d={`M222 ${y} h70 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h-70 l-10 -16 z`} className={classes.ln} />
          <text x="234" y={y + 21} className={classes.tiny}>offer {i + 1}</text>
        </g>
      ))}
      <path d="M74 20 l26 10 v20 c0 18 -12 28 -26 34 c-14 -6 -26 -16 -26 -34 v-20 z" className={classes.acStroke} />
      <path d="M63 48 l8 8 l15 -16" className={classes.acThin} />
    </svg>
  );
}

function ProgramArt() {
  const blocks = ['Deadline', 'FeeProtocol', 'Coverage', 'RmmSwap', 'Salt'];
  return (
    <svg viewBox="0 0 640 90" role="img" aria-label="The offer program: Deadline, FeeProtocol, Coverage, RmmSwap, Salt">
      {blocks.map((b, i) => {
        const x = 8 + i * 128;
        const ours = b === 'Coverage' || b === 'RmmSwap';
        return (
          <g key={b}>
            <rect x={x} y="24" width="104" height="42" rx="8" className={ours ? classes.acStroke : classes.ln} />
            <text x={x + 52} y="50" textAnchor="middle" className={ours ? classes.tag : classes.tiny}>
              {b}
            </text>
            {i < blocks.length - 1 ? <path d={`M${x + 106} 45 H${x + 124}`} className={classes.inkArrow} markerEnd="url(#docs-arrow-ink)" /> : null}
          </g>
        );
      })}
      <text x="264" y="84" className={classes.tiny}>ours ↑</text>
    </svg>
  );
}

/* ---------------------------------------------------------------- page */

export default function DocsPage() {
  return (
    <div className={classes.page}>
      <Defs />
      <header className={classes.bar}>
        <Link href="/" className={classes.brand}>
          <WordmarkMark size={18} />
          strikeline
        </Link>
        <nav className={classes.barLinks} aria-label="Docs">
          <Link href="/docs/technical" className={classes.techLink}>
            Technical docs →
          </Link>
          <Link href="/app" className={classes.back}>
            Back to app →
          </Link>
        </nav>
      </header>

      <main className={classes.body}>
        <Reveal className={classes.cover}>
          <p className={classes.kicker}>Strikeline, in seven panels</p>
          <h1>
            Name your price.
            <br />
            Get paid to <em>wait</em>.
          </h1>
        </Reveal>

        <Panel n={1} title="Your ETH stays home" art={<WalletArt />}>
          <p>You post a price and a date. The offer is a quote on 1inch Aqua, not a deposit.</p>
        </Panel>
        <Connector />

        <Panel n={2} title="Buyers pay for the wait" art={<PayArt />} flip>
          <p>Traders and bots on Aqua can buy from you. Every day nobody does, buying costs more — that gap is your premium.</p>
          <p className={classes.note}>No trade, no pay.</p>
        </Panel>
        <Connector flip />

        <Panel n={3} title="A little at a time" art={<LadderArt />}>
          <p>As the price rises your offer sells step by step, and buys back if it falls. At expiry, the rest sells at your price.</p>
          <p className={classes.note}>Flip it: offer to buy WETH below today&apos;s price with USDC.</p>
        </Panel>
        <Connector />

        <Panel n={4} title="Where you end up" art={<PayoffArt />} flip>
          <p>Below break-even you&apos;re level with holding. Above it your gains stop: break-even = your price + premium per WETH.</p>
        </Panel>
        <Connector flip />

        <Panel n={5} title="One wallet, many offers" art={<CoverageArt />}>
          <p>Coverage checks your real balance on every trade, so one wallet can back several offers safely.</p>
        </Panel>
        <Connector />

        <Reveal className={classes.panelWrap}>
          <section className={`${classes.panel} ${classes.hood}`} aria-labelledby="panel-6">
            <div className={classes.copy}>
              <span className={classes.badge} aria-hidden="true">
                6
              </span>
              <h2 id="panel-6">Under the hood</h2>
              <div className={classes.bubble}>
                <p>
                  Each offer is a SwapVM program on the official Aqua registry{' '}
                  <code className={classes.addr}>{AQUA}</code>. Every fill pays a 0.10% protocol fee.
                </p>
              </div>
            </div>
            <div className={classes.program}>
              <ProgramArt />
            </div>
            <aside className={classes.paper}>
              <span className={classes.paperKicker}>The curve comes from</span>
              <p className={classes.paperTitle}>Replicating Market Makers</p>
              <p className={classes.paperAuthors}>Angeris, Evans &amp; Chitra · 2021</p>
              <p className={classes.paperLinks}>
                <a href="https://arxiv.org/abs/2103.14769">arXiv:2103.14769</a>
                <a href="https://arxiv.org/abs/2111.13740">arXiv:2111.13740</a>
                <a href={REPO}>GitHub</a>
              </p>
            </aside>
          </section>
        </Reveal>
        <Connector flip />

        <Reveal className={classes.panelWrap}>
          <section className={classes.panel} aria-labelledby="panel-7">
            <div className={classes.copy}>
              <span className={classes.badge} aria-hidden="true">
                7
              </span>
              <h2 id="panel-7">Know the risks</h2>
            </div>
            <ul className={classes.stickers}>
              <li>
                <strong>Short volatility</strong>
                <span>Loses when ETH moves more than the vol you chose.</span>
              </li>
              <li>
                <strong>Not paid up front</strong>
                <span>Premium only arrives when someone trades.</span>
              </li>
              <li>
                <strong>Withdrawable</strong>
                <span>Offers can be pulled at any time. The demo runs on a hosted fork of Base.</span>
              </li>
            </ul>
          </section>
        </Reveal>

        <Reveal className={classes.panelWrap}>
          <section className={classes.deeper} aria-labelledby="deeper">
            <div>
              <span className={classes.paperKicker}>Want the details?</span>
              <h2 id="deeper">The technical deep dive</h2>
              <p>The SwapVM program byte by byte, the RMM-01 maths, Coverage, the protocol fee, gas, tests and how to run it.</p>
            </div>
            <Link href="/docs/technical" className={classes.deeperLink}>
              Read the technical docs →
            </Link>
          </section>
        </Reveal>

        <p className={classes.end}>
          <Link href="/app" className={classes.cta}>
            Open the app →
          </Link>
        </p>
      </main>
    </div>
  );
}
