import { useCallback, useEffect, useRef, useState } from "react";
import { connectAuthenticatedSse, type SseEvent } from "../../auth/authenticatedSse.js";
import { emptyNotificationSummary, EVENT_NOTIFICATIONS_UPDATED, fetchNotificationSummary, notificationStreamURL, type NotificationSummary } from "./notificationsApi.js";

const NOTIFICATION_SUMMARY_REFRESH_MS = 30_000;
const NOTIFICATION_SUMMARY_RELOAD_DEBOUNCE_MS = 350;

export function useNotificationSummary(companyID: string): NotificationSummary {
  const cleanCompanyID = companyID.trim();
  const [summary, setSummary] = useState<NotificationSummary>(() => emptyNotificationSummary(cleanCompanyID));
  const refreshTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  const loadSummary = useCallback(async () => {
    if (!cleanCompanyID) {
      setSummary(emptyNotificationSummary(""));
      return;
    }
    try {
      const next = await fetchNotificationSummary(cleanCompanyID);
      if (mountedRef.current) setSummary(next);
    } catch (error) {
      console.error("Failed to load notification summary", error);
    }
  }, [cleanCompanyID]);

  const scheduleLoad = useCallback(() => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void loadSummary();
    }, NOTIFICATION_SUMMARY_RELOAD_DEBOUNCE_MS);
  }, [loadSummary]);

  useEffect(() => {
    mountedRef.current = true;
    setSummary(emptyNotificationSummary(cleanCompanyID));
    void loadSummary();
    const intervalID = window.setInterval(() => { void loadSummary(); }, NOTIFICATION_SUMMARY_REFRESH_MS);
    const stream = connectAuthenticatedSse(notificationStreamURL(), {
      onEvent(event: SseEvent) {
        if (event.event === "notification") scheduleLoad();
      },
      onError(error: unknown) {
        console.error("Notification stream failed", error);
      },
    });
    const onNotificationsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      if (detail?.companyID && detail.companyID !== cleanCompanyID) return;
      scheduleLoad();
    };
    window.addEventListener(EVENT_NOTIFICATIONS_UPDATED, onNotificationsUpdated);
    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalID);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      stream.close();
      window.removeEventListener(EVENT_NOTIFICATIONS_UPDATED, onNotificationsUpdated);
    };
  }, [cleanCompanyID, loadSummary, scheduleLoad]);

  return summary;
}
