import type { EntityFolder, EntitySummary } from "./entitiesApi.js";

export type EntityTreeRow =
  | { kind: "folder"; id: string; depth: number; folder: EntityFolder }
  | { kind: "entity"; id: string; depth: number; entity: EntitySummary };

function byPositionThenName<T extends { position: number; name: string }>(left: T, right: T): number {
  return left.position - right.position
    || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

function locationKey(value: string | null | undefined): string {
  return value?.trim() || "";
}

function groupFoldersByParent(folders: EntityFolder[]): Map<string, EntityFolder[]> {
  const grouped = new Map<string, EntityFolder[]>();
  for (const folder of folders) {
    const key = locationKey(folder.parent_entity_folder_id);
    const siblings = grouped.get(key) ?? [];
    siblings.push(folder);
    grouped.set(key, siblings);
  }
  for (const siblings of grouped.values()) siblings.sort(byPositionThenName);
  return grouped;
}

export function buildEntityTreeRows(folders: EntityFolder[], entities: EntitySummary[]): EntityTreeRow[] {
  const rows: EntityTreeRow[] = [];
  const visitedFolderIDs = new Set<string>();
  const foldersByParent = groupFoldersByParent(folders);
  const entitiesByFolder = new Map<string, EntitySummary[]>();
  for (const entity of entities) {
    const key = locationKey(entity.entity_folder_id);
    const siblings = entitiesByFolder.get(key) ?? [];
    siblings.push(entity);
    entitiesByFolder.set(key, siblings);
  }
  for (const siblings of entitiesByFolder.values()) siblings.sort(byPositionThenName);

  const appendLocation = (parentFolderID: string | null, depth: number) => {
    for (const folder of foldersByParent.get(locationKey(parentFolderID)) ?? []) {
      if (visitedFolderIDs.has(folder.entity_folder_id)) continue;
      visitedFolderIDs.add(folder.entity_folder_id);
      rows.push({ kind: "folder", id: folder.entity_folder_id, depth, folder });
      appendLocation(folder.entity_folder_id, depth + 1);
    }
    for (const entity of entitiesByFolder.get(locationKey(parentFolderID)) ?? []) {
      rows.push({ kind: "entity", id: entity.entity_id, depth, entity });
    }
  };

  appendLocation(null, 0);
  return rows;
}

export function entityFolderDescendantIDs(folders: EntityFolder[], entityFolderID: string): Set<string> {
  const descendants = new Set<string>();
  const foldersByParent = groupFoldersByParent(folders);
  const visit = (parentFolderID: string) => {
    for (const folder of foldersByParent.get(locationKey(parentFolderID)) ?? []) {
      if (descendants.has(folder.entity_folder_id)) continue;
      descendants.add(folder.entity_folder_id);
      visit(folder.entity_folder_id);
    }
  };
  visit(entityFolderID);
  return descendants;
}
