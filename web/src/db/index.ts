import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });

let _dbClosed = false;
export const closeDb = async () => {
  if (_dbClosed) return;
  _dbClosed = true;
  await client.end({ timeout: 5 });
};
