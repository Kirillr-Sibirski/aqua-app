# DESIGN.md

The visual system for Strikeline. **Light, Mantine-based, one-card-first.**

This file replaces a previous version that specified a dark maker terminal. That register was
wrong for this product and both the operator and a blind comprehension study said so
independently: a retail reader scored the old app 3/10 and said *"There is not one sentence
saying 'you will sell your ETH at $X, you get paid $Y, here's the risk.' I'd bounce in about 40
seconds."* Everything below is settled and should not be re-litigated per component.

## Register

**A consumer product you can use in four clicks.** Uniswap's swap page is the reference: you land
and you are already in the action. Not a terminal, not a dashboard, not a landing page.

The person arriving holds some ETH and has never heard of a covered call. They are decided in
under a minute, by a card that reads like English. The trader who wants σ and θ is served *second*,
behind a disclosure, and never at the newcomer's expense.

## The one card

The front door is a single centred card, **480px** (`--card-w`, `max-w-container-card`), on the
page ground. Around it: a slim bar with the wordmark, the network state and the wallet button.
Nothing else. No hero paragraph, no feature grid, no stat row, no nav bar full of routes.

The whole primary flow is **three fields and one button**:

| Field | Label | Default |
|---|---|---|
| amount | **How much** | pre-filled from the wallet's WETH balance |
| price | **What price** | pre-filled above spot |
| expiry | **By when** | pre-filled, a near date |

Every default is filled in, so a user can publish without touching anything. Read top to bottom the
card forms one English sentence:

> **Sell 10 WETH if it reaches $2,800 by 15 Sep**

Beneath it, two lines that are the entire disclosure a newcomer needs: **what you earn** and **what
you risk**. Then one big primary button.

Anything else — the curve, the theta band, the coverage arithmetic, the raw program bytes — lives
behind a details disclosure on the same card, collapsed by default.

## The dashboard is the second tab

A positions view exists, and options trading genuinely needs one. It is **never the front door**.
It appears as a second tab and is worth showing only once the visitor has offers. First-time
visitor, no wallet, or a connected wallet with nothing written: they see the card.

## Jargon is banned from the primary flow

Not softened. Banned. These words do not appear on the landing card, in its labels, its helper
text, its button or its two disclosure lines:

> leg · book · ladder · theta · moneyness · notional · deliverable depth · X/L · strike ·
> implied volatility · write · position · premium · RMM · SwapVM · instruction · opcode

Say instead: **offer**, **price**, **how much**, **by when**, **what you earn**, **what you risk**,
**your offers**, **withdraw**.

Precise terms are allowed — and wanted — inside a details disclosure or a tooltip, where someone
has asked for them. `strike` may appear next to `price` there. The rule is about the front door,
not about dumbing the product down.

## Color

**Light. Restrained.** A neutral cool paper ground, one accent, and money colors that are earned:
they appear on real deltas, never as decoration. The accent stays under 10% of pixels.

Tokens are OKLCH in `web/src/app/globals.css`, mirrored in `web/src/lib/ui/tokens.ts`.

### Why these values

**The ground inverts.** The page is a faint cool paper and the card is the only pure white in the
system. That is the whole landing screen: the one card is the brightest object on it without
needing a shadow to say so.

**The accent is petrol, hue 212** — deliberately not the 245-250 that every component library ships
as its default primary. It is dark because on a light theme an accent has two jobs that pull
against each other: carry white text as a button fill, and read as link text on white. Only the
dark end of a hue does both. Mantine's own `blue.6` does neither: 3.49:1 as link text on white and
3.39:1 under a white label, both under the floor. That measurement, not taste, is why the default
theme is not shipped.

**Every semantic colour is a dark tint** for the same reason, and each has a light `-soft` wash.
The washes are grounds for dark text and are **never text themselves**. This is the one structural
difference from a dark theme, where the semantics can be bright and the washes are the dark ones.

**Neutrals carry 0.004-0.014 chroma at hue 215**, the accent's family, so the greys do not read as
printer toner beside the petrol. Text is a cool near-black, not `#000`: pure black on white is a
glare edge.

