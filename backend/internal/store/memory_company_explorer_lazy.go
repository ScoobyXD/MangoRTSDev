package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
)

func (r *MemoryRepo) ListCompanyExplorerRootRows(query CompanyExplorerLazyRowsQuery) (CompanyExplorerLazyRows, error) {
	query, err := normalizeCompanyExplorerLazyRowsQuery(query, false)
	if err != nil {
		return CompanyExplorerLazyRows{}, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	rows := CompanyExplorerLazyRows{}
	for _, folder := range r.folders {
		if !r.companyExplorerLazyFolderIncludedLocked(query, folder) || folder.ParentFolderID != nil {
			continue
		}
		rows.Folders = append(rows.Folders, r.companyExplorerLazyFolderWithAccessLocked(query, folder))
	}
	sortCompanyExplorerFolders(rows.Folders)
	r.companyExplorerLazyAppendRootEntitiesLocked(query, &rows)
	return rows, nil
}

func (r *MemoryRepo) ListCompanyExplorerFolderChildRows(query CompanyExplorerLazyRowsQuery) (CompanyExplorerLazyRows, error) {
	query, err := normalizeCompanyExplorerLazyRowsQuery(query, true)
	if err != nil {
		return CompanyExplorerLazyRows{}, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	parent, ok := r.folders[key(query.CompanyID, query.ParentID)]
	if !ok || parent.FolderKind == "communications" {
		return CompanyExplorerLazyRows{}, ErrNotFound
	}
	if !r.companyExplorerLazyFolderIncludedLocked(query, parent) {
		return CompanyExplorerLazyRows{}, nil
	}

	rows := CompanyExplorerLazyRows{}
	for _, folder := range r.folders {
		if folder.ParentFolderID == nil || *folder.ParentFolderID != query.ParentID {
			continue
		}
		if !r.companyExplorerLazyFolderIncludedLocked(query, folder) {
			continue
		}
		rows.Folders = append(rows.Folders, r.companyExplorerLazyFolderWithAccessLocked(query, folder))
	}
	sortCompanyExplorerFolders(rows.Folders)

	for _, item := range r.folderItems {
		if item.CompanyID != query.CompanyID || item.FolderID != query.ParentID || item.ItemType == "kanban" {
			continue
		}
		if !r.companyExplorerLazyFolderItemVisibleLocked(query, item) {
			continue
		}
		rows.FolderItems = append(rows.FolderItems, item)
		r.companyExplorerLazyAppendFolderItemSummaryLocked(query, &rows, item)
	}
	sortCompanyExplorerFolderItems(rows.FolderItems)
	r.companyExplorerLazySortEntities(&rows)
	return rows, nil
}

func (r *MemoryRepo) ListCompanyExplorerLogicGateChildRows(query CompanyExplorerLazyRowsQuery) (CompanyExplorerLazyRows, error) {
	query, err := normalizeCompanyExplorerLazyRowsQuery(query, true)
	if err != nil {
		return CompanyExplorerLazyRows{}, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if _, ok := r.logicGates[key(query.CompanyID, query.ParentID)]; !ok {
		return CompanyExplorerLazyRows{}, ErrNotFound
	}
	if !r.companyExplorerLazyLogicGateVisibleLocked(query, query.ParentID) {
		return CompanyExplorerLazyRows{}, nil
	}

	rows := CompanyExplorerLazyRows{}
	seen := map[string]bool{}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID != query.CompanyID || assignment.LogicGateID != query.ParentID || seen[assignment.NodeID] {
			continue
		}
		if query.PermissionUserID != "" && !r.userHasEffectiveAccessLocked(query.CompanyID, query.PermissionUserID, EntityTypeNode, assignment.NodeID, EntityPermissionEdit) {
			continue
		}
		node, ok := r.nodes[key(query.CompanyID, assignment.NodeID)]
		if !ok {
			continue
		}
		seen[assignment.NodeID] = true
		rows.Nodes = append(rows.Nodes, companyExplorerNodeSummary(r.withNodeReadModelLocked(node)))
	}
	sortCompanyExplorerNodeSummaries(rows.Nodes)
	return rows, nil
}

func (r *MemoryRepo) companyExplorerLazyAppendRootEntitiesLocked(query CompanyExplorerLazyRowsQuery, rows *CompanyExplorerLazyRows) {
	assignedNodes := map[string]bool{}
	assignedLogicGates := map[string]bool{}
	assignedProjects := map[string]bool{}
	for _, item := range r.folderItems {
		if item.CompanyID != query.CompanyID {
			continue
		}
		switch item.ItemType {
		case EntityTypeNode:
			assignedNodes[item.ItemID] = true
		case EntityTypeLogicGate:
			assignedLogicGates[item.ItemID] = true
		case EntityTypeProject:
			assignedProjects[item.ItemID] = true
		}
	}

	for _, node := range r.nodes {
		if node.CompanyID != query.CompanyID || assignedNodes[node.NodeID] {
			continue
		}
		if query.PermissionUserID != "" && !r.userHasEffectiveAccessLocked(query.CompanyID, query.PermissionUserID, EntityTypeNode, node.NodeID, EntityPermissionEdit) {
			continue
		}
		if !r.companyExplorerLazyNodeMatchesScopeLocked(query, node) {
			continue
		}
		rows.Nodes = append(rows.Nodes, companyExplorerNodeSummary(r.withNodeReadModelLocked(node)))
	}

	for _, gate := range r.logicGates {
		if gate.CompanyID != query.CompanyID || assignedLogicGates[gate.LogicGateID] {
			continue
		}
		if query.PermissionUserID != "" && !r.userHasEffectiveAccessLocked(query.CompanyID, query.PermissionUserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit) {
			continue
		}
		if !r.companyExplorerLazyLogicGateMatchesScopeLocked(query, gate.LogicGateID) {
			continue
		}
		rows.LogicGates = append(rows.LogicGates, companyExplorerLogicGateSummary(r.withLogicGateGVICLocked(gate)))
	}

	for _, project := range r.projects {
		if project.CompanyID != query.CompanyID || assignedProjects[project.ProjectID] {
			continue
		}
		if query.PermissionUserID != "" && !r.userHasEffectiveAccessLocked(query.CompanyID, query.PermissionUserID, EntityTypeProject, project.ProjectID, EntityPermissionEdit) {
			continue
		}
		if !r.companyExplorerLazyProjectMatchesScopeLocked(query, project.ProjectID) {
			continue
		}
		rows.Projects = append(rows.Projects, r.withProjectReadModelLocked(project))
	}
	r.companyExplorerLazySortEntities(rows)
}

func (r *MemoryRepo) companyExplorerLazyAppendFolderItemSummaryLocked(query CompanyExplorerLazyRowsQuery, rows *CompanyExplorerLazyRows, item domain.CompanyExplorerFolderItem) {
	switch item.ItemType {
	case EntityTypeNode:
		node, ok := r.nodes[key(query.CompanyID, item.ItemID)]
		if ok {
			rows.Nodes = append(rows.Nodes, companyExplorerNodeSummary(r.withNodeReadModelLocked(node)))
		}
	case EntityTypeLogicGate:
		gate, ok := r.logicGates[key(query.CompanyID, item.ItemID)]
		if ok {
			rows.LogicGates = append(rows.LogicGates, companyExplorerLogicGateSummary(r.withLogicGateGVICLocked(gate)))
		}
	case EntityTypeProject:
		project, ok := r.projects[key(query.CompanyID, item.ItemID)]
		if ok {
			rows.Projects = append(rows.Projects, r.withProjectReadModelLocked(project))
		}
	}
}

func (r *MemoryRepo) companyExplorerLazyFolderIncludedLocked(query CompanyExplorerLazyRowsQuery, folder domain.CompanyExplorerFolder) bool {
	if folder.CompanyID != query.CompanyID || folder.FolderKind == "communications" {
		return false
	}
	if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
		return false
	}
	if !r.companyExplorerLazyFolderMatchesScopeLocked(query, folder) {
		return false
	}
	if query.PermissionUserID != "" && !r.userHasEffectiveAccessLocked(query.CompanyID, query.PermissionUserID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionEdit) {
		return false
	}
	return true
}

func (r *MemoryRepo) companyExplorerLazyFolderWithAccessLocked(query CompanyExplorerLazyRowsQuery, folder domain.CompanyExplorerFolder) domain.CompanyExplorerFolder {
	if query.PermissionUserID == "" {
		return folder
	}
	item := folder
	item.EffectiveAccess = r.effectiveAccessLevelLocked(query.CompanyID, query.PermissionUserID, EntityTypeCompanyExplorerFolder, folder.FolderID, EntityPermissionEdit)
	return item
}

func (r *MemoryRepo) companyExplorerLazyFolderItemVisibleLocked(query CompanyExplorerLazyRowsQuery, item domain.CompanyExplorerFolderItem) bool {
	if query.PermissionUserID == "" {
		return r.companyExplorerLazyFolderItemMatchesScopeLocked(query, item)
	}
	return r.companyExplorerFolderItemVisibleLocked(query.CompanyID, query.PermissionUserID, item) && r.companyExplorerLazyFolderItemMatchesScopeLocked(query, item)
}

func (r *MemoryRepo) companyExplorerLazyFolderMatchesScopeLocked(query CompanyExplorerLazyRowsQuery, folder domain.CompanyExplorerFolder) bool {
	scopeID := companyExplorerFolderScopeID(folder)
	switch query.Scope {
	case CompanyExplorerLazyScopeAll:
		return true
	case CompanyExplorerLazyScopeMe:
		switch companyExplorerFolderScopeType(folder) {
		case CompanyExplorerFolderScopeCompany:
			return true
		case CompanyExplorerFolderScopeUser:
			return scopeID != nil && *scopeID == query.ScopeUserID
		default:
			return false
		}
	case CompanyExplorerLazyScopeTeam:
		teamUsers, teamGroups := r.companyExplorerLazyTeamScopeLocked(query.CompanyID, query.ScopeUserID)
		switch companyExplorerFolderScopeType(folder) {
		case CompanyExplorerFolderScopeCompany:
			return true
		case CompanyExplorerFolderScopeUser:
			return scopeID != nil && teamUsers[*scopeID]
		case CompanyExplorerFolderScopeTeam:
			return scopeID != nil && teamGroups[*scopeID]
		default:
			return false
		}
	default:
		return false
	}
}

func (r *MemoryRepo) companyExplorerLazyNodeMatchesScopeLocked(query CompanyExplorerLazyRowsQuery, node domain.Node) bool {
	switch query.Scope {
	case CompanyExplorerLazyScopeAll:
		return true
	case CompanyExplorerLazyScopeMe:
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID == query.CompanyID && assignment.NodeID == node.NodeID && r.companyExplorerLazyLogicGateMatchesScopeLocked(query, assignment.LogicGateID) {
				return true
			}
		}
		return false
	case CompanyExplorerLazyScopeTeam:
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID == query.CompanyID && assignment.NodeID == node.NodeID && r.companyExplorerLazyLogicGateMatchesScopeLocked(query, assignment.LogicGateID) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

func (r *MemoryRepo) companyExplorerLazyFolderItemMatchesScopeLocked(query CompanyExplorerLazyRowsQuery, item domain.CompanyExplorerFolderItem) bool {
	switch item.ItemType {
	case EntityTypeNode:
		node, ok := r.nodes[key(query.CompanyID, item.ItemID)]
		return ok && r.companyExplorerLazyNodeMatchesScopeLocked(query, node)
	case EntityTypeLogicGate:
		return r.companyExplorerLazyLogicGateMatchesScopeLocked(query, item.ItemID)
	case EntityTypeProject:
		return r.companyExplorerLazyProjectMatchesScopeLocked(query, item.ItemID)
	default:
		return false
	}
}

func (r *MemoryRepo) companyExplorerLazyLogicGateMatchesScopeLocked(query CompanyExplorerLazyRowsQuery, logicGateID string) bool {
	switch query.Scope {
	case CompanyExplorerLazyScopeAll:
		return true
	case CompanyExplorerLazyScopeMe:
		for _, assignment := range r.logicGateGVIC[key(query.CompanyID, logicGateID)] {
			if assignment.UserID == query.ScopeUserID {
				return true
			}
		}
		return false
	case CompanyExplorerLazyScopeTeam:
		teamUsers, _ := r.companyExplorerLazyTeamScopeLocked(query.CompanyID, query.ScopeUserID)
		for _, assignment := range r.logicGateGVIC[key(query.CompanyID, logicGateID)] {
			if teamUsers[assignment.UserID] {
				return true
			}
		}
		return false
	default:
		return false
	}
}

func (r *MemoryRepo) companyExplorerLazyLogicGateVisibleLocked(query CompanyExplorerLazyRowsQuery, logicGateID string) bool {
	return r.companyExplorerLazyLogicGateMatchesScopeLocked(query, logicGateID)
}

func (r *MemoryRepo) companyExplorerLazyProjectMatchesScopeLocked(query CompanyExplorerLazyRowsQuery, projectID string) bool {
	switch query.Scope {
	case CompanyExplorerLazyScopeAll:
		return true
	case CompanyExplorerLazyScopeMe:
		return false
	case CompanyExplorerLazyScopeTeam:
		_, teamGroups := r.companyExplorerLazyTeamScopeLocked(query.CompanyID, query.ScopeUserID)
		for assignmentKey := range r.projectTeamAssignments {
			parsedCompanyID, parsedProjectID, parsedTeamID, ok := splitProjectAssignmentKey(assignmentKey)
			if ok && parsedCompanyID == query.CompanyID && parsedProjectID == projectID && teamGroups[parsedTeamID] {
				return true
			}
		}
		return false
	default:
		return false
	}
}

func (r *MemoryRepo) companyExplorerLazyTeamScopeLocked(companyID, userID string) (map[string]bool, map[string]bool) {
	users := map[string]bool{userID: true}
	groups := map[string]bool{}
	for _, member := range r.userGroupMembers {
		if member.CompanyID == companyID && member.UserID == userID {
			groups[member.GroupID] = true
		}
	}
	for _, member := range r.userGroupMembers {
		if member.CompanyID == companyID && groups[member.GroupID] {
			users[member.UserID] = true
		}
	}
	return users, groups
}

func (r *MemoryRepo) companyExplorerLazySortEntities(rows *CompanyExplorerLazyRows) {
	sortCompanyExplorerNodeSummaries(rows.Nodes)
	sortCompanyExplorerLogicGateSummaries(rows.LogicGates)
	sort.Slice(rows.Projects, func(i, j int) bool {
		if rows.Projects[i].Name == rows.Projects[j].Name {
			return rows.Projects[i].ProjectID < rows.Projects[j].ProjectID
		}
		return rows.Projects[i].Name < rows.Projects[j].Name
	})
}
