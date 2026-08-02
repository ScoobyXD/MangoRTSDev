const permanentJSONPersistence = {
  buildDocumentSaveRequest: (_nextText: string) => null,
  scheduleDocumentSave: (_nextText: string, _immediate = false) => undefined,
  flushPendingDocumentSave: (_fallbackText?: string) => undefined,
  saveDocumentNow: async (_nextText: string) => undefined,
  retryFailedSave: async () => undefined,
  discardFailedSave: () => undefined,
};

export function useEditorDocumentPersistence(_input: unknown) {
  return permanentJSONPersistence;
}
