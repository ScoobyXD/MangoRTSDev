import { APIHTTPError } from "../api/requestJSON.js";

type ConversionBlockers = {
  editor?: boolean;
  kanban_work?: boolean;
  kpis?: boolean;
};

export function logicGateConversionErrorMessage(cause: unknown): string {
  const payload = readConversionErrorPayload(cause);
  if (payload?.error === "logic_gate_conversion_blocked") {
    const actions = [
      payload.blockers?.editor ? "empty the editor" : "",
      payload.blockers?.kanban_work ? "remove Kanban work" : "",
      payload.blockers?.kpis ? "remove KPIs" : "",
    ].filter(Boolean);
    if (actions.length > 0) {
      const instruction = joinActions(actions);
      return `Conversion is blocked. ${instruction[0]?.toUpperCase()}${instruction.slice(1)}, then try again.`;
    }
    return "Conversion is blocked. Check the Process content and try again.";
  }
  return cause instanceof Error ? cause.message : "Could not convert this Process.";
}

function readConversionErrorPayload(cause: unknown): { error?: unknown; blockers?: ConversionBlockers } | null {
  const bodyText = cause instanceof APIHTTPError
    ? cause.bodyText
    : cause && typeof cause === "object" && typeof (cause as { bodyText?: unknown }).bodyText === "string"
      ? (cause as { bodyText: string }).bodyText
      : "";
  if (!bodyText) return null;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    return parsed && typeof parsed === "object" ? parsed as { error?: unknown; blockers?: ConversionBlockers } : null;
  } catch {
    return null;
  }
}

function joinActions(actions: string[]): string {
  if (actions.length === 1) return actions[0] ?? "";
  if (actions.length === 2) return `${actions[0]} and ${actions[1]}`;
  return `${actions.slice(0, -1).join(", ")}, and ${actions[actions.length - 1]}`;
}
