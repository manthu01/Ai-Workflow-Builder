import { ApiCallConfig, renderDeep, parseJsonObject } from "@awb/core";
import { resolveBlueprint, resolveConnection } from "../connections.js";
import type { NodeExecutor } from "./types.js";

/**
 * Calls one operation from an ingested OpenAPI blueprint. `args` supplies path,
 * query, and body parameters; an optional connection adds an auth header.
 */
export const runApiCall: NodeExecutor = async (node, ctx) => {
  const config = ApiCallConfig.parse(node.config);
  const bp = await resolveBlueprint(config.blueprintId);
  const op = bp.operations.find((o) => o.operationId === config.operationId);
  if (!op) {
    throw new Error(`operation "${config.operationId}" not found in the blueprint`);
  }

  const rawArgs = parseJsonObject(config.args, "api_call.args");
  const args = renderDeep(rawArgs, ctx.outputs) as Record<string, unknown>;

  // Path params: {name} -> args[name]
  let path = op.path;
  for (const p of op.params.filter((x) => x.in === "path")) {
    if (!(p.name in args)) throw new Error(`missing path param "${p.name}"`);
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(args[p.name])));
  }

  const url = new URL((bp.baseUrl.replace(/\/$/, "") || "") + path);
  for (const p of op.params.filter((x) => x.in === "query")) {
    if (p.name in args && args[p.name] != null) {
      url.searchParams.set(p.name, String(args[p.name]));
    }
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (config.connectionId) {
    const conn = await resolveConnection(config.connectionId);
    if (conn.kind !== "http_header") throw new Error("connection is not an HTTP header connection");
    headers[conn.secret.headerName] = conn.secret.headerValue;
  }

  const bodyParam = op.params.find((x) => x.in === "body");
  const hasBody = op.method !== "GET" && bodyParam && "body" in args;
  if (hasBody) headers["content-type"] = "application/json";

  if (ctx.mode === "dry") {
    return {
      output: {
        status: 200,
        ok: true,
        url: url.toString(),
        body: { mocked: true, operation: op.operationId },
      },
      logs: [`dry run: ${op.method} ${url.pathname} (${op.operationId}) not sent`],
    };
  }

  const res = await fetch(url, {
    method: op.method,
    headers,
    body: hasBody ? JSON.stringify(args.body) : undefined,
  });
  const ct = res.headers.get("content-type") ?? "";
  const payload = ct.includes("json") ? await res.json().catch(() => null) : await res.text();

  return {
    output: { status: res.status, ok: res.ok, url: url.toString(), body: payload },
    logs: [`${op.method} ${url.pathname} (${op.operationId}) -> ${res.status}`],
  };
};
