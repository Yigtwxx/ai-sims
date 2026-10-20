import 'server-only';
import { MongoClient, type Db } from 'mongodb';
import { requireMongoEnv } from '@/lib/env';

// Cache the client on globalThis in dev so HMR does not open a new pool per reload.
const globalForMongo = globalThis as typeof globalThis & { __mongoClient?: MongoClient };

let productionClient: MongoClient | undefined;

/** Returns the process-wide MongoClient. The driver connects lazily on first operation. */
export function getMongoClient(): MongoClient {
  const { uri } = requireMongoEnv();

  if (process.env.NODE_ENV === 'production') {
    productionClient ??= new MongoClient(uri);
    return productionClient;
  }
  globalForMongo.__mongoClient ??= new MongoClient(uri);
  return globalForMongo.__mongoClient;
}

/** Returns the database named in MONGODB_URI. */
export function getDb(): Db {
  return getMongoClient().db();
}
