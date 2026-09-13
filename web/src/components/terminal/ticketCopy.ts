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
      ? 'What sellers pay you in total if they fill the whole offer by expiry.'
      : 'What buyers pay you in total if they take the whole offer by expiry.',
  protocolFee: (side: TicketSide) =>
    side === 'buy' ? 'Paid by the seller on each fill, on top of your premium.' : 'Paid by the buyer on each fill, on top of your premium.',
} as const;
