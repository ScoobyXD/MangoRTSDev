import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS,
  aggregateSidebarPinFolderStatusCounts,
  countSidebarLogicGateStatuses,
} from "../../../frontend/src/app/sidebarLogicGateStatusCounts.js";
import type { SidebarPinTree } from "../../../frontend/src/app/sidebarPins.js";

const timestamp = "2026-08-06T00:00:00Z";

describe("pinned Logic Gate status counts", () => {
  it("counts the four requested statuses with the aligned Pinned palette", () => {
    const counts = countSidebarLogicGateStatuses({
      columns: [
        { column_id: "requested", title: "Requested" },
        { column_id: "pending", title: "Pending" },
        { column_id: "in_progress", title: "In Progress" },
        { column_id: "review", title: "Review" },
        { column_id: "backlog", title: "Backlogs" },
        { column_id: "done", title: "Done" },
      ],
      cards: [
        { column_id: "requested" },
        { column_id: "requested" },
        { column_id: "in_progress" },
        { column_id: "review" },
        { column_id: "review" },
        { column_id: "review" },
        { column_id: "backlog" },
        { column_id: "done" },
      ],
    });

    assert.deepEqual(counts, { request: 2, pending: 0, inProgress: 1, review: 3 });
    assert.deepEqual(
      SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS.map(({ key, label, color }) => [key, label, color]),
      [
        ["request", "Request", "#facc15"],
        ["pending", "Pending", "#6f7b8a"],
        ["inProgress", "In Progress", "rgb(254, 155, 70)"],
        ["review", "Review", "#19a8ff"],
      ],
    );
    assert.deepEqual(
      SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS.map(({ key, gradient }) => [key, gradient]),
      [
        ["request", "linear-gradient(135deg, #fffbd1 0%, #fff24d 42%, #facc15 100%)"],
        ["pending", "linear-gradient(135deg, #ffffff 0%, #f1f5f9 48%, #d9e0e8 100%)"],
        ["inProgress", "none"],
        ["review", "linear-gradient(180deg, #33ddd5 0%, #19a8ff 100%)"],
      ],
    );
  });

  it("adds direct and nested Logic Gate counts into every ancestor folder only once", () => {
    const tree: SidebarPinTree = {
      folders: [
        { folderID: "outer", parentFolderID: "", name: "Outer", position: 1000, createdTimestamp: timestamp, updatedTimestamp: timestamp },
        { folderID: "inner", parentFolderID: "outer", name: "Inner", position: 1000, createdTimestamp: timestamp, updatedTimestamp: timestamp },
        { folderID: "empty", parentFolderID: "", name: "Empty", position: 2000, createdTimestamp: timestamp, updatedTimestamp: timestamp },
      ],
      pins: [
        { pinID: "gate-a-pin", parentFolderID: "inner", kind: "logic_gate", id: "gate-a", name: "Gate A", position: 1000, createdTimestamp: timestamp },
        { pinID: "gate-b-pin", parentFolderID: "outer", kind: "logic_gate", id: "gate-b", name: "Gate B", position: 2000, createdTimestamp: timestamp },
        { pinID: "node-pin", parentFolderID: "inner", kind: "node", id: "node-a", name: "Node A", position: 2000, createdTimestamp: timestamp },
        { pinID: "root-gate-pin", parentFolderID: "", kind: "logic_gate", id: "root-gate", name: "Root Gate", position: 3000, createdTimestamp: timestamp },
      ],
    };
    const result = aggregateSidebarPinFolderStatusCounts(tree, {
      "gate-a": { request: 1, pending: 2, inProgress: 0, review: 4 },
      "gate-b": { request: 3, pending: 0, inProgress: 5, review: 0 },
      "root-gate": { request: 99, pending: 99, inProgress: 99, review: 99 },
    });

    assert.deepEqual(result.inner, { request: 1, pending: 2, inProgress: 0, review: 4 });
    assert.deepEqual(result.outer, { request: 4, pending: 2, inProgress: 5, review: 4 });
    assert.equal(result.empty, undefined, "folders without Process descendants reserve no status column");
  });

});
