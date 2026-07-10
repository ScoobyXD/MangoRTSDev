import { createSHA256 } from "hash-wasm";

type HashWorkerRequest = {
  file: File;
  chunkBytes: number;
};

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<HashWorkerRequest>) => void) | null;
  postMessage(message: unknown): void;
};

workerScope.onmessage = (event: MessageEvent<HashWorkerRequest>) => {
  void hashFile(event.data).catch((cause) => {
    workerScope.postMessage({
      type: "error",
      message: cause instanceof Error ? cause.message : "attachment_hash_failed",
    });
  });
};

async function hashFile(input: HashWorkerRequest): Promise<void> {
  const chunkBytes = Math.max(64 * 1024, Math.round(input.chunkBytes));
  const hasher = await createSHA256();
  hasher.init();
  let processedBytes = 0;
  if (input.file.size === 0) {
    workerScope.postMessage({ type: "progress", processedBytes: 0, totalBytes: 0 });
  }
  while (processedBytes < input.file.size) {
    const end = Math.min(input.file.size, processedBytes + chunkBytes);
    const chunk = new Uint8Array(await input.file.slice(processedBytes, end).arrayBuffer());
    hasher.update(chunk);
    processedBytes = end;
    workerScope.postMessage({ type: "progress", processedBytes, totalBytes: input.file.size });
  }
  const digest = hasher.digest("hex");
  if (typeof digest !== "string") throw new Error("attachment_hash_invalid_output");
  workerScope.postMessage({ type: "complete", sha256: digest.toLowerCase() });
}

export {};
