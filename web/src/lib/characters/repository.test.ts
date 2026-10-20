// @vitest-environment node
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '@/lib/character/defaults';

const TEST_URI = 'mongodb://127.0.0.1:27018/ai-sims-test';

function isReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 500 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

const reachable = await isReachable('127.0.0.1', 27018);

// A minimal valid WebP container header (RIFF....WEBP) plus padding.
function webp(size = 64): Uint8Array {
  const data = new Uint8Array(size);
  data.set(new TextEncoder().encode('RIFF'), 0);
  data.set(new TextEncoder().encode('WEBP'), 8);
  return data;
}

describe.skipIf(!reachable)('character repository (local MongoDB)', () => {
  let repo: typeof import('./repository');
  let mongo: typeof import('@/lib/db/mongo');

  const userA = 'user-a';
  const userB = 'user-b';
  const config = () => createDefaultConfig('anime', 'female');

  beforeAll(async () => {
    vi.stubEnv('MONGODB_URI', TEST_URI);
    mongo = await import('@/lib/db/mongo');
    repo = await import('./repository');
    await mongo.getDb().dropDatabase();
  });

  afterAll(async () => {
    await mongo.getDb().dropDatabase();
    await mongo.getMongoClient().close();
    vi.unstubAllEnvs();
  });

  it('creates a character and derives style, base and schemaVersion from config', async () => {
    const created = await repo.createCharacter(userA, {
      name: '  Mika  ',
      config: createDefaultConfig('realistic', 'male'),
    });
    expect(created.name).toBe('Mika');
    expect(created.style).toBe('realistic');
    expect(created.base).toBe('male');
    expect(created.schemaVersion).toBe(1);
    expect(created.status).toBe('draft');
    expect(created.hasThumbnail).toBe(false);
  });

  it('lists only the user characters, newest update first', async () => {
    const first = await repo.createCharacter(userA, { name: 'list-1', config: config() });
    const second = await repo.createCharacter(userA, { name: 'list-2', config: config() });
    await repo.updateCharacter(userA, first.id, { name: 'list-1b' });

    const names = (await repo.listCharacters(userA)).map((c) => c.name);
    expect(names.indexOf('list-1b')).toBeLessThan(names.indexOf('list-2'));
    expect((await repo.listCharacters('nobody')).length).toBe(0);
    expect(second.userId).toBe(userA);
  });

  it('gets, updates and deletes own characters', async () => {
    const created = await repo.createCharacter(userA, { name: 'crud', config: config() });
    expect((await repo.getCharacter(userA, created.id))?.name).toBe('crud');

    const updated = await repo.updateCharacter(userA, created.id, {
      name: 'crud-2',
      status: 'finalized',
      config: createDefaultConfig('realistic', 'male'),
    });
    expect(updated).toMatchObject({
      name: 'crud-2',
      status: 'finalized',
      style: 'realistic',
      base: 'male',
    });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    expect(await repo.deleteCharacter(userA, created.id)).toBe(true);
    expect(await repo.getCharacter(userA, created.id)).toBeNull();
    expect(await repo.deleteCharacter(userA, created.id)).toBe(false);
  });

  it('treats malformed ids as not found', async () => {
    expect(await repo.getCharacter(userA, 'not-an-id')).toBeNull();
    expect(await repo.updateCharacter(userA, 'not-an-id', { name: 'x' })).toBeNull();
    expect(await repo.deleteCharacter(userA, 'not-an-id')).toBe(false);
  });

  it('isolates users: B cannot read, update or delete A characters', async () => {
    const mine = await repo.createCharacter(userA, { name: 'private', config: config() });
    await repo.saveThumbnail(userA, mine.id, webp());

    expect(await repo.getCharacter(userB, mine.id)).toBeNull();
    expect((await repo.listCharacters(userB)).some((c) => c.id === mine.id)).toBe(false);
    expect(await repo.updateCharacter(userB, mine.id, { name: 'hacked' })).toBeNull();
    expect(await repo.saveThumbnail(userB, mine.id, webp())).toBe(false);
    expect(await repo.getThumbnail(userB, mine.id)).toBeNull();
    expect(await repo.deleteCharacter(userB, mine.id)).toBe(false);

    const still = await repo.getCharacter(userA, mine.id);
    expect(still?.name).toBe('private');
    expect(await repo.getThumbnail(userA, mine.id)).not.toBeNull();
  });

  it('rejects an invalid config and invalid names on create and update', async () => {
    const bad = { ...config(), skin: { tone: 5 } };
    await expect(repo.createCharacter(userA, { name: 'bad', config: bad })).rejects.toThrow(
      repo.InvalidCharacterInputError,
    );
    await expect(repo.createCharacter(userA, { name: '', config: config() })).rejects.toThrow(
      repo.InvalidCharacterInputError,
    );
    await expect(
      repo.createCharacter(userA, { name: 'x'.repeat(41), config: config() }),
    ).rejects.toThrow(repo.InvalidCharacterInputError);

    const ok = await repo.createCharacter(userA, { name: 'ok', config: config() });
    await expect(repo.updateCharacter(userA, ok.id, { config: bad })).rejects.toThrow(
      repo.InvalidCharacterInputError,
    );
    expect((await repo.getCharacter(userA, ok.id))?.config.skin.tone).toBe(config().skin.tone);
  });

  it('stores thumbnails, enforces the size limit and removes them on delete', async () => {
    const created = await repo.createCharacter(userA, { name: 'thumb', config: config() });

    expect(await repo.saveThumbnail(userA, created.id, webp(1024))).toBe(true);
    expect((await repo.getCharacter(userA, created.id))?.hasThumbnail).toBe(true);
    const stored = await repo.getThumbnail(userA, created.id);
    expect(stored?.contentType).toBe('image/webp');
    expect(stored?.data.byteLength).toBe(1024);

    // Exactly at the limit is accepted, one byte over is rejected.
    expect(await repo.saveThumbnail(userA, created.id, webp(repo.MAX_THUMBNAIL_BYTES))).toBe(true);
    await expect(
      repo.saveThumbnail(userA, created.id, webp(repo.MAX_THUMBNAIL_BYTES + 1)),
    ).rejects.toMatchObject({ reason: 'too_large' });
    await expect(repo.saveThumbnail(userA, created.id, new Uint8Array(64))).rejects.toMatchObject({
      reason: 'not_webp',
    });

    await repo.deleteCharacter(userA, created.id);
    expect(await repo.getThumbnail(userA, created.id)).toBeNull();
  });
});
