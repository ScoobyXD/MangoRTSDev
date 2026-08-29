package store

import (
	"maps"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func RACIRoleSortValue(role string) int {
	switch role {
	case domain.RACIRoleResponsible:
		return 0
	case domain.RACIRoleAccountable:
		return 1
	case domain.RACIRoleConsulted:
		return 2
	case domain.RACIRoleInformed:
		return 3
	default:
		return 4
	}
}

func (r *MemoryRepo) companyUserByIDLocked(companyID, userID string) (domain.User, bool) {
	if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
		return domain.User{}, false
	}
	for _, user := range r.users {
		if user.UserID == userID {
			return user, true
		}
	}
	return domain.User{}, false
}

func logicGateRACIAssignmentPrincipal(item domain.LogicGateRACIAssignment) (string, string) {
	principalType := strings.TrimSpace(item.PrincipalType)
	principalID := strings.TrimSpace(item.PrincipalID)
	if principalType == "" {
		principalType = EntityPermissionSubjectUser
	}
	if principalType == EntityPermissionSubjectUser && principalID == "" {
		principalID = strings.TrimSpace(item.UserID)
	}
	return principalType, principalID
}

func logicGateRACIAssignmentPrincipalKey(item domain.LogicGateRACIAssignment) string {
	principalType, principalID := logicGateRACIAssignmentPrincipal(item)
	return strings.TrimSpace(item.Role) + ":" + principalType + ":" + principalID
}

func logicGateRACIAssignmentSortLabel(item domain.LogicGateRACIAssignment) string {
	label := strings.ToLower(strings.TrimSpace(item.PrincipalName))
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserDisplayName))
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserEmail))
	}
	if label == "" {
		_, principalID := logicGateRACIAssignmentPrincipal(item)
		label = strings.ToLower(principalID)
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserID))
	}
	return label
}

func (r *MemoryRepo) logicGateRACIAssignmentForPrincipalLocked(companyID, logicGateID, role, principalType, principalID string, created time.Time) (domain.LogicGateRACIAssignment, error) {
	item := domain.LogicGateRACIAssignment{
		CompanyID:        companyID,
		LogicGateID:      logicGateID,
		Role:             role,
		PrincipalType:    principalType,
		PrincipalID:      principalID,
		CreatedTimestamp: created,
	}
	switch principalType {
	case EntityPermissionSubjectUser:
		user, ok := r.companyUserByIDLocked(companyID, principalID)
		if !ok {
			return domain.LogicGateRACIAssignment{}, ErrPrincipalNotInCompany
		}
		item.UserID = user.UserID
		item.UserDisplayName = strings.TrimSpace(user.DisplayName)
		item.UserEmail = strings.TrimSpace(user.Email)
		item.PrincipalName = item.UserDisplayName
		if item.PrincipalName == "" {
			item.PrincipalName = item.UserEmail
		}
	case EntityPermissionSubjectGroup:
		group, ok := r.userGroups[userGroupKey(companyID, principalID)]
		if !ok {
			return domain.LogicGateRACIAssignment{}, ErrPrincipalNotInCompany
		}
		item.PrincipalName = strings.TrimSpace(group.Name)
	default:
		return domain.LogicGateRACIAssignment{}, ErrInvalid
	}
	return item, nil
}

func (r *MemoryRepo) logicGateRACIUserIDsForGroupLocked(companyID, groupID string) ([]string, error) {
	if _, ok := r.userGroups[userGroupKey(companyID, groupID)]; !ok {
		return nil, ErrPrincipalNotInCompany
	}
	groupIDs := companyUserGroupSubtreeIDsLocked(r.userGroups, companyID, groupID)
	userIDs := map[string]bool{}
	for _, member := range r.userGroupMembers {
		userID := strings.TrimSpace(member.UserID)
		if member.CompanyID == companyID && groupIDs[member.GroupID] && userID != "" {
			userIDs[userID] = true
		}
	}
	out := make([]string, 0, len(userIDs))
	for userID := range userIDs {
		out = append(out, userID)
	}
	sort.Strings(out)
	return out, nil
}

