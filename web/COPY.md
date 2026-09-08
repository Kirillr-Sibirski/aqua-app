# COPY.md

The words the product uses, and the reason each one was chosen. Settled; do not drift back.

A blind comprehension study of five readers (a retail crypto user, a DeFi LP, a professional
options trader, a non-1inch hackathon judge, and an engineer with no crypto background) cold-read
the material and scored a mean confidence of 5.2/10. All five said they would not use it. The
retail reader on the app specifically:

> "I connect a wallet and get 'Write a book', 'A ladder of option legs', 'Theta band',
> 'Moneyness', 'X/L', 'Deliverable depth'. There is not one sentence in the product saying 'you
> will sell your ETH at $X, you get paid $Y, here's the risk.' The empty states explain the
> architecture ('A leg is a SwapVM program shipped to Aqua') instead of explaining the product.
> I'd bounce in about 40 seconds."

Everything below exists to make that sentence untrue.

## The four rules

1. **Lead with the plain promise, and name who pays.** Never write "get paid to wait" without the
   payer in the same breath. "Whoever takes it pays you for the wait", not "earn yield".
2. **Never the word "contract."** `dock` is unconditional and instant, so a maker can withdraw a
   quote at any moment. An offer can be withdrawn; a contract cannot. Calling it a contract is the
   one thing the options trader said was untrue. Use *offer* and *quote*.
3. **Specialist framing is allowed, but labelled.** Two markers only, both borrowed from the
   README: `If you already trade options:` and `Mechanically:`. A reader who does not want that
   layer must be able to skip the sentence without feeling lost.
4. **Every screen answers three questions above the fold, in plain words, before any mechanism
   word appears:** what am I selling, what do I earn, what do I risk. Wherever earnings appear,
   the flow-dependence appears with them: **you are not paid up front.**

## The landing screen, verbatim

These four strings are fixed. They come from the comprehension study's own rewrite (§5c) and are
not to be paraphrased.

| Slot | String |
|---|---|
| Headline | Name the price you'd sell at. Get paid to wait. |
| Subhead | Covered calls written from the ETH in your own wallet. You pick the price and the date; every day nobody takes it, the next buyer pays more. Nothing is custodied — the tokens never move until someone fills. |
| Risk line | If ETH runs past your price, you sell at your price and keep what you were paid. That is the trade. If it moves more than the volatility you chose, you lose. |
| Primary button | Name your price |

The subhead keeps its em dash even though DESIGN.md bans em dashes in UI copy: it is the one
verbatim string in the app, and the study quoted it with the dash. It is the only permitted em dash
in any user-facing string. Everywhere else, use a semicolon, a colon or a full stop.

DESIGN.md also bans a hero section anywhere in the app, and that ban is overruled here and only
here. Three lines of purpose under a page title is a label, not a hero. The rest of the ban stands:
no gradient text, no glass, no 72px yield number, no payoff cartoon.

## The vocabulary

Plain word first; the precise term survives in a `title` tooltip or a labelled specialist line, so
a professional loses nothing.

