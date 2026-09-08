---
target: the Strikeline rebuild — landing card and app shell
total_score: 27
p0_count: 0
p1_count: 5
timestamp: 2026-09-08T19-38-41Z
slug: web-src-app-page-tsx
---
# Critique — Strikeline landing card and app shell

Driven in headless Chrome over CDP at 1440x900 and 390x844. 373 text runs sampled from rendered
PNG pixels. Build, lint, types and 297 tests green.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Publish resolves straight to a receipt; no pending state seen, no success toast |
| 2 | Match System / Real World | 3 | Card is genuinely English; a connector is literally named "Injected"; /surface reverts to terminal language |
| 3 | User Control and Freedom | 3 | Withdraw, roll, back-links, Esc all work; no confirm on "Take it down" |
| 4 | Consistency and Standards | 2 | Two nav shells, two wallet UIs, two component kits; one offer reports two sizes |
| 5 | Error Prevention | 2 | Over-balance shows a phantom $32M quote and clips the typed value |
| 6 | Recognition Rather Than Recall | 3 | Defaults filled, Details one click; bullets styled as radios |
| 7 | Flexibility and Efficiency | 3 | 1 click to publish warm, full keyboard path, visible focus everywhere |
| 8 | Aesthetic and Minimalist | 3 | Card and /offers exemplary; /surface is 4,360px of unmigrated terminal |
| 9 | Error Recovery | 2 | Disabled button states a balance, not an action, at a different precision |
| 10 | Help and Documentation | 3 | Inline earn/risk, tooltips, honest simulation labelling; no "what is this" on the front door |
| **Total** | | **27/40** | **Acceptable — the front door is excellent, everything behind it is a tier below** |

## Anti-patterns verdict

Does it look AI-generated? No. Measured on rendered CSS across five routes: zero elements painted
in Mantine's default blue (the ramp exists as variables, nothing consumes it), exactly one shadow
token in the whole system, no gradient text, no backdrop-filter, no purple. Exactly one white
element on the landing page, which is the card. The petrol accent at hue 212 reads as a decision.

Deterministic scan (detect.mjs over web/src): 1 finding, `em-dash-overuse` in
`src/app/(app)/receipt/ReceiptScreen.tsx` (75). Mostly code comments; two em dashes do reach
rendered body copy on /offers.

Contrast on rendered pixels: 373 text runs across 5 routes, zero real failures. Five apparent
failures were all `sr-only` Mantine table captions, i.e. sampler false positives. Tightest real
body text 5.06:1.

## Clicks to a published offer

Cold (no wallet): 3 — Connect wallet, pick a wallet, Publish offer.
Warm (wallet connected): 1 — Publish offer. Uniswap needs 3 warm and cannot publish without typing.

## What is working

1. The card is the whole product. `/` is 15 lines and renders one 476px card with three fields,
   one button, and two disclosure lines. No hero, no stat row, no feature grid.
2. Defaults are derived from chain, not invented. Balance, spot, next Friday off the block clock.
3. The publish receipt proves the mechanism: "0 transfers across 1 transaction".
4. Jargon quarantine holds. Not one banned term on the primary card; all of them live in Details.
5. `/offers` BackingBar is a real signature visual: solid inside the wallet line, hatched past it.

## Priority issues

**[P1] The over-balance state quotes an impossible trade.** Typing 12,345 WETH against a 9.33 WETH
balance: the input clips to "345.12345678" so the card shows a different number than was typed;
"If it is taken in full" still prints **+80,875.48 USDC** in green off a 32,178,196.46 USDC sale;
and the primary button is removed and replaced by a grey block reading "You hold 9.3364125 WETH" —
a balance, not an instruction, at 8 significant digits where the field caption four lines above
says 9.33641248 at 8 decimal places. `OfferCard.tsx:229` vs `:283`.

**[P1] Two navigation shells.** `/` and `/offers` render 2 tabs ("Make an offer", "Your offers").
`/offer/[hash]`, `/surface` and `/receipt` render 4 ("Make an offer", "Market", "Offers",
"Receipt"). Clicking your own offer from "Your offers" silently grows the nav and renames the tab
you came from. This is the "nav bar full of routes" the brief banned, reachable in two clicks.

**[P1] One offer, two sizes.** Hash `0x981ead51…db3e2e71`: `/offers` says "Sell 9.33641 WETH",
`/offer/…` says "Sell 9.59796 WETH". Both are headline claims. Nothing on either screen explains
the difference.

**[P1] The disconnected card computes nothing.** Amount 0, and both disclosure lines are em dashes,
even though spot ("6.1% above today's 2,450.91") is already read without a wallet. Uniswap quotes
before you connect. This is the clearest place ours is worse.

**[P1] The legacy kit was not retired.** `src/components/ui` is 29 files / 3,420 LOC and still
imported by `shell/AppShell`, `offers/OffersScreen`, `tx/TxStepper` and all four of
`components/wallet/*` — a second wallet UI beside `sell/WalletButton.tsx`.

## Minor observations

- The receipt never links to the offer it just created.
- "Nothing left your wallet" appears only after publishing, never before.
- ManagePanel bullets render as unselected radio circles below the buttons they describe.
- Amount input overflows its field at 34px on 390px (scrollWidth 275 > clientWidth 237).
- "Max" is a 24x18 tap target on mobile; /offers row links are 166x20 and rows are not tappable.
- Default amount is 100% of the wallet balance.
- WETH/USDC pills look pressable and are not.
- `/dev`, `/dev/theme` and `/kitchen-sink` are prerendered into the production build.
