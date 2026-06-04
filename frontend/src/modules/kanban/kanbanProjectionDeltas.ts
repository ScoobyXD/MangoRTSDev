import type { KanbanCard } from "./shared.js";

export type KanbanProjectionDeltaOperation = "upsert" | "delete" | "patch";

export type KanbanProjectionRowKey = {
  company_id?: string;
  board_id?: string;
  logic_gate_id?: string;
  node_id?: string;
  card_id?: string;
};

export type KanbanBoardProjectionRow = {
  company_id?: string;
  board_id?: string;
  card_id?: string;
  column_id?: string;
  node_id?: string;
  logic_gate_id?: string | null;
  node_title?: string;
  title?: string;
  description_snapshot?: string;
  is_issue?: boolean | null;
  position?: number;
  due_date?: string | null;
  priority?: number | null;
  assignee_user_id?: string | null;
  assignee_display_name?: string | null;
  assignee_name?: string | null;
  assignee_email?: string | null;
  created_timestamp?: string;
  assignment_created_timestamp?: string;
  updated_timestamp?: string;
  projection_updated_timestamp?: string;
};

export type KanbanProjectionDelta = {
  operation?: KanbanProjectionDeltaOperation | string;
  row_key?: KanbanProjectionRowKey | null;
  row?: KanbanBoardProjectionRow | null;
  patch?: Partial<KanbanBoardProjectionRow> | null;
  projected_timestamp?: string;
  projection_sequence?: number;
};

export type KanbanProjectionEnvelope = {
  company_id?: string;
  projection?: string;
  projection_sequence?: number;
  projected_timestamp?: string;
  deltas?: KanbanProjectionDelta[];
};

export type KanbanProjectionFallbackReason =
  | "wrong_company"
  | "wrong_projection"
  | "sequence_gap"
  | "invalid_envelope"
  | "invalid_delta"
  | "unknown_delta_operation"
  | "permission_revoked"
  | "missing_row"
  | "missing_existing_card"
  | "missing_row_key";

export type KanbanProjectionApplyResult = {
  cards: KanbanCard[];
  changed: boolean;
  fallback: boolean;
  fallbackReason?: KanbanProjectionFallbackReason;
  lastSequence?: number;
  removedCardIDs: string[];
  upsertedCards: KanbanCard[];
};

export type KanbanProjectionApplyInput = {
  envelope: KanbanProjectionEnvelope;
  companyID: string;
  boardID: string;
  cards: KanbanCard[];
  versions: Map<string, number>;
  lastSequence?: number;
};

export const KANBAN_BOARD_PROJECTION_NAME = "kanban_board";

export function nextKanbanProjectionCursor(currentSequence: number | undefined, projectionSequence: number | undefined): number | undefined {
  if (projectionSequence === undefined) return currentSequence;
  return Math.max(currentSequence ?? 0, projectionSequence);
}

export function beginKanbanProjectionFallback(inFlightBoards: Set<string>, boardID: string): boolean {
  const cleanBoardID = cleanString(boardID);
  if (!cleanBoardID || inFlightBoards.has(cleanBoardID)) return false;
  inFlightBoards.add(cleanBoardID);
  return true;
}

export function finishKanbanProjectionFallback(inFlightBoards: Set<string>, boardID: string): void {
  const cleanBoardID = cleanString(boardID);
  if (cleanBoardID) inFlightBoards.delete(cleanBoardID);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanOptionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim();
}

function cleanOptionalNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function parseVersionTimestamp(value: unknown): number {
  if (typeof value !== "string" || value.trim() === "") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function projectionCardKey(boardID: string, cardID: string): string {
  return `${boardID}\u0000${cardID}`;
}

function rowCardID(delta: KanbanProjectionDelta): string {
  return cleanString(delta.row?.card_id) || cleanString(delta.row_key?.card_id);
}

function rowBoardID(delta: KanbanProjectionDelta): string {
  return cleanString(delta.row?.board_id) || cleanString(delta.row_key?.board_id);
}

export function kanbanProjectionDeltaVersion(delta: KanbanProjectionDelta, envelope: KanbanProjectionEnvelope): number {
  const rowVersion = Math.max(
    parseVersionTimestamp(delta.row?.projection_updated_timestamp),
    parseVersionTimestamp(delta.row?.updated_timestamp),
    parseVersionTimestamp(delta.patch?.projection_updated_timestamp),
    parseVersionTimestamp(delta.patch?.updated_timestamp),
  );
  if (rowVersion > 0) return rowVersion;
  return Math.max(
    parseVersionTimestamp(delta.projected_timestamp),
    parseVersionTimestamp(envelope.projected_timestamp),
    Number.isFinite(delta.projection_sequence) ? Number(delta.projection_sequence) : 0,
    Number.isFinite(envelope.projection_sequence) ? Number(envelope.projection_sequence) : 0,
  );
}

export function seedKanbanProjectionVersions(cards: KanbanCard[], versions: Map<string, number>): void {
  for (const card of cards) {
    const boardID = cleanString(card.board_id);
    const cardID = cleanString(card.card_id);
    if (!boardID || !cardID) continue;
    const version = Math.max(parseVersionTimestamp(card.projection_updated_timestamp), parseVersionTimestamp(card.updated_timestamp));
    if (version > 0) versions.set(projectionCardKey(boardID, cardID), version);
  }
}

export function kanbanCardFromProjectionRow(row: KanbanBoardProjectionRow): KanbanCard | null {
  const companyID = cleanString(row.company_id);
  const boardID = cleanString(row.board_id);
  const cardID = cleanString(row.card_id);
  const columnID = cleanString(row.column_id);
  const nodeID = cleanString(row.node_id);
  const title = cleanString(row.node_title) || cleanString(row.title);
  if (!companyID || !boardID || !cardID || !columnID || !nodeID) return null;
  const projectionUpdated = cleanString(row.projection_updated_timestamp);
  const updated = cleanString(row.updated_timestamp) || projectionUpdated;
  return {
    company_id: companyID,
    board_id: boardID,
    card_id: cardID,
    column_id: columnID,
    node_id: nodeID,
    logic_gate_id: cleanOptionalString(row.logic_gate_id),
    node_title: title || nodeID,
    description_snapshot: cleanString(row.description_snapshot),
    is_issue: row.is_issue === true,
    position: typeof row.position === "number" && Number.isFinite(row.position) ? row.position : 0,
    due_date: cleanOptionalString(row.due_date),
    priority: cleanOptionalNumber(row.priority),
    assignee_user_id: cleanOptionalString(row.assignee_user_id),
    assignee_name: cleanOptionalString(row.assignee_name) ?? cleanOptionalString(row.assignee_display_name),
    assignee_email: cleanOptionalString(row.assignee_email),
    projection_updated_timestamp: projectionUpdated || undefined,
    created_timestamp: cleanString(row.created_timestamp) || cleanString(row.assignment_created_timestamp) || updated,
    updated_timestamp: updated || cleanString(row.created_timestamp) || "",
  };
}

function requestFallback(result: KanbanProjectionApplyResult, reason: KanbanProjectionFallbackReason): KanbanProjectionApplyResult {
  return { ...result, fallback: true, fallbackReason: reason };
}

function applyPatchToCard(card: KanbanCard, patch: Partial<KanbanBoardProjectionRow>, delta: KanbanProjectionDelta, envelope: KanbanProjectionEnvelope): KanbanCard {
  const patched = { ...card };
  if (typeof patch.column_id === "string") patched.column_id = patch.column_id.trim() || patched.column_id;
  if (typeof patch.node_title === "string" || typeof patch.title === "string") patched.node_title = cleanString(patch.node_title) || cleanString(patch.title) || patched.node_title;
  if (typeof patch.description_snapshot === "string") patched.description_snapshot = patch.description_snapshot;
  if (typeof patch.is_issue === "boolean") patched.is_issue = patch.is_issue;
  if (typeof patch.position === "number" && Number.isFinite(patch.position)) patched.position = patch.position;
  if (Object.prototype.hasOwnProperty.call(patch, "due_date")) patched.due_date = cleanOptionalString(patch.due_date);
  if (Object.prototype.hasOwnProperty.call(patch, "priority")) patched.priority = cleanOptionalNumber(patch.priority);
  if (Object.prototype.hasOwnProperty.call(patch, "assignee_user_id")) patched.assignee_user_id = cleanOptionalString(patch.assignee_user_id);
  if (Object.prototype.hasOwnProperty.call(patch, "assignee_display_name") || Object.prototype.hasOwnProperty.call(patch, "assignee_name")) {
    patched.assignee_name = cleanOptionalString(patch.assignee_name) ?? cleanOptionalString(patch.assignee_display_name);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "assignee_email")) patched.assignee_email = cleanOptionalString(patch.assignee_email);
  const projectionUpdated = cleanString(patch.projection_updated_timestamp) || cleanString(delta.projected_timestamp) || cleanString(envelope.projected_timestamp);
  if (projectionUpdated) patched.projection_updated_timestamp = projectionUpdated;
  const updated = cleanString(patch.updated_timestamp) || projectionUpdated;
  if (updated) patched.updated_timestamp = updated;
  return patched;
}