func (r *MemoryRepo) expandedLogicGateRACICommandAssignmentsLocked(companyID string, assignments []normalizedLogicGateRACICommandAssignment) ([]normalizedLogicGateRACICommandAssignment, error) {
	expanded := make([]normalizedLogicGateRACICommandAssignment, 0, len(assignments))
	seen := map[string]bool{}
	for _, assignment := range assignments {
		if assignment.principalType != EntityPermissionSubjectGroup {
			key := assignment.role + ":" + assignment.principalType + ":" + assignment.principalID
			if seen[key] {
				continue
			}
			seen[key] = true
			expanded = append(expanded, assignment)
			continue
		}
		userIDs, err := r.logicGateRACIUserIDsForGroupLocked(companyID, assignment.principalID)
		if err != nil {
			return nil, err
		}
		for _, userID := range userIDs {
			expandedAssignment := normalizedLogicGateRACICommandAssignment{
				role:          assignment.role,
				principalType: EntityPermissionSubjectUser,
				principalID:   userID,
				userID:        userID,
			}
			key := expandedAssignment.role + ":" + expandedAssignment.principalType + ":" + expandedAssignment.principalID
			if seen[key] {
				continue
			}
			seen[key] = true
			expanded = append(expanded, expandedAssignment)
		}
	}
	return expanded, nil
}

func sortLogicGateRACIAssignments(items []domain.LogicGateRACIAssignment) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].LogicGateID != items[j].LogicGateID {
			return items[i].LogicGateID < items[j].LogicGateID
		}
		if RACIRoleSortValue(items[i].Role) != RACIRoleSortValue(items[j].Role) {
			return RACIRoleSortValue(items[i].Role) < RACIRoleSortValue(items[j].Role)
		}
		iLabel := logicGateRACIAssignmentSortLabel(items[i])
		jLabel := logicGateRACIAssignmentSortLabel(items[j])
		if iLabel != jLabel {
			return iLabel < jLabel
		}
		iPrincipalType, iPrincipalID := logicGateRACIAssignmentPrincipal(items[i])
		jPrincipalType, jPrincipalID := logicGateRACIAssignmentPrincipal(items[j])
		if iPrincipalType != jPrincipalType {
			return iPrincipalType < jPrincipalType
		}
		return iPrincipalID < jPrincipalID
	})
}

func (r *MemoryRepo) withLogicGateRACILocked(gate domain.LogicGate) domain.LogicGate {
	gate.DefaultAccess = defaultResourceAccessOrEdit(gate.DefaultAccess)
	assignments := r.logicGateRACIAssignmentsAsLogicGateRACILocked(gate.CompanyID, gate.LogicGateID)
	sortLogicGateRACIAssignments(assignments)
	gate.RACIAssignments = assignments
	return gate
}

func (r *MemoryRepo) logicGateRACIAssignmentsAsLogicGateRACILocked(companyID, logicGateID string) []domain.LogicGateRACIAssignment {
	items := r.gvicAssignmentsForResourceLocked(companyID, EntityTypeLogicGate, logicGateID)
	out := make([]domain.LogicGateRACIAssignment, 0, len(items))
	for _, item := range items {
		assignment := domain.LogicGateRACIAssignment{
			CompanyID:        item.CompanyID,
			LogicGateID:      item.ResourceID,
			Role:             item.Role,
			PrincipalType:    item.PrincipalType,
			PrincipalID:      item.PrincipalID,
			PrincipalName:    item.PrincipalName,
			UserID:           item.UserID,
			UserDisplayName:  item.UserDisplayName,
			UserEmail:        item.UserEmail,
			CreatedTimestamp: item.CreatedTimestamp,
		}
		if assignment.PrincipalType == EntityPermissionSubjectUser && assignment.UserID == "" {
			assignment.UserID = assignment.PrincipalID
		}
		out = append(out, assignment)
	}
	sortLogicGateRACIAssignments(out)
	return out
}

func newestLogicGateTextProjectionKey(items map[string]domain.LogicGateProjection) string {
	keyValue := ""
	var newest domain.LogicGateProjection
	for key, item := range items {
		if !isEditorTextBoxType(item.Type) {
			continue
		}
		if keyValue == "" || item.UpdatedTimestamp.After(newest.UpdatedTimestamp) || (item.UpdatedTimestamp.Equal(newest.UpdatedTimestamp) && item.InformationID > newest.InformationID) {
			keyValue = key
			newest = item
		}
	}
	return keyValue
}

