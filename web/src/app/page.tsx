'use client';

/**
 * The front door: one card, centred, and nothing else.
 *
 * What used to be here was a page title, three paragraphs of purpose, an inventory row and a table
 * of offers — the shape of a terminal, and the shape a blind comprehension study bounced off in
 * about forty seconds. The operator's verdict and the study's landed in the same place: a person
 * holding ETH should arrive already inside the action, the way they do on a swap page, and be
 * decided in under a minute by something that reads like English.
 *
 * So the whole screen is `Sell 10.4 WETH · if it reaches 2,600 · by Fri 11 Sep`, pre-filled from
 * the wallet's balance, the price feed and the chain's clock, with two lines under it saying what
 * that earns and what it gives up and one button that publishes it. The positions view still
 * exists, still matters, and is a second tab that appears once there is something in it.
 */
import { OfferCard } from '@/components/sell';
import { AppChrome } from '@/components/shell';

export default function SellPage() {
  return (
    <AppChrome layout="card">
      <OfferCard />
    </AppChrome>
  );
}
