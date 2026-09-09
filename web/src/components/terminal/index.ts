/**
 * The terminal. One screen, and the only thing `app/page.tsx` renders.
 *
 * Nothing else in the app imports from here: there is no second route to compose these into, which
 * is the point. The pieces are exported for tests and for the one page.
 */
export { TerminalScreen } from './TerminalScreen';

export { TerminalHeader } from './Header';
export type { HeaderProps } from './Header';

export { Ticket } from './Ticket';
export type { TicketProps } from './Ticket';

export { Positions } from './Positions';
export type { PositionsProps } from './Positions';

export { useTicketDraft } from './useTicketDraft';
export type { TicketDraft, UseTicketDraftParams } from './useTicketDraft';

export { backingRatio } from './backing';

export { Explain, Labelled } from './Explain';
export type { ExplainProps } from './Explain';

export { useSpotWindow, formatSpan } from './useSpotWindow';
export type { SpotWindow, UseSpotWindowParams, UseSpotWindowResult } from './useSpotWindow';
