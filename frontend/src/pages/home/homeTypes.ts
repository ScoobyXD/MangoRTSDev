import type { CurrentUserResponse } from "../../auth/cognitoAuth.js";
import type { LogicGateRaciRole, LogicGateRecord } from "../../modules/logic-gate-map/shared.js";

export type HomePageProps = {
  me?: CurrentUserResponse;
  onNavigate?: (path: string) => void;
  embedded?: boolean;
  hideNavigation?: boolean;
  initialViewID?: HomeViewID;
};

export type ComposeState = {
  open: boolean;
  replyToMessageID: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
};

export const emptyCompose: ComposeState = {
  open: false,
  replyToMessageID: "",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
};

export type MailboxOption = {
  value: "primary" | "sent" | "all" | "archive";
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
  message_id?: string;
};

export type WorkspaceStreamEnvelope = {
  company_id?: string;
  type?: string;
};

export type LoadMessagesOptions = {
  refresh?: boolean;
};

export type HomeViewID =
  | "primary"
  | "my-triage"
  | "shared-root"
  | "aci-inbox"
  | "r-inbox"
  | "my-nodes"
  | "my-logic-gates"
  | `shared:${string}`;

export type HomeColumnWidths = [number, number, number, number];

export type NodeEditorOverlayState = {
  nodeID: string;
  nodeTitle: string;
};

export type HomeColumnResizeDrag = {
  dividerIndex: 0 | 1 | 2;
  startX: number;
  startWidths: HomeColumnWidths;
  availableWidth: number;
};

export type AciInboxRole = Extract<LogicGateRaciRole, "accountable" | "consulted" | "informed">;
export type ResponsibleInboxStatus = "pending" | "in_progress" | "done";
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