| Was | Is now | Where the precise term went |
|---|---|---|
| Write a book | **Name your price** | page title, primary button, nav "Name a price" |
| leg (in prose) | **offer** | "leg" stays in `ProgramInspector`, `ShipCalldata`, `/dev`, `/kitchen-sink` and all code identifiers |
| book (in prose) | **your offers** / **these offers** | "book" stays in the labelled specialist lines |
| Theta band | **Minimum trade size right now** (compact: *Minimum trade*) | `title="Theta band"`; the card body names it as what traders call it |
| Moneyness | **Share still unsold** on /book; **How far from today** on /write | `title="Moneyness: …"` |
| X/L | **never shown to a user, anywhere** | not even in a tooltip. Unlike every other term it gets no secondary label |
| Deliverable depth | **How much you can sell right now** (compact: *Can sell now*) | `title="Deliverable depth"` |
| Realised theta | **Paid so far** | `title="Realised theta"` |
| Theta captured | **Paid so far** | as above |
| Notional written | **Total on offer** / **On offer** | `title="Notional written"` |
| Notional (L) | **How much WETH** | `title="Notional, L in the program"` |
| Book delta | **What you would hand over now** | `title="Book delta"` |
| Backed | **Covered** | `title` on the tile |
| Implied vol / IV | **Movement priced in** / **How much movement you are pricing in** | the word "implied volatility" is spelled out in the field hint and in tooltips |
| Trailing realised | **What ETH has actually been doing** | `title="Trailing realised volatility…"` |
| Strike / K | **You sell at** / **Price it sells at** / **Sells at** | `title="Strike, K"` |
| Expiry / maturity / tenor | **Runs to** / **Time left** / **How long the offer runs** | `title="Expiry, the maturity in the program"` |
| Ship | **Publish** | "ship" stays in the calldata disclosure and code |
| Dock | **Take it down** / **Withdraw** | `title="Dock"` |
| Docked (status) | **Withdrawn** | `title="Docked in Aqua"` |
| Roll | **Move to a later date** | `title="Roll"` |
| Settling / In assignment | **Past its date** | `title="Past maturity: settling, assignment only"` |
| Fill / fills | **trade** / **times taken** | "fill" stays in code and in the ledger tooltips |
| Maker | **you**, or **wallet** in a column header | `title="Maker"` |
| Taker | **buyer** / **whoever takes it** | — |
| Margined / Unguarded / Unproven | **Checked** / **Wallet not checked** / **Not checked** | `title` names the `Coverage` instruction |
| Premium | **Option value** | `title="Premium, the Black-Scholes value measured from the reserves"` |
| Min ticket | **Minimum trade** | `title="Theta band…"` |
| Surface (the screen) | **Market** | the page's specialist line names it an implied-volatility surface |
| Reserve point | **where it sits now** | — |
| Virtual reserve | **on offer** | — |
| Spot | **today** / **today's price** | — |
| Call / Put (chips) | **Sell** / **Buy** | `title="Covered call"` / `title="Cash-secured put"` |
| Assigned (chart band) | **you sell here** / **you buy here** | — |

### One deliberate departure from the study's mapping

The study maps `Moneyness -> "How far above today's price"`. That is exactly right on `/write`,
where the figure really is `strike / spot - 1`, and it is used there.

It is **not** used on `/book`, because the number in that column is `X/L = Phi(-d1)` — the share of
the offer still sitting in the risky asset, which runs to 1 when the strike is far *away*. Printing
`71.4%` under a header reading "how far above today's price" would be a false statement about a
real number, and DESIGN.md's no-fake-data rule outranks a wording preference. That column is
**Share still unsold**, which is literally what the ratio is, with the desk term in its tooltip.

## Screen by screen: what each one must say above the fold

| Screen | Sells | Earns | Risks |
|---|---|---|---|
| `/` | "Covered calls written from the ETH in your own wallet" | "every day nobody takes it, the next buyer pays more" + not paid up front | the verbatim risk line |
| `/write` | "Name the price you would sell your ETH at" | "Whoever takes it pays you for the wait" + not paid up front | "if it moves more than the volatility you choose, you lose" |
| `/book` | "offers to sell your ETH at a price you named" | "what past buyers actually had to cross" + not paid up front | "the moment somebody takes one offer, the others shrink" |
| `/leg/[hash]` | "An offer to sell WETH at this price" | "pays the maker for the wait" + not paid up front | tokens never left the wallet; the offer can be taken |
| `/surface` | "Every offer anyone has made on this router" | option value per unit | "None of these makers has been paid yet either" |

## Empty states explain the product, not the architecture

The canonical replacement, used verbatim in three places (`/` disconnected, `/` empty, `/book`
disconnected and `/book` empty, in the two shapes below):

> An offer to sell your ETH at a price you choose. Your tokens stay in your wallet until someone
> takes it.

and, where a second sentence earns its place:

> …and one balance can stand behind several offers at once.

Never: "A leg is a SwapVM program shipped to Aqua."

## Numbers

Any figure shown to a reader carries its denominator and its period, and a measured sequence is
labelled as one measured sequence, never as a yield. No number renders unless it came from a chain
read, except a chart explicitly stamped `model`. Round demo amounts read as fake even when real, so
demo inventory is seeded at irregular amounts.

## Where the old vocabulary is still correct

`/dev`, `/kitchen-sink`, `ProgramInspector`, `ShipCalldata`, decoded revert names, opcode numbers,
`tau`, `Phi(-d1)`, `stableFor`, `bandFor`, `coverage`, `balanceOf ∧ allowance` — all developer
surfaces or labelled disclosures. They keep the exact words, because their reader is a developer or
a judge reading the mechanism on purpose, and renaming them there would cost precision for nothing.
