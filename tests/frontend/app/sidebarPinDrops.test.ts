import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPLORER_DRAG_MIME } from "../../../frontend/src/modules/company-explorer/companyExplorerDragDrop.js";
import { EXPLORER_ENTITY_DRAG_MIME, serializeExplorerEntityDragPayload } from "../../../frontend/src/modules/kanban/shared.js";
import { TRIAGE_MESSAGE_DRAG_MIME } from "../../../frontend/src/pages/home/homeConstants.js";
import {
  readSidebarPinnedResourceDropAction,
  sidebarPinAcceptsPinnedResourceDrag,
  sidebarPinAcceptsPinnedResourceDrop,
  sidebarPinsFromDrop,
} from "../../../frontend/src/app/sidebarPinDrops.js";
import type { SidebarPin } from "../../../frontend/src/app/sidebarPins.js";

class FakeDataTransfer {
  private readonly values = new Map<string, string>();

  get types(): string[] {
    return Array.from(this.values.keys());
  }

  getData(type: string): string {
    return this.values.get(type) ?? "";
  }

  setData(type: string, value: string): void {
    this.values.set(type, value);
  }
}

function dataTransfer(): DataTransfer {
  return new FakeDataTransfer() as unknown as DataTransfer;
}

function pin(kind: SidebarPin["kind"], id: string): SidebarPin {
  return {
    pinID: `pin-${kind}-${id}`,
    id,
    kind,
    name: kind === "logic_gate" ? "Pinned Gate" : kind === "node" ? "Pinned Node" : "Pinned Project",
    position: 1000,
    createdTimestamp: "2026-06-26T00:00:00Z",
  };
}

describe("sidebar pin drops", () => {
  it("routes triage message drops only to node and Logic Gate pins", () => {
    const transfer = dataTransfer();
    transfer.setData(TRIAGE_MESSAGE_DRAG_MIME, JSON.stringify({ kind: "triage_messages", message_ids: ["message-1", "message-1", "message-2"], account_email: " OWNER@Example.TEST " }));

    const logicGateAction = readSidebarPinnedResourceDropAction(pin("logic_gate", "gate-1"), transfer);
    assert.deepEqual(logicGateAction && {
      kind: logicGateAction.kind,
      logicGateID: "logicGateID" in logicGateAction ? logicGateAction.logicGateID : "",
      messageIDs: "messageIDs" in logicGateAction ? logicGateAction.messageIDs : [],
      accountEmail: "accountEmail" in logicGateAction ? logicGateAction.accountEmail : undefined,
    }, {
      kind: "triage_to_logic_gate",
      logicGateID: "gate-1",
      messageIDs: ["message-1", "message-2"],
      accountEmail: "owner@example.test",
    });

    const nodeAction = readSidebarPinnedResourceDropAction(pin("node", "node-1"), transfer);
    assert.deepEqual(nodeAction && {
      kind: nodeAction.kind,
      nodeID: "nodeID" in nodeAction ? nodeAction.nodeID : "",
      messageIDs: "messageIDs" in nodeAction ? nodeAction.messageIDs : [],
      accountEmail: "accountEmail" in nodeAction ? nodeAction.accountEmail : undefined,
    }, {
      kind: "triage_to_node",
      nodeID: "node-1",
      messageIDs: ["message-1", "message-2"],
      accountEmail: "owner@example.test",
    });

    assert.equal(sidebarPinAcceptsPinnedResourceDrop(pin("project", "project-1"), transfer), false);
  });

  it("routes node drops on Logic Gate pins as existing-node assignments", () => {
    const transfer = dataTransfer();
    transfer.setData(EXPLORER_ENTITY_DRAG_MIME, serializeExplorerEntityDragPayload({
      itemType: "node_batch",
      nodes: [
        { nodeID: "node-1", label: "Node One" },
        { nodeID: "node-1", label: "Node One" },
        { nodeID: "node-2", label: "Node Two" },
      ],
    }));

    const action = readSidebarPinnedResourceDropAction(pin("logic_gate", "gate-1"), transfer);
    assert.deepEqual(action && {
      kind: action.kind,
      logicGateID: "logicGateID" in action ? action.logicGateID : "",
      nodeIDs: "nodeIDs" in action ? action.nodeIDs : [],
    }, {
      kind: "nodes_to_logic_gate",
      logicGateID: "gate-1",
      nodeIDs: ["node-1", "node-2"],
    });
    assert.equal(readSidebarPinnedResourceDropAction(pin("node", "node-target"), transfer), null);
    assert.equal(readSidebarPinnedResourceDropAction(pin("project", "project-1"), transfer), null);
  });

  it("accepts pinned resource drags from MIME types before drop data is readable", () => {
    const triageTransfer = dataTransfer();
    triageTransfer.setData(TRIAGE_MESSAGE_DRAG_MIME, "");

    assert.equal(sidebarPinAcceptsPinnedResourceDrag(pin("logic_gate", "gate-1"), triageTransfer), true);
    assert.equal(sidebarPinAcceptsPinnedResourceDrag(pin("node", "node-1"), triageTransfer), true);
    assert.equal(sidebarPinAcceptsPinnedResourceDrag(pin("project", "project-1"), triageTransfer), false);
    assert.equal(readSidebarPinnedResourceDropAction(pin("logic_gate", "gate-1"), triageTransfer), null);

    const nodeTransfer = dataTransfer();
    nodeTransfer.setData(EXPLORER_ENTITY_DRAG_MIME, "");
    assert.equal(sidebarPinAcceptsPinnedResourceDrag(pin("logic_gate", "gate-1"), nodeTransfer), true);
    assert.equal(sidebarPinAcceptsPinnedResourceDrag(pin("node", "node-1"), nodeTransfer), false);
    assert.equal(sidebarPinAcceptsPinnedResourceDrag(pin("project", "project-1"), nodeTransfer), false);
    assert.equal(readSidebarPinnedResourceDropAction(pin("logic_gate", "gate-1"), nodeTransfer), null);
  });

  it("keeps ordinary resource drops available for creating sidebar pins", () => {
    const logicGateTransfer = dataTransfer();
    logicGateTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify({
      kind: "logic_gate",
      itemID: "gate-1",
      itemType: "logic_gate",
    }));
    logicGateTransfer.setData("text/plain", "Gate One");
    assert.deepEqual(sidebarPinsFromDrop(logicGateTransfer), [{
      id: "gate-1",
      kind: "logic_gate",
      name: "Gate One",
    }]);

    const nodeTransfer = dataTransfer();
    nodeTransfer.setData(EXPLORER_ENTITY_DRAG_MIME, serializeExplorerEntityDragPayload({
      itemType: "node",
      nodeID: "node-1",
      label: "Node One",
    }));
    assert.deepEqual(sidebarPinsFromDrop(nodeTransfer), [{
      id: "node-1",
      kind: "node",
      name: "Node One",
    }]);
  });
});
