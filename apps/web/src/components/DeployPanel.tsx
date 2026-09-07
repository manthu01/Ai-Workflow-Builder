import { useEffect, useState } from "react";
import { useApp } from "../store";

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: "Every 15 min", cron: "*/15 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Daily 9am", cron: "0 9 * * *" },
  { label: "Weekdays 8am", cron: "0 8 * * 1-5" },
];

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString() : "—";
}

export function DeployPanel() {
  const workflow = useApp((s) => s.workflow);
  const deployments = useApp((s) => s.deployments);
  const schedules = useApp((s) => s.schedules);
  const issues = useApp((s) => s.issues);
  const loadDeployments = useApp((s) => s.loadDeployments);
  const loadSchedules = useApp((s) => s.loadSchedules);
  const deploy = useApp((s) => s.deploy);
  const setStatus = useApp((s) => s.setDeploymentStatus);
  const removeDeployment = useApp((s) => s.removeDeployment);
  const createSchedule = useApp((s) => s.createSchedule);
  const setScheduleStatus = useApp((s) => s.setScheduleStatus);
  const removeSchedule = useApp((s) => s.removeSchedule);
  const fireHook = useApp((s) => s.fireHook);
  const running = useApp((s) => s.running);

  const [testBody, setTestBody] = useState('{\n  "message": "hello from webhook"\n}');
  const [cron, setCron] = useState("0 9 * * *");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  useEffect(() => {
    void loadDeployments();
    void loadSchedules();
  }, [workflow?.id, loadDeployments, loadSchedules]);

  if (!workflow) return <div className="empty">Compile a workflow first.</div>;

  const errors = issues.filter((i) => i.level === "error").length;

  const sendTest = (url: string) => {
    let payload: unknown;
    try {
      payload = JSON.parse(testBody);
    } catch {
      payload = { message: "test" };
    }
    void fireHook(url, payload);
  };

  return (
    <div className="runpanel-inner">
      <button
        className="primary"
        disabled={errors > 0}
        onClick={() => void deploy()}
      >
        Deploy current graph
      </button>
      {errors > 0 && (
        <div className="issue-line" style={{ color: "var(--fail)" }}>
          Fix {errors} validation error{errors > 1 ? "s" : ""} before deploying.
        </div>
      )}
      <p className="cfg-help">
        Deploying freezes the current graph behind a webhook URL. POST a JSON body
        to it and a live run starts with that body as the trigger payload.
      </p>

      {deployments.length === 0 && <div className="empty">No deployments yet.</div>}

      {deployments.map((d) => (
        <div key={d.id} className="dep-card">
          <div className="dep-head">
            <span className={`badge`} style={{ color: d.status === "active" ? "var(--ok)" : "var(--warn)" }}>
              {d.status}
            </span>
            <span className="cfg-help">
              {d.fireCount} fires{d.lastFiredAt ? ` · last ${new Date(d.lastFiredAt).toLocaleTimeString()}` : ""}
            </span>
            <div className="spacer" />
            <button onClick={() => void setStatus(d.id, d.status === "active" ? "pause" : "resume")}>
              {d.status === "active" ? "Pause" : "Resume"}
            </button>
            <button style={{ color: "var(--fail)" }} onClick={() => void removeDeployment(d.id)}>
              Delete
            </button>
          </div>
          <input className="dep-url" readOnly value={d.url} onFocus={(e) => e.currentTarget.select()} />
        </div>
      ))}

      {deployments.length > 0 && (
        <div className="dep-test">
          <span className="cfg-label">Test event body</span>
          <textarea
            rows={4}
            spellCheck={false}
            value={testBody}
            onChange={(e) => setTestBody(e.target.value)}
          />
          <button
            disabled={running || !deployments.some((d) => d.status === "active")}
            onClick={() => {
              const active = deployments.find((d) => d.status === "active");
              if (active) sendTest(active.url);
            }}
          >
            {running ? "Running…" : "Send test event"}
          </button>
        </div>
      )}

      <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "6px 0" }} />
      <span className="cfg-label">Run on a schedule ({tz})</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {CRON_PRESETS.map((p) => (
          <button key={p.cron} style={{ fontSize: 11 }} onClick={() => setCron(p.cron)}>
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="dep-url"
          value={cron}
          spellCheck={false}
          onChange={(e) => setCron(e.target.value)}
          placeholder="0 9 * * *"
        />
        <button
          disabled={errors > 0 || !cron.trim()}
          onClick={() => void createSchedule(cron.trim(), tz).catch(() => {})}
        >
          Add
        </button>
      </div>

      {schedules.map((s) => (
        <div key={s.id} className="dep-card">
          <div className="dep-head">
            <code style={{ fontSize: 11 }}>{s.cron}</code>
            <span
              className="badge"
              style={{ color: s.status === "active" ? "var(--ok)" : "var(--warn)" }}
            >
              {s.status}
            </span>
            <div className="spacer" />
            <button
              onClick={() =>
                void setScheduleStatus(s.id, s.status === "active" ? "pause" : "resume")
              }
            >
              {s.status === "active" ? "Pause" : "Resume"}
            </button>
            <button style={{ color: "var(--fail)" }} onClick={() => void removeSchedule(s.id)}>
              Delete
            </button>
          </div>
          <span className="cfg-help">
            next {fmt(s.nextRunAt)} · last {fmt(s.lastRunAt)} · {s.runCount} runs
          </span>
        </div>
      ))}
    </div>
  );
}
