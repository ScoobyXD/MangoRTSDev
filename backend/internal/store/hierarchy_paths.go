package store

import "strings"

const explorerHierarchyMaximumDepth = 100
const HuddleExplorerHierarchyEntityFolder = "huddle_explorer_folder"

func resolvedExplorerHierarchyPath(kind string, segments []CompanyExplorerLocationSegment) ExplorerHierarchyPath {
	if segments == nil {
		segments = []CompanyExplorerLocationSegment{}
	}
	return ExplorerHierarchyPath{Kind: kind, Status: ExplorerHierarchyStatusResolved, Segments: segments}
}

func omittedExplorerHierarchyPath(kind string) ExplorerHierarchyPath {
	return ExplorerHierarchyPath{Kind: kind, Status: ExplorerHierarchyStatusOmitted, Segments: []CompanyExplorerLocationSegment{}}
}

func normalizeCompanyExplorerHierarchyPathQuery(query CompanyExplorerHierarchyPathQuery) (CompanyExplorerHierarchyPathQuery, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.ResourceType = strings.ToLower(strings.TrimSpace(query.ResourceType))
	query.ResourceID = strings.TrimSpace(query.ResourceID)
	query.PermissionUserID = strings.TrimSpace(query.PermissionUserID)
	if query.CompanyID == "" || query.ResourceID == "" {
		return CompanyExplorerHierarchyPathQuery{}, ErrInvalid
	}
	switch query.ResourceType {
	case EntityTypeNode, EntityTypeLogicGate, EntityTypeProject:
		return query, nil
	default:
		return CompanyExplorerHierarchyPathQuery{}, ErrInvalid
	}
}

func normalizeHuddleExplorerHierarchyPathQuery(query HuddleExplorerHierarchyPathQuery) (HuddleExplorerHierarchyPathQuery, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.ResourceType = strings.ToLower(strings.TrimSpace(query.ResourceType))
	query.ResourceID = strings.TrimSpace(query.ResourceID)
	query.PermissionUserID = strings.TrimSpace(query.PermissionUserID)
	if query.CompanyID == "" || query.ResourceID == "" {
		return HuddleExplorerHierarchyPathQuery{}, ErrInvalid
	}
	switch query.ResourceType {
	case EntityTypeHuddleLogicGate, EntityTypeHuddleNode:
		return query, nil
	default:
		return HuddleExplorerHierarchyPathQuery{}, ErrInvalid
	}
}

func reverseHierarchySegments(segments []CompanyExplorerLocationSegment) {
	for left, right := 0, len(segments)-1; left < right; left, right = left+1, right-1 {
		segments[left], segments[right] = segments[right], segments[left]
	}
}
