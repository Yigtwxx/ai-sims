'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiFailure, openChatStream, type ApiFailureKind } from '@/features/chat/chatClient';
import { createSentenceSplitter } from '@/features/chat/sentences';
import { SpeechQueue } from '@/features/chat/speechQueue';
import { fetchSpeechClip } from '@/features/chat/ttsClient';
import { SpeechPlayer } from '@/features/lipsync/speechPlayer';
import type { ChatLocale, ChatMessage } from '@/lib/ai/types';
import { cleanSpeechText } from '@/lib/tts/speechText';
import type { VoiceGender } from '@/lib/tts/types';

import { SubtitleSink, type SubtitleLine } from './subtitleSink';

/** Waiting longer than this for the first token reads as "thinking", not "connecting". */
const CONNECTING_MS = 700;

export type TalkPhase = 'idle' | 'connecting' | 'thinking' | 'writing';

export type TalkNotice =
  | { source: 'chat'; kind: ApiFailureKind }
  | { source: 'voice'; kind: 'notConfigured' | 'unavailable' | 'failed' };

interface UseTalkOptions {
  characterId: string;
  locale: ChatLocale;
  voice: VoiceGender;
}

/**
 * The conversation pipeline: chat stream → sentence splitter → speech queue →
 * shared SpeechPlayer (which the stage lip-syncs to), plus the subtitle line
 * that is being heard. All network failures become notices the UI can explain.
 */
export function useTalk({ characterId, locale, voice }: UseTalkOptions) {
  const [player] = useState(() => new SpeechPlayer());
  const [line, setLine] = useState<SubtitleLine | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<TalkPhase>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [notice, setNotice] = useState<TalkNotice>();
  const request = useRef<AbortController>(undefined);
  const lastPrompt = useRef<{ history: ChatMessage[]; text: string }>(undefined);
  const voiceOnRef = useRef(voiceOn);

  const queueRef = useRef<SpeechQueue | null>(null);

  // The queue and its subtitle sink live for the life of the screen; they are
  // created after mount so nothing here runs during render.
  useEffect(() => {
    const sink = new SubtitleSink(player, setLine);
    const queue = new SpeechQueue(sink, {
      fetchClip: async (speechRequest, signal) =>
        sink.register(await fetchSpeechClip(speechRequest, signal)),
      onSpeakingChange: setSpeaking,
      // These hit every sentence: report once, then stop asking for audio.
      isFatal: (error) =>
        error instanceof ApiFailure &&
        (error.kind === 'not_configured' || error.kind === 'unauthenticated'),
      onError: (error) => {
        const kind = error instanceof ApiFailure ? error.kind : undefined;
        if (kind === 'not_configured') {
          voiceOnRef.current = false;
          setVoiceOn(false);
          setNotice({ source: 'voice', kind: 'notConfigured' });
        } else {
          setNotice({ source: 'voice', kind: kind === 'unavailable' ? 'unavailable' : 'failed' });
        }
      },
    });
    queueRef.current = queue;
    return () => {
      request.current?.abort();
      queue.stop();
      queueRef.current = null;
    };
  }, [player]);

  useEffect(() => () => void player.dispose(), [player]);

  const stop = useCallback(() => {
    request.current?.abort();
    queueRef.current?.stop();
  }, []);

  const toggleVoice = useCallback(() => {
    // Turning the voice on is a gesture too: wake the audio while it lasts.
    if (!voiceOnRef.current) player.unlock();
    setVoiceOn((on) => {
      voiceOnRef.current = !on;
      if (on) queueRef.current?.stop();
      return !on;
    });
  }, [player]);

  const run = useCallback(
    async (history: ChatMessage[]) => {
      setNotice(undefined);
      setMessages([...history, { role: 'assistant', content: '' }]);
      setPhase('connecting');
      queueRef.current?.reset();
      const controller = new AbortController();
      request.current = controller;
      const thinkingTimer = window.setTimeout(() => {
        setPhase((current) => (current === 'connecting' ? 'thinking' : current));
      }, CONNECTING_MS);

      const splitter = createSentenceSplitter();
      const speak = (sentence: string) => {
        if (!voiceOnRef.current || !cleanSpeechText(sentence)) return;
        queueRef.current?.enqueue({ text: sentence, voice, locale });
      };

      let reply = '';
      try {
        const stream = await openChatStream({
          messages: history,
          locale,
          characterId,
          signal: controller.signal,
        });
        for await (const chunk of stream.chunks) {
          if (!reply) setPhase('writing');
          reply += chunk;
          setMessages([...history, { role: 'assistant', content: reply }]);
          for (const sentence of splitter.push(chunk)) speak(sentence);
        }
        for (const sentence of splitter.flush()) speak(sentence);
      } catch (error) {
        // A stop is not a failure; anything else is explained inline.
        if (!controller.signal.aborted) {
          setNotice({
            source: 'chat',
            kind: error instanceof ApiFailure ? error.kind : 'network',
          });
        }
      } finally {
        window.clearTimeout(thinkingTimer);
        // Nothing arrived: drop the empty bubble and keep the user's message.
        setMessages(reply ? [...history, { role: 'assistant', content: reply }] : history);
        setPhase('idle');
      }
    },
    [characterId, locale, voice],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || phase !== 'idle') return false;
      // Still inside the user's gesture: the reply's audio arrives seconds later.
      if (voiceOnRef.current) player.unlock();
      if (speaking) queueRef.current?.stop();
      const history: ChatMessage[] = [...messages, { role: 'user', content }];
      lastPrompt.current = { history, text: content };
      void run(history);
      return true;
    },
    [messages, phase, player, run, speaking],
  );

  /** Re-asks the last message after a failure. */
  const retry = useCallback(() => {
    const last = lastPrompt.current;
    if (!last || phase !== 'idle') return;
    if (voiceOnRef.current) player.unlock();
    void run(last.history);
  }, [phase, player, run]);

  return {
    player,
    line,
    messages,
    phase,
    speaking,
    voiceOn,
    notice,
    send,
    stop,
    retry,
    toggleVoice,
    dismissNotice: () => setNotice(undefined),
  };
}
