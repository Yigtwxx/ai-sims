// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { toRequestIssues } from '@/lib/http/responses';
import { ChatRequestSchema } from './chatRequest';
import { normalizeConversation } from './conversation';

describe('normalizeConversation', () => {
  it('keeps an alternating conversation that ends with a user message', () => {
    const messages = [
      { role: 'user', content: 'Merhaba' },
      { role: 'assistant', content: 'Selam!' },
      { role: 'user', content: 'Nasılsın?' },
    ] as const;
    expect(normalizeConversation(messages)).toEqual(messages);
  });

  it('drops leading assistant messages', () => {
    const result = normalizeConversation([
      { role: 'assistant', content: 'old tail of a long chat' },
      { role: 'user', content: 'hi' },
    ]);
    expect(result).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('merges consecutive messages with the same role', () => {
    const result = normalizeConversation([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'third' },
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'first\nsecond' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'third' },
    ]);
  });

  it('drops whitespace-only messages and trims the rest', () => {
    const result = normalizeConversation([
      { role: 'user', content: '  hi  ' },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: 'there' },
    ]);
    expect(result).toEqual([{ role: 'user', content: 'hi\nthere' }]);
  });

  it('does not mutate its input', () => {
    const input = [
      { role: 'user' as const, content: 'a' },
      { role: 'user' as const, content: 'b' },
    ];
    normalizeConversation(input);
    expect(input).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
  });

  it('returns undefined when the conversation does not end with a user message', () => {
    expect(
      normalizeConversation([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]),
    ).toBeUndefined();
    expect(normalizeConversation([{ role: 'assistant', content: 'only me' }])).toBeUndefined();
    expect(normalizeConversation([])).toBeUndefined();
  });
});

describe('ChatRequestSchema', () => {
  const valid = { messages: [{ role: 'user', content: 'hi' }], locale: 'tr' };

  it('accepts a minimal request and trims content', () => {
    const parsed = ChatRequestSchema.safeParse({
      ...valid,
      messages: [{ role: 'user', content: '  hi  ' }],
    });
    expect(parsed.success && parsed.data.messages[0]?.content).toBe('hi');
  });

  it('accepts an optional characterId', () => {
    expect(ChatRequestSchema.safeParse({ ...valid, characterId: 'abc123' }).success).toBe(true);
  });

  it('rejects more than 24 messages', () => {
    const messages = Array.from({ length: 25 }, () => ({ role: 'user', content: 'x' }));
    expect(ChatRequestSchema.safeParse({ ...valid, messages }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...valid, messages: messages.slice(0, 24) }).success).toBe(
      true,
    );
  });

  it('rejects content over 2000 characters and accepts exactly 2000', () => {
    const with2000 = { ...valid, messages: [{ role: 'user', content: 'a'.repeat(2000) }] };
    const with2001 = { ...valid, messages: [{ role: 'user', content: 'a'.repeat(2001) }] };
    expect(ChatRequestSchema.safeParse(with2000).success).toBe(true);
    expect(ChatRequestSchema.safeParse(with2001).success).toBe(false);
  });

  it.each([
    ['empty messages', { ...valid, messages: [] }],
    ['blank content', { ...valid, messages: [{ role: 'user', content: '   ' }] }],
    ['unknown role', { ...valid, messages: [{ role: 'system', content: 'x' }] }],
    ['unknown locale', { ...valid, locale: 'de' }],
    ['missing locale', { messages: valid.messages }],
    ['non-string characterId', { ...valid, characterId: 42 }],
  ])('rejects %s', (_name, body) => {
    expect(ChatRequestSchema.safeParse(body).success).toBe(false);
  });

  it('turns issues into client-safe path and message pairs', () => {
    const parsed = ChatRequestSchema.safeParse({ messages: [], locale: 'de' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = toRequestIssues(parsed.error);
    expect(issues.map((issue) => issue.path).sort()).toEqual(['locale', 'messages']);
    for (const issue of issues) expect(typeof issue.message).toBe('string');
  });
});
