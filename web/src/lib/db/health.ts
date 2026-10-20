import 'server-only';
import { getMongoEnv } from '@/lib/env';
import { getDb } from './mongo';

async function ping(): Promise<boolean> {
  try {
    await getDb().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when MongoDB answers a ping. Returns false without touching the network
 * when MONGODB_URI is missing, and gives up after `timeoutMs` (the driver
 * itself would wait 30 s for server selection).
 */
export async function isDatabaseReachable(timeoutMs = 1500): Promise<boolean> {
  if (getMongoEnv() === null) return false;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([ping(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