```
--bg           oklch(0.972 0.004 215)  #f3f6f7   page ground
--surface      oklch(1     0     215)  #ffffff   the card, table rows
--surface-2    oklch(0.962 0.006 215)  #eef3f5   input wells, raised
--surface-3    oklch(0.935 0.008 215)  #e4ebed   hover, pressed
--line         oklch(0.905 0.008 215)  #dae1e3   1px hairlines
--line-strong  oklch(0.820 0.010 215)  #bdc6c8   focused input, table header rule

--ink          oklch(0.240 0.014 215)  #182123   primary text
--ink-2        oklch(0.430 0.014 215)  #475255   secondary
--ink-3        oklch(0.515 0.012 215)  #60696c   tertiary, axis labels, placeholders
--ink-inverse  oklch(0.990 0.002 215)  #fafcfd   text on a filled dark block

--accent       oklch(0.480 0.083 212)  #036a79   primary action, "your offer"
--accent-hover oklch(0.420 0.072 212)  #045764   pressed / hovered fill
--accent-ink   oklch(0.990 0.002 212)  #fafcfc   label on an accent fill
--accent-soft  oklch(0.945 0.030 212)  #d7f3f9   selected row, chip ground
--accent-dim   oklch(0.760 0.070 212)  #7bbdcb   accent hairlines, chart bands

--pos          oklch(0.500 0.125 150)  #1b763a   gains, fills received
--pos-soft     oklch(0.945 0.038 150)  #dcf5e0
--neg          oklch(0.520 0.185 27)   #bc2826   losses, a refused quote
--neg-soft     oklch(0.950 0.024 27)   #fee9e6
--warn         oklch(0.520 0.105 70)   #8f5d14   stale read, thin wallet, simulation
--warn-soft    oklch(0.950 0.045 85)   #fcedcd
```

Every value is inside the sRGB gamut as authored — no channel is clipped — so what a browser paints
is what was measured.

### Measured contrast

Floor: **body text >= 4.5:1 on its own background, no exceptions**, chart axis labels and
placeholder text included. `node web/scripts/contrast.mjs` checks 36 pairs and **exits non-zero on
a regression**, so it can gate CI. The tightest text pair in the system is `ink-3` on `surface-3`
at 4.64:1; on a light theme the ink ramp compresses at the *dark* end, which is the opposite of
where a dark theme runs out of room.

| pair | ratio |
|---|---|
| `ink` on `surface` | 16.39:1 |
| `ink-2` on `surface` | 8.06:1 |
| `ink-3` on `surface` | 5.60:1 |
| `ink-3` on `surface-3` (tightest) | 4.64:1 |
| `accent` as link text on `surface` | 6.32:1 |
| white label on `accent` (Mantine `filled`) | 6.32:1 |
| `pos` / `neg` / `warn` on `surface` | 5.66 / 6.06 / 5.64:1 |

Rejected and recorded in the same script so the number lives in the repo: Mantine `blue.6` as link
text on white, 3.49:1; a white label on it, 3.39:1; any `accent/70` alpha on text, 3.49:1. **Alpha
on text always loses the floor** — dim by choosing `ink-2` or `ink-3`, never by lowering opacity.

## Typography

Two families, contrast on the axis that matters: proportional for prose, monospace for anything a
person might compare digit by digit.

- **Geist Sans** — UI, labels, prose.
- **Geist Mono** — every number, address, hash, opcode and byte string. `font-variant-numeric:
  tabular-nums slashed-zero` globally, so figures do not jitter as they stream.

Scale: 11 (micro, uppercase, <= 4 words) / 12 / 13 / **14 body** / 16 / 20 / 26 / 34. Steps are
>= 1.25 apart above body. Line height 1.45 for prose, 1.2 for numeric rows. Display letter-spacing
floor -0.02em; nothing exceeds 34px, which is the amount field on the card.

## Layout

- The card: 480px, centred, vertically placed so it sits slightly above centre.
- The dashboard: max 1280px, 24px gutters, 8px base grid (4px allowed inside dense controls).
- Table rows 44px, 12/16px cell padding. Numbers right-aligned, mono, unit in `--ink-3`.
- Radius: 16px card, 12px field, 8px control, 999px pills only.
- Hairlines (1px `--line`) for structure. **Shadow is allowed on the card** — on a light theme a
  shadow is how a card leaves the page — via `--shadow-card`. Overlays get `--shadow-overlay`.
  Nothing else is elevated.

Cards are for genuinely separable objects. Lists of numbers get tables, not card grids. Nested
cards never — the landing card contains fields and disclosures, not more cards.

## Mantine

**Mantine 9.6.0 is the component vocabulary.** `@mantine/core`, `hooks`, `form`, `dates`,
`notifications`, `modals`. Tailwind v4 stays for layout utilities only. Do not maintain two
component libraries: `web/src/components/ui` is retired as screens migrate, and deleted when empty.

Ant Design was evaluated and rejected: `@ant-design/web3-wagmi` pins wagmi `^2.12.13` against our
wagmi 3.7.7 and fails to install with ERESOLVE. Its wallet components were the only unique thing it
offered. Do not install `antd` or `@ant-design/*`.

### Wiring

- `MantineProvider` + `ModalsProvider` + `Notifications` in `web/src/app/providers.tsx`, outside
  wagmi.
- `ColorSchemeScript forceColorScheme="light"` in `<head>` and `mantineHtmlProps` on `<html>` in
  `layout.tsx`.
- Stylesheets are imported as **`styles.layer.css`**, not `styles.css`.

### Cascade layers, and the one that will bite you

`globals.css` declares the order on its first line. Tailwind normalises it to:

```
properties -> theme -> base -> mantine -> components -> utilities
```

