'use client';

/**
 * Every specimen in the gallery.
 *
 * One client module rather than a server page, because half of what a gallery has to demonstrate
 * cannot cross the server / client boundary: a lucide `icon` prop is a component reference and an
 * `onRetry` is a function, and React Server Components serialise neither. Rendering the specimens
 * here is not a retreat from SSR — Next still renders this module on the server for the initial
 * HTML, so a primitive that reaches for `window` during render still breaks the production build.
 */
import {
  ArrowLeftRight,
  Ban,
  Clock,
  Dock,
  Download,
  Layers,
  RefreshCw,
  Send,
  Signature,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import {
  Address,
  Button,
  Callout,
  Card,
  CardRow,
  CopyButton,
  Delta,
  Dialog,
  EmptyState,
  ErrorState,
  ExplorerLink,
  Field,
  IconButton,
  Input,
  NumberInput,
  Pill,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  SkeletonText,
  StatRow,
  StatTile,
  Tab,
  TabList,
  TabPanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableMessageRow,
  TableRow,
  TableSkeletonRows,
  Tabs,
  TokenAmount,
  Tooltip,
  notify,
} from '@/components/ui';
import { Section, Specimen, SpecimenGrid } from './Section';
import {
  AQUA_ADDRESS,
  BOOK_BACKING,
  BOOK_REMAINING,
  COVERAGE_REVERT,
  DECAY_BAND,
  DUST,
  FIXTURE_LEGS,
  MAKER_ADDRESS,
  NEGATIVE_DELTA,
  STRATEGY_HASH,
  THETA_COLLECTED,
  TX_HASH,
  USDC_BALANCE,
  USDC_DECIMALS,
  USD_VALUE,
  USER_REJECTED,
  WETH_BALANCE,
  WETH_DECIMALS,
} from './fixtures';

const BASESCAN = 'https://basescan.org';

export function Gallery() {
  return (
    <div className="mt-10 flex flex-col gap-10">
      <Buttons />
      <InteractiveControls />
      <Status />
      <Numbers />
      <Identifiers />
      <Tiles />
      <Tables />
      <States />
      <InteractiveOverlays />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Buttons() {
  return (
    <Section
      title="Buttons"
      note="Loading keeps the label in place and only lays a spinner over it, so the control never changes width mid-transaction. A button disabled for a reason stays focusable and hoverable — otherwise the reason is unreadable by the people most likely to need it."
    >
      <SpecimenGrid>
        <Specimen label="Variants">
          <Button variant="primary" icon={Send}>
            Ship leg
          </Button>
          <Button variant="secondary">Quote</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger" icon={Trash2}>
            Dock
          </Button>
        </Specimen>

        <Specimen label="Sizes">
          <Button size="md" icon={Send}>
            Medium
          </Button>
          <Button size="sm" icon={Send}>
            Small
          </Button>
        </Specimen>

        <Specimen label="Loading, width preserved">
          <Button loading loadingLabel="Waiting for the signature">
            Ship leg
          </Button>
          <Button variant="secondary" loading>
            Quote
          </Button>
        </Specimen>

        <Specimen label="Disabled, hard">
          <Button disabled icon={Send}>
            Ship leg
          </Button>
          <Button variant="secondary" disabled>
            Quote
          </Button>
        </Specimen>

        <Specimen label="Disabled, with a reason">
          <Button disabled disabledReason="Connect a wallet to ship a leg." icon={Send}>
            Ship leg
          </Button>
          <Button
            variant="danger"
            disabled
            disabledReason="This leg is already docked."
            icon={Dock}
          >
            Dock
          </Button>
        </Specimen>

        <Specimen label="Icon buttons">
          <IconButton icon={RefreshCw} label="Refresh the book" variant="secondary" />
          <IconButton icon={Download} label="Download the receipt" />
          <IconButton icon={RefreshCw} label="Refreshing" loading variant="secondary" />
          <IconButton
            icon={Ban}
            label="Dock"
            variant="danger"
            disabled
            disabledReason="Already docked."
          />
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}

function Status() {
  return (
    <Section
      title="Status and loading"
      note="Every pill carries a word. Colour is the third cue, after the label and the dot's position — a screenshot, a colour-blind reader and a screen reader all get the same answer. Skeletons match the shape of what is coming, and lose their sweep entirely under prefers-reduced-motion."
    >
      <SpecimenGrid>
        <Specimen label="Pills">
          <Pill tone="positive" dot>
            Active
          </Pill>
          <Pill tone="neutral" dot>
            Docked
          </Pill>
          <Pill tone="warning" dot>
            Partial
          </Pill>
          <Pill tone="negative" dot>
            Reverted
          </Pill>
          <Pill tone="accent">Your leg</Pill>
        </Specimen>

        <Specimen label="Pills, small, with icons">
          <Pill size="sm" tone="accent" icon={Layers}>
            4 legs
          </Pill>
          <Pill size="sm" tone="neutral">
            Fork
          </Pill>
        </Specimen>

        <Specimen label="Skeletons">
          <div className="flex w-full flex-col gap-2">
            <Skeleton className="h-6 w-40" label="a figure" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton radius="pill" className="h-6 w-28" />
          </div>
        </Specimen>

        <Specimen label="Skeleton text" wide>
          <SkeletonText lines={3} className="w-full max-w-prose" />
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}

function Numbers() {
  return (
    <Section
      title="Amounts and deltas"
      note="Amounts are bigint-exact: the visible figure is rounded to a readable number of significant digits, the untruncated decimal string is on the title attribute, and a non-zero balance too small to render shows a bound rather than collapsing to zero. A delta carries an arrow and a sign as well as a colour."
    >
      <SpecimenGrid>
        <Specimen label="Token amounts">
          <div className="flex flex-col gap-2">
            <TokenAmount value={WETH_BALANCE} decimals={WETH_DECIMALS} symbol="WETH" size="lg" />
            <TokenAmount value={USDC_BALANCE} decimals={USDC_DECIMALS} symbol="USDC" />
            <TokenAmount value={DECAY_BAND} decimals={USDC_DECIMALS} symbol="USDC" size="sm" />
          </div>
        </Specimen>

        <Specimen label="With USD">
          <div className="flex flex-col items-end gap-2">
            <TokenAmount
              value={WETH_BALANCE}
              decimals={WETH_DECIMALS}
              symbol="WETH"
              usd={USD_VALUE}
            />
            <TokenAmount
              value={BOOK_BACKING}
              decimals={WETH_DECIMALS}
              symbol="WETH"
              usd={USD_VALUE}
              usdPlacement="inline"
            />
          </div>
        </Specimen>

        <Specimen label="Dust never renders as zero">
          <TokenAmount value={DUST} decimals={WETH_DECIMALS} symbol="WETH" />
        </Specimen>

        <Specimen label="Deltas">
          <div className="flex flex-col gap-2">
            <Delta value={THETA_COLLECTED} decimals={WETH_DECIMALS} symbol="WETH" />
            <Delta value={NEGATIVE_DELTA} decimals={USDC_DECIMALS} symbol="USDC" />
            <Delta value={BigInt(0)} decimals={WETH_DECIMALS} symbol="WETH" />
          </div>
        </Specimen>

        <Specimen label="Deltas, as percentages">
          <div className="flex flex-col gap-2">
            <Delta percent={0.0512} />
            <Delta percent={-0.0187} />
            <Delta percent={0.0092} goodDirection="down" />
          </div>
        </Specimen>

        <Specimen label="Deltas, untoned">
          <Delta value={THETA_COLLECTED} decimals={WETH_DECIMALS} symbol="WETH" tone={false} />
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}

function Identifiers() {
  return (
    <Section
      title="Addresses, hashes and links"
      note="Elided in the middle, because the two ends are what a person compares. The full value stays on the title attribute and on the clipboard, and the copy result is announced in a live region rather than only turning green."
    >
      <SpecimenGrid>
        <Specimen label="Address">
          <Address value={AQUA_ADDRESS} what="Aqua registry" href={`${BASESCAN}/address/${AQUA_ADDRESS}`} />
        </Specimen>

        <Specimen label="Address, no explorer (fork-local)">
          <Address value={MAKER_ADDRESS} what="maker address" />
        </Specimen>

        <Specimen label="Hash">
          <Address value={STRATEGY_HASH} kind="hash" what="strategy hash" />
        </Specimen>

        <Specimen label="Hash, in full">
          <Address value={TX_HASH} kind="hash" what="transaction hash" full size="mini" copy={false} />
        </Specimen>

        <Specimen label="Explorer links">
          <ExplorerLink href={`${BASESCAN}/tx/${TX_HASH}`}>Fill on Basescan</ExplorerLink>
          <ExplorerLink href={`${BASESCAN}/address/${AQUA_ADDRESS}`} mono bare>
            0x1111113CCf…a90a
          </ExplorerLink>
        </Specimen>

        <Specimen label="Copy buttons">
          <CopyButton value={STRATEGY_HASH} what="strategy hash" variant="secondary" />
          <CopyButton value={STRATEGY_HASH} what="strategy hash" compact />
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}

function Tiles() {
  return (
    <Section
      title="Cards and tiles"
      note="A card marks one separable object, never a grid of identical panels, and a card inside a card silently flattens itself. Tiles top out at the 20px step: a figure a maker reads all day should not shout, and there are no hero metrics anywhere in this app."
    >
      <div className="flex flex-col gap-6">
        <Card
          title="Backing"
          description="One wallet balance margins every leg in the book at once."
          actions={
            <Button size="sm" variant="secondary" icon={RefreshCw}>
              Refresh
            </Button>
          }
          footer={
            <>
              <span>Read from the wallet, not from a vault</span>
              <Address value={MAKER_ADDRESS} size="mini" copy={false} />
            </>
          }
        >
          <StatRow>
            <StatTile
              label="Wallet backing"
              value={<TokenAmount value={BOOK_BACKING} decimals={WETH_DECIMALS} size="lg" />}
              unit="WETH"
              detail="Shared across four legs"
            />
            <StatTile
              label="After a 5 WETH fill"
              value={<TokenAmount value={BOOK_REMAINING} decimals={WETH_DECIMALS} size="lg" />}
              unit="WETH"
              detail={<Delta value={BigInt('-5000000000000000000')} decimals={WETH_DECIMALS} size="sm" />}
            />
            <StatTile
              label="Theta collected"
              value={<TokenAmount value={THETA_COLLECTED} decimals={WETH_DECIMALS} size="lg" />}
              unit="WETH"
              detail="Over one leg's life"
              aside={<Pill size="sm" tone="positive">Realised</Pill>}
            />
            <StatTile label="Notional written" loading />
          </StatRow>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Card rows" description="A handful of facts that do not deserve a table.">
            <CardRow label="Strike">
              <span className="font-mono tnum">2,800 USDC</span>
            </CardRow>
            <CardRow label="Implied vol">
              <span className="font-mono tnum">60%</span>
            </CardRow>
            <CardRow label="Expiry">
              <span className="font-mono tnum">7 days</span>
            </CardRow>
            <CardRow label="Decay band, 2 days in">
              <TokenAmount value={DECAY_BAND} decimals={USDC_DECIMALS} symbol="USDC" size="sm" />
            </CardRow>
          </Card>

          <Card title="Callouts">
            <div className="flex flex-col gap-3">
              <Callout tone="info" title="Aqua records allowances, not deposits">
                The tokens backing this leg stay in the maker&rsquo;s wallet until a fill pulls them.
              </Callout>
              <Callout tone="accent" title="Your position">
                This leg was shipped from the connected wallet.
              </Callout>
              <Callout
                tone="warning"
                title="Oracle price is 340 seconds old"
                action={
                  <Button size="sm" variant="secondary">
                    Refresh
                  </Button>
                }
              >
                Pricing does not read the oracle. This figure is for orientation only.
              </Callout>
              <Callout tone="error" title="Coverage refused this quote">
                The guard reverts rather than clamping, so the quote never lies about depth.
              </Callout>
              <Callout tone="positive" title="Fill landed">
                0.338 WETH of theta paid on first assignment.
              </Callout>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}

function Tables() {
  return (
    <Section
      title="Tables"
      note="Semantic table markup, a sticky header, 44px rows and right-aligned mono numerics. Wide tables scroll inside their own container so the page body never scrolls sideways."
    >
      <div className="flex flex-col gap-6">
        <Card title="Loaded" flush>
          <LegTable>
            {FIXTURE_LEGS.map((leg, i) => (
              <TableRow key={leg.hash} highlighted={i === 0}>
                <TableCell>
                  <Address value={leg.hash} kind="hash" what="strategy hash" />
                </TableCell>
                <TableCell>{leg.pair}</TableCell>
                <TableCell>
                  <span className="font-mono">
                    {leg.kind}
                    <span className="text-ink-3"> @ </span>
                    {leg.strike}
                  </span>
                </TableCell>
                <TableCell>
                  {leg.status === 'active' ? (
                    <Pill tone="positive" dot>
                      Active
                    </Pill>
                  ) : leg.status === 'docked' ? (
                    <Pill tone="neutral" dot>
                      Docked
                    </Pill>
                  ) : (
                    <Pill tone="warning" dot>
                      Partial
                    </Pill>
                  )}
                </TableCell>
                <TableCell numeric>
                  <TokenAmount
                    value={leg.depth}
                    decimals={leg.depthDecimals}
                    symbol={leg.depthSymbol}
                    size="sm"
                  />
                </TableCell>
                <TableCell numeric>{leg.block.toString()}</TableCell>
              </TableRow>
            ))}
          </LegTable>
        </Card>

        <Card title="Loading" flush>
          <LegTable>
            <TableSkeletonRows rows={3} columns={6} label="the book" />
          </LegTable>
        </Card>

        <Card title="Empty" flush>
          <LegTable>
            <TableMessageRow colSpan={6}>No legs match this filter.</TableMessageRow>
          </LegTable>
        </Card>
      </div>
    </Section>
  );
}

function LegTable({ children }: { children: ReactNode }) {
  return (
    <Table caption="Legs in this book" hideCaption minWidth="56rem">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Leg</TableHeaderCell>
          <TableHeaderCell>Pair</TableHeaderCell>
          <TableHeaderCell>Written</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell numeric>Deliverable depth</TableHeaderCell>
          <TableHeaderCell numeric>Block</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function States() {
  return (
    <Section
      title="The five states"
      note="Every data surface in the app ships all of these. The error state headlines the decoded custom error name and lists the arguments, because on this app a revert is usually the answer rather than an outage."
    >
      <div className="flex flex-col gap-6">
        <EmptyState
          icon={Layers}
          title="No legs shipped from this wallet"
          description="A leg is a SwapVM program shipped to Aqua against tokens that never leave your wallet. Ship a ladder of them and one balance margins the whole book."
          action={<Button icon={Send}>Ship a leg</Button>}
          note="On the local fork, `make smoke` ships the demo ladder."
        />

        <ErrorState
          error={COVERAGE_REVERT}
          title="Could not quote this leg"
          onRetry={() => {}}
          action={
            <Button size="sm" variant="ghost">
              Read the guard
            </Button>
          }
        />

        <ErrorState error={USER_REJECTED} onRetry={() => {}} retryLabel="Sign again" />

        <Callout tone="warning" title="Your wallet is on Ethereum">
          Reads on this page come from Base fork, so the book below is correct. Shipping, docking and
          swapping will fail until the wallet is on the same chain.
        </Callout>

        <EmptyState
          title="Connect a wallet to see your book"
          description="Nothing is custodied, so there is nothing to read until a wallet is connected."
          action={<Button>Connect wallet</Button>}
          bare
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function InteractiveControls() {
  const [amount, setAmount] = useState('12.4871');
  const [empty, setEmpty] = useState('');
  const [side, setSide] = useState<'call' | 'put'>('call');
  const [expiry, setExpiry] = useState('7d');

  return (
    <Section
      title="Controls"
      note="NumberInput keeps the amount as a string and truncates past the token's decimals as you type, so an 18-decimal value is never rounded by a JavaScript number on its way to the chain. type=text, so no browser spinners and no locale parsing."
    >
      <SpecimenGrid>
        <Specimen label="Amount, with balance shortcuts">
          <Field label="Size" hint="Half and Max write the exact balance, not a rounded one.">
            <NumberInput
              value={amount}
              onValueChange={setAmount}
              decimals={WETH_DECIMALS}
              symbol="WETH"
              balance={WETH_BALANCE}
            />
          </Field>
        </Specimen>

        <Specimen label="Amount, invalid">
          <Field label="Strike" error="Strike must sit above spot for a call leg.">
            <NumberInput value="2100" onValueChange={() => {}} decimals={6} symbol="USDC" invalid />
          </Field>
        </Specimen>

        <Specimen label="Amount, disabled">
          <Field label="Size" hint="Connect a wallet to size a leg.">
            <NumberInput
              value={empty}
              onValueChange={setEmpty}
              decimals={WETH_DECIMALS}
              symbol="WETH"
              disabled
            />
          </Field>
        </Specimen>

        <Specimen label="Text, with leading and trailing slots">
          <Field label="Maker" hint="The wallet the legs draw on.">
            <Input
              mono
              placeholder="0x0000…0000"
              defaultValue="0x8A4c1E6d4B0f19B2ee31c2B0E0D5f9C3a7b62D14"
              trailing={<span className="text-mini text-ink-3">EIP-55</span>}
            />
          </Field>
        </Specimen>

        <Specimen label="Select">
          <Field label="Collateral">
            <Select
              defaultValue="weth"
              options={[
                { value: 'weth', label: 'WETH' },
                { value: 'usdc', label: 'USDC' },
                { value: 'cbbtc', label: 'cbBTC (no feed on this fork)', disabled: true },
              ]}
            />
          </Field>
        </Specimen>

        <Specimen label="Segmented control">
          <SegmentedControl
            label="Leg side"
            value={side}
            onValueChange={setSide}
            items={[
              { value: 'call', label: 'Call', icon: TrendingUp },
              { value: 'put', label: 'Put', icon: TrendingDown },
            ]}
          />
        </Specimen>

        <Specimen label="Segmented control, with a disabled option">
          <SegmentedControl
            label="Expiry"
            value={expiry}
            onValueChange={setExpiry}
            size="sm"
            items={[
              { value: '1d', label: '1d' },
              { value: '7d', label: '7d' },
              { value: '30d', label: '30d', disabled: true, disabledReason: 'Beyond the fork window' },
            ]}
          />
        </Specimen>

        <Specimen label="Tooltip" wide>
          <Tooltip content="Theta measured over one leg's life: 0.338 WETH.">
            <Button variant="secondary" size="sm" icon={Clock}>
              Hover or focus me
            </Button>
          </Tooltip>
          <Tooltip content="Opens the wallet picker." side="right">
            <IconButton icon={Signature} label="Sign" variant="secondary" size="sm" />
          </Tooltip>
        </Specimen>
      </SpecimenGrid>

      <div className="mt-8">
        <Tabs defaultValue="overview">
          <TabList label="Gallery tabs">
            <Tab value="overview" icon={Layers}>
              Overview
            </Tab>
            <Tab value="program" count={62}>
              Program
            </Tab>
            <Tab value="activity" count={0}>
              Activity
            </Tab>
            <Tab value="settle" disabled>
              Settlement
            </Tab>
          </TabList>
          <TabPanel value="overview">
            <p className="max-w-prose text-meta leading-prose text-ink-2">
              Selection follows focus, which is the right pattern when every panel is already-fetched
              local state. Arrow keys move, Home and End jump, and the disabled tab is skipped rather
              than trapping focus.
            </p>
          </TabPanel>
          <TabPanel value="program">
            <p className="font-mono text-meta break-all text-ink-2">
              0x55 RmmSwap · 0x93 Coverage · 62 bytes
            </p>
          </TabPanel>
          <TabPanel value="activity">
            <p className="text-meta text-ink-3">Nothing yet.</p>
          </TabPanel>
        </Tabs>
      </div>
    </Section>
  );
}

function InteractiveOverlays() {
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <Section
      title="Overlays and notifications"
      note="Dialog and Sheet portal to the body, trap Tab, close on Escape and return focus to whatever opened them. Toasts are sonner with every one of its class names discarded and each slot redrawn from the tokens."
    >
      <SpecimenGrid>
        <Specimen label="Dialog">
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Open dialog
          </Button>
        </Specimen>

        <Specimen label="Sheet">
          <Button variant="secondary" icon={ArrowLeftRight} onClick={() => setSheet(true)}>
            Open sheet
          </Button>
        </Specimen>

        <Specimen label="Toasts" wide>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              notify.success('Leg shipped', {
                description: 'K = 2,800 · 10 units of liquidity · no tokens moved',
                action: { label: 'Receipt', onClick: () => notify.info(TX_HASH) },
              })
            }
          >
            Success
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => notify.error('Could not quote the leg', COVERAGE_REVERT)}
          >
            Decoded revert
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => notify.error('Could not ship the leg', USER_REJECTED)}
          >
            Wallet rejection
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => notify.warning('Oracle price is 340 seconds old')}
          >
            Warning
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const id = notify.pending('Waiting for the receipt');
              setTimeout(() => notify.success('Fill landed', { id }), 2200);
            }}
          >
            Pending, then resolved
          </Button>
        </Specimen>
      </SpecimenGrid>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Dock this leg"
        description="Docking is pure accounting in Aqua. No tokens move."
        initialFocus={confirmRef}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Keep it open
            </Button>
            <Button
              ref={confirmRef}
              variant="danger"
              onClick={() => {
                setDialog(false);
                notify.success('Leg docked', { description: '0 ERC-20 Transfer logs' });
              }}
            >
              Dock the leg
            </Button>
          </>
        }
      >
        <p className="text-meta leading-prose text-ink-2">
          Focus starts on the confirming control because that is what the maker came here to press.
          Tab cycles inside the panel, Escape closes it, and focus returns to the button that opened
          it.
        </p>
        <Callout tone="warning" className="mt-4" title="This withdraws the quote immediately">
          A taker mid-flight will see the leg disappear. Docking is unconditional and instant, which
          is the honest limit of writing an option as a curve.
        </Callout>
      </Dialog>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        side="right"
        title="Leg detail"
        description="The same machinery as Dialog, anchored to an edge."
      >
        <p className="text-meta leading-prose text-ink-2">
          A sheet keeps the page it came from visible, which is what a detail view wants. On a narrow
          viewport pass side=&quot;bottom&quot; instead.
        </p>
      </Sheet>
    </Section>
  );
}
