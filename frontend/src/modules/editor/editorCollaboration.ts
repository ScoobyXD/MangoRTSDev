import {
  realtimeEditorScope,
  subscribeRealtimeScope,
  type RealtimeEditorAtom,
  type RealtimeEditorDelta,
  type RealtimeEditorDeltaCommittedMessage,
  type RealtimeEditorDocumentDeletedMessage,
  type RealtimeEditorSnapshotRequiredMessage,
} from "../realtime/realtimeWebSocket.js";

export type EditorCollaborationResourceType = "node" | "logic_gate" | "project";
export type EditorCollaborationState = { atoms: Array<RealtimeEditorAtom & { deleted?: boolean }> };
export type EditorCollaborationSnapshot = {
  revision: number;
  snapshot_revision: number;
  state: EditorCollaborationState;
  html: string;
  etag: string;
  deleted?: boolean;
};
type EditorCollaborationCommit = { operation_id: string; revision: number; deduplicated?: boolean; snapshot: EditorCollaborationSnapshot };
export type EditorCollaborationRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
export type EditorCollaborationControllerOptions = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  resourceType: EditorCollaborationResourceType;
  resourceID: string;
  documentID: string;
  initialHTML: string;
  requestJSON: EditorCollaborationRequest;
  onHTML: (html: string, source: "remote" | "recovery") => void;
  onPendingChange?: (pendingCount: number) => void;
  onDeleted?: () => void;
  onError?: (cause: unknown) => void;
  microBatchMs?: number;
  subscribe?: typeof subscribeRealtimeScope;
};
type PendingEditorOperation = {
  storage_key: string;
  user_id: string;
  company_id: string;
  resource_type: EditorCollaborationResourceType;
  resource_id: string;
  document_id: string;
  client_id: string;
  operation_id: string;
  base_revision: number;
  delta: RealtimeEditorDelta;
  created_at: number;
};

const PENDING_PREFIX = "mango-editor-collaboration-pending-v1:";
const CLIENT_PREFIX = "mango-editor-collaboration-client-v1:";
const LEGACY_PREFIXES = ["mango-editor-projection-draft-v2", "mango-editor-projection-tab-v1"];
const DB_NAME = "mango-editor-collaboration-v1";
const DB_STORE = "pending_operations";
export const EDITOR_COLLABORATION_OPERATION_TARGET_BYTES = 48 * 1024;
export const EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES = 2 * 1024 * 1024;
export const EDITOR_COLLABORATION_ATOM_TARGET_CODE_POINTS = 1024;
const EDITOR_COLLABORATION_SNAPSHOT_CHAR_ATOM_MAX_CODE_POINTS = 4096;
const EDITOR_COLLABORATION_FORBIDDEN_CONTENT = ["data:image/", ";base64,", "x-amz-credential", "x-amz-signature", "awsaccesskeyid", "presigned_url", "secret_access_key"];

