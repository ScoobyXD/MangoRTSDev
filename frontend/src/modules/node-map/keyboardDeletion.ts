export type NodeMapDeleteIntent =
  | { type: "none" }
  | { type: "relationships"; ids: string[] }
  | { type: "nodes"; ids: string[] };

export const resolveNodeMapDeleteIntent = (args: {
  key: string;
  selectedRelationshipIDs: Set<string>;
  selectedNodeIDs: Set<string>;
  selectedNodeID: string;
}) : NodeMapDeleteIntent => {
  if (args.key !== "Delete" && args.key !== "Backspace") return { type: "none" };
  const relationshipIDs = Array.from(args.selectedRelationshipIDs);
  if (relationshipIDs.length > 0) return { type: "relationships", ids: relationshipIDs };
  const nodeIDs = args.selectedNodeIDs.size > 0 ? Array.from(args.selectedNodeIDs) : (args.selectedNodeID ? [args.selectedNodeID] : []);
  if (nodeIDs.length > 0) return { type: "nodes", ids: nodeIDs };
  return { type: "none" };
};