export function applyKanbanProjectionEnvelope(input: KanbanProjectionApplyInput): KanbanProjectionApplyResult {
  const result: KanbanProjectionApplyResult = {
    cards: input.cards,
    changed: false,
    fallback: false,
    lastSequence: input.lastSequence,
    removedCardIDs: [],
    upsertedCards: [],
  };
  const companyID = cleanString(input.companyID);
  const boardID = cleanString(input.boardID);
  const envelopeCompanyID = cleanString(input.envelope.company_id);
  if (!companyID || !boardID || !envelopeCompanyID || envelopeCompanyID !== companyID) {
    return requestFallback(result, "wrong_company");
  }
  if (cleanString(input.envelope.projection) !== KANBAN_BOARD_PROJECTION_NAME) {
    return requestFallback(result, "wrong_projection");
  }
  const sequence = Number(input.envelope.projection_sequence);
  if (Number.isSafeInteger(sequence) && sequence > 0) {
    if (input.lastSequence !== undefined && sequence > input.lastSequence + 1) {
      return requestFallback(result, "sequence_gap");
    }
    result.lastSequence = Math.max(input.lastSequence ?? 0, sequence);
  }
  if (!Array.isArray(input.envelope.deltas)) {
    return requestFallback(result, "invalid_envelope");
  }

  let nextCards = input.cards;
  const byID = new Map(input.cards.map((card) => [card.card_id, card]));
  for (const delta of input.envelope.deltas) {
    if (!delta || typeof delta !== "object") return requestFallback(result, "invalid_delta");
    const operation = cleanString(delta.operation);
    if (operation !== "upsert" && operation !== "delete" && operation !== "patch") {
      return requestFallback(result, "unknown_delta_operation");
    }
    const deltaBoardID = rowBoardID(delta);
    if (deltaBoardID !== boardID) continue;
    const cardID = rowCardID(delta);
    if (!cardID) return requestFallback(result, "missing_row_key");
    const key = projectionCardKey(boardID, cardID);
    const incomingVersion = kanbanProjectionDeltaVersion(delta, input.envelope);
    const existingVersion = input.versions.get(key) ?? 0;
    if (incomingVersion > 0 && existingVersion > incomingVersion) continue;

    if (operation === "delete") {
      if (!byID.has(cardID)) {
        if (incomingVersion > 0) input.versions.set(key, incomingVersion);
        continue;
      }
      byID.delete(cardID);
      if (incomingVersion > 0) input.versions.set(key, incomingVersion);
      result.removedCardIDs.push(cardID);
      result.changed = true;
      continue;
    }

    if (operation === "upsert") {
      const card = delta.row ? kanbanCardFromProjectionRow(delta.row) : null;
      if (!card) return requestFallback(result, "missing_row");
      byID.set(card.card_id, card);
      if (incomingVersion > 0) input.versions.set(key, incomingVersion);
      result.upsertedCards.push(card);
      result.changed = true;
      continue;
    }

    const existing = byID.get(cardID);
    if (!existing) return requestFallback(result, "missing_existing_card");
    const patched = applyPatchToCard(existing, delta.patch ?? {}, delta, input.envelope);
    byID.set(cardID, patched);
    if (incomingVersion > 0) input.versions.set(key, incomingVersion);
    result.upsertedCards.push(patched);
    result.changed = true;
  }

  if (result.changed) nextCards = Array.from(byID.values());
  return { ...result, cards: nextCards };
}
