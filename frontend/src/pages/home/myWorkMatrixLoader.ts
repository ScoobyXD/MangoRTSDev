import type { MyWorkMatrixCell, MyWorkMatrixResponse } from "../../modules/work-items/workItemReadApi.js";
import { GVIC_MATRIX_PROJECTION_NAME, GVICMatrixRealtimeScope } from "../../modules/gvic/gvicMatrixProjectionDeltas.js";
import type { RealtimeProjectionDeltaMessage } from "../../modules/realtime/realtimeWebSocket.js";
import type { MyWorkSelectedScope } from "./myWorkGrouping.js";

export type MyWorkMatrixCellWithUser = MyWorkMatrixCell & { companyID: string; userID: string };

export type MyWorkMatrixLoadFailure = {
  userID: string;
  message: string;
};

export type MyWorkMatrixLoadResult = {
  cells: MyWorkMatrixCellWithUser[];
  failures: MyWorkMatrixLoadFailure[];
};

export type MyWorkMatrixFetcher = (targetUserID: string) => Promise<MyWorkMatrixResponse>;

export async function loadMyWorkMatrixCellsForUsers({
  companyID,
  targetUserIDs,
  fetchMatrix,
}: {
  companyID: string;
  targetUserIDs: string[];
  fetchMatrix: MyWorkMatrixFetcher;
}): Promise<MyWorkMatrixLoadResult> {
  const cleanCompanyID = companyID.trim();
  const cleanTargetUserIDs = uniqueNonEmptyStrings(targetUserIDs);
  if (!cleanCompanyID || cleanTargetUserIDs.length === 0) return { cells: [], failures: [] };

  const results = await Promise.all(cleanTargetUserIDs.map(async (targetUserID) => {
    try {
      const payload = await fetchMatrix(targetUserID);
      return {
        ok: true as const,
        cells: (payload.cells ?? []).map((cell) => ({
          ...cell,
          companyID: payload.company_id?.trim() || cleanCompanyID,
          userID: payload.user_id?.trim() || targetUserID,
        })),
      };
    } catch (error) {
      return {
        ok: false as const,
        failure: {
          userID: targetUserID,
          message: error instanceof Error && error.message.trim() ? error.message.trim() : "Failed to load My Work",
        },
      };
    }
  }));

  const cells: MyWorkMatrixCellWithUser[] = [];
  const failures: MyWorkMatrixLoadFailure[] = [];
  for (const result of results) {
    if (result.ok) cells.push(...result.cells);
    else failures.push(result.failure);
  }
  return { cells, failures };
}

export function uniqueMyWorkTargetUserIDs(values: string[]): string[] {
  return uniqueNonEmptyStrings(values);
}

export function myWorkMatrixCacheKey({
  companyID,
  selectedScope,
  targetUserIDs,
}: {
  companyID: string;
  selectedScope: MyWorkSelectedScope;
  targetUserIDs: string[];
}): string {
  const cleanCompanyID = companyID.trim() || "company";
  const level = selectedScope.level.trim() || "scope";
  const subjectType = selectedScope.subject_type.trim() || "subject";
  const subjectID = selectedScope.subject_id.trim() || "subject";
  const targets = uniqueNonEmptyStrings(targetUserIDs).join(",");
  return `my_work:${cleanCompanyID}:${level}:${subjectType}:${subjectID}:targets:${targets}`;
}

export function myWorkProjectionDeltaAffectsTargetUsers(
  message: Pick<RealtimeProjectionDeltaMessage, "scope" | "projection" | "projection_scope" | "affected_scopes" | "deltas">,
  targetUserIDs: string[],
): boolean {
  const targetUsers = new Set(uniqueNonEmptyStrings(targetUserIDs));
  if (targetUsers.size === 0) return false;

  for (const affectedScope of message.affected_scopes ?? []) {
    const [surface, targetType, ...idParts] = affectedScope.trim().split(":").filter(Boolean);
    const targetID = idParts.join(":").trim();
    if (surface !== "my_work" || !targetType || !targetID) continue;
    if (targetType === "user" && targetUsers.has(targetID)) return true;
    if (targetType === "company") return true;
  }

  const projection = cleanString(message.projection);
  if (projection && projection !== GVIC_MATRIX_PROJECTION_NAME) return false;

  const projectionScopeUserID = userIDFromProjectionScope(message.projection_scope);
  if (projectionScopeUserID && targetUsers.has(projectionScopeUserID)) return true;

  const scopeUserID = userIDFromGVICRealtimeScope(message.scope);
  if (scopeUserID && targetUsers.has(scopeUserID)) return true;

  for (const delta of message.deltas ?? []) {
    const userID = userIDFromProjectionDelta(delta);
    if (userID && targetUsers.has(userID)) return true;
  }
  return false;
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function userIDFromProjectionScope(value: unknown): string {
  const clean = cleanString(value);
  if (!clean.startsWith("user:")) return "";
  return clean.slice("user:".length).trim();
}

function userIDFromGVICRealtimeScope(value: unknown): string {
  const clean = cleanString(value);
  const prefix = GVICMatrixRealtimeScope("");
  if (!clean.startsWith(prefix)) return "";
  return clean.slice(prefix.length).trim();
}

function userIDFromProjectionDelta(value: unknown): string {
  const delta = recordValue(value);
  if (!delta) return "";
  const row = recordValue(delta.row);
  const rowKey = recordValue(delta.row_key);
  return cleanString(row?.user_id) || cleanString(rowKey?.user_id);
}
