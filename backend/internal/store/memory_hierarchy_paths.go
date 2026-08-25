package store

import "strings"

func (r *MemoryRepo) GetCompanyExplorerHierarchyPath(query CompanyExplorerHierarchyPathQuery) (ExplorerHierarchyPath, error) {
	query, err := normalizeCompanyExplorerHierarchyPathQuery(query)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if !r.memoryCompanyHierarchyResourceExistsLocked(query.CompanyID, query.ResourceType, query.ResourceID) {
		return ExplorerHierarchyPath{}, ErrNotFound
	}
	if !r.memoryHierarchyResourceVisibleLocked(query.CompanyID, query.ResourceType, query.ResourceID, query.PermissionUserID) {
		return ExplorerHierarchyPath{}, ErrNotFound
	}

	if query.ResourceType == EntityTypeNode {
		segments, resolved := r.memoryNodeHierarchyPathLocked(query)
		if !resolved {
			return omittedExplorerHierarchyPath(ExplorerHierarchyKindCompanyExplorer), nil
		}
		return resolvedExplorerHierarchyPath(ExplorerHierarchyKindCompanyExplorer, segments), nil
	}

	segments, resolved := r.memoryCompanyContainerPathLocked(query.CompanyID, query.ResourceType, query.ResourceID, query.PermissionUserID)
	if !resolved {
		return omittedExplorerHierarchyPath(ExplorerHierarchyKindCompanyExplorer), nil
	}
	return resolvedExplorerHierarchyPath(ExplorerHierarchyKindCompanyExplorer, segments), nil
}

func (r *MemoryRepo) GetHuddleExplorerHierarchyPath(query HuddleExplorerHierarchyPathQuery) (ExplorerHierarchyPath, error) {
	query, err := normalizeHuddleExplorerHierarchyPathQuery(query)
	if err != nil {
		return ExplorerHierarchyPath{}, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if !r.memoryHuddleHierarchyResourceExistsLocked(query.CompanyID, query.ResourceType, query.ResourceID) {
		return ExplorerHierarchyPath{}, ErrNotFound
	}
	if !r.memoryHierarchyResourceVisibleLocked(query.CompanyID, query.ResourceType, query.ResourceID, query.PermissionUserID) {
		return ExplorerHierarchyPath{}, ErrNotFound
	}

	if query.ResourceType == EntityTypeHuddleLogicGate {
		segments, resolved := r.memoryHuddleContainerPathLocked(query.CompanyID, query.ResourceID)
		if !resolved {
			return omittedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer), nil
		}
		return resolvedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer, segments), nil
	}

	node := r.huddleNodes[key(query.CompanyID, query.ResourceID)]
	owner, ok := r.huddleLogicGates[key(query.CompanyID, node.HuddleLogicGateID)]
	if !ok || !r.memoryHierarchyResourceVisibleLocked(query.CompanyID, EntityTypeHuddleLogicGate, owner.HuddleLogicGateID, query.PermissionUserID) {
		return omittedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer), nil
	}
	segments, resolved := r.memoryHuddleContainerPathLocked(query.CompanyID, owner.HuddleLogicGateID)
	if !resolved {
		return omittedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer), nil
	}
	segments = append(segments, CompanyExplorerLocationSegment{
		EntityType: EntityTypeHuddleLogicGate,
		EntityID:   owner.HuddleLogicGateID,
		ResourceID: owner.HuddleLogicGateID,
		Name:       owner.Header,
	})
	return resolvedExplorerHierarchyPath(ExplorerHierarchyKindHuddleExplorer, segments), nil
}

func (r *MemoryRepo) memoryNodeHierarchyPathLocked(query CompanyExplorerHierarchyPathQuery) ([]CompanyExplorerLocationSegment, bool) {
	hasOrganization := false
	if assignment, ok := r.nodeLogicGateAssignments[nodeLogicGateAssignmentKey(query.CompanyID, query.ResourceID)]; ok {
		hasOrganization = true
		if gate, exists := r.logicGates[key(query.CompanyID, assignment.LogicGateID)]; exists && r.memoryHierarchyResourceVisibleLocked(query.CompanyID, EntityTypeLogicGate, gate.LogicGateID, query.PermissionUserID) {
			if segments, resolved := r.memoryCompanyContainerPathLocked(query.CompanyID, EntityTypeLogicGate, gate.LogicGateID, query.PermissionUserID); resolved {
				return append(segments, CompanyExplorerLocationSegment{
					EntityType: EntityTypeLogicGate,
					EntityID:   gate.LogicGateID,
					ResourceID: gate.LogicGateID,
					Name:       gate.Header,
				}), true
			}
		}
	}

	for _, relationship := range r.projectRelationships {
		if relationship.CompanyID != query.CompanyID || relationship.ResourceType != EntityTypeNode || relationship.ResourceID != query.ResourceID {
			continue
		}
		hasOrganization = true
		project, exists := r.projects[key(query.CompanyID, relationship.ProjectID)]
		if !exists || !r.memoryHierarchyResourceVisibleLocked(query.CompanyID, EntityTypeProject, project.ProjectID, query.PermissionUserID) {
			continue
		}
		segments, resolved := r.memoryCompanyContainerPathLocked(query.CompanyID, EntityTypeProject, project.ProjectID, query.PermissionUserID)
		if !resolved {
			continue
		}
		return append(segments, CompanyExplorerLocationSegment{
			EntityType: EntityTypeProject,
			EntityID:   project.ProjectID,
			ResourceID: project.ProjectID,
			Name:       project.Name,
		}), true
	}
	if hasOrganization {
		return []CompanyExplorerLocationSegment{}, false
	}
	return []CompanyExplorerLocationSegment{}, true
}

