import { describe, expect, it } from 'vitest';
import { detectFills, type FillSnapshotLeg } from '../fills';

const leg = (over: Partial<FillSnapshotLeg> = {}): FillSnapshotLeg => ({
  hash: '0xa',
  maker: '0xMaker',
  live: true,
  earned: BigInt(0),
  earnedSymbol: 'USDC',
  earnedDecimals: 6,
  reserveRisky: BigInt(10),
  reserveStable: BigInt(100),
  strikeLabel: '2,600',
  kind: 'call',
  ...over,
});

describe('detectFills', () => {
  it('fires nothing on the first read', () => {
    expect(detectFills(undefined, [leg()])).toEqual([]);
    expect(detectFills([], [leg()])).toEqual([]);
  });

  it('reports the earned delta when an offer earns more', () => {
    const fills = detectFills([leg()], [leg({ earned: BigInt(14810000), reserveRisky: BigInt(9) })]);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ hash: '0xa', delta: BigInt(14810000), symbol: 'USDC', strikeLabel: '2,600' });
  });

  it('reports a fill without an amount when only reserves moved', () => {
    const fills = detectFills([leg()], [leg({ reserveStable: BigInt(200) })]);
    expect(fills).toHaveLength(1);
    expect(fills[0].delta).toBeUndefined();
  });

  it('ignores rows that appear, disappear or get withdrawn', () => {
    expect(detectFills([leg()], [leg(), leg({ hash: '0xb', earned: BigInt(5) })])).toEqual([]);
    expect(detectFills([leg(), leg({ hash: '0xb' })], [leg()])).toEqual([]);
    expect(detectFills([leg()], [leg({ live: false, reserveRisky: BigInt(0) })])).toEqual([]);
  });

  it('ignores pending earnings and unchanged rows', () => {
    expect(detectFills([leg({ earned: undefined })], [leg({ earned: BigInt(5) })])).toEqual([]);
    expect(detectFills([leg()], [leg()])).toEqual([]);
  });

  it('starts over when the wallet changes', () => {
    expect(detectFills([leg()], [leg({ maker: '0xOther', earned: BigInt(9) })])).toEqual([]);
  });

  it('caps a burst at three', () => {
    const before = ['1', '2', '3', '4'].map((h) => leg({ hash: h }));
    const after = ['1', '2', '3', '4'].map((h) => leg({ hash: h, earned: BigInt(1) }));
    expect(detectFills(before, after)).toHaveLength(3);
  });
});