Both neighbours matter. **Mantine must sit above Tailwind's `base`**, or preflight's
one-element-specificity `button { background: transparent }` beats Mantine's class selector — a
layer beats specificity outright — and every Mantine button renders transparent. And it must sit
**below `utilities`**, so `className="w-full"` on a Mantine component does what it says. Importing
the plain `styles.css` puts Mantine outside every layer, where it beats every Tailwind utility.

Both directions are verified in a real browser, not asserted: a Mantine button paints `--accent`
(preflight lost), adding `bg-neg` to it repaints it `--neg` (utilities won), and a bare `<button>`
is still transparent (preflight is still doing its job).

### Theme mapping

`web/src/components/theme/theme.ts`. Two mechanisms, for different things:

- **`theme.colors` / `radius` / `fontSizes`** — the scales handed to component props.
  `petrol` (accent), `slate` (also overrides Mantine's `gray`), `moss` (pos), `ember` (neg),
  `amber` (warn). Shade 8 of each ramp *is* the token; the other shades exist so Mantine's
  `light`/`outline`/`filled` variants have somewhere to go.
- **`cssVariablesResolver`** — the semantic variables Mantine's own CSS reads
  (`--mantine-color-text`, `-body`, `-dimmed`, `-placeholder`, `-anchor`, `-default-border`, …),
  repointed at our tokens. Without it the app is two palettes wearing one coat.

`primaryShade` is **8**, not Mantine's default 6: a fill that must also carry white text at 4.5:1
has to be dark, and `petrol.6` measures 3.1:1 under white. `--mantine-color-placeholder` is
`--ink-3`, not Mantine's `gray.5` (3.06:1 on white) — placeholder text is text.

Radius scale: `md` 8 (control), `lg` 12 (field), `xl` 16 (card). Default `md`; inputs and buttons
default to `lg`.

### Which component for what

`TextInput` / `NumberInput` for the card's fields, `DatePickerInput` for *by when*, `Button` for
the one primary action, `Collapse` or `Accordion` for the details disclosure, `Tooltip` for a term
someone might not know, `Modal` for the transaction stepper, `notifications.show` for a landed
fill, `Table` for the dashboard, `Alert` for what-you-risk, `Badge` for state. Charts stay
hand-rolled SVG on `d3-scale`/`d3-shape`, themed from the tokens — no default library styling.

Wallet UI is **ours**, on the existing wagmi 3 code in `web/src/lib/chain`: a connect button, a
connected-address pill, a network guard, styled in Mantine. Those three and no more. This is not a
wallet product.

## Motion

- 140-200ms, ease-out-quart. State changes only.
- Numbers animate value, not layout.
- One purposeful reveal: when a fill lands, the row enters and the affected balance counts to its
  new value. That is the money shot and the only place motion is loud.
- Every animation has a `prefers-reduced-motion: reduce` branch. `globals.css` collapses every
  duration token centrally and `respectReducedMotion` is on in the Mantine theme.

## States

Every data surface ships five states: **loading** (skeleton, never a spinner), **empty** (with the
one action that resolves it), **error** (the decoded custom error name, not "something went
wrong"), **disconnected**, **wrong-network**. A button that is disabled says why.

## The rule that prevents the worst bug

**Every curve value and every preview number comes from an on-chain read** — `router.asView().quote()`,
`stableFor`, `bandFor`, `coverage`. There is no TypeScript reimplementation of the option math and
there must not be one. Float math is allowed only for a clearly-labelled illustrative payoff
overlay. Every leg is sized through `stableFor()` on chain: one wei off-curve bricks a strategy
permanently.

`web/src/lib/swapvm` (the encoder, cross-checked byte-for-byte against Solidity) and
`web/src/hooks` are proven. Adapt call sites; do not rewrite them. `web/src/lib/ui/format.ts` stays
— its bigint formatters are correct and every screen depends on them.

## Bans

No gradient text. No glass or backdrop blur. No emoji. No purple. No eyebrow kickers. No hero
metrics. No hero paragraph on the landing screen. No alpha on text.

**No fake data, ever.** If a number is not read from the chain it does not render. Anything modelled
rather than measured is labelled a simulation, in its title block, its banner and its captions.
Round demo numbers ($10,000.00 in every row) read as fake even when they are real, so demo
inventory is seeded at irregular amounts.

Use the measured values verbatim and never invent one: router 23,851 B (725 B under EIP-170);
quote 113,283 gas / swap 211,317; theta over one leg's life 0.338 WETH; decay band after 2 days
133.55 USDC; a 5 WETH fill takes the shared wallet 10.4 -> 5.4 WETH, and siblings then refuse
6 WETH but still fill 2.7; the demo book is 4 offers, 30.74 WETH virtual against 10.4 WETH real.

## Reference

`/dev/theme` renders the palette, the ramps, the type scale and the Mantine vocabulary on one page,
each swatch carrying its measured ratio. It is not linked from the app. It is also the proof the
foundation works: if the provider, the stylesheet layer or the variable bridge were wrong, every
control on it would show it.
