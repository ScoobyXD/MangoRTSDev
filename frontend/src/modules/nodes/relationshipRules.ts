export type RelationshipRole = "Parent" | "Child" | "Peer";
export type NodeRelationshipCreationKind = "parent" | "peer" | "child";

export type RelationshipWritePayload = {
  a_position: RelationshipRole;
  b_position: RelationshipRole;
};

export function buildLinkedNodePayload(kind: NodeRelationshipCreationKind): RelationshipWritePayload {
  if (kind === "parent") return { a_position: "Child", b_position: "Parent" };
  if (kind === "child") return { a_position: "Parent", b_position: "Child" };
  return { a_position: "Peer", b_position: "Peer" };
}
