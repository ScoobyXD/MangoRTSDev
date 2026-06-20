package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

type recycleContainedScope struct {
	FolderIDs    map[string]bool
	NodeIDs      map[string]bool
	LogicGateIDs map[string]bool
	ProjectIDs   map[string]bool
}

func newRecycleContainedScope() recycleContainedScope {
	return recycleContainedScope{
		FolderIDs:    map[string]bool{},
		NodeIDs:      map[string]bool{},
		LogicGateIDs: map[string]bool{},
		ProjectIDs:   map[string]bool{},
	}
}

func recycleContainedItemsFromPayload(item domain.RecycleBinItem, payload []byte) []domain.RecycleBinContainedItem {
	if len(payload) == 0 {
		return nil
	}
	rows := map[string][]map[string]any{}
	if err := json.Unmarshal(payload, &rows); err != nil {
		return nil
	}
	out := make([]domain.RecycleBinContainedItem, 0)
	seen := map[string]bool{}
	for _, row := range rows["company_explorer_folders"] {
		recycleAppendContainedItem(&out, seen, item, "folder", recycleJSONText(row, "folder_id"), recycleJSONText(row, "name"), recycleJSONText(row, "folder_kind"))
	}
	for _, row := range rows["projects"] {
		recycleAppendContainedItem(&out, seen, item, EntityTypeProject, recycleJSONText(row, "project_id"), recycleJSONText(row, "name"), "")
	}
	for _, row := range rows["logic_gates"] {
		recycleAppendContainedItem(&out, seen, item, EntityTypeLogicGate, recycleJSONText(row, "logic_gate_id"), recycleJSONText(row, "header"), "")
	}
	for _, row := range rows["nodes"] {
		recycleAppendContainedItem(&out, seen, item, EntityTypeNode, recycleJSONText(row, "node_id"), recycleJSONText(row, "name"), "")
	}
	recycleSortContainedItems(out)
	return out
}

func recycleContainedItemsFromMemorySnapshot(item domain.RecycleBinItem, snapshot memoryRecycleBinSnapshot) []domain.RecycleBinContainedItem {
	scope := newRecycleContainedScope()
	switch item.ObjectKind {
	case "folder":
		scope.FolderIDs[item.ObjectID] = true
	case EntityTypeProject:
		scope.ProjectIDs[item.ObjectID] = true
	case EntityTypeLogicGate:
		scope.LogicGateIDs[item.ObjectID] = true
	default:
		return nil
	}
	expandRecycleContainedMemoryScope(item.CompanyID, &scope, snapshot)

	out := make([]domain.RecycleBinContainedItem, 0)
	seen := map[string]bool{}
	for folderID := range scope.FolderIDs {
		folder, ok := snapshot.folders[key(item.CompanyID, folderID)]
		if !ok {
			continue
		}
		recycleAppendContainedItem(&out, seen, item, "folder", folder.FolderID, folder.Name, folder.FolderKind)
	}
	for projectID := range scope.ProjectIDs {
		project, ok := snapshot.projects[key(item.CompanyID, projectID)]
		if !ok {
			continue
		}
		recycleAppendContainedItem(&out, seen, item, EntityTypeProject, project.ProjectID, project.Name, "")
	}
	for logicGateID := range scope.LogicGateIDs {
		logicGate, ok := snapshot.logicGates[key(item.CompanyID, logicGateID)]
		if !ok {
			continue
		}
		recycleAppendContainedItem(&out, seen, item, EntityTypeLogicGate, logicGate.LogicGateID, logicGate.Header, "")
	}
	for nodeID := range scope.NodeIDs {
		node, ok := snapshot.nodes[key(item.CompanyID, nodeID)]
		if !ok {
			continue
		}
		recycleAppendContainedItem(&out, seen, item, EntityTypeNode, node.NodeID, node.Title, "")
	}
	recycleSortContainedItems(out)
	return out
}

