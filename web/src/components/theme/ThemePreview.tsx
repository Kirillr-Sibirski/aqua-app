'use client';

/**
 * The palette, the type scale and the Mantine vocabulary, on one page.
 *
 * This is a reference for whoever builds a screen next, and it is also the thing that proves the
 * foundation renders: if Mantine's provider, stylesheet layer or CSS-variable bridge were wrong,
 * every control below would show it. Each swatch carries the contrast ratio
 * `node scripts/contrast.mjs` measured for it, so a value that drifts is visible here rather than
 * only in a script nobody runs.
 *
 * Not linked from the app. `/dev/theme`.
 */
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { COLOR_OKLCH, COLOR_SRGB, RAMPS, type ColorToken } from '@/lib/ui/tokens';

/** Ratios as measured by `scripts/contrast.mjs`; the ground each is measured against. */
const MEASURED: Partial<Record<ColorToken, string>> = {
  ink: '16.39:1 on surface',
  'ink-2': '8.06:1 on surface',
  'ink-3': '5.60:1 on surface',
  accent: '5.97:1 on surface',
  'accent-ink': '5.81:1 on accent',
  pos: '5.66:1 on surface',
  neg: '6.06:1 on surface',
  warn: '5.64:1 on surface',
};

const GROUND: ColorToken[] = ['bg', 'surface', 'surface-2', 'surface-3', 'line', 'line-strong'];
const TEXT: ColorToken[] = ['ink', 'ink-2', 'ink-3', 'ink-inverse'];
const ACCENT: ColorToken[] = ['accent', 'accent-hover', 'accent-ink', 'accent-soft', 'accent-dim'];
const MONEY: ColorToken[] = ['pos', 'pos-soft', 'neg', 'neg-soft', 'warn', 'warn-soft'];

function Swatch({ token }: { token: ColorToken }) {
  return (
    <div className="w-44">
      <div
        className="h-12 rounded-control border border-line"
        style={{ background: `var(--${token})` }}
      />
      <div className="mt-1.5 font-mono text-mini text-ink tnum">{token}</div>
      <div className="font-mono text-micro text-ink-3 tnum">{COLOR_SRGB[token]}</div>
      <div className="font-mono text-micro text-ink-3 tnum">{COLOR_OKLCH[token]}</div>
      {MEASURED[token] ? (
        <div className="mt-0.5 font-mono text-micro text-ink-2 tnum">{MEASURED[token]}</div>
      ) : null}
    </div>
  );
}

function Row({ title, tokens }: { title: string; tokens: ColorToken[] }) {
  return (
    <section>
      <h2 className="mb-3 text-micro uppercase text-ink-3">{title}</h2>
      <div className="flex flex-wrap gap-5">
        {tokens.map((t) => (
          <Swatch key={t} token={t} />
        ))}
      </div>
    </section>
  );
}

function Ramp({ name, shades }: { name: string; shades: readonly string[] }) {
  return (
    <div>
      <div className="mb-1 font-mono text-mini text-ink-2">{name}</div>
      <div className="flex overflow-hidden rounded-control border border-line">
        {shades.map((hex, i) => (
          <div key={hex + i} className="h-10 flex-1" style={{ background: hex }} title={`${name}.${i}  ${hex}`} />
        ))}
      </div>
    </div>
  );
}

export function ThemePreview() {
  return (
    <main className="mx-auto flex max-w-page flex-col gap-10 px-6 py-10">
      <header>
        <h1 className="text-section text-ink">Strikeline — light system</h1>
        <p className="mt-1 max-w-prose text-ink-2">
          Mantine 9.6.0 on our own tokens. Every ratio below is measured by{' '}
          <code className="text-ink">node scripts/contrast.mjs</code>, not estimated.
        </p>
      </header>

      <Row title="Ground" tokens={GROUND} />
      <Row title="Text" tokens={TEXT} />
      <Row title="Accent — petrol, hue 212" tokens={ACCENT} />
      <Row title="Money" tokens={MONEY} />

      <section>
        <h2 className="mb-3 text-micro uppercase text-ink-3">
          Mantine ramps — shade 8 is the token
        </h2>
        <div className="flex flex-col gap-3">
          {Object.entries(RAMPS).map(([name, shades]) => (
            <Ramp key={name} name={name} shades={shades} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-micro uppercase text-ink-3">Type</h2>
        <div className="flex flex-col gap-1">
          <div className="text-display text-ink">34 display — 10.4 WETH</div>
          <div className="text-section text-ink">26 section — 2,800 USDC</div>
          <div className="text-title text-ink">20 title — Sell 10 WETH</div>
          <div className="text-lead text-ink">16 lead — by 15 Sep</div>
          <div className="text-body text-ink">14 body — the default</div>
          <div className="text-meta text-ink-2">13 meta — dense table cells</div>
          <div className="text-mini text-ink-2">12 mini — captions and ticks</div>
          <div className="text-micro uppercase text-ink-3">11 micro — column headers</div>
          <div className="mt-2 font-mono text-body text-ink tnum">
            mono, tabular: 0123456789 · 23,851 B · 113,283 gas · 0.338 WETH · 133.55 USDC
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-micro uppercase text-ink-3">Mantine vocabulary</h2>
        <Card withBorder shadow="sm" padding="lg" maw={520}>
          <Stack gap="md">
            <Title order={3}>Publish an offer</Title>
            <TextInput label="How much" placeholder="10" description="WETH from your wallet" />
            <NumberInput label="Price" defaultValue={2800} thousandSeparator="," prefix="$" />
            <Select
              label="By when"
              data={['15 Sep', '30 Sep', '31 Oct']}
              defaultValue="15 Sep"
              allowDeselect={false}
            />
            <Switch label="Show the details" />
            <Group>
              <Badge color="moss">covered</Badge>
              <Badge color="ember">refused</Badge>
              <Badge color="amber">simulation</Badge>
              <Badge color="petrol" variant="light">
                yours
              </Badge>
            </Group>
            <Alert color="amber" title="What you risk">
              If ETH runs past your price you sell at your price and keep what you were paid.
            </Alert>
            <Button fullWidth size="md">
              Publish offer
            </Button>
            <Group>
              <Button variant="light">Secondary</Button>
              <Button variant="default">Default</Button>
              <Button variant="subtle">Subtle</Button>
              <Button color="ember">Withdraw</Button>
              <Button disabled>Disabled</Button>
            </Group>
            <Text size="sm" c="dimmed">
              Dimmed body text, and <Anchor href="#">an anchor</Anchor> in the accent.
            </Text>
          </Stack>
        </Card>
      </section>
    </main>
  );
}

export default ThemePreview;
