import type { EmailMailbox } from "../../modules/communications/communicationsApi.js";
import type { MailboxOption, AciInboxRole, RaciInboxRole, RaciInboxViewID, ResponsibleInboxStatus, InboxPriority, HomeColumnWidths } from "./homeTypes.js";

export const MAILBOX_OPTIONS: MailboxOption[] = [
  { value: "primary", label: "My Triage" },
  { value: "starred", label: "Starred" },
  { value: "sent", label: "Sent mail" },
  { value: "archive", label: "Archived" },
  { value: "all", label: "All" },
];

export const MESSAGE_BATCH_SIZE = 20;
export const ARCHIVE_BATCH_SIZE = 5;
export const ARCHIVE_BATCH_FLUSH_DELAY_MS = 500;
export const MESSAGE_EVENT_REFRESH_DELAY_MS = 1_200;
export const AUTO_ARCHIVE_SCROLL_DELAY_MS = 2_000;
export const SELF_SEND_DELIVERY_REFRESH_DELAY_MS = 4_000;
export const TRIAGE_MESSAGE_DRAG_MIME = "application/x-mangorts-communications-triage-messages";
export const HOME_COLUMN_WIDTHS_STORAGE_KEY = "mangorts.communications.columnWidths.v1";
export const HOME_COLUMN_RESIZER_WIDTH = 10;
export const HOME_ROW_RESIZER_HEIGHT = 10;
export const HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY = "mangorts.communications.logicGateRailTopHeight.v1";
export const HOME_NODE_RAIL_HEIGHT_STORAGE_KEY = "mangorts.communications.nodeRailTopHeight.v1";
export const HOME_INBOX_GROUP_HEIGHTS_STORAGE_KEY = "mangorts.communications.inboxLogicGateGroupHeights.v1";
export const HOME_INBOX_GROUP_MIN_HEIGHT_PX = 70;
export const HOME_INBOX_GROUP_MAX_HEIGHT_PX = 10000;
export const HOME_COLUMN_MIN_WIDTHS: HomeColumnWidths = [170, 280, 220, 280];
export const HOME_COLUMN_MAX_WIDTHS: HomeColumnWidths = [360, 760, 1600, 1600];
export const HOME_INBOX_MATRIX_PANEL_MIN_WIDTH = 320;
export const INBOX_NO_LOGIC_GATE_ID = "__mango_inbox_no_logic_gate__";

export const ACI_COLUMNS: ReadonlyArray<{ role: AciInboxRole; letter: string; label: string }> = [
  { role: "accountable", letter: "A", label: "Accountable" },
  { role: "consulted", letter: "C", label: "Consulted" },
  { role: "informed", letter: "I", label: "Informed" },
];

export const RESPONSIBLE_STATUS_COLUMNS: ReadonlyArray<{ status: ResponsibleInboxStatus; letter: string; label: string }> = [
  { status: "pending", letter: "P", label: "Pending" },
  { status: "in_progress", letter: "IP", label: "In Progress" },
];

export const RACI_STATUS_COLUMNS = RESPONSIBLE_STATUS_COLUMNS;

export const RACI_INBOX_SECTIONS: ReadonlyArray<{ viewID: RaciInboxViewID; role: RaciInboxRole; letter: string; label: string; title: string }> = [
  { viewID: "r-inbox", role: "responsible", letter: "R", label: "Responsible", title: "R Nodes" },
  { viewID: "a-inbox", role: "accountable", letter: "A", label: "Accountable", title: "A Nodes" },
  { viewID: "c-inbox", role: "consulted", letter: "C", label: "Consulted", title: "C Nodes" },
  { viewID: "i-inbox", role: "informed", letter: "I", label: "Informed", title: "I Nodes" },
  { viewID: "o-inbox", role: "other", letter: "O", label: "Other", title: "O Nodes" },
];

export const INBOX_PRIORITIES: ReadonlyArray<{ value: InboxPriority; label: string }> = [
  { value: 1, label: "1\u00A0\u00A0URGENT (<1 hr)" },
  { value: 2, label: "2\u00A0\u00A0By end of day" },
  { value: 3, label: "3\u00A0\u00A0Within a few days" },
  { value: 4, label: "4\u00A0\u00A0Within the week" },
  { value: 5, label: "5\u00A0\u00A0Later (low priority)" },
];

export const DEFAULT_HOME_MAILBOX: EmailMailbox = "primary";
