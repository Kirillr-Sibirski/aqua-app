# DESIGN.md

Visual system for the Aqua position terminal. Written before the product concept was final; the
sections marked *concept-dependent* get filled in when the position is chosen. Everything else
is settled and should not be re-litigated per component.

## Register

Product. Design serves the work: a maker opens this to put capital to work and to watch what it
is doing. It is a terminal, not a landing page. There is no hero section anywhere in the app.

## Scene

A market maker or treasury operator, at a desk, two monitors, mid-afternoon, one eye on this and
one on a price feed. They already know what a spread is. They are deciding whether to trust the
thing with real inventory. That sentence forces dark: this sits next to a charting app all day,
and the interface should recede so the numbers do not.

## Color strategy

**Restrained.** Tinted neutrals carry the surface; one accent, under 10% of pixels, marks *your*
position and the primary action. Money colors (positive/negative) are the only other saturation,
and they are earned: they appear on real deltas, never as decoration.

Tokens in OKLCH. Neutrals carry a small chroma toward the accent hue (not toward warm-by-default).

```
--bg            oklch(0.17 0.008 240)   page
--surface       oklch(0.21 0.009 240)   cards, rows
--surface-2     oklch(0.25 0.010 240)   raised, inputs, hover
--line          oklch(0.32 0.012 240)   1px hairlines
--line-strong   oklch(0.40 0.014 240)   focused inputs, table headers

--ink           oklch(0.97 0.004 240)   primary text
--ink-2         oklch(0.78 0.008 240)   secondary
--ink-3         oklch(0.64 0.010 240)   tertiary, axis labels  (>= 4.5:1 on --surface-2)

--accent        oklch(0.68 0.16 245)    primary action, "your position"
--accent-ink    oklch(0.16 0.02 245)    text on accent
--accent-dim    oklch(0.42 0.09 245)    accent borders, chart bands

--pos           oklch(0.74 0.15 155)    gains, fills received
--neg           oklch(0.68 0.17 25)     losses, liquidations
--warn          oklch(0.80 0.14 85)     stale oracle, low coverage
```

Contrast floor: body text >= 4.5:1 on its own background, chart axis labels included.
`--ink-3` on `--surface-2` is the tightest pair in the system (4.76:1 at L 0.64; L 0.62 measured
4.40:1 and failed) and must be re-measured if either moves. `web/scripts/contrast.mjs` checks all 18
pairs and exits non-zero on a regression.

Light mode is out of scope. A maker terminal that only ships dark is a decision, not an omission.

## Typography

Two families, contrast on the axis that matters here: proportional for prose, monospace for
anything a person might compare digit by digit.

- **Geist Sans** — UI, labels, prose.
- **Geist Mono** — every number, address, hash, opcode and byte string. `font-variant-numeric:
  tabular-nums slashed-zero` globally, so figures do not jitter as they stream.

Scale: 11 (micro labels, uppercase only, <= 4 words) / 12 / 13 / **14 body** / 16 / 20 / 26 / 34.
Steps are >= 1.25 apart above body. Line height 1.45 for prose, 1.2 for numeric rows.
Display letter-spacing floor -0.02em; nothing in the app exceeds 34px.

## Layout

- Max content width 1280px, 24px gutters, 8px base grid (4px allowed inside dense controls).
- Two-column detail: 2fr content, 1fr sticky rail.
- Table rows 44px, 12/16px cell padding. Numbers right-aligned, mono, with the unit in `--ink-3`.
- Hairlines (1px `--line`) instead of shadows. Elevation exists only for overlays.
- Radius: 10px cards, 8px inputs and buttons, 999px only for status pills.

Cards are used for genuinely separable objects (a position, a strategy). Lists of numbers get
tables, not card grids. Nested cards never.

## Motion

- 140-200ms, ease-out-quart. State changes only.
- Numbers animate value, not layout (`@number-flow/react`).
- One purposeful reveal: when a fill lands, its activity row enters and the affected balance
  counts to its new value. That is the money shot of the demo and the only place motion is loud.
- Every animation has a `prefers-reduced-motion: reduce` branch that crossfades or jumps.

## Components

*Concept-dependent detail marked with (C).*

**Shell** — `AppShell` (brand mark, nav, network pill with block number, wallet button),
`PageHeader`, `Footer` (contract addresses, commit SHA, block height).

**Primitives** — Button (primary/secondary/ghost/danger, loading), IconButton, Input,
NumberInput (bigint-safe, decimal-aware), Select, SegmentedControl, Tabs, Card, Dialog, Sheet,
Tooltip, Popover, Pill, Skeleton, Table, Toast, Kbd, CopyButton, ExplorerLink, Address (middle
ellipsis + ENS), TokenAmount (amount, symbol, USD), Delta, StatTile, EmptyState, ErrorState,
Callout.

**Domain** — `PositionsTable`, `PositionCard`, `ProgramInspector` (decoded instruction list with
raw bytes disclosure), `BackingMeter` (wallet balance vs total shipped across strategies),
`ActivityFeed` (Shipped / Pulled / Pushed / Docked), `TxStepper` (approve -> ship), `NetworkGuard`.

**Charts** — hand-rolled SVG on `d3-scale`/`d3-shape`, themed from the tokens above. No default
library styling anywhere. (C) the payoff/curve chart specific to the chosen position.

## States

Every data surface ships five states: loading (skeleton, never a spinner), empty (with the one
action that resolves it), error (decoded custom error name, not "something went wrong"),
disconnected, wrong-network. A button that is disabled says why.

## Bans

Beyond the standing ones: no gradient text, no glass, no emoji, no purple, no eyebrow kickers, no
hero metrics. Specific to this app: no fake data, ever. If a number is not read from the chain it
does not render. Round demo numbers ($10,000.00 in every row) read as fake even when they are
real, so demo inventory is seeded at irregular amounts.
