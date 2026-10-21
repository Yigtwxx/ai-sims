import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig } from '@/lib/character/defaults';
import type { SaveCharacterInput, SaveCharacterResult } from '@/lib/characters/saveActions';

import { snapshotOf, useCreatorStore } from './store';
import { useAutosave } from './useAutosave';

// The server action is a controllable fake: each call waits until the test settles it.
const calls: { input: SaveCharacterInput; settle: (result: SaveCharacterResult) => void }[] = [];
vi.mock('@/lib/characters/saveActions', () => ({
  saveCharacterAction: (input: SaveCharacterInput) =>
    new Promise<SaveCharacterResult>((resolve) => calls.push({ input, settle: resolve })),
}));

const flushMicrotasks = () => act(async () => undefined);

function setup() {
  const onCreated = vi.fn();
  const hook = renderHook(() =>
    useAutosave({ enabled: true, id: undefined, status: 'draft', onCreated }),
  );
  return { hook, onCreated };
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    useCreatorStore.setState({
      name: 'Ada',
      config: createDefaultConfig('female'),
      savedSnapshot: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('never overlaps saves, so Done reuses the id the draft save created', async () => {
    const { hook, onCreated } = setup();
    await act(async () => vi.advanceTimersByTime(1400));
    expect(calls).toHaveLength(1);
    expect(calls[0].input.id).toBeUndefined();

    // Done while the draft save is still running.
    let finalized: Promise<unknown> = Promise.resolve();
    act(() => {
      finalized = hook.result.current.save('finalized');
    });
    await flushMicrotasks();
    expect(calls).toHaveLength(1);

    await act(async () => calls[0].settle({ ok: true, id: 'c1' }));
    await flushMicrotasks();
    expect(calls).toHaveLength(2);
    expect(calls[1].input).toMatchObject({ id: 'c1', status: 'finalized' });

    await act(async () => calls[1].settle({ ok: true, id: 'c1' }));
    await act(async () => finalized);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith('c1');
  });

  it('marks the snapshot it sent, so an edit made during the save stays pending', async () => {
    const { hook } = setup();
    await act(async () => vi.advanceTimersByTime(1400));
    const sent = snapshotOf('Ada', useCreatorStore.getState().config);

    act(() => useCreatorStore.getState().setName('Ada Lovelace'));
    await act(async () => calls[0].settle({ ok: true, id: 'c1' }));
    await flushMicrotasks();

    expect(useCreatorStore.getState().savedSnapshot).toBe(sent);
    expect(hook.result.current.status).toBe('pending');
  });

  it('writes a pending change when the editor unmounts', async () => {
    const { hook } = setup();
    hook.unmount();
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
    expect(calls[0].input.name).toBe('Ada');
  });
});
