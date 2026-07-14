export type EditorEmailMailboxScope = Readonly<{
  sharedInboxID?: string;
  accountEmail?: string;
}>;

export function resolveEditorEmailMailboxScope(sharedInboxID?: string, accountEmail?: string): EditorEmailMailboxScope {
  const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
  if (cleanSharedInboxID) return { sharedInboxID: cleanSharedInboxID };
  const cleanAccountEmail = accountEmail?.trim().toLowerCase() ?? "";
  return cleanAccountEmail ? { accountEmail: cleanAccountEmail } : {};
}