func expandRecycleContainedMemoryScope(companyID string, scope *recycleContainedScope, snapshot memoryRecycleBinSnapshot) {
	if scope == nil {
		return
	}
	changed := true
	for changed {
		changed = false
		for _, folder := range snapshot.folders {
			if folder.CompanyID != companyID || folder.ParentFolderID == nil || !scope.FolderIDs[*folder.ParentFolderID] || scope.FolderIDs[folder.FolderID] {
				continue
			}
			scope.FolderIDs[folder.FolderID] = true
			changed = true
		}
		for _, item := range snapshot.folderItems {
			if item.CompanyID != companyID || !scope.FolderIDs[item.FolderID] {
				continue
			}
			if recycleContainedScopeAdd(scope, item.ItemType, item.ItemID) {
				changed = true
			}
		}
		for _, relationship := range snapshot.projectRelationships {
			if relationship.CompanyID != companyID || !scope.ProjectIDs[relationship.ProjectID] {
				continue
			}
			if recycleContainedScopeAdd(scope, relationship.ResourceType, relationship.ResourceID) {
				changed = true
			}
		}
		for _, assignment := range snapshot.nodeLogicGateAssignments {
			if assignment.CompanyID != companyID || !scope.LogicGateIDs[assignment.LogicGateID] {
				continue
			}
			if recycleContainedScopeAdd(scope, EntityTypeNode, assignment.NodeID) {
				changed = true
			}
		}
	}
}

func recycleContainedScopeAdd(scope *recycleContainedScope, kind, id string) bool {
	kind = strings.TrimSpace(kind)
	id = strings.TrimSpace(id)
	if id == "" {
		return false
	}
	switch kind {
	case "folder":
		if scope.FolderIDs[id] {
			return false
		}
		scope.FolderIDs[id] = true
	case EntityTypeNode:
		if scope.NodeIDs[id] {
			return false
		}
		scope.NodeIDs[id] = true
	case EntityTypeLogicGate:
		if scope.LogicGateIDs[id] {
			return false
		}
		scope.LogicGateIDs[id] = true
	case EntityTypeProject:
		if scope.ProjectIDs[id] {
			return false
		}
		scope.ProjectIDs[id] = true
	default:
		return false
	}
	return true
}

func recycleAppendContainedItem(out *[]domain.RecycleBinContainedItem, seen map[string]bool, root domain.RecycleBinItem, kind, id, label, folderKind string) {
	kind = strings.TrimSpace(kind)
	id = strings.TrimSpace(id)
	if kind == "" || id == "" || (kind == root.ObjectKind && id == root.ObjectID) {
		return
	}
	itemKey := kind + ":" + id
	if seen[itemKey] {
		return
	}
	seen[itemKey] = true
	label = strings.TrimSpace(label)
	if label == "" {
		label = id
	}
	*out = append(*out, domain.RecycleBinContainedItem{
		Kind:       kind,
		ID:         id,
		Label:      label,
		FolderKind: strings.TrimSpace(folderKind),
	})
}

func recycleJSONText(row map[string]any, field string) string {
	value, ok := row[field]
	if !ok || value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func recycleSortContainedItems(items []domain.RecycleBinContainedItem) {
	sort.Slice(items, func(i, j int) bool {
		if recycleContainedKindRank(items[i].Kind) != recycleContainedKindRank(items[j].Kind) {
			return recycleContainedKindRank(items[i].Kind) < recycleContainedKindRank(items[j].Kind)
		}
		if !strings.EqualFold(items[i].Label, items[j].Label) {
			return strings.ToLower(items[i].Label) < strings.ToLower(items[j].Label)
		}
		return items[i].ID < items[j].ID
	})
}

func recycleContainedKindRank(kind string) int {
	switch kind {
	case "folder":
		return 0
	case EntityTypeProject:
		return 1
	case EntityTypeLogicGate:
		return 2
	case EntityTypeNode:
		return 3
	default:
		return 99
	}
}