func (r *MemoryRepo) CreateLogicGate(companyID, header string) (domain.LogicGate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	beforeMutation := r.snapshotProcessMapMutationLocked()
	item := domain.LogicGate{
		CompanyID:        companyID,
		LogicGateID:      newUUIDv7String(),
		Header:           header,
		DefaultAccess:    ResourceDefaultAccessEdit,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.logicGates[key(companyID, item.LogicGateID)] = item
	r.ensureLogicGateKanbanBoardLocked(companyID, item.LogicGateID, item.Header)
	r.ensureCompanyExplorerV2CompanyGraphLocked(companyID)
	defaultFolders := r.ensureCompanyExplorerDefaultFoldersLocked(companyID)
	if err := r.syncMemoryDefaultFolderProcessMapPlacementsLocked(companyID, defaultFolders); err != nil {
		r.restoreProcessMapMutationLocked(beforeMutation)
		return domain.LogicGate{}, err
	}
	r.placeCompanyExplorerItemInDefaultFolderLocked(companyID, EntityTypeLogicGate, item.LogicGateID, false)
	if folderItem, ok := r.folderItems[folderItemKey(companyID, EntityTypeLogicGate, item.LogicGateID)]; ok {
		parentID := folderItem.FolderID
		if _, err := r.syncAutomaticMemoryProcessMapPlacementLocked(companyID, domain.ProcessMapResourceTypeProcess, item.LogicGateID, &parentID); err != nil {
			r.restoreProcessMapMutationLocked(beforeMutation)
			return domain.LogicGate{}, err
		}
	}
	return r.withLogicGateRACILocked(item), nil
}

func (r *MemoryRepo) UpdateLogicGateHeader(companyID, logicGateID, header string) (domain.LogicGate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(companyID, logicGateID)
	item, ok := r.logicGates[k]
	if !ok {
		return domain.LogicGate{}, ErrNotFound
	}
	item.Header = header
	r.logicGates[k] = item
	boardKeyValue := boardKey(companyID, LogicGateKanbanBoardID(logicGateID))
	if board, ok := r.kanbanBoards[boardKeyValue]; ok && board.LogicGateID != nil {
		board.Title = normalizeKanbanBoardTitle(board.BoardID, header)
		board.UpdatedTimestamp = time.Now().UTC()
		r.kanbanBoards[boardKeyValue] = board
	}
	r.syncRACIMatrixProjectionForLogicGateLocked(companyID, logicGateID)
	r.syncProjectManagementTimelineProjectionForLogicGateLocked(companyID, logicGateID)
	r.reconcileMemoryRACITabsLogicGateLocked(item)
	return r.withLogicGateRACILocked(item), nil
}

func (r *MemoryRepo) ListLogicGates(companyID string) ([]domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID == companyID {
			items = append(items, r.withLogicGateRACILocked(gate))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) ListVisibleLogicGates(companyID, userID string) ([]domain.LogicGate, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID {
			continue
		}
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit) {
			continue
		}
		gate = r.withLogicGateRACILocked(gate)
		gate.EffectiveAccess = r.effectiveAccessLevelForUserLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID)
		items = append(items, gate)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].LogicGateID < items[j].LogicGateID
	})
	return items, nil
}

func (r *MemoryRepo) ListLogicGateSummaries(companyID string) ([]domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID == companyID {
			items = append(items, gate)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].LogicGateID < items[j].LogicGateID
	})
	return items, nil
}

func (r *MemoryRepo) ListVisibleLogicGateSummaries(companyID, userID string) ([]domain.LogicGate, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID == companyID && r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit) {
			items = append(items, gate)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].LogicGateID < items[j].LogicGateID
	})
	return items, nil
}

