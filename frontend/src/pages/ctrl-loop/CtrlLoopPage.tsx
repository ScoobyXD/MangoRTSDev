import { useCallback, useEffect, useRef, useState } from "react";
import { readAuthConfig } from "../../auth/cognitoAuth.js";
import { fetchCommunicationsAuthURL, type EmailProvider } from "../../modules/communications/communicationsApi.js";
import { realtimePersonalMailboxScope, subscribeRealtimeScope } from "../../modules/realtime/realtimeWebSocket.js";
import {
  ctrlLoopTitle, downloadCtrlLoopWorkbook, listCtrlLoopJobs, uploadCtrlLoopWorkbook,
  type CtrlLoopJob, type CtrlLoopJobs,
} from "../../modules/ctrl-loop/ctrlLoopApi.js";
import { CtrlLoopEditDialog, CtrlLoopHistoryDialog, CtrlLoopPreviewDialog, loopDate } from "./CtrlLoopDialogs.js";
import "./ctrlLoop.css";

export function CtrlLoopPage({ companyID, currentUserID }: { companyID: string; currentUserID: string }) {
  const [data, setData] = useState<CtrlLoopJobs | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [edit, setEdit] = useState<CtrlLoopJob | "new" | null>(null);
  const [preview, setPreview] = useState<CtrlLoopJob | null>(null);
  const [history, setHistory] = useState<CtrlLoopJob | null>(null);
  const [dragged, setDragged] = useState("");
  const request = useRef<AbortController | null>(null);
  const jobs = data?.jobs ?? [];
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await listCtrlLoopJobs(companyID, controller.signal);
      if (!controller.signal.aborted) { setData(next); setError(""); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load automations.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [companyID]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 15_000);
    const focused = () => { void refresh(); };
    window.addEventListener("focus", focused);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", focused); request.current?.abort(); };
  }, [refresh]);

  const accounts = (data?.mailboxes ?? []).map((mailbox) => mailbox.account_email).sort().join("\n");
  useEffect(() => {
    if (!currentUserID || !accounts) return;
    const unsubscribers = accounts.split("\n").map((email) => subscribeRealtimeScope(
      readAuthConfig().apiBase, companyID, realtimePersonalMailboxScope(currentUserID, email),
      { onMailboxMessageChanged: () => { void refresh(); }, onAccepted: () => { void refresh(); }, onRecover: refresh },
    ));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [accounts, companyID, currentUserID, refresh]);

  useEffect(() => {
    const previous = document.title;
    return () => { document.title = previous; };
  }, []);
  useEffect(() => { document.title = ctrlLoopTitle(data?.jobs ?? []); }, [data]);

  async function upload(job: CtrlLoopJob, files: FileList | null) {
    if (busy || !files?.length || job.file_name) return;
    if (files.length !== 1) { setError("Drop one Excel .xlsx file onto an automation."); return; }
    setBusy(job.id); setError("");
    try { await uploadCtrlLoopWorkbook(companyID, job.id, files[0]); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not upload the workbook."); }
    finally { setBusy(""); }
  }

  async function download(job: CtrlLoopJob, version: "current" | "original") {
    setBusy(job.id); setError("");
    try {
      const blob = await downloadCtrlLoopWorkbook(companyID, job.id, version);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = job.file_name ?? "workbook.xlsx";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not download the workbook."); }
    finally { setBusy(""); }
  }

  async function connect(provider: EmailProvider) {
    setBusy("connect"); setError("");
    try { window.location.assign(await fetchCommunicationsAuthURL(provider, undefined, undefined, companyID)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect the mailbox."); setBusy(""); }
  }

  return (
    <section className="ctrl-loop-page" aria-label="[CTRL] Loop">
      <header className="ctrl-loop-heading">
        <div><h1>[CTRL] Loop</h1><p>Incoming email. Updated workbooks.</p></div>
        <div className="ctrl-loop-actions">
          <button onClick={() => { void refresh(); }}>Refresh</button>
          <button className="ctrl-loop-primary" onClick={() => setEdit("new")} disabled={!data}>+ New automation</button>
        </div>
      </header>
      <div className="ctrl-loop-intro">
        <span>Automations listen for new mail and keep working when you close Mango.</span>
        <div className="ctrl-loop-actions">
          <button disabled={!!busy} onClick={() => { void connect("google"); }}>Connect Gmail</button>
          <button disabled={!!busy} onClick={() => { void connect("microsoft"); }}>Connect Outlook</button>
        </div>
      </div>
      {error && <div className="ctrl-loop-error" role="alert">{error}</div>}
      <div className="ctrl-loop-table-scroll" aria-busy={loading}>
        <table className="ctrl-loop-table">
          <thead><tr><th>Name</th><th>Instructions</th><th>Status</th><th>Updates</th><th>Workbook</th><th>Download</th><th>Original</th><th>Last updated</th><th>Input</th><th>Output</th></tr></thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className={dragged === job.id ? "ctrl-loop-drop-active" : undefined}
                onDragOver={(event) => { if (!job.file_name && !busy && event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragged(job.id); } }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragged(""); }}
                onDrop={(event) => { event.preventDefault(); setDragged(""); void upload(job, event.dataTransfer.files); }}>
                <td><button className="ctrl-loop-name" onClick={() => setEdit(job)}>{job.name}</button><small>{data?.mailboxes.find((mailbox) => mailbox.email_connection_id === job.email_connection_id)?.account_email ?? "Mailbox unavailable"}</small></td>
                <td className="ctrl-loop-instructions"><button onClick={() => setEdit(job)}>{job.instructions}</button></td>
                <td><span className={`ctrl-loop-status ctrl-loop-status-${job.status.toLowerCase().replace(/ /g, "-")}`}><span aria-hidden="true" className="ctrl-loop-status-dot" />{job.status}</span>{job.error && <small className="ctrl-loop-row-error">{job.error}</small>}</td>
                <td><button className={`ctrl-loop-count${job.unseen_updates ? " ctrl-loop-count-unseen" : ""}`} aria-label={`${job.unseen_updates} unseen updates for ${job.name}`} onClick={() => setHistory(job)}>{job.unseen_updates}</button></td>
                <td>{job.file_name ? <button className="ctrl-loop-file" onClick={() => setPreview(job)} title="Open read-only workbook preview"><span aria-hidden="true">X</span>{job.file_name}</button> : <label className={`ctrl-loop-upload${busy ? " ctrl-loop-disabled" : ""}`}><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label={`Upload workbook for ${job.name}`} disabled={!!busy} onChange={(event) => { void upload(job, event.target.files); event.target.value = ""; }} />{busy === job.id ? "Uploading…" : "Upload .xlsx or drop here"}</label>}</td>
                <td><button disabled={!job.file_name || !!busy} aria-label={`Download latest workbook for ${job.name}`} onClick={() => { void download(job, "current"); }}>↓ Latest</button></td>
                <td><button disabled={!job.file_name || !!busy} aria-label={`Download original workbook for ${job.name}`} onClick={() => { void download(job, "original"); }}>↓ Original</button></td>
                <td className="ctrl-loop-last-updated">{loopDate(job.last_updated, job.time_zone)}<small>{job.time_zone}</small></td>
                <td><span className="ctrl-loop-placeholder">Email</span></td><td><span className="ctrl-loop-placeholder">Excel</span></td>
              </tr>
            ))}
            {!jobs.length && <tr><td colSpan={10} className="ctrl-loop-empty">{loading ? "Loading automations…" : "Create an automation, describe what to update, and attach your workbook."}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="ctrl-loop-footnote">Each changed cell shows the email’s arrival time and links directly to its source in your email provider. Your original upload stays available.</p>
      {edit && <CtrlLoopEditDialog companyID={companyID} job={edit === "new" ? undefined : edit} mailboxes={data?.mailboxes ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void refresh(); }} />}
      {preview && <CtrlLoopPreviewDialog companyID={companyID} job={preview} onClose={() => setPreview(null)} />}
      {history && <CtrlLoopHistoryDialog companyID={companyID} job={history} onClose={() => setHistory(null)} onSeen={refresh} />}
    </section>
  );
}
