import { useEffect, useState } from "react";

export type MangoEditorDataFormat = "tiptap_json";
export type MangoEditorMigrationState = "ready";

export type MangoEditorDataFormatGate = {
  company_id: string;
  editor_format: MangoEditorDataFormat;
  migration_state: MangoEditorMigrationState;
  document_schema_version: number;
  expected_document_count: number;
  converted_document_count: number;
};

type GateRequest = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
type GateCacheEntry = {
  value?: MangoEditorDataFormatGate;
  error?: unknown;
  promise?: Promise<MangoEditorDataFormatGate>;
  listeners: Set<() => void>;
};

const cache = new Map<string, GateCacheEntry>();

function key(apiBase: string, companyID: string): string {
  return `${apiBase.trim()}\u0000${companyID.trim()}`;
}

function validateGate(value: MangoEditorDataFormatGate, companyID: string): MangoEditorDataFormatGate {
  if (value.company_id !== companyID) throw new Error("editor_data_format_company_mismatch");
  if (value.editor_format !== "tiptap_json") throw new Error("editor_data_format_unknown");
  if (value.migration_state !== "ready") throw new Error("editor_json_format_not_ready");
  if (value.expected_document_count !== value.converted_document_count) throw new Error("editor_json_conversion_incomplete");
  if (value.document_schema_version !== 1) throw new Error("editor_json_schema_version_unsupported");
  return value;
}

export function loadMangoEditorDataFormat(
  apiBase: string,
  companyID: string,
  requestJSON: GateRequest,
): Promise<MangoEditorDataFormatGate> {
  const cacheKey = key(apiBase, companyID);
  const entry = cache.get(cacheKey) ?? { listeners: new Set() };
  cache.set(cacheKey, entry);
  if (entry.value) return Promise.resolve(entry.value);
  if (entry.promise) return entry.promise;
  entry.error = undefined;
  entry.promise = requestJSON<MangoEditorDataFormatGate>(
    `/v1/editor-data-format?company_id=${encodeURIComponent(companyID)}`,
  ).then((gate) => {
    entry.value = validateGate(gate, companyID);
    entry.error = undefined;
    return entry.value;
  }).catch((cause) => {
    entry.error = cause;
    throw cause;
  }).finally(() => {
    entry.promise = undefined;
    entry.listeners.forEach((listener) => listener());
  });
  return entry.promise;
}

export function useMangoEditorDataFormat(
  apiBase: string,
  companyID: string,
  requestJSON: GateRequest | undefined,
): { loading: boolean; gate?: MangoEditorDataFormatGate; error?: unknown } {
  const cacheKey = key(apiBase, companyID);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!apiBase.trim() || !companyID.trim() || !requestJSON) return undefined;
    const entry = cache.get(cacheKey) ?? { listeners: new Set() };
    cache.set(cacheKey, entry);
    const listener = () => rerender((value) => value + 1);
    entry.listeners.add(listener);
    void loadMangoEditorDataFormat(apiBase, companyID, requestJSON).catch(() => undefined);
    return () => { entry.listeners.delete(listener); };
  }, [apiBase, cacheKey, companyID, requestJSON]);
  if (!apiBase.trim() || !companyID.trim() || !requestJSON) {
    return { loading: false, gate: undefined, error: new Error("editor_data_format_context_missing") };
  }
  const entry = cache.get(cacheKey);
  return { loading: !entry?.value && !entry?.error, gate: entry?.value, error: entry?.error };
}

export function clearMangoEditorDataFormatCacheForTests(): void {
  cache.clear();
}
