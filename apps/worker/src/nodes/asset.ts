import { AssetConfig, renderString } from "@awb/core";
import type { NodeExecutor } from "./types.js";

const esc = (s: string) =>
  s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const wrap = (text: string, perLine: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine && cur) {
      lines.push(cur.trim());
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur.trim());
  return lines.slice(0, 4);
};

const DIMS = {
  card: { w: 1200, h: 630 },
  badge: { w: 420, h: 120 },
  banner: { w: 1500, h: 500 },
};

function build(
  template: "card" | "badge" | "banner",
  title: string,
  subtitle: string,
  color: string,
): string {
  const { w, h } = DIMS[template];
  const c = esc(color);

  if (template === "badge") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" rx="16" fill="#0e1116"/>
<rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="12" fill="none" stroke="${c}" stroke-width="3"/>
<circle cx="52" cy="${h / 2}" r="22" fill="${c}"/>
<text x="92" y="${h / 2 - 4}" fill="#e6edf3" font-family="system-ui,sans-serif" font-size="26" font-weight="700">${esc(title).slice(0, 26)}</text>
<text x="92" y="${h / 2 + 26}" fill="#8b949e" font-family="system-ui,sans-serif" font-size="16">${esc(subtitle).slice(0, 40)}</text>
</svg>`;
  }

  const titleLines = wrap(title, template === "banner" ? 42 : 28);
  const fontSize = template === "banner" ? 64 : 72;
  const startY = h / 2 - ((titleLines.length - 1) * (fontSize + 12)) / 2 - (subtitle ? 30 : 0);
  const tspans = titleLines
    .map((l, i) => `<tspan x="80" y="${startY + i * (fontSize + 12)}">${esc(l)}</tspan>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#0e1116"/><stop offset="1" stop-color="#161b22"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<rect x="0" y="0" width="14" height="${h}" fill="${c}"/>
<text fill="#e6edf3" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="800">${tspans}</text>
${
  subtitle
    ? `<text x="80" y="${startY + titleLines.length * (fontSize + 12) + 20}" fill="${c}" font-family="system-ui,sans-serif" font-size="30" font-weight="600">${esc(subtitle).slice(0, 80)}</text>`
    : ""
}
</svg>`;
}

/** Generates and minifies an SVG asset. Output: { svg, dataUri, width, height }. */
export const runAsset: NodeExecutor = async (node, ctx) => {
  const config = AssetConfig.parse(node.config);
  const title = renderString(config.title, ctx.outputs);
  const subtitle = renderString(config.subtitle, ctx.outputs);

  const raw = build(config.template, title, subtitle, config.color);
  const svg = raw.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
  const dims = DIMS[config.template];
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return {
    output: { svg, dataUri, width: dims.w, height: dims.h, bytes: svg.length },
    logs: [`generated a ${config.template} SVG (${svg.length} bytes)`],
  };
};
