/**
 * The ticket's ⓘ notes. One plain sentence each, fifteen words at most, and side-aware wherever the
 * counterparty changes: a sell offer is taken by a buyer bringing USDC, a buy offer by a seller
 * bringing WETH.
 */
export type TicketSide = 'sell' | 'buy';

export const TICKET_NOTES = {
  iv: (risky: string) => `Higher means you expect ${risky} to move more, and it raises the premium.`,
  premium: (side: TicketSide) =>
    side === 'buy'
      ? 'The option value this offer earns you from sellers over its life.'
      : 'The option value this offer earns you from buyers over its life.',
  protocolFee: (side: TicketSide) =>
    side === 'buy' ? 'Paid by the seller on each fill.' : 'Paid by the buyer on each fill.',
} as const;
