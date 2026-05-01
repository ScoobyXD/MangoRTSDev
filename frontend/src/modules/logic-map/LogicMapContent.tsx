import React from "react";
import { NodeMapContent } from "../node-map/NodeMapContent";

// Logic Gate Map intentionally reuses Node Map interaction/latency behavior.
// Only role wording changes to reflect gate semantics (input/output).
export const LogicMapContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = (props) => (
  <NodeMapContent
    {...props}
    entityMode="logic-gate"
    relationshipRoleLabels={{ parent: "Input", peer: "Peer", child: "Output" }}
  />
);
