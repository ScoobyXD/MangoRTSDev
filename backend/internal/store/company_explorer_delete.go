package store

import "strings"

const RecycleBinBatchMaxItems = CompanyExplorerFolderItemBatchMaxItems

func normalizeCompanyExplorerDeleteTargets(targets []CompanyExplorerDeleteTargetInput) []CompanyExplorerDeleteTargetInput {
	out := make([]CompanyExplorerDeleteTargetInput, 0, len(targets))
	seen := map[string]bool{}
	for _, target := range targets {
		item := CompanyExplorerDeleteTargetInput{
			Kind:       strings.TrimSpace(target.Kind),
			ID:         strings.TrimSpace(target.ID),
			FolderKind: strings.TrimSpace(target.FolderKind),
		}
		if item.Kind == "" || item.ID == "" {
			continue
		}
		key := item.Kind + ":" + item.ID
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func normalizeCompanyExplorerV2EdgeIDs(edgeIDs []string) []string {
	out := make([]string, 0, len(edgeIDs))
	seen := map[string]bool{}
	for _, edgeID := range edgeIDs {
		edgeID = strings.TrimSpace(edgeID)
		if edgeID == "" || seen[edgeID] {
			continue
		}
		seen[edgeID] = true
		out = append(out, edgeID)
	}
	return out
}

func validCompanyExplorerDeleteKind(kind string) bool {
	return kind == "folder" || kind == "node" || kind == "logic_gate" || kind == "project" || kind == "kanban"
}

func appendCompanyExplorerDeletedTarget(targets []CompanyExplorerDeletedTarget, seen map[string]bool, kind, id, folderKind string) []CompanyExplorerDeletedTarget {
	if kind == "" || id == "" {
		return targets
	}
	key := kind + ":" + id
	if seen[key] {
		return targets
	}
	seen[key] = true
	return append(targets, CompanyExplorerDeletedTarget{
		Kind:       kind,
		ID:         id,
		FolderKind: folderKind,
	})
}

func normalizeRecycleBinItemIDs(itemIDs []string) []string {
	out := make([]string, 0, len(itemIDs))
	seen := map[string]bool{}
	for _, itemID := range itemIDs {
		itemID = strings.TrimSpace(itemID)
		if itemID == "" || seen[itemID] {
			continue
		}
		seen[itemID] = true
		out = append(out, itemID)
		if len(out) >= RecycleBinBatchMaxItems {
			break
		}
	}
	return out
}
