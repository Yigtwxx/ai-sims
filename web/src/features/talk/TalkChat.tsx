'use client';

import {
  ArrowUpIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  StopIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { MAX_CHAT_MESSAGE_CHARS, type ChatMessage } from '@/lib/ai/types';
import { cn } from '@/lib/utils';

import type { TalkNotice, TalkPhase } from './useTalk';

interface TalkChatProps {
  name: string;
  messages: ChatMessage[];
  phase: TalkPhase;
  speaking: boolean;
  voiceOn: boolean;
  notice?: TalkNotice;
  onSend: (text: string) => boolean;
  onStop: () => void;
  onRetry: () => void;
  onToggleVoice: () => void;
}

const CHAT_ERROR_KEYS = {
  unauthenticated: 'unauthenticated',
  not_configured: 'notConfigured',
  unavailable: 'unavailable',
  invalid: 'invalid',
  network: 'network',
  interrupted: 'interrupted',
} as const;

/** The conversation column: history, streamed reply, status and the composer. */
export function TalkChat({
  name,
  messages,
  phase,
  speaking,
  voiceOn,
  notice,
  onSend,
  onStop,
  onRetry,
  onToggleVoice,
}: TalkChatProps) {
  const t = useTranslations('Talk');
  const inputId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = phase !== 'idle' || speaking;
  const suggestions = t.raw('chat.suggestions') as string[];

  // Keep the newest text in view while the reply is written.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (text = draft) => {
    if (onSend(text)) {
      setDraft('');
      input.current?.focus();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const status =
    phase === 'connecting'
      ? t('status.connecting')
      : phase === 'thinking'
        ? t('status.thinking', { name })
        : phase === 'writing'
          ? t('status.writing', { name })
          : speaking
            ? t('status.speaking', { name })
            : t('status.idle');

  const noticeText = notice
    ? notice.source === 'chat'
      ? t(`errors.${CHAT_ERROR_KEYS[notice.kind]}`)
      : t(`voice.${notice.kind}`)
    : undefined;
  const canRetry =
    notice?.source === 'chat' &&
    notice.kind !== 'not_configured' &&
    notice.kind !== 'unauthenticated';

  return (
    <section aria-label={t('chat.title')} className="flex h-full min-h-0 flex-col">
      <header className="border-hairline flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-title text-ink truncate">{t('chat.title')}</h2>
          <p role="status" className="text-label text-ink-muted mt-0.5 flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 rounded-full',
                phase !== 'idle' || speaking ? 'bg-marquee animate-pulse' : 'bg-ink-faint',
              )}
            />
            {status}
          </p>
        </div>
        <Button
          type="button"
          variant="quiet"
          size="sm"
          aria-pressed={voiceOn}
          onClick={onToggleVoice}
          title={voiceOn ? t('chat.voiceOn') : t('chat.voiceOff')}
        >
          {voiceOn ? (
            <SpeakerHighIcon aria-hidden="true" />
          ) : (
            <SpeakerSlashIcon aria-hidden="true" />
          )}
          {voiceOn ? t('chat.voiceOn') : t('chat.voiceOff')}
        </Button>
      </header>

      <div
        ref={log}
        role="log"
        aria-label={t('chat.log')}
        aria-busy={phase !== 'idle'}
        className="flex min-h-0 flex-1 scrollbar-none flex-col gap-4 overflow-y-auto px-5 py-5"
      >
        {messages.length === 0 ? (
          <div className="mt-auto flex flex-col gap-4">
            <div>
              <p className="font-headline text-subhead text-ink">
                {t('chat.empty.title', { name })}
              </p>
              <p className="text-body-sm text-ink-muted mt-2">{t('chat.empty.body')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => submit(suggestion)}
                  className="rounded-tile border-hairline text-ui text-ink-muted hover:border-ink-faint hover:text-ink h-9 border px-3.5 transition-colors disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => {
            const mine = message.role === 'user';
            const streaming = !mine && index === messages.length - 1 && phase !== 'idle';
            return (
              <div
                key={index}
                className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}
              >
                <span className="text-label text-ink-faint">{mine ? t('chat.you') : name}</span>
                <p
                  className={cn(
                    'text-body max-w-[92%] whitespace-pre-wrap',
                    mine
                      ? 'rounded-control rounded-br-tile bg-backstage-lift text-ink px-4 py-2.5'
                      : 'text-ink',
                  )}
                >
                  {message.content}
                  {streaming ? (
                    <span
                      aria-hidden="true"
                      className="bg-marquee ml-0.5 inline-block h-[1.05em] w-0.5 translate-y-[0.15em] animate-pulse"
                    />
                  ) : null}
                </p>
              </div>
            );
          })
        )}
      </div>

      {noticeText ? (
        <div
          role={notice?.source === 'chat' ? 'alert' : 'status'}
          className="rounded-tile border-hairline bg-backstage-raised mx-5 mb-3 flex items-start gap-3 border px-4 py-3"
        >
          <WarningCircleIcon
            className={cn(
              'mt-0.5 size-5 shrink-0',
              notice?.source === 'chat' ? 'text-alert' : 'text-marquee',
            )}
            aria-hidden="true"
          />
          <p className="text-body-sm text-ink-muted flex-1">{noticeText}</p>
          {canRetry ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={onRetry}
              className="h-6 shrink-0"
            >
              {t('retry')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="border-hairline border-t px-5 pt-4 pb-5">
        <label htmlFor={inputId} className="sr-only">
          {t('chat.inputLabel')}
        </label>
        <div className="rounded-control border-hairline bg-backstage-raised focus-within:border-ink-faint flex items-end gap-2 border p-2 transition-colors">
          <textarea
            ref={input}
            id={inputId}
            value={draft}
            rows={1}
            maxLength={MAX_CHAT_MESSAGE_CHARS}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('chat.placeholder', { name })}
            aria-describedby={hintId}
            className="text-body text-ink placeholder:text-ink-faint field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 outline-none focus-visible:outline-none"
          />
          {busy ? (
            <Button
              type="button"
              variant="quiet"
              size="icon"
              onClick={onStop}
              aria-label={t('chat.stop')}
            >
              <StopIcon weight="fill" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="icon"
              disabled={!draft.trim()}
              aria-label={t('chat.send')}
            >
              <ArrowUpIcon weight="bold" aria-hidden="true" />
            </Button>
          )}
        </div>
        <p id={hintId} className="text-label text-ink-faint mt-2">
          {t('chat.hint')}
        </p>
      </form>
    </section>
  );
}
