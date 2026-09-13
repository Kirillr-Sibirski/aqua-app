import type { Metadata } from 'next';
import Link from 'next/link';
import { CopyCode } from '@/components/docs/CopyCode';
import { Reveal } from '@/components/docs/Reveal';
import { WordmarkMark } from '@/components/shell/Wordmark';
import classes from './technical.module.css';

export const metadata: Metadata = {
  title: 'Technical docs',
  description: 'How Strikeline works under the hood: the SwapVM program, RmmSwap, Coverage, the protocol fee and the numbers.',
};

const BLOB = 'https://github.com/Kirillr-Sibirski/strikeline/blob/main';
const AQUA = '0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a';

const SECTIONS = [
  { id: 'architecture', title: 'Architecture' },
  { id: 'program', title: 'The program' },
  { id: 'rmmswap', title: 'RmmSwap · 0x55' },
  { id: 'coverage', title: 'Coverage · 0x93' },
  { id: 'fee', title: 'Protocol fee' },
  { id: 'reading', title: 'Reading offers' },
  { id: 'numbers', title: 'Numbers and tests' },
  { id: 'running', title: 'Running it' },
  { id: 'limits', title: 'Limits and risks' },
] as const;

function Section({ n, id, title, children }: { n: number; id: string; title: string; children: React.ReactNode }) {
  return (
    <Reveal className={classes.reveal}>
      <section id={id} aria-labelledby={`${id}-h`} className={classes.section}>
        <h2 id={`${id}-h`}>
          <span className={classes.num}>{String(n).padStart(2, '0')}</span>
          {title}
          <a href={`#${id}`} className={classes.anchor} aria-label={`Link to ${title}`}>
            #
          </a>
        </h2>
        {children}
      </section>
    </Reveal>
  );
}

