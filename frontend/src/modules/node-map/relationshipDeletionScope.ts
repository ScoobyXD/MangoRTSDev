type ScopedRelationship = { node_relationship_id: string; company_id: string };

export type RelationshipDeletionScope =
  | { type: "ok"; ids: string[]; companyID: string }
  | { type: "invalid_selection" }
  | { type: "company_scope_mismatch" };

export const resolveRelationshipDeletionScope = (args: {
  relationshipIDs: string[];
  relationships: ScopedRelationship[];
  activeCompanyID: string;
}): RelationshipDeletionScope => {
  const ids = Array.from(new Set(args.relationshipIDs.map((id) => id.trim()).filter((id) => id.length > 0)));
  if (ids.length === 0) return { type: "invalid_selection" };

  const byID = new Map(args.relationships.map((relationship) => [relationship.node_relationship_id, relationship]));
  for (const id of ids) {
    const relationship = byID.get(id);
    if (!relationship) continue;
    if (relationship.company_id !== args.activeCompanyID) return { type: "company_scope_mismatch" };
  }

  return { type: "ok", ids, companyID: args.activeCompanyID };
};
