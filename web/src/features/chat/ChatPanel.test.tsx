import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpeechSink } from '@/features/chat/speechQueue';
import { ChatPanel, type ChatPanelProps } from './ChatPanel';

// The backend is a stubbed fetch and the player is a fake: no network, no audio.
const encoder = new TextEncoder();

function fakeSpeech() {
  return {
    load: vi.fn<SpeechSink['load']>(async () => undefined),
    // Clips "play" instantly so the queue drains on its own.
    play: vi.fn<SpeechSink['play']>(async (onEnded) => onEnded?.()),
    stop: vi.fn<SpeechSink['stop']>(),
  };
}

function chatReply(chunks: string[], provider = 'groq'): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'X-AI-Provider': provider } });
}

const ttsReply = (overrides: Record<string, unknown> = {}) =>
  Response.json({
    audio: btoa('audio'),
    mime: 'audio/mpeg',
    visemes: [{ time: 0, id: 6 }],
    words: [],
    ...overrides,
  });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function stubBackend(handlers: { chat: Handler; tts?: Handler }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === '/api/chat') return handlers.chat(url, init);
    if (url === '/api/tts' && handlers.tts) return handlers.tts(url, init);
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(props: Partial<ChatPanelProps> = {}) {
  const speech = props.speech ?? fakeSpeech();
  render(<ChatPanel speech={speech} voice="female" locale="tr" {...props} />);
  return speech as ReturnType<typeof fakeSpeech>;
}

