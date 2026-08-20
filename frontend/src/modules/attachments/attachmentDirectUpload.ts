import type {
  AttachmentRequestJSON,
  MangoAttachmentUploadResponse,
  UploadMangoAttachmentInput,
} from "./attachmentApi.js";
import {
  attachmentUploadAbortError,
  hashAttachmentFileSHA256,
  hashAttachmentPartSHA256Base64,
  isAttachmentAbortError,
  sha256HexToBase64,
  throwIfAttachmentUploadAborted,
} from "./attachmentHash.js";

export const ATTACHMENT_SINGLE_PUT_MAX_BYTES = 64 * 1024 * 1024;
export const ATTACHMENT_MULTIPART_PART_BYTES = 16 * 1024 * 1024;
export const ATTACHMENT_MAX_PARTS_IN_FLIGHT = 3;
export const ATTACHMENT_MAX_PAGE_PUTS_IN_FLIGHT = 4;
export const ATTACHMENT_MAX_AUTOMATIC_PUT_ATTEMPTS = 5;

export type MangoAttachmentUploadState =
  | "preparing"
  | "uploading"
  | "retrying"
  | "completing"
  | "complete"
  | "canceled"
  | "failed";

export type MangoAttachmentUploadProgress = {
  state: MangoAttachmentUploadState;
  bytesUploaded: number;
  bytesPrepared: number;
  totalBytes: number;
  fraction: number;
  attempt?: number;
  partNumber?: number;
  attachmentID?: string;
  errorCode?: string;
};

export type MangoAttachmentUploadPolicy = {
  directUploadEnabled: boolean;
  maxFileBytes: number;
  singlePutMaxBytes: number;
  multipartPartBytes: number;
  maxConcurrentParts: number;
  intentLifetimeSeconds: number;
};

type PresignedUploadInstruction = {
  method: "PUT" | string;
  url: string;
  expiresAt?: string;
  requiredHeaders: Record<string, string>;
};

type SingleUploadPlan = PresignedUploadInstruction & {
  strategy: "single";
};

type MultipartUploadPlan = {
  strategy: "multipart";
  partSizeBytes: number;
  partCount: number;
};

type CreateUploadIntentResponse = {
  uploadIntentId: string;
  attachmentId: string;
  expiresAt: string;
  upload: SingleUploadPlan | MultipartUploadPlan;
};

type SignUploadPartsResponse = {
  parts: Array<PresignedUploadInstruction & { partNumber: number }>;
};

type UploadIntentStatusResponse = {
  uploadIntentId?: string;
  id?: string;
  status?: string;
  strategy?: string;
  uploadStrategy?: string;
  sha256?: string;
  sizeBytes?: number;
  expectedSizeBytes?: number;
  expiresAt?: string;
  acceptedParts?: unknown[];
  uploadedParts?: unknown[];
  parts?: unknown[];
};

type UploadIntentRequest = {
  clientRequestId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  resourceType: string;
  resourceId: string;
  relationshipKind: string;
  sourceKind: string;
  informationId?: string;
  messageId?: string;
  editorSurface?: string;
  sourceProvider?: string;
  originalWidth?: number;
  originalHeight?: number;
  expectedRevision?: number;
};

type ResumeRecord = {
  version: 1;
  clientRequestId: string;
  uploadIntentId: string;
  attachmentId: string;
  expiresAt: string;
  strategy: "single" | "multipart";
  partSizeBytes?: number;
  partCount?: number;
  filename: string;
  sizeBytes: number;
  lastModified: number;
  relativePath: string;
  sha256: string;
  contentType: string;
  resourceType: string;
  resourceId: string;
  informationId: string;
  messageId: string;
  editorSurface: string;
  relationshipKind: string;
  sourceKind: string;
  sourceProvider: string;
  originalWidth: number | null;
  originalHeight: number | null;
  expectedRevision: number | null;
};

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AttachmentDirectUploadDependencies = {
  hashFile?: typeof hashAttachmentFileSHA256;
  hashPart?: typeof hashAttachmentPartSHA256Base64;
  xhrFactory?: () => XMLHttpRequest;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  randomUUID?: () => string;
  storage?: BrowserStorage | null;
  policy?: MangoAttachmentUploadPolicy;
};

type PutProgress = (loadedBytes: number) => void;

type PresignedPutResult = {
  eTag?: string;
  checksumSHA256?: string;
};

let uploadPolicyCache = new WeakMap<AttachmentRequestJSON, { expiresAt: number; promise: Promise<MangoAttachmentUploadPolicy> }>();
const activeResumeStorageKeys = new Set<string>();

