package store

import "strings"

const CompanyExplorerDeleteBatchMaxItems = CompanyExplorerFolderItemBatchMaxItems

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
		if len(out) >= CompanyExplorerDeleteBatchMaxItems {
			break
		}
	}
	return out
}

func validCompanyExplorerDeleteKind(kind string) bool {
	return kind == "folder" || kind == "node" || kind == "logic_gate" || kind == "kanban"
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
