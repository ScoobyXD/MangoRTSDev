import { useEffect } from "react";
import { fetchCurrentUser, readAuthConfig, type CurrentUserResponse } from "../auth/cognitoAuth";
import { getActiveCompanyID } from "../auth/currentCompany";
import {
  consumeLocalNotificationClearEcho,
  consumeLocalNotificationDeleteEcho,
  emitNotificationsUpdated,
} from "../modules/notifications/notificationsApi";
import { subscribeRealtimeScope } from "../modules/realtime/realtimeWebSocket";

export function AppLiveFreshnessBridge() {
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;

  useEffect(() => {
    if (!companyID) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void fetchCurrentUser()
      .then((current) => {
        const userID = current.user.user_id.trim();
        if (cancelled || !userID || !currentUserCanUseCompany(current, companyID)) return;
        unsubscribe = subscribeRealtimeScope(apiBase, companyID, `notifications:user:${userID}`, {
          onNotificationCreated(message) {
            emitNotificationChange(message.company_id, companyID);
          },
          onNotificationDeleted(message) {
            emitNotificationChange(
              message.company_id,
              companyID,
              consumeLocalNotificationDeleteEcho(message.company_id, message.notification_id),
            );
          },
          onNotificationsCleared(message) {
            emitNotificationChange(
              message.company_id,
              companyID,
              consumeLocalNotificationClearEcho(message.company_id),
            );
          },
        });
      })
      .catch(() => {
        // Auth gate owns visible authentication failures.
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [apiBase, companyID]);

  return null;
}

function currentUserCanUseCompany(current: CurrentUserResponse, companyID: string): boolean {
  const cleanCompanyID = companyID.trim();
  return !!cleanCompanyID && (current.is_dev_admin || current.memberships.some((membership) => membership.company_id === cleanCompanyID));
}

function emitNotificationChange(messageCompanyID: string | undefined, activeCompanyID: string, source = ""): void {
  const cleanMessageCompanyID = messageCompanyID?.trim() ?? "";
  const cleanActiveCompanyID = activeCompanyID.trim();
  if (cleanMessageCompanyID && cleanMessageCompanyID !== cleanActiveCompanyID) return;
  emitNotificationsUpdated(cleanMessageCompanyID || cleanActiveCompanyID, source);
}
