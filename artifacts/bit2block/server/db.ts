import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

export let pool: Pool | undefined;
export let db: any;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required; BIT2BLOCK cannot start without PostgreSQL.");
}

pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});
db = drizzle(pool, { schema });
