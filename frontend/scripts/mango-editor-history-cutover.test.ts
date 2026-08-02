import assert from "node:assert/strict";
import test from "node:test";
import {
  convertActiveHistoryRows,
  convertRecyclePayload,
  convertStoredEditorBody,
  type JSONRecord,
} from "./mango-editor-history-cutover-core.js";

const companyID = "11111111-1111-1111-1111-111111111111";
const nodeID = "019f3e94-e460-7acb-979b-cee4a023b63b";
const gateID = "019f480e-b91b-77bc-a28e-d1d6508c7238";
const projectID = "019f6e66-7383-7000-b645-ee06fb93985a";
const textboxID = "019f6e73-d5c7-7000-a524-3d5f47846143";
const batchID = "019f6e9d-bd16-7000-be99-b3c2273327f8";
const timestamp = "2026-07-30T13:57:57.019Z";

function envelope(document: string, extra: JSONRecord = {}): string {
  return `<!-- mango-node-text-block-v1 -->${JSON.stringify({ title: "", attachments: [], document, ...extra })}`;
}

function projection(ownerKey: string, ownerID: string, informationID: string, information: string): JSONRecord {
  return {
    company_id: companyID,
    [ownerKey]: ownerID,
    information_id: informationID,
    type: "Text box",
    information,
    revision: 3,
    is_deleted: false,
    created_timestamp: timestamp,
    updated_timestamp: timestamp,
  };
}

function savedInformation(ownerKey: string, ownerID: string, kind: "manual" | "auto", information: string): JSONRecord {
  return {
    company_id: companyID,
    [ownerKey]: ownerID,
    information_id: textboxID,
    source_information_id: textboxID,
    save_batch_id: batchID,
    save_kind: kind,
    saved_by_user_id: "",
    information,
    created_timestamp: timestamp,
    updated_timestamp: timestamp,
  };
}

test("history cutover keeps attachment images by using durable attachment metadata", () => {
  const attachmentID = "e7f08c6f-fb6a-5a7d-88f7-066511f77a98";
  const body = convertStoredEditorBody(
    `<span data-mango-editor-image="true" data-mango-editor-attachment-id="${attachmentID}"><img src=""></span>`,
    [{ attachmentId: attachmentID, filename: "diagram.png", mimeType: "image/png", byteSize: 12, sha256: "a".repeat(64) }],
  );
  assert.equal(body.format, "mango-tiptap-json");
  assert.match(JSON.stringify(body), /mangoAttachmentImage/);
  assert.match(JSON.stringify(body), /image\/png/);
});

test("active history conversion keeps manual batches and excludes automatic snapshots", () => {
  const manual = savedInformation("node_id", nodeID, "manual", envelope("<p>manual</p>"));
  const automatic = { ...manual, information_id: gateID, save_kind: "auto" };
  const converted = convertActiveHistoryRows("node", [manual, automatic]);
  assert.equal(converted.length, 1);
  assert.equal(converted[0].batch_id, batchID);
  assert.equal(converted[0].display_order, 0);
  assert.equal(converted[0].saved_by_display_name, undefined);
});

test("recycle conversion creates all six target payloads and removes old save rows", () => {
  const projectSave = `MANGO_PROJECT_SAVE_V1:${JSON.stringify({
    blocks: [{ id: "project-textbox", title: "Saved", document: "<p>project history</p>", attachments: [] }],
  })}`;
  const payload: JSONRecord = {
    nodes: [{ company_id: companyID, node_id: nodeID }],
    node_projection_table: [projection("node_id", nodeID, textboxID, envelope("<p>node current</p>"))],
    logic_gate_projection_table: [projection("logic_gate_id", gateID, "logic-textbox", "<p>logic current</p>")],
    project_projection_table: [projection("project_id", projectID, "project-textbox", "<p>project current</p>")],
    node_information: [
      savedInformation("node_id", nodeID, "manual", envelope("<p>node history</p>")),
      { ...savedInformation("node_id", nodeID, "auto", envelope("<p>automatic</p>")), information_id: gateID },
    ],
    logic_gate_information: [],
    project_information: [{
      company_id: companyID,
      project_id: projectID,
      information_id: batchID,
      type: "Saved version",
      information: projectSave,
      created_timestamp: timestamp,
      updated_timestamp: timestamp,
    }],
  };
  const converted = convertRecyclePayload(payload);
  assert.equal((converted.payload.node_textboxes as unknown[]).length, 1);
  assert.equal((converted.payload.logic_gate_textboxes as unknown[]).length, 1);
  assert.equal((converted.payload.project_textboxes as unknown[]).length, 1);
  assert.equal((converted.payload.node_textboxes_history as unknown[]).length, 1);
  assert.equal((converted.payload.logic_gate_textboxes_history as unknown[]).length, 0);
  assert.equal((converted.payload.project_textboxes_history as unknown[]).length, 1);
  assert.equal((converted.payload.node_information as unknown[]).length, 0);
  assert.equal((converted.payload.project_information as unknown[]).length, 0);
  assert.equal(converted.stats.automaticHistoryDiscarded, 1);
  assert.deepEqual(convertRecyclePayload(converted.payload).payload, converted.payload);
});
