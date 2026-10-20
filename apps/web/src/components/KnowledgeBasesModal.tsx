import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { api } from "../api";
import type { KbDocument, KnowledgeBase, RetrievalMode, RetrievedChunk } from "../types";
import { ChunkCard } from "./ChunkCard";

const POLL_MS = 1500;

function DocumentRow({
  doc,
  onReindex,
  onDelete,
}: {
  doc: KbDocument;
  onReindex: () => void;
  onDelete: () => void;
}) {
  const busy = doc.status === "pending" || doc.status === "indexing";
  return (
    <div className="kb-doc">
      <span className={`dot ${doc.status === "ready" ? "succeeded" : doc.status === "failed" ? "failed" : "running"}`} />
      <span className="kb-doc-name" title={doc.filename}>
        {doc.filename}
      </span>
      <span className="badge">{doc.status}</span>
      {doc.status === "ready" && (
        <span className="cfg-help" title="reused = unchanged chunks whose embedding was kept">
          {doc.chunkCount} chunks{doc.reusedChunkCount > 0 && ` · ${doc.reusedChunkCount} reused`}
        </span>
      )}
      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        {(doc.status === "failed" || doc.status === "ready") && (
          <button onClick={onReindex} title="Re-run ingestion; unchanged chunks keep their embeddings">
            {doc.status === "failed" ? "Retry" : "Re-index"}
          </button>
        )}
        <button style={{ color: "var(--fail)" }} disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </span>
      {doc.error && <div className="kb-doc-error">{doc.error}</div>}
    </div>
  );
}

