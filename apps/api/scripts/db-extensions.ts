// Runs before `drizzle-kit push`, which syncs tables but never creates
// extensions. Idempotent, so it is safe on every push.
import { config } from "dotenv";
import pg from "pg";

config({ path: "../../.env" });

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgres://awb:awb@localhost:5433/awb",
});
await client.connect();
try {
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  console.log("[db] pgvector extension ready");
} finally {
  await client.end();
}