function Src({ path, line, children }: { path: string; line?: number; children: React.ReactNode }) {
  return (
    <a href={`${BLOB}/${path}${line ? `#L${line}` : ''}`} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function Code({ code }: { code: string }) {
  return <CopyCode code={code} className={classes.codeBlock} buttonClassName={classes.copyBtn} />;
}

function Callout({ label, tone, children }: { label: string; tone?: 'warn'; children: React.ReactNode }) {
  return (
    <div className={classes.callout} data-tone={tone}>
      <span className={classes.calloutLabel}>{label}</span>
      <p>{children}</p>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <div className={classes.diagram}>
      <svg viewBox="0 0 720 250" role="img" aria-label="The maker's wallet ships an offer to the Aqua registry; a taker trades through the Strikeline router, which runs FeeProtocol, Coverage and RmmSwap and settles through Aqua">
        <defs>
          <marker id="tech-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--ink-2)" strokeWidth="1.6" strokeLinecap="round" />
          </marker>
          <marker id="tech-arrow-ac" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
          </marker>
        </defs>
        <rect x="10" y="20" width="170" height="70" rx="10" className={classes.ln} />
        <text x="26" y="48" className={classes.boxText}>Maker wallet</text>
        <text x="26" y="70" className={classes.boxSub}>holds WETH / USDC</text>

        <rect x="275" y="20" width="190" height="70" rx="10" className={classes.ln} />
        <text x="291" y="48" className={classes.boxText}>Aqua registry</text>
        <text x="291" y="70" className={classes.boxSub}>0x1111113C…a90a · no tokens</text>

        <rect x="560" y="20" width="150" height="70" rx="10" className={classes.ln} />
        <text x="576" y="48" className={classes.boxText}>Taker</text>
        <text x="576" y="70" className={classes.boxSub}>quote() · swap()</text>

        <rect x="230" y="140" width="480" height="96" rx="12" className={classes.lnAc} />
        <text x="246" y="162" className={classes.edgeAc}>STRIKELINE ROUTER · REDEPLOYED SWAPVM</text>
        {['FeeProtocol', 'Coverage', 'RmmSwap'].map((name, i) => (
          <g key={name}>
            <rect x={246 + i * 152} y="176" width="136" height="44" rx="8" className={i === 0 ? classes.ln : classes.lnAc} />
            <text x={262 + i * 152} y="203" className={classes.boxText}>{name}</text>
          </g>
        ))}
        <path d="M382 198 H396" className={classes.ln} markerEnd="url(#tech-arrow)" />
        <path d="M534 198 H548" className={classes.ln} markerEnd="url(#tech-arrow)" />

        <path d="M180 55 H270" className={`${classes.lnAc} ${classes.draw}`} markerEnd="url(#tech-arrow-ac)" />
        <text x="184" y="44" className={classes.edgeAc}>ship</text>
        <text x="184" y="76" className={classes.edgeAc}>0 tokens</text>
        <path d="M635 90 V134" className={`${classes.ln} ${classes.draw}`} markerEnd="url(#tech-arrow)" />
        <text x="642" y="118" className={classes.edge}>trade</text>
        <path d="M370 140 V96" className={`${classes.ln} ${classes.draw}`} markerEnd="url(#tech-arrow)" />
        <text x="378" y="122" className={classes.edge}>pull · push</text>
        <path d="M230 196 H95 V96" className={classes.ln} strokeDasharray="5 5" markerEnd="url(#tech-arrow)" />
        <text x="104" y="140" className={classes.edge}>Coverage reads</text>
        <text x="104" y="156" className={classes.edge}>balanceOf ∧ allowance</text>
      </svg>
    </div>
  );
}

export default function TechnicalDocsPage() {
  return (
    <div className={classes.page}>
      <header className={classes.bar}>
        <Link href="/" className={classes.brand}>
          <WordmarkMark size={18} />
          strikeline
        </Link>
        <nav className={classes.barLinks} aria-label="Docs">
          <Link href="/docs" className={classes.link}>
            ← Visual overview
          </Link>
          <Link href="/app" className={classes.pill}>
            Open the app →
          </Link>
        </nav>
      </header>

      <div className={classes.layout}>
        <nav className={classes.toc} aria-label="On this page">
          <span className={classes.tocTitle}>On this page</span>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </nav>

        <main className={classes.body}>
          <div>
            <span className={classes.kicker}>Technical docs</span>
            <h1 className={classes.title}>How Strikeline works under the hood</h1>
            <p className={classes.lede}>
              Strikeline is a replicating market maker (RMM-01) written as two custom 1inch SwapVM instructions. This page
              covers the program an offer ships, the maths, the solvency check, the fee and how to run it. Every claim links
              to the source.
            </p>
          </div>

          <details className={classes.tocMobile}>
            <summary>On this page</summary>
            <ol>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.title}</a>
                </li>
              ))}
            </ol>
          </details>

          <Section n={1} id="architecture" title="Architecture">
            <p>
              A maker approves the <strong>official Aqua registry</strong> (<code>{AQUA}</code>) and ships a strategy whose app
              is our router. Aqua stores virtual balances and publishes the program bytes; it never holds tokens. When a taker
              trades, the router runs the program and Aqua moves tokens straight from the maker&apos;s wallet to the taker.
            </p>
            <ArchitectureDiagram />
            <p>
              The router is <Src path="contracts/src/StrikelineRouter.sol" line={31}>StrikelineRouter</Src>, a redeployed SwapVM
              that adds exactly two opcodes to <Src path="contracts/src/StrikelineRouter.sol" line={48}><code>_runOpcode</code></Src>.
              It keeps every official instruction except <code>PeggedSwap</code>, dropped to fit under EIP-170.
            </p>
          </Section>

          <Section n={2} id="program" title="The program">
            <p>Every offer is the same five-instruction program, built by <Src path="web/src/components/curve/rmm.ts">buildLegProgram</Src>:</p>
            <div className={classes.strip} aria-label="Deadline, then FeeProtocol, then Coverage, then RmmSwap, then Salt">
              <span className={classes.block}>Deadline</span>
              <span className={classes.arrow}>→</span>
              <span className={classes.block}>FeeProtocol</span>
              <span className={classes.arrow}>→</span>
              <span className={classes.block} data-ours>Coverage</span>
              <span className={classes.arrow}>→</span>
              <span className={classes.block} data-ours>RmmSwap</span>
              <span className={classes.arrow}>→</span>
              <span className={classes.block}>Salt</span>
            </div>
            <div className={classes.tableWrap}>
              <table>
                <thead>
                  <tr><th>Instruction</th><th>What it does</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>Deadline</code></td><td>Stops the offer from trading after maturity plus a grace window.</td></tr>
                  <tr><td><code>FeeProtocol</code></td><td>Takes 0.10% of the taker&apos;s input for the treasury and runs the rest on the net amount.</td></tr>
                  <tr><td><code>Coverage</code></td><td>Runs the curve, then refuses any output the maker&apos;s wallet can&apos;t deliver.</td></tr>
                  <tr><td><code>RmmSwap</code></td><td>Prices the trade on the RMM-01 curve at the current block time.</td></tr>
                  <tr><td><code>Salt</code></td><td>A nonce, so two offers with the same terms get different hashes.</td></tr>
                </tbody>
              </table>
            </div>
            <Callout label="Why this order">
              The fee comes first so both the check and the curve see the net trade. Coverage wraps the curve and runs it with a
              nested <code>ctx.runLoop()</code>: clamping the balance <em>before</em> pricing would move the reserve point and
              change the price, not just the size.
            </Callout>
          </Section>

          <Section n={3} id="rmmswap" title="RmmSwap · opcode 0x55">
            <p>
              <Src path="contracts/src/instructions/RmmSwap.sol" line={138}>RmmSwap</Src> implements RMM-01, the covered-call
              curve from Angeris, Evans &amp; Chitra (<a href="https://arxiv.org/abs/2103.14769">arXiv:2103.14769</a>,{' '}
              <a href="https://arxiv.org/abs/2111.13740">arXiv:2111.13740</a>):
            </p>
            <div className={classes.formula}>Y = L·K·Φ( Φ⁻¹(1 − X/L) − σ√τ )</div>
            <p>
              <code>X</code> and <code>Y</code> are the risky and stable reserves, <code>K</code> the strike, <code>σ</code> the
              implied volatility, <code>L</code> the liquidity, and <code>τ</code> the time left in years, read from{' '}
              <code>block.timestamp</code> with a{' '}
              <Src path="contracts/src/instructions/RmmSwap.sol" line={70}>one-hour floor</Src>. Holding reserves on this curve
              is long spot and short a call at <code>K</code>.
            </p>
            <h3>Arguments · 62 bytes</h3>
            <Code code={`[uint8 flags][uint64 sigmaWad][uint40 maturity][uint128 strikeWad]
[uint128 liquidityWad][uint64 rateRisky][uint64 rateStable]`} />
            <h3>The spread that opens with time</h3>
            <p>
              Reserves are pinned to the curve when the offer ships. As <code>τ</code> shrinks the curve moves away from them,
              so a trade must first close that gap. A trade inside it reverts with{' '}
              <Src path="contracts/src/instructions/RmmSwap.sol" line={56}><code>RmmInsideSpread(shortfall)</code></Src>, which
              carries the exact amount. That gap is the maker&apos;s premium, and the program has no fee inside the reserves
              because a fee there would push them off the curve and leak it.
            </p>
            <h3>Expiry and puts</h3>
            <p>
              At <code>τ = 0</code> the Gaussian drops out and the curve becomes <code>Y = K·(L − X)</code>, a constant-sum order
              at the strike, so assignment is an ordinary swap; the reverse direction reverts{' '}
              <code>RmmSettlementOneWay</code>. The same arguments are a cash-secured put when the reserves start in the stable
              token.
            </p>
            <Callout label="Precision">
              Φ and Φ⁻¹ are fixed-point (Solady), about 5e-12 relative error against a 50-digit reference. The guard band{' '}
              <Src path="contracts/src/instructions/RmmSwap.sol" line={76}><code>EPS = 2e-6</code></Src> is sized from the
              measured 1.18e-6 round trip and always favours the maker.
            </Callout>
          </Section>

          <Section n={4} id="coverage" title="Coverage · opcode 0x93">
            <p>
              Aqua lets a maker over-allocate: <code>ship()</code> checks no balance and <code>safeBalances()</code> never looks at
              the wallet. <Src path="contracts/src/instructions/Coverage.sol" line={105}>Coverage</Src> closes the gap inside
              the call that prices the trade.
            </p>
            <Code code={`args:  [uint8 flags][uint16 haircutBps]      // 3 bytes
check: amountOut ≤ min(balanceOf(maker), allowance(maker, Aqua)) × (1 − haircut)
else:  revert NotCovered(needed, free)`} />
            <p>
              Every offer reads the same wallet, so a fill on one immediately lowers what the others can deliver, in the same
              block, with no keeper or shared storage. It reverts rather than partially filling, and{' '}
              <Src path="contracts/src/StrikelineViews.sol" line={61}><code>coverage()</code></Src> publishes the same bound for
              UIs and solvers.
            </p>
          </Section>

          <Section n={5} id="fee" title="Protocol fee">
            <p>
              The fee is 1inch SwapVM&apos;s own <code>FeeProtocol</code>, charged on the taker&apos;s input: <code>10_000</code> in
              SwapVM units where <code>1e7</code> is 100%, so 0.10%. The receiver is <code>protocolFeeReceiver</code> from the
              deployment manifest, or the router owner.
            </p>
            <p>
              Only the net input reaches the maker&apos;s reserves, and that net amount is exactly what RmmSwap priced, so the
              curve and the premium are unchanged. Coverage only adds output-side fees to its obligation, so the solvency check
              is unaffected. Details in <Src path="docs/PROTOCOL-FEE.md">PROTOCOL-FEE.md</Src>.
            </p>
          </Section>

          <Section n={6} id="reading" title="Reading offers">
            <p>
              Aqua&apos;s <code>Shipped</code> event carries the full program, so an offer&apos;s strike, expiry, size and volatility
              are public. The app finds them with <code>getLogs</code>, decodes the program, then reads everything else in
              block-pinned multicalls so every figure on screen comes from the same block.
            </p>
            <ul>
              <li>
                <Src path="contracts/src/StrikelineViews.sol" line={23}><code>stableFor</code></Src> /{' '}
                <code>riskyFor</code> quote the curve at any reserve point.
              </li>
              <li>
                <Src path="contracts/src/StrikelineViews.sol" line={78}><code>bandFor</code></Src> returns the spread a trade
                must clear, which the premium chart draws.
              </li>
              <li>
                <Src path="contracts/src/SurfaceLens.sol" line={132}><code>SurfaceLens.book</code></Src> prices a whole book in
                one call; it is a separate contract so it costs the router nothing in size.
              </li>
            </ul>
          </Section>

          <Section n={7} id="numbers" title="Numbers and tests">
            <div className={classes.tableWrap}>
              <table>
                <tbody>
                  <tr><td>Router runtime size</td><td><strong>23,851 B</strong>, 725 B under EIP-170</td></tr>
                  <tr><td>Gas per fill</td><td>about <strong>211k</strong>, around a cent on Base</td></tr>
                  <tr><td>Offline Foundry tests</td><td><strong>147</strong> passing (<code>make test</code>)</td></tr>
                  <tr><td>Mainnet-fork tests</td><td><strong>11</strong>, real WETH/USDC through the official contracts (<code>make test-fork</code>)</td></tr>
                </tbody>
              </table>
            </div>
            <div className={classes.tableWrap}>
              <table>
                <thead>
                  <tr><th>Test</th><th>Proves</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>test_Theta_DecayOpensASpread</code></td><td>Time alone opens a two-sided spread.</td></tr>
                  <tr><td><code>test_Book_FillOnOneLegShrinksSiblingDepth</code></td><td>One fill lowers the other offers&apos; depth.</td></tr>
                  <tr><td><code>test_Book_WithoutCoverageTheDepthIsPhantom</code></td><td>Without Coverage, quoted depth isn&apos;t real.</td></tr>
                  <tr><td><code>test_Expiry_SettlesAtStrikeOneWay</code></td><td>At expiry it settles at the strike, one way.</td></tr>
                  <tr><td><code>test_Roll_MovesNoTokensAndCanRepeatParameters</code></td><td>Rolling an offer moves zero tokens.</td></tr>
                  <tr><td><code>testFuzz_QuoteEqualsSwap</code></td><td>Quotes always match swaps.</td></tr>
                  <tr><td><code>test_Fee_LeavesTheCurveAndPremiumUnchanged</code></td><td>The protocol fee doesn&apos;t touch the premium.</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              The suites live in <Src path="contracts/test/strikeline">contracts/test/strikeline</Src>.
            </p>
          </Section>

          <Section n={8} id="running" title="Running it">
            <h3>Locally</h3>
            <Code code={`make install        # once
make fork           # terminal 1: anvil fork of Base, chain id 31337
make story-setup    # deploy the router, fund demo wallets, freeze the state
make story-load     # rewind to that state (about a second)
make story-1        # ship four demo offers from one wallet
make web            # http://localhost:3000/app`} />
            <h3>Hosted demo</h3>
            <p>
              The live demo at <a href="https://strikeline-mu.vercel.app/app">strikeline-mu.vercel.app/app</a> talks to a fork of
              Base mainnet (chain ID 31337) run by anvil on a Google Cloud VM. The site reaches it through{' '}
              <Src path="web/src/app/api/rpc/route.ts">/api/rpc</Src>, which forwards JSON-RPC and blocks the{' '}
              <code>anvil_</code>, <code>evm_</code> and <code>debug_</code> admin methods.
            </p>
          </Section>

          <Section n={9} id="limits" title="Limits and risks">
            <ul>
              <li><strong>Short volatility.</strong> The position loses when realised volatility exceeds the σ it was written at.</li>
              <li><strong>No up-front premium.</strong> The premium is only realised when a taker crosses the spread.</li>
              <li><strong>Reverts, not partial fills.</strong> A taker asking for more than the wallet covers gets nothing.</li>
              <li><strong>Withdrawable.</strong> <code>dock</code> is instant, so a buyer can&apos;t rely on an offer like a listed option.</li>
              <li><strong>Approximated Φ.</strong> Dust-sized trades hit the guard band rather than an unbounded error.</li>
              <li><strong>Demo chain.</strong> The hosted demo is a fork; nothing is deployed to a public network.</li>
            </ul>
            <Callout label="Heads up" tone="warn">
              This is hackathon code and unaudited. Don&apos;t point it at real funds.
            </Callout>
          </Section>

          <nav className={classes.footerNav} aria-label="Docs navigation">
            <Link href="/docs" className={classes.link}>← Visual overview</Link>
            <Link href="/app" className={classes.pill}>Open the app →</Link>
          </nav>
        </main>
      </div>
    </div>
  );
}
