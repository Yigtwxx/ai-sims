'use client';

import { useGSAP } from '@gsap/react';
import { PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SplitText } from '@/components/reactbits/SplitText';
import { cn } from '@/lib/utils';

import {
  analyseSpeech,
  buildTimeline,
  envelope,
  indexAt,
  VISEMES,
  waveformPeaks,
  type TimedViseme,
  type TimedWord,
  type VisemeId,
} from './timeline';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Waveform bars: fewer on narrow screens so each bar stays readable. */
const barCount = () => (window.innerWidth < 640 ? 52 : 88);
const FRAME_SECONDS = 0.02;

type Status = 'idle' | 'loading' | 'ready' | 'playing' | 'error';

interface Analysis {
  duration: number;
  peaks: number[];
  words: TimedWord[];
  visemes: TimedViseme[];
}

interface TalkDemoProps {
  id: string;
  audioSrc: string;
  transcript: string;
}

const formatTime = (seconds: number) => {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole % 60).toFixed(1).padStart(4, '0')}`;
};

/**
 * Talking demo: the sample recording as a waveform with a playhead, a
 * karaoke-style subtitle that fills word by word, and a 15-cell viseme meter.
 * Press "Dinle" to hear it; otherwise scrolling through the section scrubs
 * the same timeline (pinned on desktop). Timing comes from timeline.ts.
 */
export function TalkDemo({ id, audioSrc, transcript }: TalkDemoProps) {
  const t = useTranslations('Landing.talk');
  const section = useRef<HTMLElement>(null);
  const pinTarget = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const playedLayer = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const timecode = useRef<HTMLSpanElement>(null);
  const wordEls = useRef<(HTMLSpanElement | null)[]>([]);
  const raf = useRef(0);

  const [status, setStatus] = useState<Status>('idle');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [activeWord, setActiveWord] = useState(-1);
  const [activeViseme, setActiveViseme] = useState<VisemeId>('sil');

  const fallbackWords = useMemo(() => transcript.split(/\s+/).filter(Boolean), [transcript]);

  // Decode the recording once the section is near, to draw the real waveform and time the words.
  useEffect(() => {
    const el = section.current;
    if (!el) return undefined;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setStatus('loading');
        void (async () => {
          try {
            const response = await fetch(audioSrc);
            if (!response.ok) throw new Error(`audio ${response.status}`);
            const buffer = await response.arrayBuffer();
            const context = new OfflineAudioContext(1, 1, 44100);
            const decoded = await context.decodeAudioData(buffer);
            const frames = envelope(decoded.getChannelData(0), decoded.sampleRate, FRAME_SECONDS);
            const { speech, pauses } = analyseSpeech(frames, FRAME_SECONDS);
            const words = buildTimeline(transcript, speech, pauses);
            if (cancelled) return;
            setAnalysis({
              duration: decoded.duration,
              peaks: waveformPeaks(frames, barCount()),
              words,
              visemes: words.flatMap((word) => word.visemes),
            });
            setStatus('ready');
          } catch {
            if (!cancelled) setStatus('error');
          }
        })();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [audioSrc, transcript]);

  /** Moves every time-driven part of the UI to `time` (seconds). */
  const showTime = useCallback(
    (time: number) => {
      if (!analysis) return;
      const progress = Math.min(1, Math.max(0, time / analysis.duration));
      playedLayer.current?.style.setProperty('clip-path', `inset(0 ${(1 - progress) * 100}% 0 0)`);
      playhead.current?.style.setProperty('left', `${progress * 100}%`);
      if (timecode.current) timecode.current.textContent = formatTime(time);

      const wordIndex = indexAt(analysis.words, time);
      const word = analysis.words[wordIndex];
      const inWord = word && time < word.end;
      setActiveWord(wordIndex);
      const element = wordIndex >= 0 ? wordEls.current[wordIndex] : null;
      if (element && word) {
        const fill = inWord ? (time - word.start) / Math.max(0.001, word.end - word.start) : 1;
        element.style.setProperty('--fill', fill.toFixed(3));
      }
      const visemeIndex = indexAt(analysis.visemes, time);
      const viseme = analysis.visemes[visemeIndex];
      setActiveViseme(viseme && time < viseme.end ? viseme.id : 'sil');
    },
    [analysis],
  );

  // Playback loop: only runs while audio plays.
  useEffect(() => {
    if (status !== 'playing') return undefined;
    const tick = () => {
      const element = audio.current;
      if (element) showTime(element.currentTime);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [status, showTime]);

  // Scroll scrub (pinned on desktop) while the audio is not playing.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useGSAP(
    () => {
      if (!analysis || !pinTarget.current) return;
      const media = gsap.matchMedia();
      const scrub = (self: ScrollTrigger) => {
        if (statusRef.current === 'playing') return;
        showTime(self.progress * analysis.duration);
      };
      media.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        ScrollTrigger.create({
          trigger: pinTarget.current,
          start: 'top top',
          end: '+=110%',
          pin: true,
          onUpdate: scrub,
        });
      });
      media.add('(max-width: 1023px) and (prefers-reduced-motion: no-preference)', () => {
        ScrollTrigger.create({
          trigger: pinTarget.current,
          start: 'top 70%',
          end: 'bottom 40%',
          onUpdate: scrub,
        });
      });
      return () => media.revert();
    },
    { dependencies: [analysis, showTime], scope: section },
  );

  const toggle = async () => {
    const element = audio.current;
    if (!element || !analysis) return;
    if (status === 'playing') {
      element.pause();
      setStatus('ready');
      return;
    }
    try {
      if (element.ended || element.currentTime >= analysis.duration - 0.05) element.currentTime = 0;
      await element.play();
      setStatus('playing');
    } catch {
      setStatus('error');
    }
  };

  const onEnded = () => {
    setStatus('ready');
    if (analysis) showTime(analysis.duration);
  };

  const words = analysis?.words.map((word) => word.text) ?? fallbackWords;
  const playing = status === 'playing';
  const canPlay = analysis !== null && status !== 'error';

  return (
    <section ref={section} id={id} aria-labelledby="talk-title" className="relative">
      <div
        ref={pinTarget}
        className="py-section mx-auto flex max-w-[1440px] flex-col justify-center px-5 md:px-8 lg:min-h-[100dvh] lg:px-12 lg:py-24"
      >
        <SplitText
          as="h2"
          id="talk-title"
          text={t('title')}
          className="font-headline text-headline text-ink max-w-[20ch]"
        />
        <p className="text-lede text-ink-muted mt-5 max-w-[48ch]">{t('lede')}</p>

        <div className="rounded-tile border-hairline bg-backstage-deep relative mt-12 overflow-hidden border md:mt-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_90%_at_50%_100%,rgb(255_226_176/0.08),transparent_70%)]"
          />

          <div className="border-hairline relative flex flex-wrap items-center gap-x-5 gap-y-3 border-b px-5 py-4 md:px-8">
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={!canPlay}
              aria-label={playing ? t('pause') : t('play')}
              className="rounded-control bg-marquee text-ui text-backstage hover:bg-marquee-deep inline-flex h-11 items-center gap-2.5 pr-5 pl-4 font-semibold transition-[background-color,scale] duration-200 active:scale-[0.97] active:duration-100 disabled:cursor-progress disabled:opacity-60"
            >
              {playing ? (
                <PauseIcon weight="fill" aria-hidden="true" className="size-4" />
              ) : (
                <PlayIcon weight="fill" aria-hidden="true" className="size-4" />
              )}
              {playing ? t('pause') : t('play')}
            </button>
            <p className="text-ui text-ink-muted">{t('sample')}</p>
            <p className="text-label text-ink-faint ml-auto tabular-nums" aria-hidden="true">
              <span ref={timecode}>0:00.0</span>
              {analysis ? ` / ${formatTime(analysis.duration)}` : null}
            </p>
          </div>

          {/* Waveform: faint bars, an amber copy clipped to the played part, a playhead. */}
          <div
            role="img"
            aria-label={t('waveformLabel')}
            className="relative mx-5 mt-8 h-24 md:mx-8 md:h-32"
          >
            {analysis ? (
              <>
                <Bars peaks={analysis.peaks} className="text-hairline" />
                <div
                  ref={playedLayer}
                  className="absolute inset-0"
                  style={{ clipPath: 'inset(0 100% 0 0)' }}
                >
                  <Bars peaks={analysis.peaks} className="text-marquee" />
                </div>
                <div
                  ref={playhead}
                  aria-hidden="true"
                  className="bg-ink/80 absolute inset-y-[-8px] left-0 w-px"
                />
                {analysis.words.map((word, index) => (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="bg-ink-faint/70 absolute -bottom-3 h-1.5 w-px"
                    style={{ left: `${(word.start / analysis.duration) * 100}%` }}
                  />
                ))}
              </>
            ) : (
              <div className="bg-hairline absolute inset-x-0 top-1/2 h-px" />
            )}
          </div>

          {/* Karaoke subtitle. */}
          <p
            lang="tr"
            className="font-headline text-subhead text-ink-faint relative mx-auto mt-12 max-w-[34ch] px-5 text-center md:mt-14"
          >
            {words.map((word, index) => {
              const past = index < activeWord;
              const current = index === activeWord;
              return (
                <span key={index}>
                  <span
                    ref={(node) => {
                      wordEls.current[index] = node;
                    }}
                    className={cn(
                      'relative inline-block transition-colors duration-150',
                      (past || current) && 'text-ink',
                    )}
                  >
                    {word}
                    <span
                      aria-hidden="true"
                      className="bg-marquee absolute inset-x-0 -bottom-1 h-0.5 origin-left rounded-full"
                      style={{
                        transform: current ? 'scaleX(var(--fill, 0))' : 'scaleX(0)',
                        opacity: current ? 1 : 0,
                      }}
                    />
                  </span>{' '}
                </span>
              );
            })}
          </p>

          {/* Viseme meter. */}
          <div className="border-hairline relative mt-10 border-t px-5 py-5 md:px-8">
            <p className="text-label text-ink-faint">{t('visemeLabel')}</p>
            <ul className="mt-3 grid grid-cols-5 gap-1.5 sm:grid-cols-[repeat(15,minmax(0,1fr))]">
              {VISEMES.map((viseme) => {
                const on = viseme === activeViseme && (status === 'playing' || activeWord >= 0);
                return (
                  <li
                    key={viseme}
                    className={cn(
                      'rounded-tile text-label flex h-9 items-center justify-center border font-mono transition-colors duration-100',
                      on
                        ? 'border-marquee bg-marquee text-backstage'
                        : 'border-hairline text-ink-faint',
                    )}
                  >
                    {viseme}
                  </li>
                );
              })}
            </ul>
          </div>

          {status === 'loading' ? (
            <p role="status" className="sr-only">
              {t('loading')}
            </p>
          ) : null}
          {status === 'error' ? (
            <p role="alert" className="text-ui text-alert relative px-5 pb-5 md:px-8">
              {t('error')}
            </p>
          ) : null}
        </div>
      </div>
      <audio ref={audio} src={audioSrc} preload="none" onEnded={onEnded} />
    </section>
  );
}

function Bars({ peaks, className }: { peaks: number[]; className?: string }) {
  const width = 1000;
  const height = 100;
  const step = width / peaks.length;
  const bar = step * 0.42;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn('absolute inset-0 size-full', className)}
    >
      {peaks.map((peak, index) => {
        const h = Math.max(2, peak * height * 0.92);
        return (
          <rect
            key={index}
            x={index * step + (step - bar) / 2}
            y={(height - h) / 2}
            width={bar}
            height={h}
            rx={bar / 2}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
