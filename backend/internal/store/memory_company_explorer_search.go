package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) ensureCompanyExplorerDefaultStateLocked(companyID string) {
	r.ensureCompanyExplorerDefaultFoldersLocked(companyID)
	r.backfillBareCompanyExplorerItemsLocked(companyID)
}

func (r *MemoryRepo) ensureCompanyExplorerDefaultFoldersLocked(companyID string) companyExplorerDefaultFolders {
	companyID = strings.TrimSpace(companyID)
	folders := companyExplorerDefaultFolderIDs(companyID)
	if companyID == "" || folders.UnfiledFolderID == "" {
		return folders
	}
	now := time.Now().UTC()
	rootEntityID := companyExplorerV2NativeEntityID(companyID, CompanyExplorerV2EntityCompany, companyID)
	if _, ok := r.companyExplorerV2Entities[key(companyID, rootEntityID)]; !ok {
		r.ensureCompanyExplorerV2NativeEntityLocked(companyID, CompanyExplorerV2EntityCompany, companyID, companyID, now, now)
	}
	upsertFolder := func(folderID, parentEntityID, name, folderKind string, position int) {
		created := now
		if previous, ok := r.companyExplorerV2Entities[key(companyID, folderID)]; ok && !previous.CreatedTimestamp.IsZero() {
			created = previous.CreatedTimestamp
		}
		entity := memoryCompanyExplorerV2Entity{
			CompanyID:        companyID,
			EntityID:         folderID,
			EntityType:       CompanyExplorerV2EntityFolder,
			Name:             name,
			DefaultAccess:    ResourceDefaultAccessEdit,
			CreatedTimestamp: created,
			UpdatedTimestamp: now,
		}
		r.companyExplorerV2Entities[key(companyID, folderID)] = entity
		edge := memoryCompanyExplorerV2Edge{
			CompanyID:        companyID,
			EdgeID:           companyExplorerV2EdgeID(companyID, parentEntityID, folderID),
			ParentEntityID:   parentEntityID,
			ChildEntityID:    folderID,
			Position:         position,
			CreatedTimestamp: created,
			UpdatedTimestamp: now,
		}
		r.companyExplorerV2Edges[key(companyID, edge.EdgeID)] = edge
		var parentFolderID *string
		if parentEntityID != rootEntityID && parentEntityID != companyID {
			parent := parentEntityID
			parentFolderID = &parent
		}
		r.folders[key(companyID, folderID)] = domain.CompanyExplorerFolder{
			CompanyID:        companyID,
			FolderID:         folderID,
			ParentFolderID:   parentFolderID,
			FolderKind:       folderKind,
			Name:             name,
			DefaultAccess:    ResourceDefaultAccessEdit,
			ScopeType:        CompanyExplorerFolderScopeCompany,
			Position:         position,
			CreatedTimestamp: created,
			UpdatedTimestamp: now,
		}
	}
	upsertFolder(folders.UnfiledFolderID, rootEntityID, CompanyExplorerDefaultRootFolderName, "logic_gate", 1000)
	upsertFolder(folders.ProjectsFolderID, folders.UnfiledFolderID, CompanyExplorerDefaultProjectsFolderName, "project", 1000)
	upsertFolder(folders.LogicGatesFolderID, folders.UnfiledFolderID, CompanyExplorerDefaultLogicGatesFolderName, "logic_gate", 2000)
	upsertFolder(folders.NodesFolderID, folders.UnfiledFolderID, CompanyExplorerDefaultNodesFolderName, "node", 3000)
	return folders
}

func (r *MemoryRepo) backfillBareCompanyExplorerItemsLocked(companyID string) {
	for _, project := range r.projects {
		if project.CompanyID != companyID || r.companyExplorerV2HasManualEdgeLocked(companyID, CompanyExplorerV2EntityProject, project.ProjectID) {
			continue
		}
		r.placeCompanyExplorerItemInDefaultFolderLocked(companyID, EntityTypeProject, project.ProjectID)
	}
	for _, logicGate := range r.logicGates {
		if logicGate.CompanyID != companyID || r.companyExplorerV2HasManualEdgeLocked(companyID, CompanyExplorerV2EntityLogicGate, logicGate.LogicGateID) || r.companyExplorerLogicGateHasProjectParentLocked(companyID, logicGate.LogicGateID) {
			continue
		}
		r.placeCompanyExplorerItemInDefaultFolderLocked(companyID, EntityTypeLogicGate, logicGate.LogicGateID)
	}
	for _, node := range r.nodes {
		if node.CompanyID != companyID || r.companyExplorerV2HasManualEdgeLocked(companyID, CompanyExplorerV2EntityNode, node.NodeID) || r.companyExplorerNodeHasNativeParentLocked(companyID, node.NodeID) {
			continue
		}
		r.placeCompanyExplorerItemInDefaultFolderLocked(companyID, EntityTypeNode, node.NodeID)
	}
}