function stableID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function localStorageTarget(): Storage | null { return typeof window === "undefined" ? null : window.localStorage; }
function encodedParts(parts: string[]): string { return parts.map(encodeURIComponent).join(":"); }
function scopePrefix(options: EditorCollaborationControllerOptions, clientID: string): string {
  return `${PENDING_PREFIX}${encodedParts([options.currentUserID, options.companyID, options.resourceType, options.resourceID, options.documentID, clientID])}:`;
}
function clientIDFor(options: EditorCollaborationControllerOptions): string {
  const target = localStorageTarget();
  const key = `${CLIENT_PREFIX}${encodedParts([options.currentUserID, options.companyID])}`;
  const found = target?.getItem(key)?.trim();
  if (found) return found;
  const created = stableID();
  target?.setItem(key, created);
  return created;
}
export function cleanupLegacyEditorProjectionStorage(
  local: Storage | null = localStorageTarget(),
  session: Storage | null = typeof window === "undefined" ? null : window.sessionStorage,
): number {
  let removed = 0;
  for (const target of [local, session]) {
    if (!target) continue;
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index)).filter((key): key is string => Boolean(key));
    for (const key of keys) if (LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) { target.removeItem(key); removed += 1; }
  }
  return removed;
}
function openPendingDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE, { keyPath: "storage_key" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
}
async function writeMirror(record: PendingEditorOperation | null, key: string): Promise<void> {
  const db = await openPendingDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    if (record) transaction.objectStore(DB_STORE).put(record); else transaction.objectStore(DB_STORE).delete(key);
    transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
  });
  db.close();
}
async function readMirror(prefix: string): Promise<PendingEditorOperation[]> {
  const db = await openPendingDB();
  if (!db) return [];
  const result = await new Promise<PendingEditorOperation[]>((resolve) => {
    const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
    request.onsuccess = () => resolve((request.result as PendingEditorOperation[]).filter((record) => record.storage_key.startsWith(prefix)));
    request.onerror = () => resolve([]);
  });
  db.close();
  return result;
}
function readLocal(prefix: string): PendingEditorOperation[] {
  const target = localStorageTarget();
  if (!target) return [];
  const result: PendingEditorOperation[] = [];
  const keys = Array.from({ length: target.length }, (_, index) => target.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  for (const key of keys) try {
    const record = JSON.parse(target.getItem(key) ?? "") as PendingEditorOperation;
    if (record.storage_key === key && record.operation_id && record.client_id) result.push(record);
  } catch { target.removeItem(key); }
  return result;
}
function retain(record: PendingEditorOperation): void {
  localStorageTarget()?.setItem(record.storage_key, JSON.stringify(record));
  void writeMirror(record, record.storage_key);
}
function clear(record: PendingEditorOperation): void {
  localStorageTarget()?.removeItem(record.storage_key);
  void writeMirror(null, record.storage_key);
}

export function newEditorCollaborationState(html: string): EditorCollaborationState {
  let afterID = "";
  const codePoints = Array.from(html);
  const values = codePoints.length <= EDITOR_COLLABORATION_SNAPSHOT_CHAR_ATOM_MAX_CODE_POINTS
    ? codePoints
    : chunkEditorCollaborationCodePoints(codePoints);
  return { atoms: values.map((value, index) => {
    const id = `0:${index.toString(16).padStart(8, "0")}`;
    const atom = { id, after_id: afterID, value };
    afterID = id;
    return atom;
  }) };
}
function chunkEditorCollaborationCodePoints(codePoints: string[]): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < codePoints.length; index += EDITOR_COLLABORATION_ATOM_TARGET_CODE_POINTS) {
    chunks.push(codePoints.slice(index, index + EDITOR_COLLABORATION_ATOM_TARGET_CODE_POINTS).join(""));
  }
  return chunks;
}
export function applyEditorCollaborationDelta(state: EditorCollaborationState, delta: RealtimeEditorDelta): EditorCollaborationState {
  const atoms = state.atoms.map((atom) => ({ ...atom }));
  const indexes = new Map(atoms.map((atom, index) => [atom.id, index]));
  for (const atom of delta.inserts ?? []) {
    if (!atom.id || indexes.has(atom.id) || (atom.after_id && !indexes.has(atom.after_id))) throw new Error("collaboration_snapshot_required");
    indexes.set(atom.id, atoms.length);
    atoms.push({ ...atom });
  }
  for (const id of delta.delete_ids ?? []) {
    const index = indexes.get(id);
    if (index === undefined) throw new Error("collaboration_snapshot_required");
    atoms[index] = { ...atoms[index], deleted: true };
  }
  return { atoms };
}
export function materializeEditorCollaborationState(state: EditorCollaborationState): string {
  const ids = new Set(state.atoms.map((atom) => atom.id));
  const children = new Map<string, Array<RealtimeEditorAtom & { deleted?: boolean }>>();
  for (const atom of state.atoms) {
    if (!atom.id || (atom.after_id && !ids.has(atom.after_id))) throw new Error("invalid_editor_collaboration_state");
    const key = atom.after_id ?? "";
    children.set(key, [...(children.get(key) ?? []), atom]);
  }
  for (const bucket of children.values()) bucket.sort((left, right) => right.id.localeCompare(left.id));
  const visited = new Set<string>();
  let html = "";
  const stack = [...(children.get("") ?? [])].reverse();
  while (stack.length > 0) {
    const atom = stack.pop();
    if (!atom || visited.has(atom.id)) throw new Error("invalid_editor_collaboration_state");
    visited.add(atom.id);
    if (!atom.deleted) html += atom.value;
    const descendants = children.get(atom.id) ?? [];
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      stack.push(descendants[index]);
    }
  }
  if (visited.size !== state.atoms.length) throw new Error("invalid_editor_collaboration_state");
  return html;
}
export function editorCollaborationDeltaForHTML(state: EditorCollaborationState, nextHTML: string, atomPrefix: string): RealtimeEditorDelta {
  const visible = state.atoms.filter((atom) => !atom.deleted);
  const current = Array.from(visible.map((atom) => atom.value).join(""));
  const next = Array.from(nextHTML);
  let prefix = 0;
  while (prefix < current.length && prefix < next.length && current[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < current.length - prefix && suffix < next.length - prefix && current[current.length - suffix - 1] === next[next.length - suffix - 1]) suffix += 1;

  let preservedPrefixAtoms = 0;
  let preservedPrefixCodePoints = 0;
  while (preservedPrefixAtoms < visible.length) {
    const atomSize = Array.from(visible[preservedPrefixAtoms].value).length;
    if (preservedPrefixCodePoints + atomSize > prefix) break;
    preservedPrefixCodePoints += atomSize;
    preservedPrefixAtoms += 1;
  }
  let preservedSuffixStart = visible.length;
  let preservedSuffixCodePoints = 0;
  while (preservedSuffixStart > preservedPrefixAtoms) {
    const atomSize = Array.from(visible[preservedSuffixStart - 1].value).length;
    if (preservedSuffixCodePoints + atomSize > suffix) break;
    preservedSuffixCodePoints += atomSize;
    preservedSuffixStart -= 1;
  }

  const deleteIDs = visible.slice(preservedPrefixAtoms, preservedSuffixStart).map((atom) => atom.id);
  let afterID = preservedPrefixAtoms > 0 ? visible[preservedPrefixAtoms - 1]?.id ?? "" : "";
  const insertedValues = chunkEditorCollaborationCodePoints(next.slice(preservedPrefixCodePoints, next.length - preservedSuffixCodePoints));
  const inserts = insertedValues.map((value, index) => {
    const id = `${atomPrefix}:${index.toString(36)}`;
    const atom = { id, after_id: afterID, value };
    afterID = id;
    return atom;
  });
  return { inserts, delete_ids: deleteIDs };
}
function mergeDeltas(left: RealtimeEditorDelta, right: RealtimeEditorDelta): RealtimeEditorDelta {
  return { inserts: [...(left.inserts ?? []), ...(right.inserts ?? [])], delete_ids: [...(left.delete_ids ?? []), ...(right.delete_ids ?? [])] };
}
function emptyDelta(delta: RealtimeEditorDelta): boolean { return (delta.inserts?.length ?? 0) === 0 && (delta.delete_ids?.length ?? 0) === 0; }
function encodedBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function utf8Bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }
function editorHTMLContainsForbiddenRealtimeContent(value: string): boolean { const lower = value.toLowerCase(); return EDITOR_COLLABORATION_FORBIDDEN_CONTENT.some((item) => lower.includes(item)); }
function deltaFitsTransport(delta: RealtimeEditorDelta): boolean {
  return encodedBytes(delta) <= EDITOR_COLLABORATION_OPERATION_TARGET_BYTES;
}
export function splitEditorCollaborationDelta(delta: RealtimeEditorDelta): RealtimeEditorDelta[] {
  if (emptyDelta(delta)) return [];
  const parts: RealtimeEditorDelta[] = [];
  let current: RealtimeEditorDelta = {};
  let currentBytes = encodedBytes(current);
  const flush = () => {
    if (!emptyDelta(current)) parts.push(current);
    current = {};
    currentBytes = encodedBytes(current);
  };
  for (const atom of delta.inserts ?? []) {
    const itemBytes = encodedBytes(atom);
    const candidateBytes = current.inserts
      ? currentBytes + 1 + itemBytes
      : encodedBytes({ inserts: [atom] });
    if (!emptyDelta(current) && candidateBytes > EDITOR_COLLABORATION_OPERATION_TARGET_BYTES) flush();
    const nextBytes = current.inserts ? currentBytes + 1 + itemBytes : encodedBytes({ inserts: [atom] });
    if (nextBytes > EDITOR_COLLABORATION_OPERATION_TARGET_BYTES) throw new Error("editor_collaboration_atom_exceeds_transport_limit");
    current.inserts = [...(current.inserts ?? []), atom];
    currentBytes = nextBytes;
  }
  for (const id of delta.delete_ids ?? []) {
    const itemBytes = encodedBytes(id);
    const candidateBytes = current.delete_ids
      ? currentBytes + 1 + itemBytes
      : current.inserts
        ? currentBytes - 1 + encodedBytes(`,"delete_ids":[${JSON.stringify(id)}]}`)
        : encodedBytes({ delete_ids: [id] });
    if (!emptyDelta(current) && candidateBytes > EDITOR_COLLABORATION_OPERATION_TARGET_BYTES) flush();
    const nextBytes = current.delete_ids
      ? currentBytes + 1 + itemBytes
      : current.inserts
        ? currentBytes - 1 + encodedBytes(`,"delete_ids":[${JSON.stringify(id)}]}`)
        : encodedBytes({ delete_ids: [id] });
    if (nextBytes > EDITOR_COLLABORATION_OPERATION_TARGET_BYTES) throw new Error("editor_collaboration_delete_exceeds_transport_limit");
    current.delete_ids = [...(current.delete_ids ?? []), id];
    currentBytes = nextBytes;
  }
  flush();
  return parts;
}

