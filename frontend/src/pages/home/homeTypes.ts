import type { CurrentUserResponse } from "../../auth/cognitoAuth.js";
import type { EmailMessage } from "../../modules/communications/communicationsApi.js";
import type { LogicGateGVICRole, LogicGateRecord } from "../../modules/logic-gate-map/shared.js";
import type { NodeRecord } from "../../modules/node-map/shared.js";

export type HomePageProps = {
  me?: CurrentUserResponse;
  onNavigate?: (path: string, options?: { replace?: boolean }) => void;
  embedded?: boolean;
  hideNavigation?: boolean;
  initialViewID?: HomeViewID;
  onActiveViewChange?: (viewID: HomeViewID) => void;
  deepLinkNodeID?: string;
  onNodeOverlayOpen?: (nodeID: string) => void;
  onNodeOverlayClose?: () => void;
};

export type ComposeState = {
  open: boolean;
  draftID: string;
  sharedInboxID: string;
  accountEmail: string;
  replyToMessageID: string;
  replyToMessage?: EmailMessage | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: ComposeAttachment[];
  scheduledAt: string;
};

export type ComposeAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  content: string;
};

export const emptyCompose: ComposeState = {
  open: false,
  draftID: "",
  sharedInboxID: "",
  accountEmail: "",
  replyToMessageID: "",
  replyToMessage: null,
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  attachments: [],
  scheduledAt: "",
};

export type MailboxOption = {
  value: "primary" | "drafts" | "sent" | "starred" | "all" | "archive" | "spam";
  label: string;
};

export type MessageSelectionModifiers = {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

export type CommunicationsStreamEnvelope = {
  type?: string;
  trigger?: string;
  action?: string;
  message_id?: string;
  shared_inbox_id?: string;
};

export type WorkspaceStreamEnvelope = {
  company_id?: string;
  type?: string;
  data?: Record<string, unknown>;
};

export type LoadMessagesOptions = {
  refresh?: boolean;
};

export type HomeViewID =
  | "primary"
  | "my-triage"
  | "shared-root"
  | "r-inbox"
  | "a-inbox"
  | "c-inbox"
  | "i-inbox"
  | "o-inbox"
  | "my-work"
  | "updates"
  | "my-nodes"
  | "my-logic-gates"
  | `shared:${string}`;

export type HomeEntityDeleteKind = "node" | "logic_gate";

export type HomeEntityDeleteTarget = {
  kind: HomeEntityDeleteKind;
  id: string;
  label: string;
};

export type HomeColumnWidths = [number, number, number, number];

export type NodeEditorOverlayState = {
  nodeID: string;
  nodeTitle: string;
  focusInformationID?: string;
  focusRequestID?: number;
};

export type HomeColumnResizeDrag = {
  dividerIndex: 0 | 1 | 2;
  startX: number;
  startWidths: HomeColumnWidths;
  availableWidth: number;
  ownerDocument: Document;
  previousCursor: string;
  previousUserSelect: string;
  pointerID: number;
  captureTarget: HTMLButtonElement;
};

export type GVICInboxRole = LogicGateGVICRole | "other";
export type GVICInboxViewID = Extract<HomeViewID, "r-inbox" | "a-inbox" | "c-inbox" | "i-inbox" | "o-inbox">;
export type GVICInboxStatus = "pending" | "in_progress" | "review" | "done";
export type InboxPriority = 0 | 1 | 2 | 3 | 4 | 5;

export type InboxLogicGateNodeGroup = {
  logicGateID: string;
  label: string;
  nodeIDs: string[];
};

export type MyLogicGateGroup = {
  key: string;
  label: string;
  logicGates: LogicGateRecord[];
};

export type MyNodeGroup = {
  key: string;
  label: string;
  nodes: NodeRecord[];
};
