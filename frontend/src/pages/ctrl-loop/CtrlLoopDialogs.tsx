import React, { useEffect, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import {
  getCtrlLoopHistory, markCtrlLoopChangesSeen, previewCtrlLoopWorkbook, saveCtrlLoopJob, workbookWebLink,
  type CtrlLoopHistory, type CtrlLoopJob, type CtrlLoopMailbox, type CtrlLoopPreview,
} from "../../modules/ctrl-loop/ctrlLoopApi.js";

export function loopDate(value: string | null | undefined, timeZone: string): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone, year: "2-digit", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <AppModalPortal onRequestClose={onClose}>
    <div className="ctrl-loop-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={title} className={`ctrl-loop-dialog${wide ? " ctrl-loop-dialog-wide" : ""}`}>
        <header><h2>{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose}>×</button></header>
        {children}
      </section>
    </div>
  </AppModalPortal>;
}

export function CtrlLoopEditDialog({ companyID, job, mailboxes, onClose, onSaved }: { companyID: string; job?: CtrlLoopJob; mailboxes: CtrlLoopMailbox[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(job?.name ?? "");
  const [instructions, setInstructions] = useState(job?.instructions ?? "");
  const [mailbox, setMailbox] = useState(job?.email_connection_id ?? mailboxes.find((item) => item.status === "connected")?.email_connection_id ?? "");
  const [timeZone, setTimeZone] = useState(job?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try { new Intl.DateTimeFormat("en-US", { timeZone: timeZone.trim() }).format(); }
    catch { setError("Enter a valid timezone, such as America/Los_Angeles."); return; }
    setBusy(true);
    try {
      await saveCtrlLoopJob(companyID, { name: name.trim(), instructions: instructions.trim(), email_connection_id: mailbox, time_zone: timeZone.trim() }, job);
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the automation."); setBusy(false); }
  }
  return <Dialog title={job ? "Edit automation" : "New automation"} onClose={onClose}>
    <form className="ctrl-loop-form" onSubmit={(event) => { void save(event); }}>
      <label>Name<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Purchase order WIP" /></label>
      <label>Instructions<textarea required maxLength={12000} rows={6} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="When a supplier confirms a PO has shipped, find that PO in this workbook and stamp its Shipped cell." /></label>
      <p>Describe which emails matter and which cells to update. Each changed cell contains the email arrival time with a link to the source email.</p>
      <label>Connected mailbox<select required value={mailbox} onChange={(event) => setMailbox(event.target.value)}>
        <option value="">Select a mailbox</option>
        {job?.email_connection_id && !mailboxes.some((item) => item.email_connection_id === job.email_connection_id) && <option value={job.email_connection_id} disabled>Mailbox unavailable</option>}
        {mailboxes.map((item) => <option key={item.email_connection_id} value={item.email_connection_id}>{item.account_email} · {item.provider === "google" ? "Gmail" : "Outlook"}{item.status !== "connected" ? ` (${item.status})` : ""}</option>)}
      </select></label>
      {!mailboxes.length && <p>Close this form and connect a mailbox to get started.</p>}
      <label>Timezone<input required value={timeZone} onChange={(event) => setTimeZone(event.target.value)} placeholder="America/Los_Angeles" /><small>Email arrival timestamps are written in this timezone.</small></label>
      {error && <div role="alert" className="ctrl-loop-error">{error}</div>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button className="ctrl-loop-primary" disabled={busy || !mailbox || !name.trim() || !instructions.trim()} type="submit">{busy ? "Saving…" : "Save automation"}</button></footer>
    </form>
  </Dialog>;
}

function columnName(column: number): string {
  let name = "";
  for (let current = column; current > 0; current = Math.floor((current - 1) / 26)) name = String.fromCharCode(65 + ((current - 1) % 26)) + name;
  return name;
}

export function CtrlLoopPreviewDialog({ companyID, job, onClose }: { companyID: string; job: CtrlLoopJob; onClose: () => void }) {
  const [sheetName, setSheetName] = useState("");
  const [row, setRow] = useState(1);
  const [column, setColumn] = useState(1);
  const [preview, setPreview] = useState<CtrlLoopPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void previewCtrlLoopWorkbook(companyID, job.id, sheetName, row, column, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setPreview(next); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not preview the workbook."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [companyID, job.id, sheetName, row, column]);
  const sheet = preview?.sheets.find((item) => item.name === preview.sheet.name);
  const columns = sheet ? Array.from({ length: Math.max(0, Math.min(20, sheet.columns - column + 1)) }, (_, index) => column + index) : [];
  return <Dialog title={job.file_name ?? "Workbook preview"} onClose={onClose} wide>
    <p className="ctrl-loop-dialog-note">Read-only preview of the latest saved workbook. Email links open your provider in a new tab.</p>
    <div className="ctrl-loop-preview-toolbar">
      <label>Worksheet <select disabled={!preview || loading} value={sheetName || preview?.sheet.name || ""} onChange={(event) => { setSheetName(event.target.value); setRow(1); setColumn(1); }}>
        {preview?.sheets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
      </select></label>
      <span>{sheet ? `${sheet.rows} rows · ${sheet.columns} columns` : ""}</span>
    </div>
    {error && <div role="alert" className="ctrl-loop-error">{error}</div>}
    <div className="ctrl-loop-workbook-scroll" aria-busy={loading}>
      {loading ? <p role="status">Loading workbook…</p> : !error && <table className="ctrl-loop-workbook">
        <thead><tr><th aria-label="Row" />{columns.map((index) => <th key={index} scope="col">{columnName(index)}</th>)}</tr></thead>
        <tbody>{preview?.sheet.rows.map((item) => <tr key={item.row}><th scope="row">{item.row}</th>{item.cells.map((cell) => {
          const href = workbookWebLink(cell.hyperlink);
          return <td key={cell.address} data-cell={cell.address} title={cell.formula ? `${cell.address}: ${cell.formula}` : cell.address}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{cell.text}</a> : cell.text || cell.formula}</td>;
        })}</tr>)}</tbody>
      </table>}
      {!loading && !error && !preview?.sheet.rows.length && <p>This worksheet is empty.</p>}
    </div>
    <footer className="ctrl-loop-pagination">
      <div><button disabled={loading || row === 1} onClick={() => setRow(Math.max(1, row - 40))}>Previous rows</button><span>Rows {row}–{Math.min(row + 39, sheet?.rows ?? row)}</span><button disabled={loading || !sheet || row + 40 > sheet.rows} onClick={() => setRow(row + 40)}>Next rows</button></div>
      <div><button disabled={loading || column === 1} onClick={() => setColumn(Math.max(1, column - 20))}>Previous columns</button><span>{columnName(column)}–{columnName(Math.min(column + 19, sheet?.columns || column))}</span><button disabled={loading || !sheet || column + 20 > sheet.columns} onClick={() => setColumn(column + 20)}>Next columns</button></div>
    </footer>
  </Dialog>;
}

export function CtrlLoopHistoryDialog({ companyID, job, onClose, onSeen }: { companyID: string; job: CtrlLoopJob; onClose: () => void; onSeen: () => Promise<void> }) {
  const [history, setHistory] = useState<CtrlLoopHistory | null>(null);
  const [cursors, setCursors] = useState<string[]>([""]);
  const [error, setError] = useState("");
  const [seenError, setSeenError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const beforeID = cursors[cursors.length - 1];
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null); setError(""); setSeenError("");
    void getCtrlLoopHistory(companyID, job.id, beforeID, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setHistory(next); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load changes."); });
    return () => controller.abort();
  }, [companyID, job.id, beforeID]);

  // Only this rendered page is acknowledged. Newer changes arriving after this read remain unseen.
  useEffect(() => {
    const ids = history?.changes.filter((change) => !change.seen).map((change) => change.id) ?? [];
    if (!ids.length) return;
    const controller = new AbortController();
    void markCtrlLoopChangesSeen(companyID, job.id, ids, controller.signal).then(async () => {
      if (controller.signal.aborted) return;
      setSeenError("");
      await onSeen();
    }).catch((cause) => { if (!controller.signal.aborted) setSeenError(cause instanceof Error ? cause.message : "Could not mark the displayed changes seen."); });
    return () => controller.abort();
  }, [companyID, job.id, history, attempt, onSeen]);

  return <Dialog title={`Updates · ${job.name}`} onClose={onClose} wide>
    <p className="ctrl-loop-dialog-note">One update per changed cell. Opening this list marks only the displayed changes seen.</p>
    {error && <div role="alert" className="ctrl-loop-error">{error}</div>}
    {seenError && <div role="alert" className="ctrl-loop-error">{seenError} <button onClick={() => setAttempt(attempt + 1)}>Retry marking seen</button></div>}
    {!history && !error && <p role="status">Loading updates…</p>}
    {history && <>
      <div className="ctrl-loop-history-scroll"><table className="ctrl-loop-history">
        <thead><tr><th>Worksheet / cell</th><th>Previous text</th><th>Email arrival / new text</th><th>Saved</th></tr></thead>
        <tbody>{history.changes.map((change) => <tr key={change.id} data-change-id={change.id}>
          <td>{change.sheet} · <strong>{change.cell}</strong>{!change.seen && <span className="ctrl-loop-new">New</span>}</td>
          <td>{change.previous_text || "—"}</td>
          <td>{workbookWebLink(change.source_url) ? <a href={workbookWebLink(change.source_url)} target="_blank" rel="noopener noreferrer" title={change.arrival_at}>{change.text}</a> : change.text}</td>
          <td>{loopDate(change.saved_at, job.time_zone)}</td>
        </tr>)}</tbody>
      </table>{!history.changes.length && <p className="ctrl-loop-empty">No workbook changes yet.</p>}</div>
      <footer className="ctrl-loop-pagination"><button disabled={cursors.length === 1} onClick={() => setCursors(cursors.slice(0, -1))}>Newer changes</button><span>Page {cursors.length}</span><button disabled={!history.has_more || !history.changes.length} onClick={() => setCursors([...cursors, history.changes[history.changes.length - 1].id])}>Older changes</button></footer>
      <details className="ctrl-loop-runs"><summary>Recent processing history</summary>{history.runs.length ? <ol>{history.runs.map((run) => <li key={run.id}><strong>{loopDate(run.completed_at || run.created_at, job.time_zone)}</strong> · {run.status} · {run.changed_cells} changed cells{run.error && <p className="ctrl-loop-row-error">{run.error}</p>}</li>)}</ol> : <p>No emails processed yet.</p>}</details>
    </>}
  </Dialog>;
}