func (r *MemoryRepo) ListLogicGatesInFolderSubtree(companyID, folderID string) ([]domain.LogicGate, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListLogicGates(companyID)
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, "logic_gate")
	visible := map[string]bool{}
	for _, item := range r.folderItems {
		if item.CompanyID == companyID && item.ItemType == "logic_gate" && folderIDs[item.FolderID] {
			visible[item.ItemID] = true
		}
	}
	items := make([]domain.LogicGate, 0, len(visible))
	for _, gate := range r.logicGates {
		if gate.CompanyID == companyID && visible[gate.LogicGateID] {
			items = append(items, r.withLogicGateRACILocked(gate))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) ListVisibleLogicGatesInFolderSubtree(companyID, folderID, userID string) ([]domain.LogicGate, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}
	if folderID == "" {
		return r.ListVisibleLogicGates(companyID, userID)
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, companyID, folderID, "logic_gate")
	folderGates := map[string]bool{}
	for _, item := range r.folderItems {
		if item.CompanyID == companyID && item.ItemType == "logic_gate" && folderIDs[item.FolderID] {
			folderGates[item.ItemID] = true
		}
	}
	items := make([]domain.LogicGate, 0, len(folderGates))
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID || !folderGates[gate.LogicGateID] {
			continue
		}
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit) {
			continue
		}
		gate = r.withLogicGateRACILocked(gate)
		gate.EffectiveAccess = r.effectiveAccessLevelForUserLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID)
		items = append(items, gate)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].LogicGateID < items[j].LogicGateID
	})
	return items, nil
}
func logicGateMatchesQuery(gate domain.LogicGate, query string) bool {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return true
	}
	return strings.Contains(strings.ToLower(gate.Header), query) ||
		strings.Contains(strings.ToLower(gate.LogicGateID), query)
}

func (r *MemoryRepo) logicGateAssignedToUserLocked(companyID string, assignments []domain.LogicGateRACIAssignment, userID string) bool {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return true
	}
	return r.logicGateRACIAssignmentUserSetLocked(companyID, assignments)[userID]
}

func sortLogicGateQueryResults(items []domain.LogicGate) {
	sort.Slice(items, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(items[i].Header))
		right := strings.ToLower(strings.TrimSpace(items[j].Header))
		if left != right {
			return left < right
		}
		return items[i].LogicGateID < items[j].LogicGateID
	})
}

func (r *MemoryRepo) QueryLogicGates(companyID string, query LogicGateQuery) ([]domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID || !logicGateMatchesQuery(gate, query.Search) {
			continue
		}
		assignments := r.logicGateRACIAssignmentsAsLogicGateRACILocked(gate.CompanyID, gate.LogicGateID)
		if !r.logicGateAssignedToUserLocked(companyID, assignments, query.AssignedUserID) {
			continue
		}
		items = append(items, r.withLogicGateRACILocked(gate))
	}
	sortLogicGateQueryResults(items)
	if query.Limit > 0 && len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) QueryVisibleLogicGates(companyID, userID string, query LogicGateQuery) ([]domain.LogicGate, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID != companyID || !logicGateMatchesQuery(gate, query.Search) {
			continue
		}
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit) {
			continue
		}
		assignments := r.logicGateRACIAssignmentsAsLogicGateRACILocked(gate.CompanyID, gate.LogicGateID)
		if !r.logicGateAssignedToUserLocked(companyID, assignments, query.AssignedUserID) {
			continue
		}
		items = append(items, r.withLogicGateRACILocked(gate))
	}
	sortLogicGateQueryResults(items)
	if query.Limit > 0 && len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) GetLogicGate(companyID, logicGateID string) (domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return domain.LogicGate{}, ErrNotFound
	}
	return r.withLogicGateRACILocked(item), nil
}

func (r *MemoryRepo) SetLogicGateRACIAssignments(input LogicGateRACIAssignmentUpdateInput) ([]domain.LogicGateRACIAssignment, error) {
	assignments := make([]ResourceRACIAssignmentInput, 0, len(input.Assignments))
	for _, item := range input.Assignments {
		normalized, err := normalizeLogicGateRACIAssignmentInput(item)
		if err != nil {
			return nil, err
		}
		assignments = append(assignments, ResourceRACIAssignmentInput{Role: normalized.role, PrincipalType: normalized.principalType, PrincipalID: normalized.principalID})
	}
	result, err := r.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: input.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: input.LogicGateID,
		Assignments: assignments,
	})
	if err != nil {
		return nil, err
	}
	return logicGateRACIAssignmentsFromResources(result.RACIAssignments), nil
}

func (r *MemoryRepo) DeleteLogicGate(companyID, logicGateID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return ErrNotFound
	}
	beforeEvent := r.snapshotProcessMapMutationLocked()
	eventInput := workspaceDomainEventInput(companyID, "logic_gate_deleted", map[string]any{
		"logic_gate_id": logicGateID, "realtime_change_type": "resource_deleted", "realtime_audience_snapshot": true,
	})
	if _, err := r.appendDomainEventLocked(eventInput); err != nil {
		r.restoreProcessMapMutationLocked(beforeEvent)
		return err
	}
	if err := r.deleteLogicGateLocked(companyID, logicGateID, false); err != nil {
		r.restoreProcessMapMutationLocked(beforeEvent)
		return err
	}
	return nil
}

