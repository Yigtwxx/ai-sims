'use client';

import {
  ArrowUpIcon,
  HourglassIcon,
  KeyIcon,
  SignInIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  StopIcon,
  WarningCircleIcon,
  WifiSlashIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { EASE, SPRING_SNAP, SPRING_SOFT } from '@/components/motion/tokens';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ApiFailureKind } from '@/features/chat/chatClient';
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
  /** Closes a voice notice (chat failures stay until the next message or retry). */
  onDismissNotice?: () => void;
}

const CHAT_ERROR_KEYS = {
  unauthenticated: 'unauthenticated',
  not_configured: 'notConfigured',
  unavailable: 'unavailable',
  invalid: 'invalid',
  network: 'network',
  interrupted: 'interrupted',
} as const;

/** One glyph per failure, so the cause reads before the sentence does. */
const CHAT_ERROR_ICONS: Record<ApiFailureKind, Icon> = {
  unauthenticated: SignInIcon,
  not_configured: KeyIcon,
  unavailable: HourglassIcon,
  invalid: WarningCircleIcon,
  network: WifiSlashIcon,
  interrupted: WarningCircleIcon,
};

/** What the conversation is doing right now, as one word for the status line. */
type Live = 'idle' | 'connecting' | 'thinking' | 'writing' | 'speaking' | 'failed' | 'offline';

/** A message arriving: a short, stiff rise (no overshoot); the fade is quicker than the travel. */
const MESSAGE_IN = {
  opacity: 1,
  y: 0,
  transition: { ...SPRING_SNAP, opacity: { duration: 0.16, ease: EASE.outQuint } },
};

/**
 * The conversation column: a status line that says what is happening, the
 * history (each message rises in once), inline notices with a cause icon,
 * and the composer whose send turns into a labelled stop while busy.
 */
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
  onDismissNotice,
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
    if (event.key === 'Escape' && busy) {
      event.preventDefault();
      onStop();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const live: Live =
    phase === 'connecting'
      ? 'connecting'
      : phase === 'thinking'
        ? 'thinking'
        : phase === 'writing'
          ? 'writing'
          : speaking
            ? 'speaking'
            : notice?.source === 'chat'
              ? notice.kind === 'not_configured'
                ? 'offline'
                : 'failed'
              : 'idle';

  const status = {
    connecting: t('status.connecting'),
    thinking: t('status.thinking', { name }),
    writing: t('status.writing', { name }),
    speaking: t('status.speaking', { name }),
    failed: t('status.failed'),
    offline: t('status.offline'),
    idle: voiceOn ? t('status.idle') : t('status.voiceOff'),
  }[live];

  const noticeText = notice
    ? notice.source === 'chat'
      ? t(`errors.${CHAT_ERROR_KEYS[notice.kind]}`)
      : t(`voice.${notice.kind}`)
    : undefined;
  const NoticeIcon = notice
    ? notice.source === 'chat'
      ? CHAT_ERROR_ICONS[notice.kind]
      : SpeakerSlashIcon
    : undefined;
  const canRetry =
    notice?.source === 'chat' &&
    notice.kind !== 'not_configured' &&
    notice.kind !== 'unauthenticated';

  return (
    <section aria-label={t('chat.title')} className="flex h-full min-h-0 flex-col">
      <header className="border-hairline flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-title text-ink">{t('chat.title')}</h2>
          <p
            role="status"
            className={cn(
              'text-label relative mt-1 flex min-w-0 items-center gap-2 transition-colors duration-200',
              live === 'failed' || live === 'offline'
                ? 'text-alert'
                : live === 'idle'
                  ? 'text-ink-muted'
                  : 'text-ink',
            )}
          >
            <StatusGlyph live={live} />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={status}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: SPRING_SOFT }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="truncate"
              >
                {status}
              </motion.span>
            </AnimatePresence>
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              aria-pressed={voiceOn}
              onClick={onToggleVoice}
              className={cn('shrink-0', !voiceOn && 'text-ink-muted')}
            >
              {voiceOn ? (
                <SpeakerHighIcon aria-hidden="true" />
              ) : (
                <SpeakerSlashIcon aria-hidden="true" />
              )}
              {t('chat.voice')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {voiceOn ? t('chat.voiceMute') : t('chat.voiceUnmute')}
          </TooltipContent>
        </Tooltip>
      </header>

      <div
        ref={log}
        role="log"
        aria-label={t('chat.log')}
        aria-busy={phase !== 'idle'}
        className="scroll-fade-y flex min-h-0 flex-1 scrollbar-none flex-col gap-5 overflow-y-auto px-5 py-6 [--fade-end:1rem]"
      >
        {messages.length === 0 ? (
          <div className="mt-auto flex flex-col gap-5">
            <div>
              <p className="font-headline text-subhead text-ink">
                {t('chat.empty.title', { name })}
              </p>
              <p className="text-body-sm text-ink-muted mt-2">{t('chat.empty.body')}</p>
            </div>
            <div className="stagger-in flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => submit(suggestion)}
                  className="rounded-tile border-hairline text-ui text-ink-muted hover:border-ink-faint hover:bg-paper-raised hover:text-ink h-9 border px-3.5 transition-[border-color,background-color,color,scale] duration-200 active:scale-[0.97] active:duration-100 disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => {
            const mine = message.role === 'user';
            return (
              <MessageRow
                key={index}
                mine={mine}
                author={mine ? t('chat.you') : name}
                content={message.content}
                streaming={!mine && index === messages.length - 1 && phase !== 'idle'}
              />
            );
          })
        )}
      </div>

      <AnimatePresence initial={false}>
        {notice && noticeText && NoticeIcon ? (
          <motion.div
            key={`${notice.source}-${notice.kind}`}
            role={notice.source === 'chat' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: SPRING_SOFT }}
            exit={{ opacity: 0, transition: { duration: 0.14, ease: EASE.inQuart } }}
            className="rounded-tile border-hairline bg-paper-raised mx-5 mb-3 flex items-start gap-3 border px-4 py-3"
          >
            <NoticeIcon
              className={cn(
                'mt-0.5 size-5 shrink-0',
                notice.source === 'chat' ? 'text-alert' : 'text-ink-muted',
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
                className="text-ink h-6 shrink-0"
              >
                {t('retry')}
              </Button>
            ) : null}
            {notice.source === 'voice' && onDismissNotice ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onDismissNotice}
                aria-label={t('chat.dismiss')}
                className="-mt-1 -mr-2 size-7 shrink-0"
              >
                <XIcon aria-hidden="true" />
              </Button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <form
        onSubmit={onSubmit}
        className="border-hairline border-t px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <label htmlFor={inputId} className="sr-only">
          {t('chat.inputLabel')}
        </label>
        <div className="rounded-control border-hairline bg-paper-raised focus-within:border-ink-faint flex items-end gap-2 border p-2 transition-colors duration-200">
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
            // While a reply is coming or being spoken, the send key becomes a labelled stop.
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => {
                onStop();
                input.current?.focus();
              }}
              aria-keyshortcuts="Escape"
              className="h-10 shrink-0"
            >
              <StopIcon weight="fill" aria-hidden="true" />
              {t('chat.stop')}
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="icon"
              disabled={!draft.trim()}
              aria-label={t('chat.send')}
              className="shrink-0"
            >
              <ArrowUpIcon weight="bold" aria-hidden="true" />
            </Button>
          )}
        </div>
        {/* Keyboard shortcuts only: touch screens have no Enter/Esc to press. */}
        <p id={hintId} className="text-label text-ink-faint mt-2 pointer-coarse:hidden">
          {busy ? t('chat.hintBusy') : t('chat.hint')}
        </p>
      </form>
    </section>
  );
}