func (r *MemoryRepo) placeCompanyExplorerItemInDefaultFolderLocked(companyID, targetType, targetID string) bool {
	folderID, ok := companyExplorerDefaultFolderIDForTargetType(companyID, targetType)
	if !ok || r.companyExplorerV2HasManualEdgeLocked(companyID, targetType, targetID) {
		return false
	}
	child, ok := r.companyExplorerV2EntityForNativeLocked(companyID, targetType, targetID)
	if !ok {
		return false
	}
	position := r.nextCompanyExplorerV2EdgePositionLocked(companyID, folderID)
	now := time.Now().UTC()
	edge := memoryCompanyExplorerV2Edge{
		CompanyID:        companyID,
		EdgeID:           companyExplorerV2EdgeID(companyID, folderID, child.EntityID),
		ParentEntityID:   folderID,
		ChildEntityID:    child.EntityID,
		Position:         position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.companyExplorerV2Edges[key(companyID, edge.EdgeID)] = edge
	if parent, ok := r.companyExplorerV2Entities[key(companyID, folderID)]; ok {
		r.shadowCompanyExplorerV2EdgeToLegacyLocked(parent, child, edge)
	}
	return true
}

func (r *MemoryRepo) companyExplorerV2HasManualEdgeLocked(companyID, targetType, targetID string) bool {
	child, ok := r.companyExplorerV2EntityForNativeLocked(companyID, targetType, targetID)
	if !ok {
		return false
	}
	for _, edge := range r.companyExplorerV2Edges {
		if edge.CompanyID == companyID && edge.ChildEntityID == child.EntityID {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) companyExplorerLogicGateHasProjectParentLocked(companyID, logicGateID string) bool {
	for _, projection := range r.projectRelationshipProjection {
		if projection.CompanyID == companyID && projection.ResourceType == EntityTypeLogicGate && projection.ResourceID == logicGateID {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) companyExplorerNodeHasNativeParentLocked(companyID, nodeID string) bool {
	for _, projection := range r.projectRelationshipProjection {
		if projection.CompanyID == companyID && projection.ResourceType == EntityTypeNode && projection.ResourceID == nodeID {
			return true
		}
	}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID == companyID && assignment.NodeID == nodeID {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) SearchCompanyExplorer(query CompanyExplorerSearchQuery) (CompanyExplorerSearchResults, error) {
	query, err := normalizeCompanyExplorerSearchQuery(query)
	if err != nil {
		return CompanyExplorerSearchResults{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	r.ensureCompanyExplorerV2CompanyGraphLocked(query.CompanyID)
	r.ensureCompanyExplorerDefaultStateLocked(query.CompanyID)
	rowsQuery := CompanyExplorerV2RowsQuery{CompanyID: query.CompanyID, PermissionUserID: query.PermissionUserID}
	matches := make([]CompanyExplorerSearchResult, 0)
	add := func(entity memoryCompanyExplorerV2Entity) {
		if !r.companyExplorerV2EntityVisibleLocked(rowsQuery, entity) {
			return
		}
		priority, ok := companyExplorerSearchTypePriority(entity.EntityType)
		if !ok {
			return
		}
		matchPriority, reason, ok := companyExplorerSearchMatch(entity.Name, entity.EntityID, query.Query)
		if !ok {
			return
		}
		resourceID := entity.ResourceID
		if resourceID == "" {
			resourceID = entity.EntityID
		}
		_ = priority
		_ = matchPriority
		matches = append(matches, CompanyExplorerSearchResult{
			CompanyID:        entity.CompanyID,
			ResourceType:     entity.EntityType,
			ResourceID:       resourceID,
			EntityID:         entity.EntityID,
			DisplayName:      entity.Name,
			MatchReason:      reason,
			LocationPath:     r.companyExplorerV2LocationPathLocked(query.CompanyID, entity.EntityID),
			HasChildren:      len(r.companyExplorerV2DirectChildEdgesLocked(query.CompanyID, entity.EntityID)) > 0,
			CreatedTimestamp: entity.CreatedTimestamp,
			UpdatedTimestamp: entity.UpdatedTimestamp,
		})
	}
	for _, entity := range r.companyExplorerV2Entities {
		if entity.CompanyID == query.CompanyID {
			add(entity)
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		leftType, _ := companyExplorerSearchTypePriority(matches[i].ResourceType)
		rightType, _ := companyExplorerSearchTypePriority(matches[j].ResourceType)
		if leftType != rightType {
			return leftType < rightType
		}
		leftMatch, _, _ := companyExplorerSearchMatch(matches[i].DisplayName, matches[i].EntityID, query.Query)
		rightMatch, _, _ := companyExplorerSearchMatch(matches[j].DisplayName, matches[j].EntityID, query.Query)
		if leftMatch != rightMatch {
			return leftMatch < rightMatch
		}
		if !strings.EqualFold(matches[i].DisplayName, matches[j].DisplayName) {
			return strings.ToLower(matches[i].DisplayName) < strings.ToLower(matches[j].DisplayName)
		}
		if !matches[i].CreatedTimestamp.Equal(matches[j].CreatedTimestamp) {
			return matches[i].CreatedTimestamp.After(matches[j].CreatedTimestamp)
		}
		return matches[i].EntityID < matches[j].EntityID
	})
	if len(matches) > query.Limit {
		matches = matches[:query.Limit]
	}
	return CompanyExplorerSearchResults{Results: matches}, nil
}

func companyExplorerSearchTypePriority(entityType string) (int, bool) {
	switch entityType {
	case CompanyExplorerV2EntityLogicGate:
		return 0, true
	case CompanyExplorerV2EntityNode:
		return 1, true
	case CompanyExplorerV2EntityProject:
		return 2, true
	case CompanyExplorerV2EntityFolder:
		return 3, true
	default:
		return 0, false
	}
}

func companyExplorerSearchMatch(name, entityID, query string) (int, string, bool) {
	name = strings.TrimSpace(name)
	entityID = strings.TrimSpace(entityID)
	query = strings.ToLower(strings.TrimSpace(query))
	lowerName := strings.ToLower(name)
	if query == "" {
		return 0, "", false
	}
	if lowerName == query {
		return 0, "name_exact", true
	}
	if strings.HasPrefix(lowerName, query) {
		return 1, "name_prefix", true
	}
	if strings.Contains(lowerName, query) {
		return 2, "name_contains", true
	}
	if strings.Contains(strings.ToLower(entityID), query) {
		return 3, "id_contains", true
	}
	return 0, "", false
}

func (r *MemoryRepo) companyExplorerV2LocationPathLocked(companyID, targetEntityID string) []CompanyExplorerLocationSegment {
	rootID := companyExplorerV2NativeEntityID(companyID, CompanyExplorerV2EntityCompany, companyID)
	type queueItem struct {
		EntityID string
		Path     []CompanyExplorerLocationSegment
	}
	queue := []queueItem{{EntityID: rootID, Path: []CompanyExplorerLocationSegment{}}}
	seen := map[string]bool{rootID: true}
	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]
		for _, edge := range r.companyExplorerV2DirectChildEdgesLocked(companyID, item.EntityID) {
			child, ok := r.companyExplorerV2Entities[key(companyID, edge.ChildEntityID)]
			if !ok || seen[child.EntityID] {
				continue
			}
			if child.EntityID == targetEntityID {
				return item.Path
			}
			segment := CompanyExplorerLocationSegment{
				EntityType: child.EntityType,
				EntityID:   child.EntityID,
				ResourceID: child.ResourceID,
				Name:       child.Name,
			}
			nextPath := append(append([]CompanyExplorerLocationSegment{}, item.Path...), segment)
			seen[child.EntityID] = true
			queue = append(queue, queueItem{EntityID: child.EntityID, Path: nextPath})
		}
	}
	return []CompanyExplorerLocationSegment{}
}
