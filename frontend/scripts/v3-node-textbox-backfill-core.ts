import type { JSONContent } from "@tiptap/core";

import { EDITOR_TEXT_BLOCK_CONTENT_PREFIX } from "../src/modules/editor/editorProjection.js";
import type { MangoTiptapDocument } from "../src/modules/editor/tiptap/mangoTiptapDocument.js";

export type V3NodeTextboxBackfillMode = "inventory" | "dry-run" | "backfill";

export type V3NodeTextboxBackfillArguments = {
  mode: V3NodeTextboxBackfillMode;
  companyID: string;
  expectedCount: number | null;
  allowWrite: boolean;
  confirmation: string;
  backupReference: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseV3NodeTextboxBackfillArguments(argv: readonly string[]): V3NodeTextboxBackfillArguments {
  const values = new Map<string, string>();
  let allowWrite = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-write") {
      allowWrite = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`unexpected_argument:${argument}`);
    if (!["--mode", "--company", "--expected-count", "--confirm", "--backup-reference"].includes(argument)) {
      throw new Error(`unknown_argument:${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${argument}`);
    values.set(argument, value);
    index += 1;
  }

  const mode = String(values.get("--mode") ?? "") as V3NodeTextboxBackfillMode;
  if (!(["inventory", "dry-run", "backfill"] as const).includes(mode)) {
    throw new Error("--mode must be inventory, dry-run, or backfill");
  }
  const companyID = String(values.get("--company") ?? "").trim().toLowerCase();
  if (!UUID_PATTERN.test(companyID)) throw new Error("--company must be a UUID");

  const expectedValue = values.get("--expected-count");
  const expectedCount = expectedValue === undefined ? null : Number(expectedValue);
  if (expectedCount !== null && (!Number.isSafeInteger(expectedCount) || expectedCount < 0)) {
    throw new Error("--expected-count must be a non-negative integer");
  }

  return {
    mode,
    companyID,
    expectedCount,
    allowWrite,
    confirmation: String(values.get("--confirm") ?? ""),
    backupReference: String(values.get("--backup-reference") ?? "").trim(),
  };
}

export function assertV3NodeTextboxBackfillSafety(args: V3NodeTextboxBackfillArguments): void {
  if (args.mode !== "backfill") {
    if (args.allowWrite) throw new Error(`${args.mode} does not accept --allow-write`);
    return;
  }
  if (!args.allowWrite) throw new Error("backfill requires --allow-write");
  if (args.expectedCount === null) throw new Error("backfill requires --expected-count");
  if (!args.backupReference) throw new Error("backfill requires --backup-reference");
  const expectedConfirmation = `BACKFILL V3 NODE TEXTBOXES ${args.companyID} ${args.expectedCount}`;
  if (args.confirmation !== expectedConfirmation) {
    throw new Error(`backfill requires --confirm \"${expectedConfirmation}\"`);
  }
}

export function legacyNodeTextboxHTML(information: string): string {
  if (!information.startsWith(EDITOR_TEXT_BLOCK_CONTENT_PREFIX)) {
    throw new Error("node_textbox_projection_is_not_a_mango_envelope");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(information.slice(EDITOR_TEXT_BLOCK_CONTENT_PREFIX.length));
  } catch {
    throw new Error("node_textbox_projection_envelope_is_invalid_json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("node_textbox_projection_envelope_is_not_an_object");
  }
  const document = (payload as Record<string, unknown>).document;
  if (typeof document !== "string") throw new Error("node_textbox_projection_envelope_has_no_document");
  return document;
}

export function v3NodeTextboxBody(document: MangoTiptapDocument): Record<string, unknown> {
  return { ...document, annotations: [] };
}

export function mangoAttachmentIDs(document: MangoTiptapDocument): string[] {
  const ids = new Set<string>();
  const visit = (node: JSONContent): void => {
    if (node.type === "mangoAttachmentImage") {
      const attachmentID = typeof node.attrs?.attachmentId === "string"
        ? node.attrs.attachmentId.trim().toLowerCase()
        : "";
      if (!UUID_PATTERN.test(attachmentID)) throw new Error("node_inline_image_attachment_id_is_not_a_uuid");
      ids.add(attachmentID);
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(document.document);
  return [...ids].sort();
}
