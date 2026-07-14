export type EditorAttachmentMutationLifecycle = {
  begin: () => void;
  finish: (succeeded: boolean) => void;
};

export type EditorAttachmentMutationState = {
  active: number;
  succeeded: boolean;
};

export function beginEditorAttachmentMutation(
  states: Map<string, EditorAttachmentMutationState>,
  key: string,
): void {
  const cleanKey = key.trim();
  if (!cleanKey) return;
  const current = states.get(cleanKey);
  states.set(cleanKey, {
    active: (current?.active ?? 0) + 1,
    succeeded: current?.succeeded ?? false,
  });
}

export function finishEditorAttachmentMutation(
  states: Map<string, EditorAttachmentMutationState>,
  key: string,
  succeeded: boolean,
): boolean {
  const cleanKey = key.trim();
  const current = states.get(cleanKey);
  if (!current) return false;
  const next = {
    active: Math.max(0, current.active - 1),
    succeeded: current.succeeded || succeeded,
  };
  if (next.active > 0) {
    states.set(cleanKey, next);
    return false;
  }
  states.delete(cleanKey);
  return !next.succeeded;
}

export async function withPreparedEditorAttachmentResource<T>(
  prepareResource: (() => Promise<void>) | undefined,
  mutation: () => Promise<T>,
  lifecycle?: EditorAttachmentMutationLifecycle,
): Promise<T> {
  lifecycle?.begin();
  let succeeded = false;
  try {
    await prepareResource?.();
    const result = await mutation();
    succeeded = true;
    return result;
  } finally {
    lifecycle?.finish(succeeded);
  }
}
