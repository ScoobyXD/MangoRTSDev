export type RelationshipDeleteSummary = {
  succeededIDs: string[];
  failed: Array<{ relationshipID: string; reason: string }>;
};

// Converts Promise.allSettled DELETE results into a UI-friendly success/failure summary.
export const summarizeRelationshipDeleteResults = (
  relationshipIDs: string[],
  settled: PromiseSettledResult<unknown>[],
): RelationshipDeleteSummary => {
  const succeededIDs: string[] = [];
  const failed: Array<{ relationshipID: string; reason: string }> = [];

  settled.forEach((result, index) => {
    const relationshipID = relationshipIDs[index] ?? "";
    if (!relationshipID) return;
    if (result.status === "fulfilled") {
      succeededIDs.push(relationshipID);
      return;
    }
    const reason = result.reason instanceof Error
      ? result.reason.message
      : typeof result.reason === "string"
        ? result.reason
        : "failed_to_delete_relationship";
    failed.push({ relationshipID, reason });
  });

  return { succeededIDs, failed };
};
