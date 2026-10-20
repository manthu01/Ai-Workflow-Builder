import { eq } from "drizzle-orm";
import { IngestDocumentWorkflowType, type IngestDocumentInput } from "@awb/core";
import { db, schema } from "../db/client.js";
import { env } from "../env.js";
import { getTemporalClient } from "../temporal/client.js";

/**
 * Starts (or restarts) the ingestDocument workflow for a stored document. On
 * failure the document is marked failed with the reason, so the UI shows it
 * and the user can retry. Returns whether the workflow started.
 */
export async function startIngestion(kbId: string, documentId: string): Promise<boolean> {
  await db
    .update(schema.kbDocuments)
    .set({ status: "pending", error: null })
    .where(eq(schema.kbDocuments.id, documentId));
  try {
    const client = await getTemporalClient();
    const input: IngestDocumentInput = { kbId, documentId };
    await client.workflow.start(IngestDocumentWorkflowType, {
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      // Unique per attempt, so a retry never collides with an earlier execution.
      workflowId: `kb-ingest-${documentId}-${Date.now()}`,
      args: [input],
    });
    return true;
  } catch (err) {
    await db
      .update(schema.kbDocuments)
      .set({ status: "failed", error: `could not start ingestion: ${(err as Error).message}` })
      .where(eq(schema.kbDocuments.id, documentId));
    return false;
  }
}
