package store

import (
	"sort"
	"strings"
)

func companyExplorerPolicyFolderIDs(scope companyExplorerRecycleScope) []string {
	out := make([]string, 0)
	for folderID := range scope.FolderIDs {
		if strings.TrimSpace(scope.FolderKinds[folderID]) != "communications" {
			out = append(out, folderID)
		}
	}
	sort.Strings(out)
	return out
}