function applyPendingDeltaForRecovery(state: EditorCollaborationState, delta: RealtimeEditorDelta): EditorCollaborationState {
  const byID = new Map(state.atoms.map((atom) => [atom.id, atom]));
  const inserts = delta.inserts ?? [];
  const existing = inserts.filter((atom) => byID.has(atom.id));
  if (existing.length > 0 && existing.length !== inserts.length) throw new Error("collaboration_snapshot_required");
  if (existing.length === inserts.length && inserts.length > 0) {
    for (const atom of inserts) {
      const committed = byID.get(atom.id);
      if (!committed || committed.after_id !== atom.after_id || committed.value !== atom.value) throw new Error("collaboration_snapshot_required");
    }
    const atoms = state.atoms.map((atom) => ({ ...atom }));
    const indexes = new Map(atoms.map((atom, index) => [atom.id, index]));
    for (const id of delta.delete_ids ?? []) {
      const index = indexes.get(id);
      if (index === undefined) throw new Error("collaboration_snapshot_required");
      atoms[index] = { ...atoms[index], deleted: true };
    }
    return { atoms };
  }
  return applyEditorCollaborationDelta(state, delta);
}

export class EditorCollaborationController {
  private readonly clientID: string;
  private readonly path: string;
  private readonly scope: string;
  private readonly pendingPrefix: string;
  private confirmed: EditorCollaborationState;
  private optimistic: EditorCollaborationState;
  private revision = 0;
  private pending: PendingEditorOperation[] = [];
  private active: PendingEditorOperation | null = null;
  private batchTimer: number | undefined;
  private unsubscribe: (() => void) | undefined;
  private recovery: Promise<void> | undefined;
  private recoveryRequested = false;
  private drainPromise: Promise<void> | undefined;
  private buffered: RealtimeEditorDeltaCommittedMessage[] = [];
  private deleted = false;
  private renderedHTML: string;

