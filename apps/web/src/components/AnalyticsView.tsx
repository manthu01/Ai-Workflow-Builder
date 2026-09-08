import { useEffect, useState } from "react";
import { api } from "../api";
import type { Analytics } from "../types";

const KIND_LABEL: Record<string, string> = {
  trigger: "Trigger",
  llm: "LLM Step",
  http_request: "HTTP Request",
  transform: "Transform",
  branch: "Branch",
  loop: "Loop",
  code: "Code",
  asset: "2D Asset",
  api_call: "API call",
  local: "Local exec",
  approval: "Approval",
  slack_post: "Post to Slack",
};
const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function RunsOverTime({ data }: { data: Analytics["perDay"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.succeeded + d.failed + d.other));

  return (
    <div className="card">
      <div className="card-head">
        <h3>Runs over time</h3>
        <div className="legend">
          <span><i className="sw" style={{ background: "var(--ok)" }} /> succeeded</span>
          <span><i className="sw" style={{ background: "var(--fail)" }} /> failed</span>
        </div>
      </div>
      <div className="bars" onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const total = d.succeeded + d.failed + d.other;
          return (
            <div
              key={d.day}
              className="bar-col"
              onMouseEnter={() => setHover(i)}
            >
              {hover === i && (
                <div className="bar-tip">
                  <strong>{d.day}</strong>
                  <div>{d.succeeded} succeeded</div>
                  <div>{d.failed} failed</div>
                  {d.other > 0 && <div>{d.other} other</div>}
                </div>
              )}
              <div className="bar-stack" style={{ height: `${(total / max) * 100}%` }}>
                <div
                  className="seg fail"
                  style={{ flexBasis: total ? `${(d.failed / total) * 100}%` : 0 }}
                />
                <div
                  className="seg ok"
                  style={{ flexBasis: total ? `${(d.succeeded / total) * 100}%` : 0 }}
                />
              </div>
              <div className="bar-x">{d.day.slice(8)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NodePerf({ rows }: { rows: Analytics["nodePerf"] }) {
  const maxP95 = Math.max(1, ...rows.map((r) => r.p95Ms));
  return (
    <div className="card">
      <div className="card-head"><h3>Node performance</h3></div>
      <table className="atable">
        <thead>
          <tr>
            <th>Node</th>
            <th>Runs</th>
            <th>Success</th>
            <th>p50</th>
            <th>p95</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind}>
              <td>{kindLabel(r.kind)}</td>
              <td>{r.count}</td>
              <td>
                {r.succeeded + r.failed > 0
                  ? `${Math.round(r.successRate * 100)}%`
                  : "—"}
              </td>
              <td>{fmtMs(r.p50Ms)}</td>
              <td>
                <div className="lat-bar">
                  <div
                    className="lat-fill"
                    style={{ width: `${(r.p95Ms / maxP95) * 100}%` }}
                  />
                  <span>{fmtMs(r.p95Ms)}</span>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="muted">No node executions yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Failures({ rows }: { rows: Analytics["failuresByKind"] }) {
  const max = Math.max(1, ...rows.map((r) => r.failed));
  return (
    <div className="card">
      <div className="card-head"><h3>Failures by node</h3></div>
      {rows.length === 0 ? (
        <div className="muted" style={{ padding: 8 }}>No failures recorded. 🎉</div>
      ) : (
        <div className="hbars">
          {rows.map((r) => (
            <div key={r.kind} className="hbar-row">
              <span className="hbar-label">{kindLabel(r.kind)}</span>
              <div className="hbar-track">
                <div
                  className="hbar-fill"
                  style={{ width: `${(r.failed / max) * 100}%` }}
                />
              </div>
              <span className="hbar-val">{r.failed}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentRuns({ rows }: { rows: Analytics["recentRuns"] }) {
  return (
    <div className="card">
      <div className="card-head"><h3>Recent runs</h3></div>
      <table className="atable">
        <thead>
          <tr>
            <th>Workflow</th>
            <th>Trigger</th>
            <th>Mode</th>
            <th>Status</th>
            <th>Duration</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.workflowName}</td>
              <td>{r.trigger}</td>
              <td>{r.mode}</td>
              <td>
                <span className={`dot ${r.status === "succeeded" ? "succeeded" : r.status === "failed" ? "failed" : "running"}`} />
                {" "}{r.status}
              </td>
              <td>{fmtMs(r.durationMs)}</td>
              <td>{new Date(r.startedAt).toLocaleString()}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="muted">No runs yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AnalyticsView() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .analytics()
      .then(setData)
      .catch((e) => setError((e as Error).message));
  };
  useEffect(load, []);

  if (error) return <div className="analytics"><div className="empty">{error}</div></div>;
  if (!data) return <div className="analytics"><div className="empty">Loading…</div></div>;

  const t = data.totals;
  return (
    <div className="analytics">
      <div className="analytics-head">
        <h2>Analytics</h2>
        <span className="muted">across {t.runs} runs</span>
        <div style={{ flex: 1 }} />
        <button onClick={load}>Refresh</button>
      </div>

      <div className="stat-row">
        <StatTile
          label="Total runs"
          value={String(t.runs)}
          sub={`${t.liveRuns} live · ${t.dryRuns} dry`}
        />
        <StatTile
          label="Success rate"
          value={t.succeeded + t.failed ? `${Math.round(t.successRate * 100)}%` : "—"}
          sub={`${t.succeeded} ok · ${t.failed} failed`}
        />
        <StatTile label="Avg run time" value={fmtMs(t.avgRunMs)} />
        <StatTile
          label="Node executions"
          value={String(t.nodeRuns)}
          sub={`${data.nodePerf.length} node types`}
        />
      </div>

      <RunsOverTime data={data.perDay} />
      <div className="card-grid">
        <NodePerf rows={data.nodePerf} />
        <Failures rows={data.failuresByKind} />
      </div>
      <RecentRuns rows={data.recentRuns} />
    </div>
  );
}
