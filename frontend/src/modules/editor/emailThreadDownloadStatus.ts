export type EmailThreadDownloadStatus = "partial" | "downloading" | "complete" | "failed";

/**
 * A stored one-off message can retain an old failed/partial download state even
 * though it has no provider thread to download. Treat that state as complete so
 * the UI does not claim that missing thread history exists.
 */
export function resolveEmailThreadDownloadStatus(
  status: EmailThreadDownloadStatus | undefined,
  historyComplete: boolean,
  providerThreadID: string | undefined,
): EmailThreadDownloadStatus {
  if (!providerThreadID?.trim()) return "complete";
  return status ?? (historyComplete ? "complete" : "partial");
}