  constructor(private readonly options: EditorCollaborationControllerOptions) {
    this.clientID = clientIDFor(options);
    this.confirmed = newEditorCollaborationState(options.initialHTML);
    this.optimistic = newEditorCollaborationState(options.initialHTML);
    this.renderedHTML = options.initialHTML;
    this.path = `/v1/editor-collaboration/${options.resourceType}/${options.resourceID}/documents/${options.documentID}?company_id=${encodeURIComponent(options.companyID)}`;
    this.scope = realtimeEditorScope(options.resourceType, options.resourceID, options.documentID);
    this.pendingPrefix = scopePrefix(options, this.clientID);
  }
  start(): void {
    cleanupLegacyEditorProjectionStorage();
    const subscribe = this.options.subscribe ?? ((apiBase, companyID, scope, handlers) => subscribeRealtimeScope(apiBase, companyID, scope, handlers));
    this.unsubscribe = subscribe(this.options.apiBase, this.options.companyID, this.scope, {
      onEditorDeltaCommitted: (message) => this.handleCommitted(message),
      onEditorSnapshotRequired: (message) => this.handleSnapshotRequired(message),
      onEditorDocumentDeleted: (message) => this.handleDeleted(message),
      onRecover: () => this.recover(),
      onRejected: () => this.options.onError?.(new Error("editor_collaboration_subscription_rejected")),
    });
    void this.recover().catch((cause) => this.options.onError?.(cause));
  }
  stop(): void {
    if (this.batchTimer !== undefined) window.clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
  schedule(nextHTML: string, immediate = false): void {
    if (this.deleted) return;
    if (editorHTMLContainsForbiddenRealtimeContent(nextHTML)) {
      this.options.onError?.(new Error("editor_collaboration_sensitive_content_rejected"));
      return;
    }
    if (utf8Bytes(nextHTML) > EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES) {
      this.options.onError?.(new Error("editor_collaboration_document_too_large"));
      return;
    }
    const delta = editorCollaborationDeltaForHTML(this.optimistic, nextHTML, `${this.clientID}:${stableID()}`);
    if (emptyDelta(delta)) return;
    this.optimistic = applyEditorCollaborationDelta(this.optimistic, delta);
    this.renderedHTML = nextHTML;
    const parts = splitEditorCollaborationDelta(delta);
    parts.forEach((part, index) => {
      if (this.active) {
        const merged = mergeDeltas(this.active.delta, part);
        if (deltaFitsTransport(merged)) {
          this.active.delta = merged;
          retain(this.active);
          if (index < parts.length - 1) this.seal();
          return;
        }
        this.seal();
      }
      const operationID = stableID();
      this.active = {
        storage_key: `${this.pendingPrefix}${encodeURIComponent(operationID)}`,
        user_id: this.options.currentUserID,
        company_id: this.options.companyID,
        resource_type: this.options.resourceType,
        resource_id: this.options.resourceID,
        document_id: this.options.documentID,
        client_id: this.clientID,
        operation_id: operationID,
        base_revision: this.revision,
        delta: part,
        created_at: Date.now() + index,
      };
      this.pending.push(this.active);
      retain(this.active);
      if (index < parts.length - 1) this.seal();
    });
    this.options.onPendingChange?.(this.pending.length);
    if (this.batchTimer !== undefined) window.clearTimeout(this.batchTimer);
    if (immediate) { this.seal(); void this.drain().catch((cause) => this.options.onError?.(cause)); return; }
    this.batchTimer = window.setTimeout(() => { this.batchTimer = undefined; this.seal(); void this.drain().catch((cause) => this.options.onError?.(cause)); }, this.options.microBatchMs ?? 160);
  }
  async flush(): Promise<void> {
    if (this.batchTimer !== undefined) window.clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    this.seal();
    await this.drain();
  }
  async recover(): Promise<void> {
    if (this.recovery) {
      this.recoveryRequested = true;
      return this.recovery;
    }
    this.recovery = (async () => {
      do {
        this.recoveryRequested = false;
        await this.performRecovery();
      } while (this.recoveryRequested);
    })().finally(() => { this.recovery = undefined; });
    return this.recovery;
  }
  private async performRecovery(): Promise<void> {
    const [snapshot, mirrored] = await Promise.all([this.options.requestJSON<EditorCollaborationSnapshot>(this.path), readMirror(this.pendingPrefix)]);
    this.deleted = Boolean(snapshot.deleted);
    this.revision = snapshot.revision;
    this.confirmed = snapshot.state;
    const records = new Map<string, PendingEditorOperation>();
    for (const record of [...mirrored, ...readLocal(this.pendingPrefix), ...this.pending]) records.set(record.operation_id, record);
    this.pending = [...records.values()].sort((left, right) => left.created_at - right.created_at || left.operation_id.localeCompare(right.operation_id));
    this.active = null;
    if (this.deleted) {
      this.options.onPendingChange?.(this.pending.length);
      this.options.onDeleted?.();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      return;
    }
    const buffered = this.buffered.splice(0).filter((event) => event.resource_revision > this.revision).sort((left, right) => left.resource_revision - right.resource_revision);
    for (const event of buffered) {
      if (event.resource_revision !== this.revision + 1) throw new Error("collaboration_revision_gap");
      this.confirmed = applyEditorCollaborationDelta(this.confirmed, event.delta);
      this.revision = event.resource_revision;
      const local = this.pending.find((item) => item.operation_id === event.operation_id);
      if (local) { clear(local); this.pending = this.pending.filter((item) => item !== local); }
    }
    this.rebuild();
    this.renderOptimistic("recovery", true);
    this.options.onPendingChange?.(this.pending.length);
    await this.drain();
  }
  private seal(): void {
    if (!this.active) return;
    if (emptyDelta(this.active.delta)) { this.pending = this.pending.filter((item) => item !== this.active); clear(this.active); }
    this.active = null;
  }
  private async drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.performDrain().finally(() => { this.drainPromise = undefined; });
    return this.drainPromise;
  }
  private async performDrain(): Promise<void> {
    while (true) {
      if (this.deleted) return;
      const record = this.pending.find((item) => item !== this.active);
      if (!record) return;
      const commit = await this.options.requestJSON<EditorCollaborationCommit>(this.path, {
        method: "POST",
        body: JSON.stringify({ operation_id: record.operation_id, client_id: record.client_id, base_revision: record.base_revision, delta: record.delta }),
      });
      clear(record);
      this.pending = this.pending.filter((item) => item !== record);
      if (commit.snapshot.revision >= this.revision) {
        this.revision = commit.snapshot.revision;
        this.confirmed = commit.snapshot.state;
      }
      this.rebuild();
      this.renderOptimistic("remote");
      this.options.onPendingChange?.(this.pending.length);
    }
  }
  private rebuild(): void {
    this.optimistic = { atoms: this.confirmed.atoms.map((atom) => ({ ...atom })) };
    for (const record of this.pending) this.optimistic = applyPendingDeltaForRecovery(this.optimistic, record.delta);
  }
  private renderOptimistic(source: "remote" | "recovery", force = false): void {
    const html = materializeEditorCollaborationState(this.optimistic);
    if (!force && html === this.renderedHTML) return;
    this.renderedHTML = html;
    this.options.onHTML(html, source);
  }
  private handleCommitted(message: RealtimeEditorDeltaCommittedMessage): void {
    if (this.recovery) { this.buffered.push(message); return; }
    if (message.resource_revision <= this.revision) return;
    if (message.resource_revision !== this.revision + 1) { void this.recover().catch((cause) => this.options.onError?.(cause)); return; }
    try {
      this.confirmed = applyEditorCollaborationDelta(this.confirmed, message.delta);
      this.revision = message.resource_revision;
      const local = this.pending.find((item) => item.operation_id === message.operation_id);
      if (local) {
        clear(local);
        this.pending = this.pending.filter((item) => item !== local);
        if (this.active === local) this.active = null;
      }
      this.rebuild();
      if (!local) this.renderOptimistic("remote");
      this.options.onPendingChange?.(this.pending.length);
    } catch (cause) {
      this.options.onError?.(cause);
      void this.recover().catch((recoveryCause) => this.options.onError?.(recoveryCause));
    }
  }
  private handleSnapshotRequired(message: RealtimeEditorSnapshotRequiredMessage): void {
    if (message.resource_revision <= this.revision) return;
    void this.recover().catch((cause) => this.options.onError?.(cause));
  }
  private handleDeleted(message: RealtimeEditorDocumentDeletedMessage): void {
    if (message.resource_revision <= this.revision) return;
    if (this.recovery) {
      this.recoveryRequested = true;
      return;
    }
    this.deleted = true;
    this.revision = message.resource_revision;
    this.active = null;
    this.options.onPendingChange?.(this.pending.length);
    this.options.onDeleted?.();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
