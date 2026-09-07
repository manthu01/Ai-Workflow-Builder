import type { ModelTier } from "./nodes.js";

export interface TierModelMap {
  fast: string;
  balanced: string;
  deep: string;
}

/** Sensible defaults; every deployment can override via env. */
export const DEFAULT_TIER_MODELS: TierModelMap = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-5",
  deep: "claude-opus-5",
};

/** Explicit model id wins; otherwise the tier picks one from the map. */
export function resolveModel(
  tier: ModelTier,
  explicit: string | undefined,
  map: TierModelMap,
): string {
  return explicit && explicit.trim() ? explicit.trim() : map[tier];
}

/**
 * Heuristic complexity router for the NL -> DAG compiler. No model call - it
 * scores the request text so simple automations compile on a cheap model and
 * intricate, multi-branch ones get a stronger one.
 */
export function routeCompilerTier(request: string): {
  tier: ModelTier;
  score: number;
  reasons: string[];
} {
  const text = request.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > 45) {
    score += 2;
    reasons.push("long description");
  } else if (words > 22) {
    score += 1;
    reasons.push("medium-length description");
  }

  const conditionals = (text.match(/\b(if|when|unless|otherwise|depending on|in case)\b/g) ?? []).length;
  if (conditionals >= 2) {
    score += 2;
    reasons.push("conditional logic");
  } else if (conditionals === 1) {
    score += 1;
  }

  const steps = (text.match(/\b(then|after that|next|finally|and then)\b/g) ?? []).length;
  if (steps >= 2) {
    score += 1;
    reasons.push("multi-step chain");
  }

  const integrations = new Set(
    text.match(
      /\b(slack|github|gitlab|jira|notion|salesforce|hubspot|stripe|gmail|email|sheets|airtable|discord|twilio|s3|webhook|api|database|postgres)\b/g,
    ) ?? [],
  );
  if (integrations.size >= 3) {
    score += 2;
    reasons.push(`${integrations.size} integrations`);
  } else if (integrations.size === 2) {
    score += 1;
  }

  const heavyVerbs = (text.match(/\b(analy[sz]e|classif|summari[sz]e for|reason|decide|evaluate|extract structured|research)\b/g) ?? []).length;
  if (heavyVerbs >= 1) {
    score += 1;
    reasons.push("reasoning-heavy task");
  }

  const tier: ModelTier = score >= 4 ? "deep" : score >= 2 ? "balanced" : "fast";
  if (reasons.length === 0) reasons.push("simple single-path automation");
  return { tier, score, reasons };
}
