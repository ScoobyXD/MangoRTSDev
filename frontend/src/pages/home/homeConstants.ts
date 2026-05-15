import type { EmailMailbox } from "../../modules/communications/communicationsApi.js";
import type { MailboxOption, AciInboxRole, ResponsibleInboxStatus, InboxPriority, HomeColumnWidths } from "./homeTypes.js";

export const MAILBOX_OPTIONS: MailboxOption[] = [
  { value: "primary", label: "Pending" },
  { value: "starred", label: "Starred" },
  { value: "sent", label: "Sent mail" },
  { value: "archive", label: "Archived" },
  { value: "all", label: "All" },
];

export const MESSAGE_BATCH_SIZE = 15;
export const MESSAGE_EVENT_REFRESH_DELAY_MS = 1_200;
export const SELF_SEND_DELIVERY_REFRESH_DELAY_MS = 4_000;
export const TRIAGE_MESSAGE_DRAG_MIME = "application/x-mangorts-communications-triage-messages";
export const HOME_COLUMN_WIDTHS_STORAGE_KEY = "mangorts.communications.columnWidths.v1";
export const HOME_COLUMN_RESIZER_WIDTH = 10;
export const HOME_ROW_RESIZER_HEIGHT = 10;
export const HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY = "mangorts.communications.logicGateRailTopHeight.v1";
export const HOME_NODE_RAIL_HEIGHT_STORAGE_KEY = "mangorts.communications.nodeRailTopHeight.v1";
export const HOME_COLUMN_MIN_WIDTHS: HomeColumnWidths = [170, 280, 220, 280];
export const HOME_COLUMN_MAX_WIDTHS: HomeColumnWidths = [360, 760, 1600, 1600];
export const INBOX_NO_LOGIC_GATE_ID = "__mango_inbox_no_logic_gate__";

export const ACI_COLUMNS: ReadonlyArray<{ role: AciInboxRole; letter: string; label: string }> = [
  { role: "accountable", letter: "A", label: "Accountable" },
  { role: "consulted", letter: "C", label: "Consulted" },
  { role: "informed", letter: "I", label: "Informed" },
];

export const RESPONSIBLE_STATUS_COLUMNS: ReadonlyArray<{ status: ResponsibleInboxStatus; letter: string; label: string }> = [
  { status: "pending", letter: "P", label: "Pending" },
  { status: "in_progress", letter: "IP", label: "In Progress" },
  { status: "done", letter: "D", label: "Done" },
];

export const INBOX_PRIORITIES: ReadonlyArray<{ value: InboxPriority; label: string }> = [
  { value: 1, label: "1\u00A0\u00A0URGENT (<1 hr)" },
  { value: 2, label: "2\u00A0\u00A0By end of day" },
  { value: 3, label: "3\u00A0\u00A0Within a few days" },
  { value: 4, label: "4\u00A0\u00A0Within the week" },
  { value: 5, label: "5\u00A0\u00A0Later (low priority)" },
  { value: 0, label: "0\u00A0\u00A0Unassigned" },
];

export const DEFAULT_HOME_MAILBOX: EmailMailbox = "primary";
