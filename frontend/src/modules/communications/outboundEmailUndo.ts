export const OUTBOUND_EMAIL_UNDO_WINDOW_MS = 10_000;

export type PendingOutboundEmailSend = {
  id: string;
  label: string;
  queuedAt: number;
  deadlineAt: number;
};

export type OutboundEmailDispatchOptions = {
  label?: string;
};

type PendingOutboundEmailSendInternal = PendingOutboundEmailSend & {
  timer: ReturnType<typeof setTimeout>;
  beginDispatch: () => void;
  reject: (reason: OutboundEmailUndoneError) => void;
};

export class OutboundEmailUndoneError extends Error {
  readonly code = "email_send_undone";

  constructor() {
    super("email_send_undone");
    this.name = "OutboundEmailUndoneError";
  }
}

let nextOutboundEmailSendID = 0;
let pendingSnapshot: readonly PendingOutboundEmailSend[] = Object.freeze([]);
const pendingOutboundEmailSends = new Map<string, PendingOutboundEmailSendInternal>();
const listeners = new Set<() => void>();

function publishPendingOutboundEmailSends() {
  pendingSnapshot = Object.freeze(Array.from(pendingOutboundEmailSends.values())
    .map(({ id, label, queuedAt, deadlineAt }) => Object.freeze({ id, label, queuedAt, deadlineAt }))
    .sort((left, right) => left.queuedAt - right.queuedAt || left.id.localeCompare(right.id)));
  for (const listener of Array.from(listeners)) listener();
}

export function getPendingOutboundEmailSends(): readonly PendingOutboundEmailSend[] {
  return pendingSnapshot;
}

export function subscribePendingOutboundEmailSends(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isOutboundEmailUndoneError(error: unknown): error is OutboundEmailUndoneError {
  return error instanceof OutboundEmailUndoneError
    || (error instanceof Error && (error as Error & { code?: string }).code === "email_send_undone")
    || (typeof error === "object" && error !== null && (error as { code?: string }).code === "email_send_undone");
}

export function undoOutboundEmailSend(sendID: string): boolean {
  const pending = pendingOutboundEmailSends.get(sendID);
  if (!pending) return false;
  pendingOutboundEmailSends.delete(sendID);
  clearTimeout(pending.timer);
  publishPendingOutboundEmailSends();
  pending.reject(new OutboundEmailUndoneError());
  return true;
}

export function sendOutboundEmailNow(sendID: string): boolean {
  const pending = pendingOutboundEmailSends.get(sendID);
  if (!pending) return false;
  pending.beginDispatch();
  return true;
}

export function scheduleOutboundEmailDispatch<T>(
  dispatch: () => Promise<T>,
  options: OutboundEmailDispatchOptions = {},
): Promise<T> {
  const undoWindowMs = OUTBOUND_EMAIL_UNDO_WINDOW_MS;

  const queuedAt = Date.now();
  const id = `email-send-${queuedAt}-${++nextOutboundEmailSendID}`;
  const label = options.label?.trim() || "Email";
  return new Promise<T>((resolve, reject) => {
    const beginDispatch = () => {
      const pending = pendingOutboundEmailSends.get(id);
      if (!pending) return;
      pendingOutboundEmailSends.delete(id);
      clearTimeout(pending.timer);
      publishPendingOutboundEmailSends();
      void Promise.resolve().then(dispatch).then(resolve, reject);
    };
    const timer = setTimeout(beginDispatch, undoWindowMs);
    pendingOutboundEmailSends.set(id, {
      id,
      label,
      queuedAt,
      deadlineAt: queuedAt + undoWindowMs,
      timer,
      beginDispatch,
      reject,
    });
    publishPendingOutboundEmailSends();
  });
}

export function undoAllOutboundEmailSends(): number {
  const ids = Array.from(pendingOutboundEmailSends.keys());
  for (const id of ids) undoOutboundEmailSend(id);
  return ids.length;
}