func (r *MemoryRepo) memoryCompanyContainerPathLocked(companyID, resourceType, resourceID, permissionUserID string) ([]CompanyExplorerLocationSegment, bool) {
	childID := companyExplorerV2NativeEntityID(companyID, resourceType, resourceID)
	var placement *memoryCompanyExplorerV2Edge
	for _, edge := range r.companyExplorerV2Edges {
		if edge.CompanyID != companyID || edge.ChildEntityID != childID {
			continue
		}
		candidate := edge
		if placement == nil || candidate.UpdatedTimestamp.After(placement.UpdatedTimestamp) || (candidate.UpdatedTimestamp.Equal(placement.UpdatedTimestamp) && candidate.EdgeID < placement.EdgeID) {
			placement = &candidate
		}
	}
	if placement != nil {
		if placement.ParentEntityID == companyExplorerV2NativeEntityID(companyID, CompanyExplorerV2EntityCompany, companyID) {
			return []CompanyExplorerLocationSegment{}, true
		}
		return r.memoryCompanyFolderPathLocked(companyID, placement.ParentEntityID, permissionUserID)
	}
	return []CompanyExplorerLocationSegment{}, false
}

func (r *MemoryRepo) memoryCompanyFolderPathLocked(companyID, folderID, permissionUserID string) ([]CompanyExplorerLocationSegment, bool) {
	segments := make([]CompanyExplorerLocationSegment, 0)
	seen := make(map[string]bool)
	currentID := strings.TrimSpace(folderID)
	for depth := 0; currentID != ""; depth++ {
		if depth >= explorerHierarchyMaximumDepth || seen[currentID] {
			return []CompanyExplorerLocationSegment{}, false
		}
		seen[currentID] = true
		folder, ok := r.folders[key(companyID, currentID)]
		if !ok || folder.FolderKind == "communications" || !r.memoryHierarchyResourceVisibleLocked(companyID, EntityTypeCompanyExplorerFolder, currentID, permissionUserID) {
			return []CompanyExplorerLocationSegment{}, false
		}
		segments = append(segments, CompanyExplorerLocationSegment{EntityType: CompanyExplorerV2EntityFolder, EntityID: folder.FolderID, Name: folder.Name})
		if folder.ParentFolderID == nil || strings.TrimSpace(*folder.ParentFolderID) == "" {
			reverseHierarchySegments(segments)
			return segments, true
		}
		currentID = strings.TrimSpace(*folder.ParentFolderID)
	}
	return []CompanyExplorerLocationSegment{}, false
}

func (r *MemoryRepo) memoryHuddleContainerPathLocked(companyID, huddleLogicGateID string) ([]CompanyExplorerLocationSegment, bool) {
	for _, item := range r.huddleExplorerItems {
		if item.CompanyID != companyID || item.ResourceType != EntityTypeHuddleLogicGate || item.ResourceID != huddleLogicGateID {
			continue
		}
		if item.ParentFolderID == nil || strings.TrimSpace(*item.ParentFolderID) == "" {
			return []CompanyExplorerLocationSegment{}, true
		}
		return r.memoryHuddleFolderPathLocked(companyID, *item.ParentFolderID)
	}
	return []CompanyExplorerLocationSegment{}, false
}

func (r *MemoryRepo) memoryHuddleFolderPathLocked(companyID, folderID string) ([]CompanyExplorerLocationSegment, bool) {
	segments := make([]CompanyExplorerLocationSegment, 0)
	seen := make(map[string]bool)
	currentID := strings.TrimSpace(folderID)
	for depth := 0; currentID != ""; depth++ {
		if depth >= explorerHierarchyMaximumDepth || seen[currentID] {
			return []CompanyExplorerLocationSegment{}, false
		}
		seen[currentID] = true
		folder, ok := r.huddleExplorerFolders[key(companyID, currentID)]
		if !ok {
			return []CompanyExplorerLocationSegment{}, false
		}
		segments = append(segments, CompanyExplorerLocationSegment{EntityType: HuddleExplorerHierarchyEntityFolder, EntityID: folder.FolderID, Name: folder.Name})
		if folder.ParentFolderID == nil || strings.TrimSpace(*folder.ParentFolderID) == "" {
			reverseHierarchySegments(segments)
			return segments, true
		}
		currentID = strings.TrimSpace(*folder.ParentFolderID)
	}
	return []CompanyExplorerLocationSegment{}, false
}

func (r *MemoryRepo) memoryHierarchyResourceVisibleLocked(companyID, resourceType, resourceID, permissionUserID string) bool {
	return permissionUserID == "" || r.userCanAccessEntityLocked(companyID, resourceType, resourceID, permissionUserID, EntityPermissionEdit)
}

func (r *MemoryRepo) memoryCompanyHierarchyResourceExistsLocked(companyID, resourceType, resourceID string) bool {
	switch resourceType {
	case EntityTypeNode:
		_, ok := r.nodes[key(companyID, resourceID)]
		return ok
	case EntityTypeLogicGate:
		_, ok := r.logicGates[key(companyID, resourceID)]
		return ok
	case EntityTypeProject:
		_, ok := r.projects[key(companyID, resourceID)]
		return ok
	default:
		return false
	}
}

func (r *MemoryRepo) memoryHuddleHierarchyResourceExistsLocked(companyID, resourceType, resourceID string) bool {
	switch resourceType {
	case EntityTypeHuddleLogicGate:
		_, ok := r.huddleLogicGates[key(companyID, resourceID)]
		return ok
	case EntityTypeHuddleNode:
		_, ok := r.huddleNodes[key(companyID, resourceID)]
		return ok
	default:
		return false
	}
}
