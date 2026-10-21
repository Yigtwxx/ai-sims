// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connection: vi.fn(async () => undefined) }));
vi.mock('next/server', () => ({ connection: mocks.connection }));

// The route resolves its file from the working directory when it loads.
const root = mkdtempSync(path.join(tmpdir(), 'ai-sims-curation-'));
const folder = path.join(root, 'public', 'assets', 'mh');
const file = path.join(folder, 'curation.json');
const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
const { GET, PUT } = await import('./route');
cwd.mockRestore();

const pick = {
  keep: 'groom.eyebrows.Eyebrows_M_SlightArch',
  keepLabel: 'Medium Slight Arch Eyebrows',
  distance: 0.31,
  unit: 'mm',
};

const put = (body: unknown) =>
  PUT(
    new Request('http://localhost/api/dev/curation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const onDisk = () => JSON.parse(readFileSync(file, 'utf8')) as unknown;

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/dev/curation', () => {
  it('returns the hidden ids and the pre-pass picks', async () => {
    const curation = {
      hidden: ['groom.eyebrows.Eyebrows_M_Thin'],
      auto: { 'groom.eyebrows.Eyebrows_M_Thin': pick },
    };
    writeFileSync(file, JSON.stringify(curation));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(curation);
  });

  it('reads an older file and a missing one as no picks', async () => {
    expect(await (await GET()).json()).toEqual({ hidden: [], auto: {} });
    writeFileSync(file, JSON.stringify({ hidden: ['a'] }));
    expect(await (await GET()).json()).toEqual({ hidden: ['a'], auto: {} });
  });

  it('is not served outside next dev', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await GET()).status).toBe(404);
  });
});

describe('PUT /api/dev/curation', () => {
  it('replaces the hidden ids and keeps the pre-pass picks on disk', async () => {
    const auto = { 'groom.eyebrows.Eyebrows_M_Thin': pick };
    writeFileSync(file, JSON.stringify({ hidden: ['groom.eyebrows.Eyebrows_M_Thin'], auto }));

    // The curator restored the pick and hid two others (one twice).
    const response = await put({ hidden: ['face.Bruce', 'face.Ada', 'face.Bruce'] });

    expect(response.status).toBe(200);
    const expected = { hidden: ['face.Ada', 'face.Bruce'], auto };
    expect(await response.json()).toEqual(expected);
    expect(onDisk()).toEqual(expected);
  });

  it('ignores picks sent by the client', async () => {
    writeFileSync(file, JSON.stringify({ hidden: [], auto: { a: pick } }));

    const response = await put({ hidden: ['b'], auto: { b: pick } });

    expect(response.status).toBe(200);
    expect(onDisk()).toEqual({ hidden: ['b'], auto: { a: pick } });
  });

  it('creates the file with no picks when there is none', async () => {
    const response = await put({ hidden: ['a'] });

    expect(response.status).toBe(200);
    expect(onDisk()).toEqual({ hidden: ['a'], auto: {} });
  });

  it('never overwrites a file it cannot read', async () => {
    writeFileSync(file, '{ not json');

    const response = await put({ hidden: ['a'] });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'curation_unreadable' });
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('still validates the ids and the body size', async () => {
    expect((await put({ hidden: ['../escape'] })).status).toBe(400);
    expect((await put({ hidden: 'a' })).status).toBe(400);
    const huge = await put({ hidden: Array.from({ length: 30_000 }, (_, i) => `id.${i}`) });
    expect([400, 413]).toContain(huge.status);
  });
});
