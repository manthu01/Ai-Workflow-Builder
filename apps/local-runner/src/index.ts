import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execAsync = promisify(exec);

const env = z
  .object({
    AWB_API_URL: z.string().default("http://localhost:8787"),
    LOCAL_RUNNER_TOKEN: z.string().default("dev-local-runner-token"),
    LOCAL_RUNNER_POLL_MS: z.coerce.number().default(2000),
    LOCAL_RUNNER_TIMEOUT_MS: z.coerce.number().default(120_000),
  })
  .parse(process.env);

interface Task {
  id: string;
  command: string;
  nodeId: string;
}

async function poll(): Promise<Task[]> {
  const res = await fetch(
    `${env.AWB_API_URL}/api/local-tasks/pending?token=${env.LOCAL_RUNNER_TOKEN}`,
  );
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return ((await res.json()) as { tasks: Task[] }).tasks;
}

async function report(
  id: string,
  body: { stdout: string; stderr: string; exitCode: number },
): Promise<void> {
  await fetch(`${env.AWB_API_URL}/api/local-tasks/${id}/result`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runner-token": env.LOCAL_RUNNER_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

async function runTask(task: Task): Promise<void> {
  console.log(`[runner] ${task.nodeId}: ${task.command}`);
  try {
    const { stdout, stderr } = await execAsync(task.command, {
      timeout: env.LOCAL_RUNNER_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    await report(task.id, { stdout, stderr, exitCode: 0 });
    console.log(`[runner] ${task.nodeId}: done`);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    await report(task.id, {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "command failed",
      exitCode: typeof e.code === "number" ? e.code : 1,
    });
    console.log(`[runner] ${task.nodeId}: exit ${e.code ?? 1}`);
  }
}

async function main(): Promise<void> {
  console.log(
    `[runner] polling ${env.AWB_API_URL} every ${env.LOCAL_RUNNER_POLL_MS}ms — commands run in ${process.cwd()}`,
  );
  for (;;) {
    try {
      const tasks = await poll();
      await Promise.all(tasks.map(runTask));
    } catch (err) {
      console.error("[runner]", (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, env.LOCAL_RUNNER_POLL_MS));
  }
}

void main();
