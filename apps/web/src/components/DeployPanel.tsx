import { useEffect, useState } from "react";
import { useApp } from "../store";

export function DeployPanel() {
  const workflow = useApp((s) => s.workflow);
  const deployments = useApp((s) => s.deployments);
  const issues = useApp((s) => s.issues);
  const loadDeployments = useApp((s) => s.loadDeployments);
  const deploy = useApp((s) => s.deploy);
  const setStatus = useApp((s) => s.setDeploymentStatus);
  const removeDeployment = useApp((s) => s.removeDeployment);
  const fireHook = useApp((s) => s.fireHook);
  const running = useApp((s) => s.running);

  const [testBody, setTestBody] = useState('{\n  "message": "hello from webhook"\n}');

  useEffect(() => {
    void loadDeployments();
  }, [workflow?.id, loadDeployments]);

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
    </div>
  );
}
