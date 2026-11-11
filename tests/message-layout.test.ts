import { describe, expect, it } from 'vitest';
import { continuesMessageGroup } from '../src/message-layout';
import type { Message } from '../src/core/types';
const note = (createdAt: string, channelId = 'notes'): Message => ({id: crypto.randomUUID(), channelId, createdAt, text: 'Une note', pinned: false, attachments: []});
describe('consecutive message groups', () => {
  it('groups consecutive notes within five minutes without crossing channels or changing saved content', () => {
    const a = note('2026-11-11T12:00:00Z');
    const b = note('2026-11-11T12:04:59Z');
    const before = structuredClone([a, b]);
    expect(continuesMessageGroup(undefined, a)).toBe(false);
    expect(continuesMessageGroup(a, a)).toBe(true);
    expect(continuesMessageGroup(a, b)).toBe(true);
    expect(continuesMessageGroup(a, {...b, channelId: 'other'})).toBe(false);
    expect(continuesMessageGroup(a, note('2026-11-11T12:05:00Z'))).toBe(false);
    expect(continuesMessageGroup(b, a)).toBe(false);
    expect([a, b]).toEqual(before);
  });
  it('starts a new group after midnight even when two notes are seconds apart', () => {
    const a = new Date(2026, 10, 11, 23, 59, 59), b = new Date(2026, 10, 12, 0, 0, 1);
    expect(continuesMessageGroup(note(a.toISOString()), note(b.toISOString()))).toBe(false);
  });
});
