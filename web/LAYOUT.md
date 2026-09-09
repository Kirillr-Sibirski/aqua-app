# The app is one page

One route. One screen. No navigation, no sub-pages, no "details" route, no marketing. A trading
terminal for writing covered calls: a chart, a ticket, and your positions, the way Oshio and every
perp UI lays out.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◇ strikeline  ⬡ WETH/USDC 2,442.43 -2.15% 3d  ● 50,946,647   0x70…79C8   │  56px
├────────────────────────────────────────────┬─────────────────────────────┤
│  [ decay | payoff | curve ]                │  SELL          MAX 10.4000  │
│                                            │  ⬡ WETH  [ 10.4          ]  │
│   the band widening over time,             │  STRIKE                     │
│   the payoff against holding,              │  ⬡ USDC  [ 2,600    ] +6.5% │
│   the live curve with its reserve          │  EXPIRY                  8d │
│   point — all three sampled from           │  [ 18 Sep ]  [1w] [2w] [1m] │
│   the router, none of them a model         │  IV               REAL 21.2 │
│                                            │  [ 21.2 %          ]  − +   │
│                                            │  ─────────────────────────  │
│                                            │  PREMIUM      +59.08 USDC   │
│                                            │  CAPPED AT   2,605.68 USDC  │
│                                            │  ┌───────────────────────┐  │
│                                            │  │     Publish offer     │  │
│                                            │  └───────────────────────┘  │
├────────────────────────────────────────────┴─────────────────────────────┤
│ POSITIONS                    PROMISED 30.7400 / 10.4000 WETH 2.96×       │
│     SIZE       STRIKE      IV    EXPIRY     EARNED      BACKING          │
│ ⬡C 9.9251 WETH 3,000.00  60.0%  16 Sep 6d  0.00 USDC ▓▓▓▓▓▓▓▓▓ 100%  ×   │
│ ⬡C 9.4551 WETH 2,800.00  60.0%  16 Sep 6d  0.00 USDC ▓▓▓▓▓▓▓▓▓ 100%  ×   │
└──────────────────────────────────────────────────────────────────────────┘
```

Grid: `minmax(0,1fr) 380px` above, full width below. Below 960px the ticket stacks under the
chart. Below 640px the positions table scrolls inside itself, with a right-edge mask and a sticky
instrument column so a row keeps its identity while the rest of it scrolls under the header.

## Rules

**No prose.** Not one explanatory sentence anywhere on the screen. A label is one or two words.
A number carries its unit. If something needs explaining, it is either wrong or it belongs in the
README. Delete: "Your WETH stays in your wallet…", "Nobody has to take it…", "Priced for anyone…",
"At that point the WETH is sold…". A production trading UI does not teach. **This applies to the
accessible layer too**: an `aria-label` that spells out a teaching sentence is prose for a screen
reader and an unlabelled shape for everybody else, which is the worst of both. A meter is
`aria-hidden` beside the figure it draws.

**Numbers do the talking.** Every figure is monospace, tabular, right-aligned in a column. Deltas
carry a sign and a colour. Loading is a skeleton of the right width, never a word. **One decimal
convention per token, from `components/token/registry`, at every call site** — the ticket legend,
the promised ratio, the table and both chart readouts. WETH is four places everywhere or the column
does not align. **One tenor format**, from `formatTenor`: `8d` in the ticket is `8d` in the row and
`8d` in the chart readout.

**Token icons everywhere a token is named.** 20px, in the ticket, the positions rows, the pair in
the header. Never a bare "WETH".

**Charts earn their space.** Three views behind one segmented control, all real, all sampled from
the chain: the decay band widening over time; payoff at expiry against holding; the live pricing
curve with the reserve point. Options justify a real chart — build a real one. A view that cannot
draw its subject legibly says the figure instead of drawing an invisible region, and **a refused
input is refused on the chart too**: when the ticket will not ship a configuration, the plot goes
empty and says what the button says rather than plotting the nonsense.

**One accent.** `--accent` marks the primary action and your own position. Green and red mean money
moved, never decoration. Nothing else takes it — not the view switch, not the backing meter.

**One radius scale, one focus ring, one border.** `--radius-control` on every button, well, pill and
bordered box; `--radius-chip` only for a chip sitting inside a control-radius track, where it is the
concentric inner corner. Every focusable thing wears the same `2px` outline at `2px` offset,
including the wells — drawn on the well, not on the borderless input inside it.

**Density is the point.** 56px header, 12px cell padding, 36px rows. This should look like a desk
tool at 1440px, not a landing page with a form on it. A column whose value is another column times
a third is not density; it is redundancy, and it goes.

## What gets deleted

`/offers`, `/offer/[hash]`, `/leg/[hash]`, `/write`, `/book`, `/surface`, `/receipt`, `/kitchen-sink`
as *routes*, **and the footer link that reached the last two**. The surface and the markout study are
submission artifacts, not product screens: their content is in the README, their decoders and
queries and measured numbers are still in the repo, and their screens are gone. A link to them put a
second product, at a different type scale and density, one click from the terminal.
The positions view merges into the strip at the bottom. The offer detail becomes a row expansion or
a slide-over, not a page.

## Where the build diverged from this sketch, and why

**The ticket has four controls, not three.** IV was drawn as a bare figure that grew a rule on
hover, on the theory that a spec saying three should not grow a fourth. That made the one number on
the ticket the chain cannot supply — the one PRODUCT.md says makers want to be theirs — the only
input on the screen a person could not see was an input, at 21px, with no hover to reveal it on a
phone. It has the same well as the other three, plus a stepper. The spec's "three controls" was a
sketch, not a constraint worth hiding the differentiator behind.

**`decay` is the landing view, not `payoff`.** The payoff at expiry of a covered call written with
no cash up front is two straight segments: below the assignment point the position *is* the hold,
and above it, flat. That is the honest picture and it is not worth 60% of a 900px window as the
first thing a reader sees. The premium is not a region on it either — fifty-nine USDC against a
position worth twenty-six thousand is three pixels — so the payoff view prints `premium +59.08`
beside the kink, in the money colour, under the same word the ticket uses, and the decay view, which
draws a curve that actually moves, is what the screen opens on. Lifting the position line by the
premium would have claimed this instrument pays up front. It does not.

**The positions strip trades `OPEN` for `IV`.** `OPEN` was `SIZE × BACKING` by construction, so it
printed the same string as `SIZE` on every untouched row; `BACKING` — the fraction of what the offer
promises that the shared balance can still deliver — is the half that moves when a sibling is
filled, and the absolute is one multiplication away. The width goes to the leg's own `sigmaWad`,
which is the term that makes this an options venue rather than a limit order and the one a maker
compares across their own book: 21.2 / 20.0 / 60.0 across the offers this fork ships. A `C`/`P`
glyph leads the row, because a book that mixes a WETH-collateralised call with a USDC-collateralised
put has to say which is which.

**The block pill stays on the phone.** It is ten characters, and a phone is exactly where a reader
most needs to know the page is live. The wordmark and the pair name give way instead. There is one
`block` figure on this page and it is the live one: the footer states the deploy block as
`deployed 50,946,000`, which is a property of the deployment, not a second reading of the same word.