/**
 * One message. Memoised on plain values: while a reply streams, only the
 * message being written re-renders, and each message animates in once.
 */
const MessageRow = memo(function MessageRow({
  mine,
  author,
  content,
  streaming,
}: {
  mine: boolean;
  author: string;
  content: string;
  streaming: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={MESSAGE_IN}
      className={cn('flex flex-col gap-1.5', mine ? 'items-end' : 'items-start')}
    >
      <span className="text-label text-ink-faint">{author}</span>
      {streaming && !content ? (
        // Nothing written yet: the reply is being thought, not lost.
        <ThinkingDots className="text-ink-muted h-7 px-1" />
      ) : (
        <p
          className={cn(
            'text-body max-w-[92%] whitespace-pre-wrap',
            mine
              ? 'rounded-control rounded-br-tile bg-paper-lift text-ink px-4 py-2.5'
              : 'text-ink',
          )}
        >
          {content}
          {streaming ? (
            <span
              aria-hidden="true"
              className="bg-ink-muted ml-0.5 inline-block h-[1.05em] w-0.5 translate-y-[0.15em] animate-pulse"
            />
          ) : null}
        </p>
      )}
    </motion.div>
  );
});

/** The status line's live mark: still dot, lifting dots, level meter or alert dot. */
function StatusGlyph({ live }: { live: Live }) {
  if (live === 'connecting' || live === 'thinking') {
    return <ThinkingDots className="text-cobalt h-3" />;
  }
  if (live === 'speaking') {
    return (
      <span aria-hidden="true" className="flex h-3 w-3.5 shrink-0 items-end gap-[2px]">
        {[0, 1, 2].map((bar) => (
          <span
            key={bar}
            className="bg-ink-muted animate-eq-bar h-full w-[3px] origin-bottom rounded-full"
            style={{ animationDelay: `${bar * 150}ms` }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        live === 'writing'
          ? 'bg-cobalt animate-pulse'
          : live === 'failed' || live === 'offline'
            ? 'bg-alert'
            : 'bg-ink-faint',
      )}
    />
  );
}

function ThinkingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center gap-1', className)}>
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="animate-dot-wave size-1.5 rounded-full bg-current"
          style={{ animationDelay: `${dot * 160}ms` }}
        />
      ))}
    </span>
  );
}
