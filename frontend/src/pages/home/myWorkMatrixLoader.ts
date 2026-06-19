import type { MyWorkMatrixCell, MyWorkMatrixResponse } from "../../modules/work-items/workItemReadApi.js";

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
