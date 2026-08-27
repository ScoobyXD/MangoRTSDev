type ProcessMapChangedMessage = {
  type: "process_map.changed";
  company_id: string;
  scope: string;
  origin_connection_id?: string;
  presentation_only?: boolean;
};

type RealtimeCallbacks = {
  onProcessMapChanged?: (message: ProcessMapChangedMessage) => void;
};

const processMapSubscribers = new Set<RealtimeCallbacks>();

export function subscribeRealtimeScope(
  _apiBase: string,
  _companyID: string,
  scope: string,
  callbacks: RealtimeCallbacks,
): () => void {
  if (scope === "process-map:company") processMapSubscribers.add(callbacks);
  return () => { processMapSubscribers.delete(callbacks); };
}

export function emitProcessMapChangedForTest(message: ProcessMapChangedMessage): void {
  for (const subscriber of processMapSubscribers) subscriber.onProcessMapChanged?.(message);
}

export function resetProcessMapRealtimeTestStub(): void {
  processMapSubscribers.clear();
}

export function getCurrentRealtimeConnectionID(): undefined {
  return undefined;
}

export function getCurrentRealtimeConnectionCorrelation(): undefined {
  return undefined;
}

export function realtimeEditorJSONScope(resourceType: string, resourceID: string, documentID: string): string {
  return `editor-json:${resourceType}:${resourceID}:${documentID}`;
}
