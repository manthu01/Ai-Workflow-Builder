import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { getEmbedder } from "../embeddings.js";
import { newId } from "../id.js";
import { startIngestion } from "./ingest.js";

/** Fixed id so the built-in "Answer from the handbook" template can point at it. */
export const SAMPLE_KB_ID = "kb_sample_handbook";
const SAMPLE_KB_NAME = "Sample: Northwind employee handbook";

// Same relative path from src/kb/ (tsx) and dist/kb/ (built).
const SEED_DIR = fileURLToPath(new URL("../../seed-kb/", import.meta.url));

/**
 * Creates the sample knowledge base from apps/api/seed-kb/*.md on first boot.
 * On later boots, re-queues any sample document that isn't ready (e.g. the
 * first boot happened before Temporal was up). Deleting the KB re-seeds it on
 * the next boot.
 */
export async function seedSampleKnowledgeBase(): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(schema.knowledgeBases)
      .where(eq(schema.knowledgeBases.id, SAMPLE_KB_ID));

    if (existing) {
      const stale = await db
        .select({ id: schema.kbDocuments.id })
        .from(schema.kbDocuments)
        .where(and(eq(schema.kbDocuments.kbId, SAMPLE_KB_ID), ne(schema.kbDocuments.status, "ready")));
      for (const doc of stale) await startIngestion(SAMPLE_KB_ID, doc.id);
      if (stale.length) console.log(`[seed] re-queued ${stale.length} sample KB document(s)`);
      return;
    }

    const embedder = getEmbedder();
    await db.insert(schema.knowledgeBases).values({
      id: SAMPLE_KB_ID,
      name: SAMPLE_KB_NAME,
      description:
        "HR and company policies: time off, expenses and travel, remote work, IT and security, benefits and pay.",
      embeddingModel: embedder.id,
      dimensions: embedder.dimensions,
    });

    const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith(".md")).sort();
    for (const filename of files) {
      const id = newId("doc");
      await db.insert(schema.kbDocuments).values({
        id,
        kbId: SAMPLE_KB_ID,
        filename,
        mimeType: "text/markdown",
        source: await readFile(SEED_DIR + filename),
      });
      await startIngestion(SAMPLE_KB_ID, id);
    }
    console.log(`[seed] created sample knowledge base with ${files.length} documents`);
  } catch (err) {
    console.error("[seed] sample knowledge base seed failed", err);
  }
}
