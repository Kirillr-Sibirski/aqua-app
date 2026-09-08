# The app is one page

One route. One screen. No navigation, no sub-pages, no "details" route, no marketing. A trading
terminal for writing covered calls: a chart, a ticket, and your positions, the way Oshio and every
perp UI lays out.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◇ strikeline    ⬡ WETH/USDC  2,442.43  +1.24%              0x70…79C8  ▾  │  56px
├────────────────────────────────────────────┬─────────────────────────────┤
│                                            │  SELL                       │
│   payoff at expiry, vs holding             │  ⬡ WETH   [ 1.0      ]  max │
│   ───────────────────────────              │                             │
│   the curve, the strike marker,            │  STRIKE                     │
│   the shaded region you give up,           │  ⬡ USDC   [ 2,600    ] +6.5%│
│   spot, and the live reserve point         │                             │
│                                            │  EXPIRY                     │
│   [ payoff | curve | decay ]               │  [ 18 Sep ]  [1w] [2w] [1m] │
│                                            │  ─────────────────────────  │
│                                            │  Premium      +5.69 USDC    │
│                                            │  Capped at     2,605.69     │
│                                            │  IV               62.0%     │
│                                            │  ┌───────────────────────┐  │
│                                            │  │    Publish offer      │  │
│                                            │  └───────────────────────┘  │
├────────────────────────────────────────────┴─────────────────────────────┤
│ POSITIONS                                          promised 30.74 / 10.4 │
│ ⬡ 1.0 WETH   2,600   18 Sep   3.1 open   +0.338   ▓▓▓▓▓░░░░   ×          │
│ ⬡ 2.0 WETH   2,800   18 Sep   0 taken    +1.021   ▓▓▓▓▓▓▓▓▓   ×          │
└──────────────────────────────────────────────────────────────────────────┘
```

Grid: `minmax(0,1fr) 380px` above, full width below. Below 960px the ticket stacks under the
chart. Below 640px the positions table scrolls inside itself.

## Rules

**No prose.** Not one explanatory sentence anywhere on the screen. A label is one or two words.
A number carries its unit. If something needs explaining, it is either wrong or it belongs in the
README. Delete: "Your WETH stays in your wallet…", "Nobody has to take it…", "Priced for anyone…",
"At that point the WETH is sold…". A production trading UI does not teach.

**Numbers do the talking.** Every figure is monospace, tabular, right-aligned in a column. Deltas
carry a sign and a colour. Loading is a skeleton of the right width, never a word.

**Token icons everywhere a token is named.** 20px, in the ticket, the positions rows, the pair in
the header. Never a bare "WETH".

**Charts earn their space.** Three views behind one segmented control, all real, all sampled from
the chain: payoff at expiry against holding; the live pricing curve with the reserve point; the
decay band widening over time. Options justify a real chart — build a real one.

**One accent.** `--accent` marks the primary action and your own position. Green and red mean money
moved, never decoration.

**Density is the point.** 56px header, 12px cell padding, 36px rows. This should look like a desk
tool at 1440px, not a landing page with a form on it.

## What gets deleted

`/offers`, `/offer/[hash]`, `/leg/[hash]`, `/write`, `/book`, `/surface`, `/receipt`, `/kitchen-sink`
as *routes*. The surface and the markout study are submission artifacts, not product screens: keep
them reachable from a small footer link, or move their content to the README and delete the routes.
The positions view merges into the strip at the bottom. The offer detail becomes a row expansion or
a slide-over, not a page.
