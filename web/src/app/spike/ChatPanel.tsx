'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { ApiFailure, openChatStream, type ApiFailureKind } from '@/features/chat/chatClient';
import { createSentenceSplitter } from '@/features/chat/sentences';
import { SpeechQueue, type SpeechSink } from '@/features/chat/speechQueue';
import { fetchSpeechClip } from '@/features/chat/ttsClient';
import { MAX_CHAT_MESSAGE_CHARS, type ChatLocale, type ChatMessage } from '@/lib/ai/types';
import { cleanSpeechText } from '@/lib/tts/speechText';
import type { VoiceGender } from '@/lib/tts/types';

export interface ChatPanelProps {
  /** The shared player the avatar listens to; any `SpeechPlayer` fits. */
  speech: SpeechSink;
  voice: VoiceGender;
  locale: ChatLocale;
  /** Saved character whose name, base and style shape the persona. Optional. */
  characterId?: string;
  /** Placement is up to the host, e.g. `absolute bottom-3 left-3`. */
  className?: string;
}

interface Notice {
  tone: 'error' | 'info';
  text: string;
}

// Developer bench, not product UI: like the other spike controls, these strings
// are not localized (they live outside the next-intl shell).
const CHAT_PROBLEMS: Record<ApiFailureKind, string> = {
  unauthenticated: 'You are not signed in. Open the landing page and press Enter first.',
  not_configured:
    'No AI provider is configured. Add a key to web/.env.local and restart the dev server (docs/setup-accounts.md).',
  unavailable: 'Every AI provider failed. The dev server log has the details.',
  invalid: 'The server rejected this message.',
  network: 'Could not reach the server.',
  interrupted: 'The reply was interrupted.',
};

const SPEECH_PROBLEMS: Record<ApiFailureKind, string> = {
  unauthenticated: CHAT_PROBLEMS.unauthenticated,
  not_configured:
    'Voice is not configured (AZURE_SPEECH_KEY and AZURE_SPEECH_REGION). Showing text only.',
  unavailable: 'Text-to-speech failed. The dev server log has the details.',
  invalid: 'The server rejected the text for speech.',
  network: 'Could not reach the speech service.',
  interrupted: 'The audio download was interrupted.',
};

type Phase = 'idle' | 'waiting' | 'streaming';

/**
 * Type a message, read the streamed reply and hear it: each finished sentence
 * is synthesized and played through the shared `SpeechPlayer`, so the avatar's
 * mouth follows the audio (Azure viseme events, else word boundaries, else text).
 */
export function ChatPanel({ speech, voice, locale, characterId, className }: ChatPanelProps) {
  const inputId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [provider, setProvider] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const requestRef = useRef<AbortController>(undefined);
  const logRef = useRef<HTMLDivElement>(null);

  const queue = useMemo(
    () =>
      new SpeechQueue(speech, {
        fetchClip: (request, signal) => fetchSpeechClip(request, signal),
        onSpeakingChange: setSpeaking,
        // These hit every sentence, so report them once and stop asking for audio.
        isFatal: (error) =>
          error instanceof ApiFailure &&
          (error.kind === 'not_configured' || error.kind === 'unauthenticated'),
        onError: (error) => {
          const kind = error instanceof ApiFailure ? error.kind : undefined;
          setNotice({
            tone: kind === 'not_configured' ? 'info' : 'error',
            text: kind ? SPEECH_PROBLEMS[kind] : 'The audio could not be played.',
          });
        },
      }),
    [speech],
  );

  useEffect(
    () => () => {
      requestRef.current?.abort();
      queue.stop();
    },
    [queue],
  );

  // Keep the newest text in view while the reply is written.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const busy = phase !== 'idle' || speaking;

  const stop = () => {
    requestRef.current?.abort();
    queue.stop();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;

    const history: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setDraft('');
    setNotice(undefined);
    setProvider(undefined);
    setMessages([...history, { role: 'assistant', content: '' }]);
    setPhase('waiting');
    queue.reset();

    const controller = new AbortController();
    requestRef.current = controller;
    const splitter = createSentenceSplitter();
    const speak = (sentence: string) => {
      if (!cleanSpeechText(sentence)) return;
      queue.enqueue({ text: sentence, voice, locale });
    };

    let reply = '';
    try {
      const stream = await openChatStream({
        messages: history,
        locale,
        characterId,
        signal: controller.signal,
      });
      setProvider(stream.provider);
      setPhase('streaming');

      for await (const chunk of stream.chunks) {
        reply += chunk;
        setMessages([...history, { role: 'assistant', content: reply }]);
        for (const sentence of splitter.push(chunk)) speak(sentence);
      }
      for (const sentence of splitter.flush()) speak(sentence);
    } catch (error) {
      // A stop is not a failure; anything else is shown inline.
      if (!controller.signal.aborted) {
        const kind = error instanceof ApiFailure ? error.kind : 'network';
        setNotice({ tone: 'error', text: CHAT_PROBLEMS[kind] });
      }
    } finally {
      // Nothing arrived: drop the empty bubble and keep the user's message.
      setMessages(reply ? [...history, { role: 'assistant', content: reply }] : history);
      setPhase('idle');
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const status = (() => {
    if (phase === 'waiting') return 'Thinking…';
    if (phase === 'streaming') return provider ? `Replying via ${provider}…` : 'Replying…';
    if (speaking) return 'Speaking…';
    return provider ? `Last reply via ${provider}` : '';
  })();

  return (
    <section
      aria-label="Chat with the character"
      className={`pointer-events-auto flex w-80 max-w-full flex-col gap-2 rounded-xl border border-black/10 bg-white p-3 font-sans text-xs text-neutral-900 shadow-sm ${className ?? ''}`}
    >
      <div
        ref={logRef}
        role="log"
        aria-label="Conversation"
        aria-busy={phase !== 'idle'}
        className="flex max-h-56 min-h-16 flex-col gap-1.5 overflow-y-auto"
      >
        {messages.length === 0 && (
          <p className="text-neutral-500">Say something to start the conversation.</p>
        )}
        {messages.map((message, index) => (
          <p
            key={index}
            className={`max-w-[90%] rounded-lg px-2.5 py-1.5 whitespace-pre-wrap ${
              message.role === 'user'
                ? 'self-end bg-neutral-900 text-white'
                : 'self-start bg-neutral-100'
            }`}
          >
            <span className="sr-only">{message.role === 'user' ? 'You: ' : 'Character: '}</span>
            {message.content || '…'}
          </p>
        ))}
      </div>

      <p role="status" className="min-h-4 text-neutral-500">
        {status}
      </p>
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={notice.tone === 'error' ? 'text-red-700' : 'text-neutral-700'}
        >
          {notice.text}
        </p>
      )}

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          Message
        </label>
        <input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_CHAT_MESSAGE_CHARS}
          autoComplete="off"
          placeholder="Type a message…"
          className="min-w-0 flex-1 rounded-full border border-black/15 px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-full border border-neutral-900 px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-full bg-neutral-900 px-3 py-1.5 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-50"
          >
            Send
          </button>
        )}
      </form>
    </section>
  );
}