function KbDetail({ kb, onChanged }: { kb: KnowledgeBase; onChanged: () => void }) {
  const headerConnections = useApp((s) => s.connections).filter((c) => c.kind === "http_header");
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<RetrievalMode>("hybrid");
  const [topK, setTopK] = useState(5);
  const [rerank, setRerank] = useState(false);
  const [results, setResults] = useState<{ chunks: RetrievedChunk[]; tookMs: number } | null>(null);
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDocs((await api.listKbDocuments(kb.id)).documents);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [kb.id]);

  useEffect(() => {
    setDocs([]);
    setResults(null);
    setError("");
    void refresh();
  }, [refresh]);

  // Poll while anything is still indexing; refresh the KB counts when it settles.
  const indexing = docs.some((d) => d.status === "pending" || d.status === "indexing");
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearInterval(t);
      onChanged();
    };
  }, [indexing, refresh, onChanged]);

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    }
    await refresh();
    onChanged();
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    await run(async () => {
      for (const f of Array.from(files)) await api.uploadKbDocument(kb.id, f);
    });
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    try {
      const res = await api.searchKb(kb.id, query.trim(), mode, topK, rerank);
      setResults({ chunks: res.chunks, tookMs: res.tookMs });
    } catch (err) {
      setError((err as Error).message);
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="kb-detail">
      <div>
        <h3 className="kb-title">{kb.name}</h3>
        {kb.description && <div className="cfg-help">{kb.description}</div>}
        <div className="cfg-help">
          <code>{kb.id}</code> · {kb.embeddingModel} · {kb.dimensions} dims
        </div>
      </div>

      {error && <div className="kb-error">{error}</div>}

      <div className="conn-list">
        {docs.length === 0 && <div className="empty">No documents yet. Upload one below.</div>}
        {docs.map((d) => (
          <DocumentRow
            key={d.id}
            doc={d}
            onReindex={() => void run(() => api.reindexKbDocument(kb.id, d.id))}
            onDelete={() => void run(() => api.deleteKbDocument(kb.id, d.id))}
          />
        ))}
      </div>

      <div className="conn-form">
        <h3>Add documents</h3>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.md,.markdown,.txt,.html,.htm"
          disabled={uploading}
          onChange={(e) => void uploadFiles(e.target.files)}
        />
        <span className="cfg-help">PDF, Markdown, text or HTML, up to 10 MB each.</span>
        <label className="cfg-field">
          <span className="cfg-label">URL auth (optional)</span>
          <select
            value={kb.connectionId ?? ""}
            onChange={(e) =>
              void run(() => api.updateKnowledgeBase(kb.id, { connectionId: e.target.value || null }))
            }
          >
            <option value="">{headerConnections.length ? "— none (public URLs) —" : "no header connections yet"}</option>
            {headerConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="cfg-help">
            Sent as a header when fetching this KB's URLs, for pages behind auth. Add one under Connections.
          </span>
        </label>
        <div className="kb-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/policy"
            onKeyDown={(e) => e.key === "Enter" && url.trim() && void run(() => api.addKbUrl(kb.id, url.trim())).then(() => setUrl(""))}
          />
          <button
            disabled={!url.trim()}
            onClick={() => void run(() => api.addKbUrl(kb.id, url.trim())).then(() => setUrl(""))}
          >
            Add URL
          </button>
        </div>
      </div>

      <div className="conn-form">
        <h3>Test search</h3>
        <div className="kb-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void search()}
            placeholder="How many vacation days carry over?"
          />
          <select value={mode} onChange={(e) => setMode(e.target.value as RetrievalMode)}>
            <option value="hybrid">hybrid</option>
            <option value="vector">vector</option>
            <option value="keyword">keyword</option>
          </select>
          <select value={topK} onChange={(e) => setTopK(Number(e.target.value))} title="top K">
            {[3, 5, 10].map((k) => (
              <option key={k} value={k}>
                top {k}
              </option>
            ))}
          </select>
          <label className="kb-check" title="Re-score candidates with a cross-encoder">
            <input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} />
            rerank
          </label>
          <button className="primary" disabled={searching || !query.trim()} onClick={() => void search()}>
            {searching ? "…" : "Search"}
          </button>
        </div>
        {results && (
          <div className="kb-results">
            <div className="cfg-help">
              {results.chunks.length} result(s) in {results.tookMs} ms
            </div>
            {results.chunks.length === 0 && <div className="empty">Nothing matched.</div>}
            {results.chunks.map((c, i) => (
              <ChunkCard key={c.id} chunk={c} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function KnowledgeBasesModal() {
  const open = useApp((s) => s.knowledgeBasesOpen);
  const setOpen = useApp((s) => s.setKnowledgeBasesOpen);
  const kbs = useApp((s) => s.knowledgeBases);
  const load = useApp((s) => s.loadKnowledgeBases);
  const create = useApp((s) => s.createKnowledgeBase);
  const remove = useApp((s) => s.removeKnowledgeBase);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const selected = kbs.find((kb) => kb.id === selectedId) ?? kbs[0];
  const onChanged = useCallback(() => void load(), [load]);

  if (!open) return null;

  const submit = async () => {
    if (!name.trim()) return;
    const kb = await create(name.trim(), description.trim());
    if (kb) {
      setSelectedId(kb.id);
      setName("");
      setDescription("");
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal kb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Knowledge bases</h2>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
        <p className="cfg-help">
          Upload documents into a knowledge base, then search it from a <code>retrieve</code> node.
          An <code>llm</code> step with <em>Require citations</em> answers from what it finds.
        </p>

        <div className="kb-layout">
          <div className="kb-sidebar">
            {kbs.length === 0 && <div className="empty">No knowledge bases yet.</div>}
            {kbs.map((kb) => (
              <button
                key={kb.id}
                className={`kb-item ${selected?.id === kb.id ? "active" : ""}`}
                onClick={() => setSelectedId(kb.id)}
              >
                <strong>{kb.name}</strong>
                <span className="cfg-help">
                  {kb.documentCount} docs · {kb.chunkCount} chunks
                </span>
              </button>
            ))}
            <div className="conn-form">
              <h3>New knowledge base</h3>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="HR policies" />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's in it (helps the compiler pick it)"
              />
              <button className="primary" disabled={!name.trim()} onClick={() => void submit()}>
                Create
              </button>
            </div>
            {selected && (
              <button
                style={{ color: "var(--fail)" }}
                onClick={() => {
                  setSelectedId(null);
                  void remove(selected.id);
                }}
              >
                Delete “{selected.name}”
              </button>
            )}
          </div>
          {selected ? (
            <KbDetail key={selected.id} kb={selected} onChanged={onChanged} />
          ) : (
            <div className="empty">Create a knowledge base to get started.</div>
          )}
        </div>
      </div>
    </div>
  );
}
