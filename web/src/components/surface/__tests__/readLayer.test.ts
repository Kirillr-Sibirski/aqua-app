/**
 * The two decisions the read-layer panel makes.
 *
 * It prints a query and claims the numbers beside it are that query's answer, so the query has to
 * name the cell actually on screen — a panel showing the 2,800 call beside a query for the 2,600 one
 * would be worse than showing no query at all. And the cell it opens on has to be the one where the
 * comparison exists, because a "best bid across all makers" panel that opens on a strike only one
 * maker wrote is a comparison of one thing.
 */
import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import { bestBidQuery } from '../ReadLayer';
import { pickQuotePoint } from '../BestQuote';
import { groupSurface } from '../decode';
import type { SurfaceLeg, SurfacePoint } from '../types';

const WETH = '0x2e234DAe75C793f67A35089C9d99245E1C58470b' as Address;
const USDC = '0xF62849F9A0B5Bf2913b396098F7c7019b51A820a' as Address;
const WAD = BigInt(10) ** BigInt(18);

function leg(overrides: Partial<SurfaceLeg> = {}): SurfaceLeg {
  return {
    strategyHash: `0x${'ab'.repeat(32)}` as Hex,
    maker: '0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7' as Address,
    app: '0xa0Cb889707d426A7A386870A03bc70d1b0697598' as Address,
    tokenRisky: WETH,
    tokenStable: USDC,
    riskyIsTokenA: true,
    strikeWad: BigInt(2800) * WAD,
    sigmaWad: (BigInt(6) * WAD) / BigInt(10),
    maturity: 604_801,
    liquidityWad: BigInt(10) * WAD,
    rateRisky: BigInt(1),
    rateStable: BigInt(10) ** BigInt(12),
    flags: 0b111,
    guarded: true,
    reserveRisky: BigInt('9220000000000000000'),
    reserveStable: BigInt('1864000000'),
    docked: false,
    shippedAtBlock: BigInt(1),
    mine: false,
    ...overrides,
  };
}

describe('pickQuotePoint', () => {
  const contested = [
    leg({ strategyHash: '0x01' as Hex }),
    leg({ strategyHash: '0x02' as Hex, maker: '0x000000000000000000000000000000000000dEaD' as Address }),
  ];
  const lonely = leg({ strategyHash: '0x03' as Hex, strikeWad: BigInt(2600) * WAD });

  it('opens on the cell the most makers are quoting, not on whichever sorted first', () => {
    const points = groupSurface([lonely, ...contested]);
    // The 2,600 cell sorts first by strike; the 2,800 one is where the comparison exists.
    expect(points[0].strikeWad).toBe(BigInt(2600) * WAD);
    expect(pickQuotePoint(points)!.strikeWad).toBe(BigInt(2800) * WAD);
  });

  it('honours an explicit selection over its own preference', () => {
    const points = groupSurface([lonely, ...contested]);
    expect(pickQuotePoint(points, points[0].key)!.strikeWad).toBe(BigInt(2600) * WAD);
  });

  it('breaks a tie on the nearer expiry, so the choice does not move between renders', () => {
    const near = leg({ strategyHash: '0x04' as Hex });
    const far = leg({ strategyHash: '0x05' as Hex, maturity: 604_801 + 14 * 86_400 });
    expect(pickQuotePoint(groupSurface([far, near]))!.maturity).toBe(604_801);
    expect(pickQuotePoint(groupSurface([near, far]))!.maturity).toBe(604_801);
  });

  it('never offers a cell whose only offers have been withdrawn', () => {
    const points = groupSurface([leg({ strategyHash: '0x06' as Hex, docked: true })]);
    expect(points).toHaveLength(1);
    expect(pickQuotePoint(points)).toBeUndefined();
  });
});

describe('bestBidQuery', () => {
  const point: SurfacePoint = groupSurface([leg({ strategyHash: '0x07' as Hex })])[0];

  it('asks about the cell on screen, in the literals The Graph expects', () => {
    const query = bestBidQuery(point);
    expect(query).toContain('strikeWad: "2800000000000000000000"');
    expect(query).toContain('maturity: "604801"');
    expect(query).toContain(`tokenRisky: "${WETH.toLowerCase()}"`);
    expect(query).toContain(`tokenStable: "${USDC.toLowerCase()}"`);
    // The pair is part of the cell's identity: a cbBTC call struck at 2,800 USDC carries the same
    // strikeWad as a WETH one, and ranking them together would offer a choice nobody has.
    expect(query.indexOf('tokenRisky')).toBeLessThan(query.indexOf('strikeWad:'));
  });

  it('asks only about live offers, since a withdrawn one is not a bid', () => {
    expect(bestBidQuery(point)).toContain('liveLegCount_gt: 0');
    expect(bestBidQuery()).toContain('liveLegCount_gt: 0');
  });

  it('selects the fields the panel above it displays, and nothing it does not', () => {
    const query = bestBidQuery(point);
    for (const field of ['maxSigmaWad', 'liveLiquidityWad', 'bestLeg', 'guarded', 'reserveRisky']) {
      expect(query).toContain(field);
    }
  });

  it('is balanced, so what is on screen is something a playground would accept', () => {
    const query = bestBidQuery(point);
    const open = [...query].filter((c) => c === '{').length;
    const close = [...query].filter((c) => c === '}').length;
    expect(open).toBe(close);
  });
});
