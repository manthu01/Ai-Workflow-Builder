import { HttpRequestConfig, renderString, parseJsonObject } from "@awb/core";
import type { NodeExecutor } from "./types.js";

export const runHttpRequest: NodeExecutor = async (node, ctx) => {
  const config = HttpRequestConfig.parse(node.config);
  const url = renderString(config.url, ctx.outputs);
  const headers = parseJsonObject(renderString(config.headers, ctx.outputs), "http.headers") as Record<string, string>;
  const bodyObj = parseJsonObject(renderString(config.body, ctx.outputs), "http.body");
  const hasBody = config.method !== "GET" && Object.keys(bodyObj).length > 0;

  if (ctx.mode === "dry") {
    return {
      output: {
        status: 200,
        ok: true,
        url,
        body: { mocked: true, echo: hasBody ? bodyObj : null },
      },
      logs: [`dry run: ${config.method} ${url} not sent (mocked 200)`],
    };
  }

  const res = await fetch(url, {
    method: config.method,
    headers: { ...headers, ...(hasBody ? { "content-type": "application/json" } : {}) },
    body: hasBody ? JSON.stringify(bodyObj) : undefined,
  });
  const contentType = res.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text();

  return {
    output: { status: res.status, ok: res.ok, url, body: payload },
    logs: [`${config.method} ${url} -> ${res.status}`],
  };
};
