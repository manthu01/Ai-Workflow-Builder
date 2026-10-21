import type { DemoStatus } from "../types";

/** The public demo's notice under the top bar: what runs here, and where the full version lives. */
export function DemoBanner({ demo }: { demo: Extract<DemoStatus, { demo: true }> }) {
  return (
    <div className="demo-banner">
      <strong>Public demo</strong>
      <span>
        Dry runs only. Runs locally with full features:{" "}
        <a href={demo.repoUrl} target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </span>
      <span className="demo-banner-detail">
        {demo.compiler === "stub"
          ? "Compiler: offline keyword rules (no AI model). The real compiler uses Claude when run locally with an API key."
          : `Compiler: Claude · ${demo.compilesLeftThisHour}/${demo.compilesPerHour} compiles left this hour`}
        {` · Your workflows are private to this browser and deleted after ${demo.retentionHours}h.`}
      </span>
      <span className="demo-banner-detail" title={demo.disabled.join("\n")}>
        Some features are off here (hover for the list).
      </span>
    </div>
  );
}
