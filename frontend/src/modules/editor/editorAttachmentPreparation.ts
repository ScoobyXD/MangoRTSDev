export async function withPreparedEditorAttachmentResource<T>(
  prepareResource: (() => Promise<void>) | undefined,
  mutation: () => Promise<T>,
): Promise<T> {
  await prepareResource?.();
  return mutation();
}
