import { describe, expect, it } from 'vitest';
import { TICKET_NOTES } from '../ticketCopy';

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const notes = [
  TICKET_NOTES.iv('WETH'),
  TICKET_NOTES.premium('sell'),
  TICKET_NOTES.premium('buy'),
  TICKET_NOTES.protocolFee('sell'),
  TICKET_NOTES.protocolFee('buy'),
];

describe('ticket notes', () => {
  it.each(notes)('%s is one short sentence', (note) => {
    expect(sentences(note)).toHaveLength(1);
    expect(note).toMatch(/[.!?]$/);
    expect(note.split(/\s+/).length).toBeLessThanOrEqual(15);
  });

  it('names the counterparty for each side', () => {
    expect(TICKET_NOTES.premium('buy')).toMatch(/seller/);
    expect(TICKET_NOTES.protocolFee('buy')).toMatch(/seller/);
    expect(TICKET_NOTES.premium('sell')).toMatch(/buyer/);
    expect(TICKET_NOTES.protocolFee('sell')).toMatch(/buyer/);
  });
});
