import type { ChatMessage } from './types';

/**
 * Shapes a client transcript into what every provider accepts: no empty turns,
 * roles that alternate, a first turn from the user and a last turn from the
 * user (a trailing assistant turn would be a prefill, which Claude rejects).
 *
 * - Whitespace-only messages are dropped.
 * - Leading assistant messages are dropped (a client that keeps only the last N
 *   messages can start mid-conversation).
 * - Consecutive messages with the same role are merged with a newline.
 *
 * Returns undefined when nothing answerable is left, i.e. the conversation
 * does not end with a user message.
 */
export function normalizeConversation(messages: readonly ChatMessage[]): ChatMessage[] | undefined {
  const result: ChatMessage[] = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;

    const last = result.at(-1);
    if (last?.role === message.role) {
      last.content = `${last.content}\n${content}`;
    } else if (last || message.role === 'user') {
      result.push({ role: message.role, content });
    }
  }
  return result.at(-1)?.role === 'user' ? result : undefined;
}
