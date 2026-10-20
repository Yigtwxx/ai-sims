// Stops the dev MongoDB started by db-start.mjs with a clean `shutdown` command,
// which works the same on every platform (unlike `mongod --shutdown`).
import { MongoClient } from 'mongodb';

const uri = 'mongodb://127.0.0.1:27018/?directConnection=true&serverSelectionTimeoutMS=2000';
const client = new MongoClient(uri);

try {
  await client.connect();
} catch {
  console.log('mongod is not running on 127.0.0.1:27018');
  process.exit(0);
}

try {
  await client.db('admin').command({ shutdown: 1 });
} catch {
  // The server closes the connection while shutting down; that is the success path.
}
await client.close().catch(() => {});
console.log('mongod on 127.0.0.1:27018 stopped');