func (r *MemoryRepo) deleteLogicGateLocked(companyID, logicGateID string, preserveResourceFields bool) error {
	k := key(companyID, logicGateID)
	if _, ok := r.logicGates[k]; !ok {
		return ErrNotFound
	}
	if !preserveResourceFields {
		r.clearEntityResourceFieldsForResourceLocked(companyID, EntityTypeLogicGate, logicGateID)
	}
	affectedNodeIDs := []string{}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID == companyID && assignment.LogicGateID == logicGateID {
			affectedNodeIDs = append(affectedNodeIDs, assignment.NodeID)
		}
	}
	r.deleteRACIMatrixProjectionForLogicGateLocked(companyID, logicGateID)
	for itemKey, item := range r.projectTimelineItems {
		if item.CompanyID == companyID && item.EntityType == EntityTypeLogicGate && item.EntityID == logicGateID {
			delete(r.projectTimelineItems, itemKey)
			delete(r.projectTimelineProjection, itemKey)
		}
	}
	r.deleteProcessMapResourceLocked(companyID, domain.ProcessMapResourceTypeProcess, logicGateID)
	delete(r.logicGates, k)
	delete(r.logicGateInfo, k)
	delete(r.logicGateText, k)
	delete(r.logicGateRACI, k)
	for ratingKey, rating := range r.qdRatings {
		if rating.CompanyID == companyID && rating.LogicGateID == logicGateID {
			delete(r.qdRatings, ratingKey)
		}
	}
	r.deleteMemoryHuddleRelationshipsForLogicGateLocked(companyID, logicGateID)
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == EntityTypeLogicGate && permission.EntityID == logicGateID {
			delete(r.entityPermissions, permissionKey)
		}
	}
	r.deleteNodeLogicGateAssignmentsForLogicGateLocked(companyID, logicGateID)
	for _, nodeID := range affectedNodeIDs {
		r.syncRACIMatrixProjectionForNodeLocked(companyID, nodeID)
	}
	delete(r.folderItems, folderItemKey(companyID, "logic_gate", logicGateID))
	for boardKeyValue, board := range r.kanbanBoards {
		if board.CompanyID != companyID || board.LogicGateID == nil || *board.LogicGateID != logicGateID {
			continue
		}
		delete(r.kanbanCards, boardKeyValue)
		delete(r.kanbanColumns, boardKeyValue)
		delete(r.kanbanBoards, boardKeyValue)
		delete(r.folderItems, folderItemKey(companyID, "kanban", board.BoardID))
	}
	defaultBoardID := LogicGateKanbanBoardID(logicGateID)
	delete(r.kanbanCards, boardKey(companyID, defaultBoardID))
	delete(r.kanbanColumns, boardKey(companyID, defaultBoardID))
	delete(r.kanbanBoards, boardKey(companyID, defaultBoardID))
	delete(r.folderItems, folderItemKey(companyID, "kanban", defaultBoardID))
	for linkKey, link := range r.emailNodeLinks {
		if link.CompanyID == companyID && link.LogicGateID == logicGateID {
			delete(r.emailNodeLinks, linkKey)
		}
	}
	for itemKey, item := range r.raciTabItems {
		if item.CompanyID == companyID && item.LogicGateID == logicGateID {
			delete(r.raciTabItems, itemKey)
		}
	}

	return nil
}

