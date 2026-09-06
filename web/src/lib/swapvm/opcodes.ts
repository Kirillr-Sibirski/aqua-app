/**
 * Opcode numbers, mirroring `enum Opcode` in @1inch/swap-vm `src/libs/OpcodeList.sol`.
 * Banked by instruction family; the 0xf0-0xff bank is reserved and never allocated.
 */
export const Opcode = {
  // 0x00-0x0f | Core control flow
  Stop: 0x00,
  Revert: 0x01,
  Salt: 0x02,
  Jump: 0x03,
  Extruction: 0x04,

  // 0x10-0x1f | Debug (only wired into *Debug opcode sets)
  PrintSwapRegisters: 0x10,
  PrintSwapQuery: 0x11,
  PrintVM: 0x12,
  PrintFreeMemoryPointer: 0x13,
  PrintGasLeft: 0x14,
  PrintFee: 0x15,
  PatchSwapRegisters: 0x1a,

  // 0x20-0x3f | Conditions & access guards
  Deadline: 0x20,
  OnlyTakerTokenBalanceNonZero: 0x23,
  OnlyTakerTokenBalanceGte: 0x24,
  OnlyTakerTokenSupplyShareGte: 0x25,
  OnlyTxOriginTokenBalanceNonZero: 0x26,
  PrivateOrder: 0x2b,
  WhitelistCoequal: 0x2c,
  WhitelistSequential: 0x2d,
  JumpIfDirection: 0x30,
  JumpIfTokenIn: 0x31,
  JumpIfTokenOut: 0x32,

  // 0x40-0x4f | Invalidators & epochs
  InvalidateBit: 0x40,
  InvalidateTokenIn: 0x41,
  InvalidateTokenOut: 0x42,
  ValidateSeriesEpoch: 0x48,

  // 0x50-0x6f | Swap curves
  XYCSwap: 0x50,
  XYCConcentrateSwap: 0x51,
  LimitSwap: 0x53,
  LimitSwapFullAmount: 0x54,
  PeggedSwap: 0x58,

  // 0x70-0x8f | Fees
  FeeFlatIn: 0x70,
  FeeFlatOut: 0x71,
  FeeProtocol: 0x80,

  // 0x90-0xaf | Balances tuning
  StaticBalances: 0x90,
  DynamicBalances: 0x91,
  DutchAuctionBalanceIn: 0x94,
  DutchAuctionBalanceOut: 0x95,
  PiecewiseLinearScaleBalanceIn: 0x98,
  PiecewiseLinearScaleBalanceOut: 0x99,
  Decay: 0x9c,
  TWAPSwap: 0x9d,

  // 0xb0-0xcf | Rates tuning
  RequireMinRate: 0xb0,
  AdjustMinRate: 0xb1,
  OraclePriceAdjuster: 0xb2,
  BaseFeeAdjuster: 0xb4,

  // 0xd0-0xef | Unallocated upstream — project-custom opcodes live here
  /** Custom ProbeRouter opcode (`Opcode._d0`): scales balanceOut by `factor / 1e9`. */
  ProbeScale: 0xd0,
} as const;

export type OpcodeName = keyof typeof Opcode;
export type OpcodeValue = (typeof Opcode)[OpcodeName];

/** Opcodes dispatched by `AquaOpcodes` (the set the ProbeRouter inherits) plus the custom ProbeScale. */
export const AQUA_OPCODES: ReadonlySet<number> = new Set<number>([
  Opcode.Jump,
  Opcode.JumpIfTokenIn,
  Opcode.JumpIfTokenOut,
  Opcode.Deadline,
  Opcode.OnlyTakerTokenBalanceNonZero,
  Opcode.OnlyTakerTokenBalanceGte,
  Opcode.OnlyTakerTokenSupplyShareGte,
  Opcode.XYCSwap,
  Opcode.XYCConcentrateSwap,
  Opcode.Decay,
  Opcode.Salt,
  Opcode.FeeFlatIn,
  Opcode.FeeProtocol,
  Opcode.PeggedSwap,
  Opcode.Extruction,
  Opcode.OnlyTxOriginTokenBalanceNonZero,
]);

export const PROBE_ROUTER_OPCODES: ReadonlySet<number> = new Set<number>([...AQUA_OPCODES, Opcode.ProbeScale]);

const NAME_BY_VALUE: ReadonlyMap<number, OpcodeName> = new Map(
  (Object.entries(Opcode) as [OpcodeName, number][]).map(([name, value]) => [value, name]),
);

export function opcodeName(value: number): OpcodeName | undefined {
  return NAME_BY_VALUE.get(value);
}
