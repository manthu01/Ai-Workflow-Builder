import { useState } from "react";
import { useApp } from "../store";

const EXAMPLES = [
  "When a PR is merged, summarize it and post the summary to #eng on Slack.",
  "Every morning, fetch open incidents from our API and post a digest to #ops.",
  "When a webhook fires, extract the customer email and send it to our CRM endpoint.",
];

export function ChatPanel() {
  const [text, setText] = useState("");
  const chat = useApp((s) => s.chat);
  const compiling = useApp((s) => s.compiling);
  const compile = useApp((s) => s.compile);

  const submit = () => {
    const prompt = text.trim();
    if (!prompt || compiling) return;
    setText("");
    void compile(prompt);
  };

  return (
    <div className="chat">
      <div className="chat-log">
        {chat.length === 0 && (
          <div className="empty" style={{ padding: "8px 0" }}>
            Try one of these:
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  style={{ textAlign: "left", fontSize: 12 }}
                  onClick={() => setText(e)}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((entry, i) => (
          <div key={i} className={`chat-entry ${entry.role}`}>
            {entry.text}
          </div>
        ))}
        {compiling && <div className="chat-entry system">Compiling…</div>}
      </div>
      <div className="chat-input">
        <textarea
          rows={3}
          placeholder="Describe the workflow…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="chat-hint">⌘/Ctrl + Enter</span>
          <button className="primary" disabled={compiling || !text.trim()} onClick={submit}>
            Compile
          </button>
        </div>
      </div>
    </div>
  );
}
