import type { MailboxOption, GVICInboxRole, GVICInboxViewID, GVICInboxStatus, InboxPriority, HomeColumnWidths } from "./homeTypes.js";

export const MAILBOX_OPTIONS: MailboxOption[] = [
  { value: "primary", label: "Inbox" },
  { value: "drafts", label: "My Drafts" },
  { value: "starred", label: "Starred" },
  { value: "sent", label: "Sent mail" },
  { value: "archive", label: "Archived" },
  { value: "all", label: "All" },
];
export const MESSAGE_BATCH_SIZE = 20;
export const ARCHIVE_QUEUE_BATCH_SIZE = 2;
export const ARCHIVE_QUEUE_MAX_EMAILS = 140;
export const MESSAGE_EVENT_REFRESH_DELAY_MS = 1_200;
export const SELF_SEND_DELIVERY_REFRESH_DELAY_MS = 4_000;
export const TRIAGE_MESSAGE_DRAG_MIME = "application/x-mangorts-communications-triage-messages";
export const EVENT_HOME_TRIAGE_CONVERSION_APPLIED = "mangorts:home-triage-conversion-applied";
export type HomeTriageConversionAppliedDetail = {
  companyID?: string;
  messageIDs?: string[];
  sharedInboxID?: string;
  logicGateID?: string;
  nodeIDs?: string[];
  boardIDs?: string[];
  cardIDs?: string[];
  unstarredMessageIDs?: string[];
};
export const HOME_COLUMN_WIDTHS_STORAGE_KEY = "mangorts.communications.columnWidths.v1";
export const HOME_COLUMN_RESIZER_WIDTH = 10;
export const HOME_ROW_RESIZER_HEIGHT = 10;
export const HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY = "mangorts.communications.logicGateRailTopHeight.v1";
export const HOME_NODE_RAIL_HEIGHT_STORAGE_KEY = "mangorts.communications.nodeRailLogicGatesTopHeight.v1";
export const HOME_INBOX_GROUP_HEIGHTS_STORAGE_KEY = "mangorts.communications.inboxLogicGateGroupHeights.v1";
export const HOME_INBOX_GROUP_MIN_HEIGHT_PX = 70;
export const HOME_INBOX_GROUP_MAX_HEIGHT_PX = 10000;
export const HOME_UPDATES_SAVED_VIEWS_SLOT_ID = "mangorts-home-updates-saved-views-slot";
export const HOME_MY_WORK_SAVED_VIEWS_SLOT_ID = "mangorts-home-my-work-saved-views-slot";
export const HOME_COLUMN_MIN_WIDTHS: HomeColumnWidths = [170, 280, 220, 280];
export const HOME_COLUMN_MAX_WIDTHS: HomeColumnWidths = [360, 760, 1600, 1600];
export const HOME_INBOX_MATRIX_PANEL_MIN_WIDTH = 320;
export const INBOX_NO_LOGIC_GATE_ID = "__mango_inbox_no_logic_gate__";

export const GVIC_STATUS_COLUMNS: ReadonlyArray<{ status: GVICInboxStatus; letter: string; label: string }> = [
  { status: "pending", letter: "P", label: "Pending" },
  { status: "in_progress", letter: "IP", label: "In Progress" },
  { status: "review", letter: "R", label: "Review" },
];

export const GVIC_INBOX_SECTIONS: ReadonlyArray<{ viewID: GVICInboxViewID; role: GVICInboxRole; letter: string; label: string; title: string }> = [
  { viewID: "r-inbox", role: "generated", letter: "G", label: "Generated", title: "Generated Nodes" },
  { viewID: "a-inbox", role: "verified", letter: "V", label: "Verified", title: "Verified Nodes" },
  { viewID: "c-inbox", role: "consulted", letter: "C", label: "Consulted", title: "Consulted Nodes" },
  { viewID: "i-inbox", role: "informed", letter: "I", label: "Informed", title: "Informed Nodes" },
  { viewID: "o-inbox", role: "other", letter: "O", label: "Other", title: "Other Nodes" },
];

export const INBOX_PRIORITIES: ReadonlyArray<{ value: InboxPriority; label: string }> = [
  { value: 1, label: "1\u00A0\u00A0URGENT(<1hr)" },
  { value: 2, label: "2\u00A0\u00A0By end of day" },
  { value: 3, label: "3\u00A0\u00A0Tomorrow" },
  { value: 4, label: "4\u00A0\u00A0Sprint (1 week)" },
  { value: 5, label: "5\u00A0\u00A0Later (low priority)" },
];
