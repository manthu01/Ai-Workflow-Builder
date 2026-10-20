import {
  RetrieveConfig,
  buildRetrievedContext,
  renderString,
  type RetrieveOutput,
  type RetrievedChunk,
} from "@awb/core";
import { env } from "../env.js";
import type { NodeExecutor } from "./types.js";

/**
 * Searches a knowledge base. The worker never touches Postgres, so the search
 * runs in the API over the internal endpoint - the same code path as the UI's
 * "Test search". Runs identically in dry and live mode: it only reads, and
 * local embeddings make no external calls.
 */
export const runRetrieve: NodeExecutor = async (node, ctx) => {
  const parsed = RetrieveConfig.safeParse(node.config);
  if (!parsed.success) {
    // Spelled out per field so self-heal can see exactly what to fix.
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message} (got ${JSON.stringify(node.config[i.path[0] as string])})`)
      .join("; ");
    throw new Error(`invalid retrieve config - ${detail}`);
  }
  const config = parsed.data;

  const query = renderString(config.query, ctx.outputs).trim();
  if (!query) {
    throw new Error(`retrieve query rendered empty (template: ${JSON.stringify(config.query)})`);
  }

  const res = await fetch(`${env.AWB_API_URL}/api/kbs/internal/${config.kbId}/search`, {
    method: "POST",
    headers: { "x-internal-token": env.INTERNAL_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({
      query,
      topK: config.topK,
      mode: config.mode,
      minScore: config.minScore,
      rerank: config.rerank,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    chunks?: RetrievedChunk[];
    tookMs?: number;
    error?: string;
  };
  if (!res.ok || !body.chunks) {
    throw new Error(`knowledge base search failed: ${body.error ?? `HTTP ${res.status}`}`);
  }

  const output: RetrieveOutput = {
    chunks: body.chunks,
    context: buildRetrievedContext(body.chunks),
    count: body.chunks.length,
  };
  const top = body.chunks[0];
  return {
    output,
    logs: [
      `${config.mode}${config.rerank ? " + rerank" : ""} search for ${JSON.stringify(query.slice(0, 120))}: ${output.count} chunk(s) in ${body.tookMs ?? "?"}ms`,
      ...(top ? [`top: ${top.document}${top.heading ? ` › ${top.heading}` : ""} (score ${top.score.toFixed(3)})`] : []),
      ...(output.count === 0 ? ["no chunks matched - the llm step will have no context"] : []),
    ],
  };
};
