import { useEffect, useState } from "react";
import { emptyNotificationSummary, EVENT_NOTIFICATIONS_UPDATED, fetchNotificationSummary, type NotificationSummary } from "./notificationsApi.js";

const NOTIFICATION_SUMMARY_CLOSE_GRACE_MS = 1500;

type NotificationSummaryListener = (summary: NotificationSummary) => void;
type TimerID = ReturnType<typeof setTimeout>;

type NotificationSummaryEntry = {
  companyID: string;
  summary: NotificationSummary;
  listeners: Set<NotificationSummaryListener>;
  closeTimer?: TimerID;
  loading: boolean;
  reloadQueued: boolean;
};

const notificationSummaryEntries = new Map<string, NotificationSummaryEntry>();
let notificationUpdateListener: ((event: Event) => void) | undefined;

export function useNotificationSummary(companyID: string): NotificationSummary {
  const cleanCompanyID = companyID.trim();
  const [summary, setSummary] = useState<NotificationSummary>(() => emptyNotificationSummary(cleanCompanyID));

  useEffect(() => {
    setSummary(emptyNotificationSummary(cleanCompanyID));
    if (!cleanCompanyID) return;
    return subscribeNotificationSummary(cleanCompanyID, setSummary);
  }, [cleanCompanyID]);

  return summary;
}

function subscribeNotificationSummary(companyID: string, listener: NotificationSummaryListener): () => void {
  const entry = getNotificationSummaryEntry(companyID);
  if (entry.closeTimer !== undefined) {
    clearTimeout(entry.closeTimer);
    entry.closeTimer = undefined;
  }

  entry.listeners.add(listener);
  listener(entry.summary);
  ensureNotificationUpdateListener();
  requestNotificationSummaryLoad(entry, { queueWhileLoading: false });

  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.closeTimer === undefined) {
      entry.closeTimer = setTimeout(() => {
        if (entry.listeners.size > 0 || notificationSummaryEntries.get(companyID) !== entry) return;
        notificationSummaryEntries.delete(companyID);
      }, NOTIFICATION_SUMMARY_CLOSE_GRACE_MS);
    }
    scheduleNotificationUpdateListenerClose();
  };
}

function getNotificationSummaryEntry(companyID: string): NotificationSummaryEntry {
  const existing = notificationSummaryEntries.get(companyID);
  if (existing) return existing;
  const created: NotificationSummaryEntry = {
    companyID,
    summary: emptyNotificationSummary(companyID),
    listeners: new Set(),
    loading: false,
    reloadQueued: false,
  };
  notificationSummaryEntries.set(companyID, created);
  return created;
}

function ensureNotificationUpdateListener(): void {
  if (!notificationUpdateListener) {
    notificationUpdateListener = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      requestNotificationSummaryLoadsForCompany(detail?.companyID?.trim() ?? "");
    };
    window.addEventListener(EVENT_NOTIFICATIONS_UPDATED, notificationUpdateListener);
  }
}

function scheduleNotificationUpdateListenerClose(): void {
  setTimeout(() => {
    if (activeNotificationSummaryListenerCount() > 0) return;
    if (notificationUpdateListener) {
      window.removeEventListener(EVENT_NOTIFICATIONS_UPDATED, notificationUpdateListener);
      notificationUpdateListener = undefined;
    }
  }, NOTIFICATION_SUMMARY_CLOSE_GRACE_MS);
}

function activeNotificationSummaryListenerCount(): number {
  let count = 0;
  for (const entry of notificationSummaryEntries.values()) count += entry.listeners.size;
  return count;
}

function requestActiveNotificationSummaryLoads(): void {
  for (const entry of notificationSummaryEntries.values()) {
    if (entry.listeners.size > 0) requestNotificationSummaryLoad(entry);
  }
}

function requestNotificationSummaryLoadsForCompany(companyID: string): void {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) {
    requestActiveNotificationSummaryLoads();
    return;
  }
  const entry = notificationSummaryEntries.get(cleanCompanyID);
  if (entry && entry.listeners.size > 0) requestNotificationSummaryLoad(entry);
}

function requestNotificationSummaryLoad(entry: NotificationSummaryEntry, options: { queueWhileLoading?: boolean } = {}): void {
  if (entry.listeners.size === 0) return;
  if (entry.loading) {
    if (options.queueWhileLoading ?? true) entry.reloadQueued = true;
    return;
  }
  entry.loading = true;
  void fetchNotificationSummary(entry.companyID)
    .then((next) => {
      if (notificationSummaryEntries.get(entry.companyID) !== entry) return;
      entry.summary = next;
      notifyNotificationSummaryListeners(entry);
    })
    .catch((error: unknown) => {
      if (notificationSummaryEntries.get(entry.companyID) === entry) console.error("Failed to load notification summary", error);
    })
    .finally(() => {
      if (notificationSummaryEntries.get(entry.companyID) !== entry) return;
      entry.loading = false;
      if (!entry.reloadQueued) return;
      entry.reloadQueued = false;
      requestNotificationSummaryLoad(entry);
    });
}

function notifyNotificationSummaryListeners(entry: NotificationSummaryEntry): void {
  for (const listener of Array.from(entry.listeners)) listener(entry.summary);
}
