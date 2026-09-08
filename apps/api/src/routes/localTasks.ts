import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { LocalResultSignalName } from "@awb/core";
import { db, schema } from "../db/client.js";
import { newId } from "../id.js";
import { env } from "../env.js";
import { getTemporalClient } from "../temporal/client.js";

export const localTaskRoutes = new Hono();

const runnerAuthed = (c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }) =>
  (c.req.header("x-runner-token") ?? c.req.query("token")) === env.LOCAL_RUNNER_TOKEN;

/** Internal (worker): enqueue a local task for the runner to pick up. */
localTaskRoutes.post("/internal", async (c) => {
  if (c.req.header("x-internal-token") !== env.INTERNAL_TOKEN) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = z
    .object({
      runId: z.string(),
      nodeId: z.string(),
      temporalWorkflowId: z.string(),
      command: z.string(),
    })
    .parse(await c.req.json());
  const [row] = await db
    .insert(schema.localTasks)
    .values({ id: newId("lt"), ...body })
    .returning();
  return c.json({ task: { id: row!.id } });
});

/** Runner: poll for pending tasks. */
localTaskRoutes.get("/pending", async (c) => {
  if (!runnerAuthed(c)) return c.json({ error: "forbidden" }, 403);
  const rows = await db
    .select()
    .from(schema.localTasks)
    .where(eq(schema.localTasks.status, "pending"));
  if (rows.length > 0) {
    // Claim them so a subsequent poll doesn't hand the same task out twice.
    await db
      .update(schema.localTasks)
      .set({ status: "running" })
      .where(inArray(schema.localTasks.id, rows.map((r) => r.id)));
  }
  return c.json({
    tasks: rows.map((r) => ({ id: r.id, command: r.command, nodeId: r.nodeId })),
  });
});

/** Runner: report a task's result; signals the paused workflow. */
localTaskRoutes.post("/:id/result", async (c) => {
  if (!runnerAuthed(c)) return c.json({ error: "forbidden" }, 403);
  const body = z
    .object({
      stdout: z.string().default(""),
      stderr: z.string().default(""),
      exitCode: z.number().default(0),
    })
    .parse(await c.req.json().catch(() => ({})));

  const [task] = await db
    .select()
    .from(schema.localTasks)
    .where(eq(schema.localTasks.id, c.req.param("id")));
  if (!task) return c.json({ error: "not found" }, 404);

  await db
    .update(schema.localTasks)
    .set({ status: body.exitCode === 0 ? "done" : "error", result: body })
    .where(eq(schema.localTasks.id, task.id));

  try {
    const client = await getTemporalClient();
    await client.workflow
      .getHandle(task.temporalWorkflowId)
      .signal(LocalResultSignalName, {
        nodeId: task.nodeId,
        stdout: body.stdout,
        stderr: body.stderr,
        exitCode: body.exitCode,
      });
  } catch (err) {
    return c.json({ error: `could not signal run: ${(err as Error).message}` }, 502);
  }
  return c.json({ ok: true });
});
