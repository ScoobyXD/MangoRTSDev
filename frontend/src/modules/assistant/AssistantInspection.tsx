import React, { useState } from "react";
import type { AssistantTrace } from "./assistantApi.js";

type Props = { traces: AssistantTrace[]; requestID?: string; companyID: string; userID: string };
type View = "inputs" | "requests" | "events";
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown) => typeof value === "string" ? value : undefined;

const JSONDetails = React.memo(function JSONDetails({ title, value }: { title: string; value: unknown }) {
  return <details><summary tabIndex={0}>{title}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
});

function Source({ value }: { value: unknown }) {
  const source = object(value);
  if (!source) return <pre>{JSON.stringify(value, null, 2)}</pre>;
  const location = text(source.path) ?? text(source.table) ?? text(source.kind) ?? "Captured source";
  return <li className="mango-assistant-source">
    <strong>{text(source.label) ?? location}</strong>
    <dl>{Object.entries(source).filter(([key]) => key !== "label").map(([key, item]) => <React.Fragment key={key}>
      <dt>{key.replace(/_/g, " ")}</dt><dd><code>{typeof item === "string" ? item : JSON.stringify(item)}</code></dd>
    </React.Fragment>)}</dl>
  </li>;
}

function inputTitle(trace: AssistantTrace): string {
  switch (trace.kind) {
    case "runtime": return "App instructions, available skills, tools, and initial history";
    case "context": return "Current user and selected Process context";
    case "skill_load": return "Full skill instructions read during this run";
    case "tool_catalog": return "Available tools after Process binding";
    case "tool": return `Mango tool: ${text(trace.data.name) ?? "result"}`;
    case "tool_result": return "Tool output returned to the model";
    default: return trace.kind.replace(/_/g, " ");
  }
}

export function AssistantInspection({ traces, requestID, companyID, userID }: Props) {
  const [view, setView] = useState<View>("inputs");
  const requests = traces.filter(trace => trace.kind === "provider_request" && object(trace.data.body));
  const inputEvents = traces.filter(trace => ["runtime", "context", "skill_load", "tool_catalog", "tool_result"].includes(trace.kind)
    || trace.kind === "tool" && trace.data.result !== undefined || trace.kind !== "provider_request" && Array.isArray(trace.data.sources));
  return <>
    <nav className="mango-assistant-inspection-tabs" aria-label="Inspection views">
      {([["inputs", "Inputs & sources"], ["requests", "Model requests"], ["events", "All events"]] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}
    </nav>
    <p>Each model request shows the captured request body. Source locations explain how Mango assembled it; source labels themselves are not added to the model's prompt.</p>
    {requestID && <details className="mango-assistant-archive-location"><summary tabIndex={0}>Run archive location</summary>
      <p>After this run ends, Mango attempts to save the complete event array once in <code>public.ai_runs.inspection_json</code>. This location is not confirmation that the archive write succeeded.</p>
      <dl><dt>company_id</dt><dd><code>{companyID}</code></dd><dt>user_id</dt><dd><code>{userID}</code></dd><dt>ai_runs_id</dt><dd><code>{requestID}</code></dd></dl>
    </details>}
    {view === "inputs" && <section aria-label="Inputs and their sources">
      {inputEvents.length === 0 && <p>No input sources captured yet. Model requests and All events show any received data.</p>}
      {inputEvents.map(trace => <article className="mango-assistant-inspection-entry" key={trace.sequence}>
        <h3>{inputTitle(trace)}</h3><p className="mango-assistant-hint">Event {trace.sequence} · {trace.status} · {trace.time}</p>
        {Array.isArray(trace.data.sources) && <ul className="mango-assistant-sources">{trace.data.sources.map((source, index) => <Source key={index} value={source} />)}</ul>}
        <JSONDetails title="Captured content and source details" value={trace.data} />
      </article>)}
    </section>}
    {view === "requests" && <section aria-label="Exact model requests">
      {requests.length === 0 && <p>No model request captured yet.</p>}
      {requests.map(trace => {
        const invocation = trace.data.invocation;
        const dispatched = traces.some(event => event.kind === "provider_request" && event.status === "dispatched" && event.data.invocation === invocation);
        return <article className="mango-assistant-inspection-entry" key={trace.sequence}>
          <h3>Model request {String(invocation ?? "")}</h3><p>{dispatched ? "Dispatched" : "Prepared; dispatch not confirmed"} · {trace.time}</p>
          {Array.isArray(trace.data.sources) && <details><summary tabIndex={0}>Sources included in this request</summary><ul className="mango-assistant-sources">{trace.data.sources.map((source, index) => <Source key={index} value={source} />)}</ul></details>}
          <JSONDetails title="Complete captured request body" value={trace.data.body} />
          <JSONDetails title="Request capture and omission details" value={trace} />
        </article>;
      })}
    </section>}
    {view === "events" && <section aria-label="Ordered run events">{traces.map(trace =>
      <JSONDetails key={trace.sequence} title={`${trace.sequence}. ${trace.kind.replace(/_/g, " ")} · ${trace.status} · ${trace.time}`} value={trace} />)}
    </section>}
  </>;
}