export async function readMangoAttachmentUploadPolicy(
  request: AttachmentRequestJSON,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<MangoAttachmentUploadPolicy> {
  throwIfAttachmentUploadAborted(options.signal);
  const now = Date.now();
  const cached = uploadPolicyCache.get(request);
  if (!options.force && cached && cached.expiresAt > now) {
    const policy = await cached.promise;
    throwIfAttachmentUploadAborted(options.signal);
    return policy;
  }
  // The cache is shared by every file on the page, so one file's cancellation
  // must not cancel the policy read used by its siblings.
  const promise = request<MangoAttachmentUploadPolicy>("/v1/attachments/upload-policy").then(normalizeUploadPolicy);
  uploadPolicyCache.set(request, { expiresAt: now + (5 * 60 * 1000), promise });
  try {
    const policy = await promise;
    throwIfAttachmentUploadAborted(options.signal);
    return policy;
  } catch (cause) {
    if (uploadPolicyCache.get(request)?.promise === promise) uploadPolicyCache.delete(request);
    throw cause;
  }
}

export function clearMangoAttachmentUploadPolicyCache(): void {
  uploadPolicyCache = new WeakMap();
}

export async function uploadBrowserAttachment(
  request: AttachmentRequestJSON,
  input: UploadMangoAttachmentInput,
  dependencies: AttachmentDirectUploadDependencies = {},
): Promise<MangoAttachmentUploadResponse> {
  const signal = input.signal;
  const totalBytes = input.file.size;
  let intentID = "";
  let resumeStorageKey = "";
  let resumeStorageClaimed = false;
  let lastProgress: MangoAttachmentUploadProgress = progressSnapshot("preparing", totalBytes, 0, 0);
  const emit = (next: Partial<MangoAttachmentUploadProgress> & Pick<MangoAttachmentUploadProgress, "state">) => {
    const bytesUploaded = clampBytes(next.bytesUploaded ?? lastProgress.bytesUploaded, totalBytes);
    const bytesPrepared = clampBytes(next.bytesPrepared ?? lastProgress.bytesPrepared, totalBytes);
    const phaseBytes = next.state === "preparing" ? bytesPrepared : bytesUploaded;
    const fraction = totalBytes === 0
      ? next.state === "complete" ? 1 : 0
      : Math.max(0, Math.min(1, phaseBytes / totalBytes));
    lastProgress = { ...lastProgress, ...next, bytesUploaded, bytesPrepared, totalBytes, fraction };
    try {
      input.onProgress?.(lastProgress);
    } catch {
      // A view callback must never corrupt a durable upload.
    }
  };

  emit({ state: "preparing", bytesPrepared: 0, bytesUploaded: 0 });
  try {
    throwIfAttachmentUploadAborted(signal);
    const policy = dependencies.policy ?? await readMangoAttachmentUploadPolicy(request, { signal });
    if (!policy.directUploadEnabled) throw new AttachmentUploadError("attachment_direct_upload_disabled");
    if (totalBytes > policy.maxFileBytes) {
      throw new AttachmentUploadError("attachment_file_too_large", { maxFileBytes: policy.maxFileBytes });
    }

    const hashFile = dependencies.hashFile ?? hashAttachmentFileSHA256;
    const sha256 = await hashFile(input.file, {
      signal,
      onProgress: (processedBytes) => emit({ state: "preparing", bytesPrepared: processedBytes }),
    });
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new AttachmentUploadError("attachment_upload_checksum_invalid");
    throwIfAttachmentUploadAborted(signal);

    const baseResumeStorageKey = attachmentUploadResumeStorageKey(input);
    if (!activeResumeStorageKeys.has(baseResumeStorageKey)) {
      activeResumeStorageKeys.add(baseResumeStorageKey);
      resumeStorageKey = baseResumeStorageKey;
      resumeStorageClaimed = true;
    }
    const storage = dependencies.storage === undefined ? browserLocalStorage() : dependencies.storage;
    const existingRecord = resumeStorageKey ? readResumeRecord(storage, resumeStorageKey) : null;
    const reusableRecord = existingRecord && resumeRecordMatches(existingRecord, input, sha256)
      ? existingRecord
      : null;
    if (existingRecord && !reusableRecord) removeResumeRecord(storage, resumeStorageKey);

    const clientRequestID = reusableRecord?.clientRequestId || createClientRequestID(dependencies.randomUUID);
    let intentRequest = buildUploadIntentRequest(input, sha256, clientRequestID);
    let status: UploadIntentStatusResponse | null = null;
    let intent: CreateUploadIntentResponse;

    if (reusableRecord && !isExpiredTimestamp(reusableRecord.expiresAt)) {
      try {
        status = await request<UploadIntentStatusResponse>(uploadIntentPath(reusableRecord.uploadIntentId), { signal });
        validateResumedIntentStatus(status, reusableRecord, sha256, totalBytes);
        const state = cleanString(status.status).toLowerCase();
        if (state === "completed" || state === "completing") {
          intentID = reusableRecord.uploadIntentId;
          emit({ state: "completing", attachmentID: reusableRecord.attachmentId, bytesUploaded: totalBytes });
          const completed = await completeUploadIntentWithRetry(request, intentID, signal, dependencies);
          removeResumeRecord(storage, resumeStorageKey);
          emit({ state: "complete", attachmentID: completed.attachment.attachment_id, bytesUploaded: totalBytes });
          return completed;
        }
        if (isTerminalIntentState(state)) {
          await abortUploadIntentBestEffort(request, reusableRecord.uploadIntentId);
          removeResumeRecord(storage, resumeStorageKey);
          status = null;
          intentRequest = { ...intentRequest, clientRequestId: createClientRequestID(dependencies.randomUUID) };
          intent = await createUploadIntent(request, input.companyID, intentRequest, signal, dependencies);
        } else {
          // Idempotent recreation refreshes a single PUT URL and recovers the
          // multipart plan without persisting any bearer URL in the browser.
          intent = await createUploadIntent(request, input.companyID, intentRequest, signal, dependencies);
          if (intent.uploadIntentId !== reusableRecord.uploadIntentId) {
            throw new AttachmentUploadError("attachment_upload_state_conflict");
          }
        }
      } catch (cause) {
        if (!isMissingOrExpiredIntentError(cause)) throw cause;
        removeResumeRecord(storage, resumeStorageKey);
        status = null;
        intentRequest = { ...intentRequest, clientRequestId: createClientRequestID(dependencies.randomUUID) };
        intent = await createUploadIntent(request, input.companyID, intentRequest, signal, dependencies);
      }
    } else {
      if (reusableRecord) {
        removeResumeRecord(storage, resumeStorageKey);
        intentRequest = { ...intentRequest, clientRequestId: createClientRequestID(dependencies.randomUUID) };
      }
      intent = await createUploadIntent(request, input.companyID, intentRequest, signal, dependencies);
    }

    validateUploadIntentResponse(intent, totalBytes, policy);
    intentID = intent.uploadIntentId;
    const resumeRecord = resumeRecordFromIntent(intent, input, sha256, intentRequest.clientRequestId);
    if (resumeStorageKey) writeResumeRecord(storage, resumeStorageKey, resumeRecord);

    if (intent.upload.strategy === "single") {
      await uploadSingleAttachment(request, input, intentRequest, intent, emit, dependencies);
    } else {
      const acceptedPartNumbers = acceptedMultipartPartNumbers(status);
      await uploadMultipartAttachment(
        request,
        input,
        intent,
        acceptedPartNumbers,
        policy,
        emit,
        dependencies,
      );
    }

    throwIfAttachmentUploadAborted(signal);
    emit({ state: "completing", attachmentID: intent.attachmentId, bytesUploaded: totalBytes });
    const result = await completeUploadIntentWithRetry(request, intent.uploadIntentId, signal, dependencies);
    removeResumeRecord(storage, resumeStorageKey);
    emit({ state: "complete", attachmentID: result.attachment.attachment_id, bytesUploaded: totalBytes });
    return result;
  } catch (cause) {
    if (isAttachmentAbortError(cause) || signal?.aborted) {
      const storage = dependencies.storage === undefined ? browserLocalStorage() : dependencies.storage;
      removeResumeRecord(storage, resumeStorageKey);
      emit({ state: "canceled", errorCode: "attachment_upload_canceled" });
      if (intentID) await abortUploadIntentBestEffort(request, intentID);
      throw attachmentUploadAbortError(signal?.reason);
    }
    emit({ state: "failed", errorCode: attachmentUploadErrorCode(cause) });
    throw cause;
  } finally {
    if (resumeStorageClaimed) activeResumeStorageKeys.delete(resumeStorageKey);
  }
}

async function uploadSingleAttachment(
  request: AttachmentRequestJSON,
  input: UploadMangoAttachmentInput,
  intentRequest: UploadIntentRequest,
  initialIntent: CreateUploadIntentResponse,
  emit: (next: Partial<MangoAttachmentUploadProgress> & Pick<MangoAttachmentUploadProgress, "state">) => void,
  dependencies: AttachmentDirectUploadDependencies,
): Promise<void> {
  if (initialIntent.upload.strategy !== "single") throw new AttachmentUploadError("attachment_upload_state_conflict");
  let instruction: PresignedUploadInstruction = initialIntent.upload;
  validateSingleUploadChecksum(instruction, intentRequest.sha256);
  await putWithAutomaticRetry({
    body: input.file,
    signal: input.signal,
    instruction: () => instruction,
    refreshInstruction: async () => {
      const refreshed = await createUploadIntent(request, input.companyID, intentRequest, input.signal, dependencies);
      if (refreshed.uploadIntentId !== initialIntent.uploadIntentId || refreshed.upload.strategy !== "single") {
        throw new AttachmentUploadError("attachment_upload_state_conflict");
      }
      instruction = refreshed.upload;
      validateSingleUploadChecksum(instruction, intentRequest.sha256);
    },
    onProgress: (loadedBytes) => emit({ state: "uploading", bytesUploaded: loadedBytes }),
    onAttempt: (state, attempt) => emit({ state, attempt, bytesUploaded: state === "retrying" ? 0 : undefined }),
    dependencies,
  });
  emit({ state: "uploading", bytesUploaded: input.file.size });
}

async function uploadMultipartAttachment(
  request: AttachmentRequestJSON,
  input: UploadMangoAttachmentInput,
  intent: CreateUploadIntentResponse,
  acceptedPartNumbers: Set<number>,
  policy: MangoAttachmentUploadPolicy,
  emit: (next: Partial<MangoAttachmentUploadProgress> & Pick<MangoAttachmentUploadProgress, "state">) => void,
  dependencies: AttachmentDirectUploadDependencies,
): Promise<void> {
  if (intent.upload.strategy !== "multipart") throw new AttachmentUploadError("attachment_upload_state_conflict");
  const { partSizeBytes, partCount } = intent.upload;
  const expectedPartCount = Math.max(1, Math.ceil(input.file.size / partSizeBytes));
  if (partCount !== expectedPartCount) throw new AttachmentUploadError("attachment_upload_part_invalid");
  const confirmedParts = new Set<number>();
  let confirmedBytes = 0;
  for (const partNumber of acceptedPartNumbers) {
    if (partNumber < 1 || partNumber > partCount) continue;
    confirmedParts.add(partNumber);
    confirmedBytes += multipartPartLength(input.file.size, partSizeBytes, partNumber);
  }
  const inFlightBytes = new Map<number, number>();
  const reportProgress = (state: "uploading" | "retrying", partNumber?: number, attempt?: number) => {
    const uploaded = Math.min(input.file.size, confirmedBytes + Array.from(inFlightBytes.values()).reduce((sum, value) => sum + value, 0));
    emit({ state, bytesUploaded: uploaded, partNumber, attempt });
  };
  reportProgress("uploading");

  const pendingPartNumbers: number[] = [];
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    if (!confirmedParts.has(partNumber)) pendingPartNumbers.push(partNumber);
  }
  if (pendingPartNumbers.length === 0) {
    emit({ state: "uploading", bytesUploaded: input.file.size });
    return;
  }

  const internalController = new AbortController();
  const abortFromCaller = () => internalController.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (input.signal?.aborted) abortFromCaller();
  let nextPartIndex = 0;
  let firstFailure: unknown;
  const workerCount = Math.max(1, Math.min(
    ATTACHMENT_MAX_PARTS_IN_FLIGHT,
    policy.maxConcurrentParts,
    pendingPartNumbers.length,
  ));
  const hashPart = dependencies.hashPart ?? hashAttachmentPartSHA256Base64;

  const runWorker = async () => {
    while (!internalController.signal.aborted) {
      const currentIndex = nextPartIndex;
      nextPartIndex += 1;
      const partNumber = pendingPartNumbers[currentIndex];
      if (partNumber === undefined) return;
      const start = (partNumber - 1) * partSizeBytes;
      const end = Math.min(input.file.size, start + partSizeBytes);
      const part = input.file.slice(start, end);
      try {
        const checksum = await hashPart(part, { signal: internalController.signal });
        let instruction = await signMultipartPart(request, intent.uploadIntentId, partNumber, checksum, internalController.signal, dependencies);
        await putWithAutomaticRetry({
          body: part,
          signal: internalController.signal,
          instruction: () => instruction,
          refreshInstruction: async () => {
            instruction = await signMultipartPart(request, intent.uploadIntentId, partNumber, checksum, internalController.signal, dependencies);
          },
          onProgress: (loadedBytes) => {
            inFlightBytes.set(partNumber, Math.min(part.size, loadedBytes));
            reportProgress("uploading", partNumber);
          },
          onAttempt: (state, attempt) => {
            if (state === "retrying") inFlightBytes.set(partNumber, 0);
            reportProgress(state, partNumber, attempt);
          },
          dependencies,
        });
        inFlightBytes.delete(partNumber);
        confirmedParts.add(partNumber);
        confirmedBytes += part.size;
        reportProgress("uploading", partNumber);
      } catch (cause) {
        if (firstFailure === undefined) firstFailure = cause;
        internalController.abort(cause);
        return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  } finally {
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
  if (firstFailure !== undefined) throw firstFailure;
  throwIfAttachmentUploadAborted(input.signal);
  emit({ state: "uploading", bytesUploaded: input.file.size });
}

async function signMultipartPart(
  request: AttachmentRequestJSON,
  intentID: string,
  partNumber: number,
  checksum: string,
  signal: AbortSignal,
  dependencies: AttachmentDirectUploadDependencies,
): Promise<PresignedUploadInstruction> {
  const response = await controlRequestWithRetry(
    () => request<SignUploadPartsResponse>(`${uploadIntentPath(intentID)}/parts`, {
      method: "POST",
      json: { parts: [{ partNumber, checksumAlgorithm: "SHA256", checksum }] },
      signal,
    }),
    signal,
    dependencies,
  );
  const instruction = response.parts?.find((part) => part.partNumber === partNumber);
  if (!instruction) throw new AttachmentUploadError("attachment_upload_part_invalid");
  validatePresignedInstruction(instruction);
  const signedChecksum = Object.entries(instruction.requiredHeaders ?? {}).find(([name]) => name.toLowerCase() === "x-amz-checksum-sha256")?.[1];
  if (signedChecksum !== checksum) throw new AttachmentUploadError("attachment_upload_checksum_mismatch");
  return instruction;
}

async function createUploadIntent(
  request: AttachmentRequestJSON,
  companyID: string,
  body: UploadIntentRequest,
  signal: AbortSignal | undefined,
  dependencies: AttachmentDirectUploadDependencies,
): Promise<CreateUploadIntentResponse> {
  const cleanCompanyID = companyID.trim();
  return controlRequestWithRetry(
    () => request<CreateUploadIntentResponse>("/v1/attachments/upload-intents", {
      method: "POST",
      headers: cleanCompanyID ? { "X-Mango-Company-ID": cleanCompanyID } : undefined,
      json: body,
      signal,
    }),
    signal,
    dependencies,
  );
}

async function completeUploadIntentWithRetry(
  request: AttachmentRequestJSON,
  intentID: string,
  signal: AbortSignal | undefined,
  dependencies: AttachmentDirectUploadDependencies,
): Promise<MangoAttachmentUploadResponse> {
  return controlRequestWithRetry(
    () => request<MangoAttachmentUploadResponse>(`${uploadIntentPath(intentID)}/complete`, {
      method: "POST",
      json: {},
      signal,
      timeoutMs: 120_000,
    }),
    signal,
    dependencies,
    4,
  );
}

async function abortUploadIntentBestEffort(request: AttachmentRequestJSON, intentID: string): Promise<void> {
  try {
    await request<unknown>(uploadIntentPath(intentID), { method: "DELETE", timeoutMs: 15_000 });
  } catch {
    // S3 lifecycle and backend expiry cleanup are the durable safety nets.
  }
}

async function putWithAutomaticRetry(input: {
  body: Blob;
  signal?: AbortSignal;
  instruction: () => PresignedUploadInstruction;
  refreshInstruction: () => Promise<void>;
  onProgress: PutProgress;
  onAttempt: (state: "uploading" | "retrying", attempt: number) => void;
  dependencies: AttachmentDirectUploadDependencies;
}): Promise<PresignedPutResult> {
  const sleep = input.dependencies.sleep ?? abortableSleep;
  const random = input.dependencies.random ?? Math.random;
  for (let attempt = 1; attempt <= ATTACHMENT_MAX_AUTOMATIC_PUT_ATTEMPTS; attempt += 1) {
    throwIfAttachmentUploadAborted(input.signal);
    if (attempt > 1) {
      input.onAttempt("retrying", attempt);
      await sleep(retryDelayMilliseconds(attempt, random), input.signal);
    }
    input.onAttempt("uploading", attempt);
    const release = await pagePutSemaphore.acquire(input.signal);
    try {
      return await putPresignedAttachmentBytes(input.instruction(), input.body, {
        signal: input.signal,
        onProgress: input.onProgress,
        xhrFactory: input.dependencies.xhrFactory,
      });
    } catch (cause) {
      if (isAttachmentAbortError(cause)) throw cause;
      const status = cause instanceof PresignedAttachmentUploadError ? cause.status : 0;
      if (status === 403 && attempt < ATTACHMENT_MAX_AUTOMATIC_PUT_ATTEMPTS) {
        await input.refreshInstruction();
        continue;
      }
      if (!isRetryablePresignedPutFailure(cause) || attempt >= ATTACHMENT_MAX_AUTOMATIC_PUT_ATTEMPTS) throw cause;
    } finally {
      release();
    }
  }
  throw new AttachmentUploadError("attachment_upload_storage_unavailable");
}

export function putPresignedAttachmentBytes(
  instruction: PresignedUploadInstruction,
  body: Blob,
  options: { signal?: AbortSignal; onProgress?: PutProgress; xhrFactory?: () => XMLHttpRequest } = {},
): Promise<PresignedPutResult> {
  validatePresignedInstruction(instruction);
  throwIfAttachmentUploadAborted(options.signal);
  const xhrFactory = options.xhrFactory ?? (() => new XMLHttpRequest());
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    let settled = false;
    const cleanup = () => options.signal?.removeEventListener("abort", onAbort);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => xhr.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.open("PUT", instruction.url, true);
    xhr.withCredentials = false;
    xhr.timeout = 10 * 60 * 1000;
    for (const [name, value] of Object.entries(instruction.requiredHeaders ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      options.onProgress?.(Math.min(body.size, Math.max(0, event.loaded)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(() => resolve({
          eTag: cleanHeaderValue(xhr.getResponseHeader("ETag")),
          checksumSHA256: cleanHeaderValue(xhr.getResponseHeader("x-amz-checksum-sha256")),
        }));
        return;
      }
      settle(() => reject(new PresignedAttachmentUploadError(xhr.status)));
    };
    xhr.onerror = () => settle(() => reject(new PresignedAttachmentUploadError(0, "attachment_upload_network_or_cors_error")));
    xhr.ontimeout = () => settle(() => reject(new PresignedAttachmentUploadError(408)));
    xhr.onabort = () => settle(() => reject(
      options.signal?.aborted
        ? attachmentUploadAbortError(options.signal.reason)
        : new PresignedAttachmentUploadError(0, "attachment_upload_request_aborted"),
    ));
    try {
      xhr.send(body);
    } catch (cause) {
      settle(() => reject(cause));
    }
  });
}

function normalizeUploadPolicy(value: MangoAttachmentUploadPolicy): MangoAttachmentUploadPolicy {
  const policy = {
    directUploadEnabled: Boolean(value?.directUploadEnabled),
    maxFileBytes: positiveInteger(value?.maxFileBytes),
    singlePutMaxBytes: positiveInteger(value?.singlePutMaxBytes),
    multipartPartBytes: positiveInteger(value?.multipartPartBytes),
    maxConcurrentParts: positiveInteger(value?.maxConcurrentParts),
    intentLifetimeSeconds: positiveInteger(value?.intentLifetimeSeconds),
  };
  if (!policy.maxFileBytes || !policy.singlePutMaxBytes || !policy.multipartPartBytes || !policy.maxConcurrentParts || !policy.intentLifetimeSeconds) {
    throw new AttachmentUploadError("attachment_upload_policy_invalid");
  }
  return policy;
}

function buildUploadIntentRequest(
  input: UploadMangoAttachmentInput,
  sha256: string,
  clientRequestId: string,
): UploadIntentRequest {
  const result: UploadIntentRequest = {
    clientRequestId,
    filename: input.file.name.trim() || "attachment",
    sizeBytes: input.file.size,
    sha256,
    contentType: input.file.type.trim() || "application/octet-stream",
    resourceType: input.resourceType,
    resourceId: input.resourceID.trim(),
    relationshipKind: input.relationshipKind,
    sourceKind: input.sourceKind,
  };
  const informationId = cleanOptionalString(input.informationID);
  const messageId = cleanOptionalString(input.messageID);
  const editorSurface = cleanOptionalString(input.editorSurface);
  const sourceProvider = cleanOptionalString(input.sourceProvider);
  if (informationId !== undefined) result.informationId = informationId;
  if (messageId !== undefined) result.messageId = messageId;
  if (editorSurface !== undefined) result.editorSurface = editorSurface;
  if (sourceProvider !== undefined) result.sourceProvider = sourceProvider;
  const originalWidth = positiveOptionalInteger(input.originalWidth);
  const originalHeight = positiveOptionalInteger(input.originalHeight);
  if (originalWidth !== undefined) result.originalWidth = originalWidth;
  if (originalHeight !== undefined) result.originalHeight = originalHeight;
  const expectedRevision = positiveOptionalInteger(input.expectedRevision);
  if (expectedRevision !== undefined) result.expectedRevision = expectedRevision;
  return result;
}

function validateUploadIntentResponse(
  intent: CreateUploadIntentResponse,
  sizeBytes: number,
  policy: MangoAttachmentUploadPolicy,
): void {
  if (!cleanString(intent?.uploadIntentId) || !cleanString(intent?.attachmentId) || !cleanString(intent?.expiresAt) || !intent?.upload) {
    throw new AttachmentUploadError("attachment_upload_intent_invalid");
  }
  if (intent.upload.strategy === "single") {
    if (sizeBytes > policy.singlePutMaxBytes) throw new AttachmentUploadError("attachment_upload_state_conflict");
    validatePresignedInstruction(intent.upload);
    return;
  }
  if (intent.upload.strategy !== "multipart" || sizeBytes <= policy.singlePutMaxBytes) {
    throw new AttachmentUploadError("attachment_upload_state_conflict");
  }
  if (positiveInteger(intent.upload.partSizeBytes) !== intent.upload.partSizeBytes || positiveInteger(intent.upload.partCount) !== intent.upload.partCount) {
    throw new AttachmentUploadError("attachment_upload_part_invalid");
  }
}

function validatePresignedInstruction(instruction: PresignedUploadInstruction): void {
  if (instruction?.method?.toUpperCase() !== "PUT" || !cleanString(instruction?.url)) {
    throw new AttachmentUploadError("attachment_upload_storage_unavailable");
  }
  try {
    const url = new URL(instruction.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid protocol");
  } catch {
    throw new AttachmentUploadError("attachment_upload_storage_unavailable");
  }
  for (const [name, value] of Object.entries(instruction.requiredHeaders ?? {})) {
    if (!name.trim() || /^(authorization|cookie|x-mango-|x-company)/i.test(name) || /[\r\n]/.test(name + value)) {
      throw new AttachmentUploadError("attachment_upload_signed_headers_invalid");
    }
  }
}

function validateSingleUploadChecksum(instruction: PresignedUploadInstruction, sha256: string): void {
  const signedChecksum = Object.entries(instruction.requiredHeaders ?? {}).find(([name]) => name.toLowerCase() === "x-amz-checksum-sha256")?.[1];
  if (signedChecksum !== sha256HexToBase64(sha256)) throw new AttachmentUploadError("attachment_upload_checksum_mismatch");
}

function validateResumedIntentStatus(
  status: UploadIntentStatusResponse,
  record: ResumeRecord,
  sha256: string,
  sizeBytes: number,
): void {
  const returnedID = cleanString(status.uploadIntentId) || cleanString(status.id);
  if (returnedID && returnedID !== record.uploadIntentId) throw new AttachmentUploadError("attachment_upload_state_conflict");
  if (cleanString(status.sha256) && cleanString(status.sha256).toLowerCase() !== sha256) {
    throw new AttachmentUploadError("attachment_upload_checksum_mismatch");
  }
  const returnedSize = finiteNumber(status.expectedSizeBytes) ?? finiteNumber(status.sizeBytes);
  if (returnedSize !== undefined && returnedSize !== sizeBytes) throw new AttachmentUploadError("attachment_upload_size_mismatch");
}

function acceptedMultipartPartNumbers(status: UploadIntentStatusResponse | null): Set<number> {
  const values = status?.acceptedParts ?? status?.uploadedParts ?? status?.parts ?? [];
  const result = new Set<number>();
  for (const value of values) {
    if (typeof value === "number") {
      if (Number.isInteger(value)) result.add(value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const partNumber = finiteNumber(record.partNumber) ?? finiteNumber(record.part_number);
    if (partNumber !== undefined && Number.isInteger(partNumber)) result.add(partNumber);
  }
  return result;
}

function resumeRecordFromIntent(
  intent: CreateUploadIntentResponse,
  input: UploadMangoAttachmentInput,
  sha256: string,
  clientRequestId: string,
): ResumeRecord {
  const record: ResumeRecord = {
    version: 1,
    clientRequestId,
    uploadIntentId: intent.uploadIntentId,
    attachmentId: intent.attachmentId,
    expiresAt: intent.expiresAt,
    strategy: intent.upload.strategy,
    filename: input.file.name,
    sizeBytes: input.file.size,
    lastModified: input.file.lastModified,
    relativePath: attachmentRelativePath(input.file),
    sha256,
    contentType: input.file.type.trim() || "application/octet-stream",
    resourceType: input.resourceType,
    resourceId: input.resourceID.trim(),
    informationId: input.informationID?.trim() ?? "",
    messageId: input.messageID?.trim() ?? "",
    editorSurface: input.editorSurface?.trim() ?? "",
    relationshipKind: input.relationshipKind,
    sourceKind: input.sourceKind,
    sourceProvider: input.sourceProvider?.trim() ?? "",
    originalWidth: positiveOptionalInteger(input.originalWidth) ?? null,
    originalHeight: positiveOptionalInteger(input.originalHeight) ?? null,
    expectedRevision: positiveOptionalInteger(input.expectedRevision) ?? null,
  };
  if (intent.upload.strategy === "multipart") {
    record.partSizeBytes = intent.upload.partSizeBytes;
    record.partCount = intent.upload.partCount;
  }
  return record;
}

function resumeRecordMatches(record: ResumeRecord, input: UploadMangoAttachmentInput, sha256: string): boolean {
  return record.version === 1
    && record.filename === input.file.name
    && record.sizeBytes === input.file.size
    && record.lastModified === input.file.lastModified
    && record.relativePath === attachmentRelativePath(input.file)
    && record.sha256 === sha256
    && record.contentType === (input.file.type.trim() || "application/octet-stream")
    && record.resourceType === input.resourceType
    && record.resourceId === input.resourceID.trim()
    && record.informationId === (input.informationID?.trim() ?? "")
    && record.messageId === (input.messageID?.trim() ?? "")
    && record.editorSurface === (input.editorSurface?.trim() ?? "")
    && record.relationshipKind === input.relationshipKind
    && record.sourceKind === input.sourceKind
    && record.sourceProvider === (input.sourceProvider?.trim() ?? "")
    && record.originalWidth === (positiveOptionalInteger(input.originalWidth) ?? null)
    && record.originalHeight === (positiveOptionalInteger(input.originalHeight) ?? null)
    && record.expectedRevision === (positiveOptionalInteger(input.expectedRevision) ?? null);
}

export function attachmentUploadResumeStorageKey(input: UploadMangoAttachmentInput): string {
  const identity = [
    input.companyID.trim(),
    input.resourceType,
    input.resourceID.trim(),
    input.informationID?.trim() ?? "",
    attachmentRelativePath(input.file),
    input.file.name,
    String(input.file.size),
    String(input.file.lastModified),
  ].join("\u001f");
  return `mango-attachment-upload-resume-v1:${encodeURIComponent(identity)}`;
}

function attachmentRelativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim() ?? "";
}

function readResumeRecord(storage: BrowserStorage | null, key: string): ResumeRecord | null {
  if (!storage || !key) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "null") as ResumeRecord | null;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writeResumeRecord(storage: BrowserStorage | null, key: string, record: ResumeRecord): void {
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // Private browsing/storage pressure may disable resume, not upload.
  }
}

function removeResumeRecord(storage: BrowserStorage | null, key: string): void {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Best effort only.
  }
}

function browserLocalStorage(): BrowserStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function uploadIntentPath(intentID: string): string {
  return `/v1/attachments/upload-intents/${encodeURIComponent(intentID.trim())}`;
}

function createClientRequestID(factory?: () => string): string {
  if (factory) return factory();
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.some(Boolean)) {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function controlRequestWithRetry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
  dependencies: AttachmentDirectUploadDependencies,
  maxAttempts = 3,
): Promise<T> {
  const sleep = dependencies.sleep ?? abortableSleep;
  const random = dependencies.random ?? Math.random;
  let lastCause: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAttachmentUploadAborted(signal);
    try {
      return await operation();
    } catch (cause) {
      lastCause = cause;
      if (!isRetryableControlFailure(cause) || attempt >= maxAttempts) throw cause;
      await sleep(retryDelayMilliseconds(attempt + 1, random), signal);
    }
  }
  throw lastCause;
}

function isRetryableControlFailure(cause: unknown): boolean {
  if (isAttachmentAbortError(cause)) return false;
  const status = errorHTTPStatus(cause);
  if (status === undefined) return !(cause instanceof Error && cause.name === "TerminalAuthFailureError");
  if (status === 408 || status === 429 || status >= 500) return true;
  return status === 409 && attachmentUploadErrorCode(cause) === "attachment_upload_state_conflict";
}

function isRetryablePresignedPutFailure(cause: unknown): boolean {
  if (!(cause instanceof PresignedAttachmentUploadError)) return false;
  return cause.status === 0 || cause.status === 408 || cause.status === 429 || cause.status >= 500;
}

function isMissingOrExpiredIntentError(cause: unknown): boolean {
  const code = attachmentUploadErrorCode(cause);
  return code === "attachment_upload_intent_not_found" || code === "attachment_upload_intent_expired" || errorHTTPStatus(cause) === 404;
}

function attachmentUploadErrorCode(cause: unknown): string {
  if (cause instanceof AttachmentUploadError) return cause.code;
  if (cause instanceof PresignedAttachmentUploadError) return cause.code;
  if (cause && typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    for (const key of ["code", "errorCode", "error_code"]) {
      if (typeof record[key] === "string" && cleanString(record[key])) return cleanString(record[key]);
    }
    if (typeof record.bodyText === "string") {
      try {
        const parsed = JSON.parse(record.bodyText) as Record<string, unknown>;
        for (const key of ["code", "errorCode", "error_code", "error"]) {
          if (typeof parsed[key] === "string" && cleanString(parsed[key])) return cleanString(parsed[key]);
        }
      } catch {
        // Fall through to the stable generic code.
      }
    }
  }
  return isAttachmentAbortError(cause) ? "attachment_upload_canceled" : "attachment_upload_failed";
}

function errorHTTPStatus(cause: unknown): number | undefined {
  if (!cause || typeof cause !== "object") return undefined;
  const value = (cause as { status?: unknown }).status;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function retryDelayMilliseconds(attempt: number, random: () => number): number {
  const exponential = Math.min(8_000, 250 * (2 ** Math.max(0, attempt - 2)));
  return Math.round(exponential + (Math.max(0, Math.min(1, random())) * 250));
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAttachmentUploadAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, milliseconds));
    const onAbort = () => {
      clearTimeout(timer);
      reject(attachmentUploadAbortError(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function multipartPartLength(totalBytes: number, partSizeBytes: number, partNumber: number): number {
  const start = (partNumber - 1) * partSizeBytes;
  return Math.max(0, Math.min(partSizeBytes, totalBytes - start));
}

function isTerminalIntentState(state: string): boolean {
  return state === "failed" || state === "aborted" || state === "expired";
}

function isExpiredTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function progressSnapshot(
  state: MangoAttachmentUploadState,
  totalBytes: number,
  bytesUploaded: number,
  bytesPrepared: number,
): MangoAttachmentUploadProgress {
  return { state, totalBytes, bytesUploaded, bytesPrepared, fraction: 0 };
}

function clampBytes(value: number, totalBytes: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(totalBytes, Math.round(value)));
}

function cleanOptionalString(value: string | undefined): string | undefined {
  const clean = value?.trim() ?? "";
  return clean || undefined;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanHeaderValue(value: string | null): string | undefined {
  const clean = value?.trim() ?? "";
  return clean || undefined;
}

function positiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function positiveOptionalInteger(value: number | undefined): number | undefined {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.round(value as number) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export class AttachmentUploadError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, details?: Record<string, unknown>) {
    super(code);
    this.name = "AttachmentUploadError";
    this.code = code;
    this.details = details;
  }
}

class PresignedAttachmentUploadError extends AttachmentUploadError {
  readonly status: number;

  constructor(status: number, code = "attachment_upload_storage_unavailable") {
    super(code);
    this.name = "PresignedAttachmentUploadError";
    this.status = status;
  }
}

type AttachmentUploadSemaphoreWaiter = {
  signal?: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (cause: unknown) => void;
  onAbort: () => void;
};

class AttachmentUploadSemaphore {
  private readonly limit: number;
  private active = 0;
  private readonly waiters: AttachmentUploadSemaphoreWaiter[] = [];

  constructor(limit: number) {
    this.limit = Math.max(1, Math.round(limit));
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    throwIfAttachmentUploadAborted(signal);
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaseFunction());
    }
    return new Promise<() => void>((resolve, reject) => {
      let waiter: AttachmentUploadSemaphoreWaiter;
      waiter = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(attachmentUploadAbortError(signal?.reason));
        },
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private releaseFunction(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.limit && this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal?.aborted) {
        waiter.reject(attachmentUploadAbortError(waiter.signal.reason));
        continue;
      }
      this.active += 1;
      waiter.resolve(this.releaseFunction());
    }
  }
}

const pagePutSemaphore = new AttachmentUploadSemaphore(ATTACHMENT_MAX_PAGE_PUTS_IN_FLIGHT);
