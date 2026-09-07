import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs from apps/api; the shared .env lives at the repo root.
config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://awb:awb@localhost:5433/awb",
  },
});