func (r *MemoryRepo) AddLogicGateInformation(companyID, logicGateID, infoType, information, informationID string) (domain.LogicGateInformation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return domain.LogicGateInformation{}, ErrNotFound
	}
	now := time.Now().UTC()
	k := key(companyID, logicGateID)
	item := domain.LogicGateInformation{
		CompanyID:        companyID,
		InformationID:    newUUIDv7String(),
		LogicGateID:      logicGateID,
		Type:             infoType,
		Information:      information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.logicGateInfo[k] = append(r.logicGateInfo[k], item)
	sort.Slice(r.logicGateInfo[k], func(i, j int) bool {
		return r.logicGateInfo[k][i].CreatedTimestamp.Before(r.logicGateInfo[k][j].CreatedTimestamp)
	})

	// Keep one latest-value row per stable information_id while preserving every
	// save above as history. Clients/agents should reuse information_id for edits.
	projectionID := informationID
	if projectionID == "" {
		projectionID = item.InformationID
	}
	if r.logicGateText[k] == nil {
		r.logicGateText[k] = map[string]domain.LogicGateProjection{}
	}
	if isEditorTextBoxType(infoType) {
		// Logic gates keep the legacy one-document editor contract. The new
		// multi-block timeline/chat/email workspace is node-only.
		if existingTextKey := newestLogicGateTextProjectionKey(r.logicGateText[k]); existingTextKey != "" {
			projectionID = existingTextKey
			for keyValue, projection := range r.logicGateText[k] {
				if keyValue != projectionID && isEditorTextBoxType(projection.Type) {
					delete(r.logicGateText[k], keyValue)
				}
			}
		}
	}
	created := item.CreatedTimestamp
	revision := int64(1)
	if existing, ok := r.logicGateText[k][projectionID]; ok {
		created = existing.CreatedTimestamp
		if existing.Revision < 1 {
			existing.Revision = 1
		}
		revision = existing.Revision + 1
	}
	projection := domain.LogicGateProjection{
		CompanyID:        companyID,
		LogicGateID:      logicGateID,
		Type:             infoType,
		Information:      information,
		InformationID:    projectionID,
		CreatedTimestamp: created,
		Revision:         revision,
		UpdatedTimestamp: item.UpdatedTimestamp,
	}
	r.logicGateText[k][projectionID] = projection
	return item, nil
}

func (r *MemoryRepo) ListLogicGateProjections(companyID, logicGateID string) ([]domain.LogicGateProjection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return nil, ErrNotFound
	}
	items := make([]domain.LogicGateProjection, 0)
	latestTextKey := newestLogicGateTextProjectionKey(r.logicGateText[key(companyID, logicGateID)])
	for projectionID, item := range r.logicGateText[key(companyID, logicGateID)] {
		if isEditorTextBoxType(item.Type) && projectionID != latestTextKey {
			continue
		}
		if isEditorTextBoxType(item.Type) && item.IsDeleted {
			continue
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedTimestamp.Before(items[j].UpdatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) DeleteLogicGateProjection(input LogicGateProjectionDeleteInput) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.LogicGateID)
	informationID := strings.TrimSpace(input.InformationID)
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return ErrNotFound
	}
	k := key(companyID, logicGateID)
	existing, projectionExists := r.logicGateText[k][informationID]
	if projectionExists && isEditorTextBoxType(existing.Type) {
		if existing.Revision < 1 {
			existing.Revision = 1
		}
		if input.ExpectedRevision == nil {
			return ErrProjectionRevisionRequired
		}
		if existing.IsDeleted || *input.ExpectedRevision != existing.Revision {
			current := existing
			return &ProjectionRevisionConflictError{LogicGateCurrent: &current}
		}
	}
	if projectionExists {
		if isEditorTextBoxType(existing.Type) {
			existing.IsDeleted = true
			existing.Revision++
			existing.UpdatedTimestamp = time.Now().UTC()
			r.logicGateText[k][informationID] = existing
		} else {
			delete(r.logicGateText[k], informationID)
		}
	}
	return nil
}

func cloneMemoryLogicGateProjectionMap(items map[string]domain.LogicGateProjection) map[string]domain.LogicGateProjection {
	if items == nil {
		return nil
	}
	out := make(map[string]domain.LogicGateProjection, len(items))
	for key, value := range items {
		out[key] = value
	}
	return out
}

