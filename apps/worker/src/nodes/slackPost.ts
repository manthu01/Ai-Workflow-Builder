import { SlackPostConfig, renderString } from "@awb/core";
import { env } from "../env.js";
import type { NodeExecutor } from "./types.js";

export const runSlackPost: NodeExecutor = async (node, ctx) => {
  const config = SlackPostConfig.parse(node.config);
  const channel = renderString(config.channel, ctx.outputs);
  const text = renderString(config.text, ctx.outputs);

  if (ctx.mode === "dry") {
    return {
      output: { delivered: false, channel, text },
      logs: [`dry run: would post to ${channel} (${text.length} chars) - not sent`],
    };
  }

  if (!env.SLACK_BOT_TOKEN) {
    throw new Error("slack_post live run needs SLACK_BOT_TOKEN");
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, text }),
  });
  const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
  if (!data.ok) throw new Error(`slack error: ${data.error}`);

  return {
    output: { delivered: true, channel, ts: data.ts },
    logs: [`posted to ${channel} (ts ${data.ts})`],
  };
};