function send(text: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

const bodyOf = (fetchMock: ReturnType<typeof stubBackend>, url: string) =>
  fetchMock.mock.calls
    .filter(([input]) => String(input) === url)
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // React reports act() problems and render errors through console.error.
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('ChatPanel', () => {
  describe('accessibility', () => {
    it('exposes a labelled region, a conversation log and a labelled input', () => {
      renderPanel();

      expect(screen.getByRole('region', { name: 'Chat with the character' })).toBeTruthy();
      expect(screen.getByRole('log', { name: 'Conversation' })).toBeTruthy();
      expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy();
    });

    it('only enables Send when there is something to send', () => {
      renderPanel();
      const button = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);

      fireEvent.change(screen.getByLabelText('Message'), { target: { value: '  ' } });
      expect(button.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Selam' } });
      expect(button.disabled).toBe(false);
    });

    it('limits the input to the 2000 characters the server accepts', () => {
      renderPanel();
      expect((screen.getByLabelText('Message') as HTMLInputElement).maxLength).toBe(2000);
    });
  });

  describe('a reply', () => {
    it('streams into the transcript, names the provider and clears the input', async () => {
      stubBackend({
        chat: () => chatReply(['Mer', 'haba! ', 'Nasılsın?'], 'gemini'),
        tts: () => ttsReply(),
      });
      renderPanel();

      send('Selam');

      expect(await screen.findByText('Merhaba! Nasılsın?')).toBeTruthy();
      expect(screen.getByText('Selam')).toBeTruthy();
      await screen.findByText('Last reply via gemini');
      expect((screen.getByLabelText('Message') as HTMLInputElement).value).toBe('');
    });

    it('sends the whole conversation on the next turn', async () => {
      const fetchMock = stubBackend({
        chat: () => chatReply(['Tamam.']),
        tts: () => ttsReply(),
      });
      renderPanel({ characterId: 'char-1' });

      send('Bir');
      await screen.findByText('Last reply via groq');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).toBeTruthy(),
      );
      send('İki');
      await waitFor(() => expect(bodyOf(fetchMock, '/api/chat')).toHaveLength(2));

      expect(bodyOf(fetchMock, '/api/chat')[1]).toEqual({
        messages: [
          { role: 'user', content: 'Bir' },
          { role: 'assistant', content: 'Tamam.' },
          { role: 'user', content: 'İki' },
        ],
        locale: 'tr',
        characterId: 'char-1',
      });
    });
  });

  describe('speech', () => {
    it('synthesizes each sentence with the chosen voice and locale, in order', async () => {
      const fetchMock = stubBackend({
        chat: () => chatReply(['Hello there! ', 'How are you today?']),
        tts: () => ttsReply(),
      });
      const speech = renderPanel({ voice: 'male', locale: 'en' });

      send('Hi');

      await waitFor(() => expect(speech.play).toHaveBeenCalledTimes(2));
      expect(bodyOf(fetchMock, '/api/tts')).toEqual([
        { text: 'Hello there!', voice: 'male', locale: 'en' },
        { text: 'How are you today?', voice: 'male', locale: 'en' },
      ]);
    });

    it('drives the mouth with viseme events when the voice provides them', async () => {
      stubBackend({
        chat: () => chatReply(['Merhaba.']),
        tts: () =>
          ttsReply({
            visemes: [{ time: 0, id: 21 }],
            words: [{ time: 0, duration: 1, text: 'Merhaba' }],
          }),
      });
      const speech = renderPanel();

      send('Selam');

      await waitFor(() => expect(speech.load).toHaveBeenCalledTimes(1));
      const [audio, script] = speech.load.mock.calls[0]!;
      expect(audio.byteLength).toBe(5);
      expect(script).toEqual({ events: [{ viseme: 'PP', time: 0 }] });
    });

    it('falls back to word boundaries when there are no viseme events', async () => {
      const words = [{ time: 0, duration: 0.6, text: 'Merhaba' }];
      stubBackend({
        chat: () => chatReply(['Merhaba.']),
        tts: () => ttsReply({ visemes: [], words }),
      });
      const speech = renderPanel();

      send('Selam');

      await waitFor(() => expect(speech.load).toHaveBeenCalledTimes(1));
      expect(speech.load.mock.calls[0]![1]).toEqual({ words });
    });

    it('does not ask for speech for text that is only emojis', async () => {
      const fetchMock = stubBackend({
        chat: () => chatReply(['Selam. ', '😊']),
        tts: () => ttsReply(),
      });
      const speech = renderPanel();

      send('Selam');

      await screen.findByText('Last reply via groq');
      await waitFor(() => expect(speech.play).toHaveBeenCalledTimes(1));
      expect(bodyOf(fetchMock, '/api/tts')).toHaveLength(1);
    });
  });

  describe('problems are shown inline', () => {
    it('explains when no AI provider is configured and keeps only the user message', async () => {
      stubBackend({
        chat: () => Response.json({ error: 'ai_not_configured' }, { status: 503 }),
      });
      renderPanel();

      send('Selam');

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('No AI provider is configured');
      expect(screen.getByText('Selam')).toBeTruthy();
      expect(screen.queryByText('…')).toBeNull(); // the empty reply bubble is gone
    });

    it('asks to sign in when the session is missing', async () => {
      stubBackend({ chat: () => Response.json({ error: 'unauthenticated' }, { status: 401 }) });
      renderPanel();

      send('Selam');

      expect((await screen.findByRole('alert')).textContent).toContain('not signed in');
    });

    it('says every provider failed on a 502', async () => {
      stubBackend({ chat: () => Response.json({ error: 'ai_unavailable' }, { status: 502 }) });
      renderPanel();

      send('Selam');

      expect((await screen.findByRole('alert')).textContent).toContain('Every AI provider failed');
    });

    it('reports an unreachable server', async () => {
      stubBackend({
        chat: () => {
          throw new TypeError('fetch failed');
        },
      });
      renderPanel();

      send('Selam');

      expect((await screen.findByRole('alert')).textContent).toContain(
        'Could not reach the server',
      );
    });

    it('falls back to text only, once, when voice is not configured', async () => {
      stubBackend({
        chat: () => chatReply(['Birinci cümle. ', 'İkinci cümle. ', 'Üçüncü cümle.']),
        tts: () => Response.json({ error: 'tts_not_configured' }, { status: 503 }),
      });
      const speech = renderPanel();

      send('Selam');

      expect(await screen.findByText('Birinci cümle. İkinci cümle. Üçüncü cümle.')).toBeTruthy();
      const notice = await screen.findByText(/Voice is not configured/);
      expect(notice.textContent).toContain('AZURE_SPEECH_KEY');
      await waitFor(() => expect(screen.queryByText('Speaking…')).toBeNull());
      expect(screen.getAllByText(/Voice is not configured/)).toHaveLength(1);
      expect(speech.load).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull(); // text-only mode is not an error
    });

    it('keeps the partial reply and says so when the stream is interrupted', async () => {
      stubBackend({
        chat: () => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('Merha'));
            },
            pull(controller) {
              controller.error(new TypeError('terminated'));
            },
          });
          return new Response(stream, { headers: { 'X-AI-Provider': 'groq' } });
        },
        tts: () => ttsReply(),
      });
      renderPanel();

      send('Selam');

      expect((await screen.findByRole('alert')).textContent).toContain('interrupted');
      expect(screen.getByText('Merha')).toBeTruthy();
    });

    it('reports a failed text-to-speech request without losing the text', async () => {
      stubBackend({
        chat: () => chatReply(['Merhaba.']),
        tts: () => Response.json({ error: 'tts_unavailable' }, { status: 502 }),
      });
      renderPanel();

      send('Selam');

      expect((await screen.findByRole('alert')).textContent).toContain('Text-to-speech failed');
      expect(screen.getByText('Merhaba.')).toBeTruthy();
    });
  });

  describe('stopping', () => {
    it('cancels the reply and the audio, and keeps what was already written', async () => {
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      stubBackend({
        chat: (_url, init) => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              streamController = controller;
              controller.enqueue(encoder.encode('Başladım, '));
              // A real fetch errors the body when its signal aborts.
              init.signal?.addEventListener('abort', () =>
                controller.error(new DOMException('Aborted', 'AbortError')),
              );
            },
          });
          return new Response(stream, { headers: { 'X-AI-Provider': 'groq' } });
        },
        tts: () => ttsReply(),
      });
      const speech = renderPanel();

      send('Selam');
      await screen.findByText('Başladım,');
      const stop = await screen.findByRole('button', { name: 'Stop' });

      fireEvent.click(stop);

      await screen.findByRole('button', { name: 'Send' });
      expect(speech.stop).toHaveBeenCalled();
      expect(screen.getByText('Başladım,')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull(); // a stop is not an error
      expect(streamController).toBeDefined();
    });

    it('does not start a second reply while one is running', async () => {
      const fetchMock = stubBackend({
        chat: () => new Response(new ReadableStream<Uint8Array>()), // never produces text
      });
      renderPanel();

      send('Bir');
      await screen.findByText('Thinking…');
      fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'İki' } });
      fireEvent.submit(screen.getByLabelText('Message').closest('form')!);

      expect(bodyOf(fetchMock, '/api/chat')).toHaveLength(1);
    });
  });
});
