package store

import "strings"

const (
	MutationOriginCompanyExplorer = "company_explorer"
	MutationOriginMatrix          = "matrix"
	MutationOriginKanban          = "kanban"
	MutationOriginEditor          = "editor"
)

func NormalizeMutationOrigin(origin string) string {
	switch strings.TrimSpace(origin) {
	case MutationOriginCompanyExplorer:
		return MutationOriginCompanyExplorer
	case MutationOriginMatrix:
		return MutationOriginMatrix
	case MutationOriginKanban:
		return MutationOriginKanban
	case MutationOriginEditor:
		return MutationOriginEditor
	default:
		return ""
	}
}

func MutationOriginNeedsCompanyExplorerFolderItem(origin string) bool {
	origin = NormalizeMutationOrigin(origin)
	return origin == "" || origin == MutationOriginCompanyExplorer
}

func MutationOriginNeedsCompanyExplorerDefaultPlacement(origin string) bool {
	switch NormalizeMutationOrigin(origin) {
	case MutationOriginMatrix, MutationOriginKanban, MutationOriginEditor:
		return true
	default:
		return false
	}
}
