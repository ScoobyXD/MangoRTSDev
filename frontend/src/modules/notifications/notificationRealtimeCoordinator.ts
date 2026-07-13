import {
  claimLocalNotificationClearReconciliation,
  claimLocalNotificationDeleteReconciliation,
  emitNotificationsUpdated,
} from "./notificationsApi.js";

type NotificationCreatedHint = {
  company_id?: string;
};

type NotificationDeletedHint = NotificationCreatedHint & {
  notification_id: string;
};

export function createNotificationRealtimeHandlers(activeCompanyID: string) {
  const cleanActiveCompanyID = activeCompanyID.trim();
  const reconcile = (messageCompanyID = "") => {
    const cleanMessageCompanyID = messageCompanyID.trim();
    if (cleanMessageCompanyID && cleanMessageCompanyID !== cleanActiveCompanyID) return;
    emitNotificationsUpdated(cleanMessageCompanyID || cleanActiveCompanyID);
  };

  return {
    onAccepted() {
      reconcile();
    },
    onNotificationCreated(message: NotificationCreatedHint) {
      reconcile(message.company_id);
    },
    onNotificationDeleted(message: NotificationDeletedHint) {
      const claim = claimLocalNotificationDeleteReconciliation(message.company_id ?? cleanActiveCompanyID, message.notification_id, "socket");
      if (!claim || claim.shouldReconcile) reconcile(message.company_id);
    },
    onNotificationsCleared(message: NotificationCreatedHint) {
      const claim = claimLocalNotificationClearReconciliation(message.company_id ?? cleanActiveCompanyID, "socket");
      if (!claim || claim.shouldReconcile) reconcile(message.company_id);
    },
  };
}
