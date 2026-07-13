import { useEffect } from "react";
import { fetchCurrentUser, readAuthConfig, type CurrentUserResponse } from "../auth/cognitoAuth";
import { getActiveCompanyID } from "../auth/currentCompany";
import { createNotificationRealtimeHandlers } from "../modules/notifications/notificationRealtimeCoordinator";
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
        unsubscribe = subscribeRealtimeScope(
          apiBase,
          companyID,
          `notifications:user:${userID}`,
          createNotificationRealtimeHandlers(companyID),
        );
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
