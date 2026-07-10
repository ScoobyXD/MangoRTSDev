import { createSHA256 } from "hash-wasm";

export const ATTACHMENT_HASH_CHUNK_BYTES = 4 * 1024 * 1024;

export type AttachmentHashProgress = (processedBytes: number, totalBytes: number) => void;

export type HashAttachmentFileOptions = {
  chunkBytes?: number;
  signal?: AbortSignal;
  onProgress?: AttachmentHashProgress;
  workerFactory?: () => Worker;
  preferWorker?: boolean;
};

type HashWorkerResponse =
  | { type: "progress"; processedBytes: number; totalBytes: number }
  | { type: "complete"; sha256: string }
  | { type: "error"; message: string };

/**
 * Hash a browser File without ever materializing the complete file in memory.
 * Browser builds use a dedicated worker; the chunked fallback keeps tests,
 * non-window consumers, and restrictive worker environments bounded too.
 */
export async function hashAttachmentFileSHA256(
  file: File,
  options: HashAttachmentFileOptions = {},
): Promise<string> {
  throwIfAttachmentUploadAborted(options.signal);
  const preferWorker = options.preferWorker ?? true;
  const workerFactory = options.workerFactory ?? defaultAttachmentHashWorkerFactory;
  if (preferWorker && typeof Worker !== "undefined") {
    try {
      return await hashAttachmentFileInWorker(file, workerFactory, options);
    } catch (cause) {
      if (isAttachmentAbortError(cause)) throw cause;
      // Construction can be blocked by a browser policy. The fallback still
      // hashes incrementally and never calls File.arrayBuffer() for the whole file.
      if (!(cause instanceof AttachmentHashWorkerUnavailableError)) throw cause;
    }
  }
  return hashAttachmentBlobIncrementally(file, options);
}

export async function hashAttachmentBlobIncrementally(
  blob: Blob,
  options: Omit<HashAttachmentFileOptions, "workerFactory" | "preferWorker"> = {},
): Promise<string> {
  const chunkBytes = normalizeAttachmentHashChunkBytes(options.chunkBytes);
  const hasher = await createSHA256();
  hasher.init();
  let processedBytes = 0;
  if (blob.size === 0) options.onProgress?.(0, 0);
  while (processedBytes < blob.size) {
    throwIfAttachmentUploadAborted(options.signal);
    const end = Math.min(blob.size, processedBytes + chunkBytes);
    const chunk = new Uint8Array(await blob.slice(processedBytes, end).arrayBuffer());
    throwIfAttachmentUploadAborted(options.signal);
    hasher.update(chunk);
    processedBytes = end;
    options.onProgress?.(processedBytes, blob.size);
  }
  throwIfAttachmentUploadAborted(options.signal);
  const digest = hasher.digest("hex");
  if (typeof digest !== "string") throw new Error("attachment_hash_invalid_output");
  return digest.toLowerCase();
}

export async function hashAttachmentPartSHA256Base64(
  part: Blob,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  throwIfAttachmentUploadAborted(options.signal);
  const hex = await hashAttachmentBlobIncrementally(part, {
    chunkBytes: ATTACHMENT_HASH_CHUNK_BYTES,
    signal: options.signal,
  });
  return sha256HexToBase64(hex);
}

export function sha256HexToBase64(hex: string): string {
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("attachment_upload_checksum_invalid");
  const digest = new Uint8Array(32);
  for (let index = 0; index < digest.length; index += 1) {
    digest[index] = Number.parseInt(hex.slice(index * 2, (index * 2) + 2), 16);
  }
  return bytesToBase64(digest);
}

export function throwIfAttachmentUploadAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw attachmentUploadAbortError(signal.reason);
}

export function attachmentUploadAbortError(reason?: unknown): Error {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  if (typeof DOMException !== "undefined") return new DOMException("Attachment upload canceled", "AbortError");
  const error = new Error("Attachment upload canceled");
  error.name = "AbortError";
  return error;
}

export function isAttachmentAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function hashAttachmentFileInWorker(
  file: File,
  workerFactory: () => Worker,
  options: HashAttachmentFileOptions,
): Promise<string> {
  let worker: Worker;
  try {
    worker = workerFactory();
  } catch (cause) {
    throw new AttachmentHashWorkerUnavailableError(cause);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => settle(() => reject(attachmentUploadAbortError(options.signal?.reason)));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<HashWorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        options.onProgress?.(message.processedBytes, message.totalBytes);
        return;
      }
      if (message.type === "complete") {
        settle(() => resolve(message.sha256.toLowerCase()));
        return;
      }
      settle(() => reject(new Error(message.message || "attachment_hash_failed")));
    };
    worker.onerror = () => settle(() => reject(new AttachmentHashWorkerUnavailableError("attachment_hash_worker_failed")));
    try {
      worker.postMessage({ file, chunkBytes: normalizeAttachmentHashChunkBytes(options.chunkBytes) });
    } catch (cause) {
      settle(() => reject(new AttachmentHashWorkerUnavailableError(cause)));
    }
  });
}

function defaultAttachmentHashWorkerFactory(): Worker {
  return new Worker(new URL("./attachmentHashWorker.ts", import.meta.url), { type: "module" });
}

function normalizeAttachmentHashChunkBytes(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return ATTACHMENT_HASH_CHUNK_BYTES;
  return Math.max(64 * 1024, Math.round(value as number));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === "function") return btoa(binary);
  const nodeBuffer = (globalThis as typeof globalThis & { Buffer?: { from(value: Uint8Array): { toString(encoding: string): string } } }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(bytes).toString("base64");
  throw new Error("attachment_upload_base64_encoder_unavailable");
}

class AttachmentHashWorkerUnavailableError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "attachment_hash_worker_unavailable");
    this.name = "AttachmentHashWorkerUnavailableError";
  }
}