func (r *MemoryRepo) GetLogicGateDetails(companyID, logicGateID string) (domain.LogicGateDetails, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	logicGate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return domain.LogicGateDetails{}, ErrNotFound
	}

	info := append([]domain.LogicGateInformation{}, r.logicGateInfo[key(companyID, logicGateID)]...)
	sort.Slice(info, func(i, j int) bool {
		return info[i].CreatedTimestamp.Before(info[j].CreatedTimestamp)
	})

	return domain.LogicGateDetails{
		LogicGate:   r.withLogicGateRACILocked(logicGate),
		Information: info,
	}, nil
}
func (r *MemoryRepo) CreateLogicGateWithWorkspaceEvent(companyID, header string) (domain.LogicGate, domain.DomainEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	beforeMutation := r.snapshotProcessMapMutationLocked()
	beforeGates := maps.Clone(r.logicGates)
	beforeBoards := maps.Clone(r.kanbanBoards)
	beforeColumns := maps.Clone(r.kanbanColumns)
	item := domain.LogicGate{CompanyID: companyID, LogicGateID: newUUIDv7String(), Header: header, DefaultAccess: ResourceDefaultAccessEdit, CreatedTimestamp: time.Now().UTC()}
	r.logicGates[key(companyID, item.LogicGateID)] = item
	r.ensureLogicGateKanbanBoardLocked(companyID, item.LogicGateID, item.Header)
	item = r.withLogicGateRACILocked(item)
	event, err := r.appendDomainEventLocked(logicGateCreatedWorkspaceEventInput(item, workItemAssignmentEventMetadata{}))
	if err != nil {
		r.logicGates = beforeGates
		r.kanbanBoards = beforeBoards
		r.kanbanColumns = beforeColumns
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	r.ensureCompanyExplorerV2CompanyGraphLocked(companyID)
	defaultFolders := r.ensureCompanyExplorerDefaultFoldersLocked(companyID)
	if err := r.syncMemoryDefaultFolderProcessMapPlacementsLocked(companyID, defaultFolders); err != nil {
		r.restoreProcessMapMutationLocked(beforeMutation)
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	r.placeCompanyExplorerItemInDefaultFolderLocked(companyID, EntityTypeLogicGate, item.LogicGateID, false)
	if folderItem, ok := r.folderItems[folderItemKey(companyID, EntityTypeLogicGate, item.LogicGateID)]; ok {
		parentID := folderItem.FolderID
		if _, err := r.syncAutomaticMemoryProcessMapPlacementLocked(companyID, domain.ProcessMapResourceTypeProcess, item.LogicGateID, &parentID); err != nil {
			r.restoreProcessMapMutationLocked(beforeMutation)
			return domain.LogicGate{}, domain.DomainEvent{}, err
		}
	}
	return item, event, nil
}

func (r *MemoryRepo) UpdateLogicGateHeaderWithWorkspaceEvent(companyID, logicGateID, header string) (domain.LogicGate, domain.DomainEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	beforeGates := maps.Clone(r.logicGates)
	beforeBoards := maps.Clone(r.kanbanBoards)
	beforeRACITabItems := maps.Clone(r.raciTabItems)
	beforeRACIProjection := maps.Clone(r.RACIMatrixProjectionRows)
	beforeTimelineItems := maps.Clone(r.projectTimelineItems)
	beforeTimelineProjection := maps.Clone(r.projectTimelineProjection)
	k := key(companyID, logicGateID)
	item, ok := r.logicGates[k]
	if !ok {
		return domain.LogicGate{}, domain.DomainEvent{}, ErrNotFound
	}
	item.Header = header
	r.logicGates[k] = item
	boardKeyValue := boardKey(companyID, LogicGateKanbanBoardID(logicGateID))
	if board, ok := r.kanbanBoards[boardKeyValue]; ok && board.LogicGateID != nil {
		board.Title = normalizeKanbanBoardTitle(board.BoardID, header)
		board.UpdatedTimestamp = time.Now().UTC()
		r.kanbanBoards[boardKeyValue] = board
	}
	r.syncRACIMatrixProjectionForLogicGateLocked(companyID, logicGateID)
	r.syncProjectManagementTimelineProjectionForLogicGateLocked(companyID, logicGateID)
	r.reconcileMemoryRACITabsLogicGateLocked(item)
	item = r.withLogicGateRACILocked(item)
	event, err := r.appendDomainEventLocked(logicGateUpdatedWorkspaceEventInput(item))
	if err != nil {
		r.logicGates = beforeGates
		r.kanbanBoards = beforeBoards
		r.raciTabItems = beforeRACITabItems
		r.RACIMatrixProjectionRows = beforeRACIProjection
		r.projectTimelineItems = beforeTimelineItems
		r.projectTimelineProjection = beforeTimelineProjection
		return domain.LogicGate{}, domain.DomainEvent{}, err
	}
	return item, event, nil
}
