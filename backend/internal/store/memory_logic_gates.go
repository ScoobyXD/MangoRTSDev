package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func raciRoleSortValue(role string) int {
	switch role {
	case domain.GVICRoleGenerated:
		return 0
	case domain.GVICRoleVerified:
		return 1
	case domain.GVICRoleConsulted:
		return 2
	case domain.GVICRoleInformed:
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

func logicGateRaciAssignmentSubject(item domain.LogicGateRaciAssignment) (string, string) {
	subjectType := strings.TrimSpace(item.SubjectType)
	subjectID := strings.TrimSpace(item.SubjectID)
	if subjectType == "" {
		subjectType = EntityPermissionSubjectUser
	}
	if subjectType == EntityPermissionSubjectUser && subjectID == "" {
		subjectID = strings.TrimSpace(item.UserID)
	}
	return subjectType, subjectID
}

func logicGateRaciAssignmentSubjectKey(item domain.LogicGateRaciAssignment) string {
	subjectType, subjectID := logicGateRaciAssignmentSubject(item)
	return strings.TrimSpace(item.Role) + ":" + subjectType + ":" + subjectID
}

func logicGateRaciAssignmentSortLabel(item domain.LogicGateRaciAssignment) string {
	label := strings.ToLower(strings.TrimSpace(item.SubjectName))
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserDisplayName))
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserEmail))
	}
	if label == "" {
		_, subjectID := logicGateRaciAssignmentSubject(item)
		label = strings.ToLower(subjectID)
	}
	if label == "" {
		label = strings.ToLower(strings.TrimSpace(item.UserID))
	}
	return label
}

func (r *MemoryRepo) logicGateRaciAssignmentForSubjectLocked(companyID, logicGateID, role, subjectType, subjectID string, created time.Time) (domain.LogicGateRaciAssignment, error) {
	item := domain.LogicGateRaciAssignment{
		CompanyID:        companyID,
		LogicGateID:      logicGateID,
		Role:             role,
		SubjectType:      subjectType,
		SubjectID:        subjectID,
		CreatedTimestamp: created,
	}
	switch subjectType {
	case EntityPermissionSubjectUser:
		user, ok := r.companyUserByIDLocked(companyID, subjectID)
		if !ok {
			return domain.LogicGateRaciAssignment{}, ErrAssigneeNotInCompany
		}
		item.UserID = user.UserID
		item.UserDisplayName = strings.TrimSpace(user.DisplayName)
		item.UserEmail = strings.TrimSpace(user.Email)
		item.SubjectName = item.UserDisplayName
		if item.SubjectName == "" {
			item.SubjectName = item.UserEmail
		}
	case EntityPermissionSubjectGroup:
		group, ok := r.userGroups[userGroupKey(companyID, subjectID)]
		if !ok {
			return domain.LogicGateRaciAssignment{}, ErrAssigneeNotInCompany
		}
		item.SubjectName = strings.TrimSpace(group.Name)
	default:
		return domain.LogicGateRaciAssignment{}, ErrInvalid
	}
	return item, nil
}

func (r *MemoryRepo) logicGateRaciUserIDsForGroupLocked(companyID, groupID string) ([]string, error) {
	if _, ok := r.userGroups[userGroupKey(companyID, groupID)]; !ok {
		return nil, ErrAssigneeNotInCompany
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

func (r *MemoryRepo) expandedLogicGateRaciCommandAssignmentsLocked(companyID string, assignments []normalizedLogicGateRaciCommandAssignment) ([]normalizedLogicGateRaciCommandAssignment, error) {
	expanded := make([]normalizedLogicGateRaciCommandAssignment, 0, len(assignments))
	seen := map[string]bool{}
	for _, assignment := range assignments {
		if assignment.subjectType != EntityPermissionSubjectGroup {
			key := assignment.role + ":" + assignment.subjectType + ":" + assignment.subjectID
			if seen[key] {
				continue
			}
			seen[key] = true
			expanded = append(expanded, assignment)
			continue
		}
		userIDs, err := r.logicGateRaciUserIDsForGroupLocked(companyID, assignment.subjectID)
		if err != nil {
			return nil, err
		}
		for _, userID := range userIDs {
			expandedAssignment := normalizedLogicGateRaciCommandAssignment{
				role:        assignment.role,
				subjectType: EntityPermissionSubjectUser,
				subjectID:   userID,
				userID:      userID,
			}
			key := expandedAssignment.role + ":" + expandedAssignment.subjectType + ":" + expandedAssignment.subjectID
			if seen[key] {
				continue
			}
			seen[key] = true
			expanded = append(expanded, expandedAssignment)
		}
	}
	return expanded, nil
}

func sortLogicGateRaciAssignments(items []domain.LogicGateRaciAssignment) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].LogicGateID != items[j].LogicGateID {
			return items[i].LogicGateID < items[j].LogicGateID
		}
		if raciRoleSortValue(items[i].Role) != raciRoleSortValue(items[j].Role) {
			return raciRoleSortValue(items[i].Role) < raciRoleSortValue(items[j].Role)
		}
		iLabel := logicGateRaciAssignmentSortLabel(items[i])
		jLabel := logicGateRaciAssignmentSortLabel(items[j])
		if iLabel != jLabel {
			return iLabel < jLabel
		}
		iSubjectType, iSubjectID := logicGateRaciAssignmentSubject(items[i])
		jSubjectType, jSubjectID := logicGateRaciAssignmentSubject(items[j])
		if iSubjectType != jSubjectType {
			return iSubjectType < jSubjectType
		}
		return iSubjectID < jSubjectID
	})
}

func (r *MemoryRepo) withLogicGateRaciLocked(gate domain.LogicGate) domain.LogicGate {
	gate.DefaultAccess = defaultResourceAccessOrEdit(gate.DefaultAccess)
	assignments := r.logicGateGVICAssignmentsAsLogicGateRaciLocked(gate.CompanyID, gate.LogicGateID)
	sortLogicGateRaciAssignments(assignments)
	gate.RaciAssignments = assignments
	gate.GVICAssignments = r.gvicAssignmentsForResourceLocked(gate.CompanyID, EntityTypeLogicGate, gate.LogicGateID)
	return gate
}

func (r *MemoryRepo) logicGateGVICAssignmentsAsLogicGateRaciLocked(companyID, logicGateID string) []domain.LogicGateRaciAssignment {
	items := r.gvicAssignmentsForResourceLocked(companyID, EntityTypeLogicGate, logicGateID)
	out := make([]domain.LogicGateRaciAssignment, 0, len(items))
	for _, item := range items {
		assignment := domain.LogicGateRaciAssignment{
			CompanyID:        item.CompanyID,
			LogicGateID:      item.ResourceID,
			Role:             item.Role,
			SubjectType:      item.PrincipalType,
			SubjectID:        item.PrincipalID,
			SubjectName:      item.PrincipalName,
			UserID:           item.UserID,
			UserDisplayName:  item.UserDisplayName,
			UserEmail:        item.UserEmail,
			CreatedTimestamp: item.CreatedTimestamp,
		}
		if assignment.SubjectType == EntityPermissionSubjectUser && assignment.UserID == "" {
			assignment.UserID = assignment.SubjectID
		}
		out = append(out, assignment)
	}
	sortLogicGateRaciAssignments(out)
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

	item := domain.LogicGate{
		CompanyID:        companyID,
		LogicGateID:      newUUIDv7String(),
		Header:           header,
		DefaultAccess:    ResourceDefaultAccessEdit,
		CreatedTimestamp: time.Now().UTC(),
	}
	r.logicGates[key(companyID, item.LogicGateID)] = item
	r.ensureLogicGateKanbanBoardLocked(companyID, item.LogicGateID, item.Header)
	return r.withLogicGateRaciLocked(item), nil
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
	r.syncRacioProjectionForLogicGateLocked(companyID, logicGateID)
	r.syncProjectManagementTimelineProjectionForLogicGateLocked(companyID, logicGateID)
	return r.withLogicGateRaciLocked(item), nil
}

func (r *MemoryRepo) ListLogicGates(companyID string) ([]domain.LogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.LogicGate, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID == companyID {
			items = append(items, r.withLogicGateRaciLocked(gate))
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
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionView) {
			continue
		}
		gate = r.withLogicGateRaciLocked(gate)
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
			items = append(items, r.withLogicGateRaciLocked(gate))
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
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionView) {
			continue
		}
		gate = r.withLogicGateRaciLocked(gate)
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

func (r *MemoryRepo) logicGateAssignedToUserLocked(companyID string, assignments []domain.LogicGateRaciAssignment, userID string) bool {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return true
	}
	return r.logicGateRaciAssignmentUserSetLocked(companyID, assignments)[userID]
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
		assignments := r.logicGateGVICAssignmentsAsLogicGateRaciLocked(gate.CompanyID, gate.LogicGateID)
		if !r.logicGateAssignedToUserLocked(companyID, assignments, query.AssignedUserID) {
			continue
		}
		items = append(items, r.withLogicGateRaciLocked(gate))
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
		if !r.userHasEffectiveAccessLocked(companyID, userID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionView) {
			continue
		}
		assignments := r.logicGateGVICAssignmentsAsLogicGateRaciLocked(gate.CompanyID, gate.LogicGateID)
		if !r.logicGateAssignedToUserLocked(companyID, assignments, query.AssignedUserID) {
			continue
		}
		items = append(items, r.withLogicGateRaciLocked(gate))
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
	return r.withLogicGateRaciLocked(item), nil
}

func (r *MemoryRepo) SetLogicGateRaciAssignments(input LogicGateRaciAssignmentUpdateInput) ([]domain.LogicGateRaciAssignment, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.LogicGateID)
	if companyID == "" || logicGateID == "" {
		return nil, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return nil, ErrNotFound
	}
	now := time.Now().UTC()
	seen := map[string]bool{}
	assignments := make([]domain.LogicGateRaciAssignment, 0, len(input.Assignments))
	normalizedAssignments := make([]normalizedLogicGateRaciCommandAssignment, 0, len(input.Assignments))
	for _, inputAssignment := range input.Assignments {
		normalized, err := normalizeLogicGateRaciAssignmentInput(inputAssignment)
		if err != nil {
			return nil, err
		}
		if err := r.validateGVICPrincipalLocked(companyID, normalized.subjectType, normalized.subjectID); err != nil {
			return nil, err
		}
		normalizedAssignments = append(normalizedAssignments, normalized)
	}
	for _, normalized := range normalizedAssignments {
		assignmentKey := normalized.role + ":" + normalized.subjectType + ":" + normalized.subjectID
		if seen[assignmentKey] {
			continue
		}
		seen[assignmentKey] = true
		assignment, err := r.logicGateRaciAssignmentForSubjectLocked(companyID, logicGateID, normalized.role, normalized.subjectType, normalized.subjectID, now)
		if err != nil {
			return nil, err
		}
		assignments = append(assignments, assignment)
	}
	sortLogicGateRaciAssignments(assignments)
	before := r.logicGateGVICAssignmentsAsLogicGateRaciLocked(companyID, logicGateID)
	for sourceKey, assignment := range r.gvicAssignments {
		if assignment.CompanyID == companyID && assignment.ResourceType == EntityTypeLogicGate && assignment.ResourceID == logicGateID {
			delete(r.gvicAssignments, sourceKey)
		}
	}
	sourceKeyValue := resourceGVICKey{companyID: companyID, resourceType: EntityTypeLogicGate, resourceID: logicGateID}
	for _, normalized := range normalizedAssignments {
		item := r.resourceGVICAssignmentForPrincipalLocked(sourceKeyValue, normalizedGVICAssignmentInput{
			role:          normalized.role,
			principalType: normalized.subjectType,
			principalID:   normalized.subjectID,
		}, now)
		r.gvicAssignments[gvicSourceAssignmentKey(item.CompanyID, item.ResourceType, item.ResourceID, item.Role, item.PrincipalType, item.PrincipalID)] = item
	}
	r.logicGateRaci[key(companyID, logicGateID)] = assignments
	r.syncRacioProjectionForLogicGateAssignmentsLocked(companyID, logicGateID, before, assignments)
	return append([]domain.LogicGateRaciAssignment{}, assignments...), nil
}

func (r *MemoryRepo) DeleteLogicGate(companyID, logicGateID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.deleteLogicGateLocked(companyID, logicGateID)
}

func (r *MemoryRepo) deleteLogicGateLocked(companyID, logicGateID string) error {
	k := key(companyID, logicGateID)
	if _, ok := r.logicGates[k]; !ok {
		return ErrNotFound
	}
	affectedNodeIDs := []string{}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID == companyID && assignment.LogicGateID == logicGateID {
			affectedNodeIDs = append(affectedNodeIDs, assignment.NodeID)
		}
	}
	r.deleteRacioProjectionForLogicGateLocked(companyID, logicGateID)
	for itemKey, item := range r.projectTimelineItems {
		if item.CompanyID == companyID && item.EntityType == EntityTypeLogicGate && item.EntityID == logicGateID {
			delete(r.projectTimelineItems, itemKey)
			delete(r.projectTimelineProjection, itemKey)
		}
	}
	delete(r.logicGates, k)
	delete(r.logicGateInfo, k)
	delete(r.logicGateText, k)
	delete(r.logicGateRaci, k)
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.EntityType == EntityTypeLogicGate && permission.EntityID == logicGateID {
			delete(r.entityPermissions, permissionKey)
		}
	}
	r.deleteNodeLogicGateAssignmentsForLogicGateLocked(companyID, logicGateID)
	for _, nodeID := range affectedNodeIDs {
		r.syncRacioProjectionForNodeLocked(companyID, nodeID)
	}
	delete(r.folderItems, folderItemKey(companyID, "logic_gate", logicGateID))
	delete(r.logicMapPositions, k)
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
	for shortcutKey, shortcut := range r.logicGateShortcuts {
		if shortcut.CompanyID == companyID && shortcut.LogicGateID == logicGateID {
			delete(r.logicGateShortcuts, shortcutKey)
		}
	}
	for linkKey, link := range r.emailNodeLinks {
		if link.CompanyID == companyID && link.LogicGateID == logicGateID {
			delete(r.emailNodeLinks, linkKey)
		}
	}

	filtered := make([]domain.LogicGateRelationship, 0, len(r.logicGateRels[companyID]))
	for _, rel := range r.logicGateRels[companyID] {
		if rel.LogicGateIDA == logicGateID || rel.LogicGateIDB == logicGateID {
			continue
		}
		filtered = append(filtered, rel)
	}
	r.logicGateRels[companyID] = filtered
	return nil
}

func (r *MemoryRepo) ListLogicGateMapPositions(companyID string) ([]domain.LogicGateMapPosition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.LogicGateMapPosition, 0)
	for _, item := range r.logicMapPositions {
		if item.CompanyID == companyID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].LogicGateID < items[j].LogicGateID
	})
	return items, nil
}

func (r *MemoryRepo) ListLogicGateMapPositionsInFolderSubtree(companyID, folderID string) ([]domain.LogicGateMapPosition, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListLogicGateMapPositions(companyID)
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
	items := make([]domain.LogicGateMapPosition, 0)
	for _, item := range r.logicMapPositions {
		if item.CompanyID == companyID && visible[item.LogicGateID] {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].LogicGateID < items[j].LogicGateID
	})
	return items, nil
}
func logicGateMapPositionInWindow(position domain.LogicGateMapPosition, window NodeMapWindowBounds) bool {
	return position.X >= window.MinX && position.X <= window.MaxX && position.Y >= window.MinY && position.Y <= window.MaxY
}

func sortLogicGateMapWindowPositions(items []domain.LogicGateMapPosition) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].X != items[j].X {
			return items[i].X < items[j].X
		}
		if items[i].Y != items[j].Y {
			return items[i].Y < items[j].Y
		}
		return items[i].LogicGateID < items[j].LogicGateID
	})
}

func (r *MemoryRepo) logicGateMapWindowPositionsLocked(query LogicGateMapWindowQuery, folderIDs map[string]bool) []domain.LogicGateMapPosition {
	visibleFolderGates := map[string]bool{}
	for _, item := range r.folderItems {
		if item.CompanyID == query.CompanyID && item.ItemType == "logic_gate" && folderIDs[item.FolderID] {
			visibleFolderGates[item.ItemID] = true
		}
	}
	items := make([]domain.LogicGateMapPosition, 0)
	for _, item := range r.logicMapPositions {
		if item.CompanyID == query.CompanyID && visibleFolderGates[item.LogicGateID] && logicGateMapPositionInWindow(item, query.Window) {
			items = append(items, item)
		}
	}
	sortLogicGateMapWindowPositions(items)
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items
}

func (r *MemoryRepo) ListLogicGateMapPositionsWindow(query LogicGateMapWindowQuery) ([]domain.LogicGateMapPosition, error) {
	query, err := NormalizeLogicGateMapWindowQuery(query)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, query.CompanyID, query.FolderID, "logic_gate")
	if len(folderIDs) == 0 {
		return nil, ErrNotFound
	}
	return r.logicGateMapWindowPositionsLocked(query, folderIDs), nil
}

func (r *MemoryRepo) ListLogicGateMapWindow(query LogicGateMapWindowQuery) (LogicGateMapWindowResult, error) {
	query, err := NormalizeLogicGateMapWindowQuery(query)
	if err != nil {
		return LogicGateMapWindowResult{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	folderIDs := companyExplorerFolderSubtreeIDsLocked(r.folders, query.CompanyID, query.FolderID, "logic_gate")
	if len(folderIDs) == 0 {
		return LogicGateMapWindowResult{}, ErrNotFound
	}

	positions := r.logicGateMapWindowPositionsLocked(query, folderIDs)
	visibleGates := map[string]bool{}
	for _, position := range positions {
		visibleGates[position.LogicGateID] = true
	}

	result := LogicGateMapWindowResult{
		CompanyID:             query.CompanyID,
		FolderID:              query.FolderID,
		Window:                query.Window,
		Limit:                 query.Limit,
		LogicGates:            []domain.LogicGate{},
		Relationships:         []domain.LogicGateRelationship{},
		Folders:               []domain.CompanyExplorerFolder{},
		FolderItems:           []domain.CompanyExplorerFolderItem{},
		LogicGateMapPositions: positions,
	}
	for _, folder := range r.folders {
		if !folderIDs[folder.FolderID] {
			continue
		}
		if folder.SystemKey != nil && *folder.SystemKey == "kanban_boards" {
			continue
		}
		result.Folders = append(result.Folders, r.withSharedInboxRaciLocked(folder))
	}
	sort.Slice(result.Folders, func(i, j int) bool {
		if result.Folders[i].Position == result.Folders[j].Position {
			if !result.Folders[i].CreatedTimestamp.Equal(result.Folders[j].CreatedTimestamp) {
				return result.Folders[i].CreatedTimestamp.Before(result.Folders[j].CreatedTimestamp)
			}
			return result.Folders[i].FolderID < result.Folders[j].FolderID
		}
		return result.Folders[i].Position < result.Folders[j].Position
	})
	for _, gate := range r.logicGates {
		if gate.CompanyID == query.CompanyID && visibleGates[gate.LogicGateID] {
			result.LogicGates = append(result.LogicGates, r.withLogicGateRaciLocked(gate))
		}
	}
	sort.Slice(result.LogicGates, func(i, j int) bool {
		return result.LogicGates[i].CreatedTimestamp.Before(result.LogicGates[j].CreatedTimestamp)
	})
	for _, rel := range r.logicGateRels[query.CompanyID] {
		if visibleGates[rel.LogicGateIDA] && visibleGates[rel.LogicGateIDB] {
			result.Relationships = append(result.Relationships, rel)
		}
	}
	sort.Slice(result.Relationships, func(i, j int) bool {
		return result.Relationships[i].CreatedTimestamp.Before(result.Relationships[j].CreatedTimestamp)
	})
	for _, item := range r.folderItems {
		if item.CompanyID == query.CompanyID && item.ItemType == "logic_gate" && folderIDs[item.FolderID] && visibleGates[item.ItemID] {
			result.FolderItems = append(result.FolderItems, item)
		}
	}
	sort.Slice(result.FolderItems, func(i, j int) bool {
		if result.FolderItems[i].Position == result.FolderItems[j].Position {
			if !result.FolderItems[i].CreatedTimestamp.Equal(result.FolderItems[j].CreatedTimestamp) {
				return result.FolderItems[i].CreatedTimestamp.Before(result.FolderItems[j].CreatedTimestamp)
			}
			return result.FolderItems[i].ItemID < result.FolderItems[j].ItemID
		}
		return result.FolderItems[i].Position < result.FolderItems[j].Position
	})
	return result, nil
}
func (r *MemoryRepo) UpsertLogicGateMapPositions(companyID string, positions []domain.LogicGateMapPosition) ([]domain.LogicGateMapPosition, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, position := range positions {
		if _, ok := r.logicGates[key(companyID, position.LogicGateID)]; !ok {
			return nil, ErrNotFound
		}
	}
	now := time.Now().UTC()
	out := make([]domain.LogicGateMapPosition, 0, len(positions))
	for _, position := range positions {
		item := domain.LogicGateMapPosition{
			CompanyID:        companyID,
			LogicGateID:      position.LogicGateID,
			X:                position.X,
			Y:                position.Y,
			UpdatedTimestamp: now,
		}
		r.logicMapPositions[key(companyID, item.LogicGateID)] = item
		out = append(out, item)
	}
	return out, nil
}

func (r *MemoryRepo) ListLogicGateRelationships(companyID string) ([]domain.LogicGateRelationship, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := append([]domain.LogicGateRelationship{}, r.logicGateRels[companyID]...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) ListLogicGateRelationshipsInFolderSubtree(companyID, folderID string) ([]domain.LogicGateRelationship, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return r.ListLogicGateRelationships(companyID)
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
	items := make([]domain.LogicGateRelationship, 0)
	for _, rel := range r.logicGateRels[companyID] {
		if visible[rel.LogicGateIDA] && visible[rel.LogicGateIDB] {
			items = append(items, rel)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
	})
	return items, nil
}
func (r *MemoryRepo) CreateLogicGateRelationship(companyID, logicGateIDA, logicGateIDB, aPosition, bPosition string) (domain.LogicGateRelationship, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.logicGates[key(companyID, logicGateIDA)]; !ok {
		return domain.LogicGateRelationship{}, ErrNotFound
	}
	if _, ok := r.logicGates[key(companyID, logicGateIDB)]; !ok {
		return domain.LogicGateRelationship{}, ErrNotFound
	}

	item := domain.LogicGateRelationship{
		CompanyID:               companyID,
		LogicGateRelationshipID: newUUIDv7String(),
		LogicGateIDA:            logicGateIDA,
		LogicGateIDB:            logicGateIDB,
		APosition:               aPosition,
		BPosition:               bPosition,
		CreatedTimestamp:        time.Now().UTC(),
	}
	r.logicGateRels[companyID] = append(r.logicGateRels[companyID], item)
	return item, nil
}

func (r *MemoryRepo) DeleteLogicGateRelationship(companyID, relationshipID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	items := r.logicGateRels[companyID]
	filtered := make([]domain.LogicGateRelationship, 0, len(items))
	deleted := false
	for _, item := range items {
		if item.LogicGateRelationshipID == relationshipID {
			deleted = true
			continue
		}
		filtered = append(filtered, item)
	}
	if !deleted {
		return ErrNotFound
	}
	r.logicGateRels[companyID] = filtered
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
	beforeInfo := append([]domain.LogicGateInformation{}, r.logicGateInfo[k]...)
	beforeText := cloneMemoryLogicGateProjectionMap(r.logicGateText[k])
	rollback := func() {
		r.logicGateInfo[k] = beforeInfo
		r.logicGateText[k] = beforeText
	}
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
	if existing, ok := r.logicGateText[k][projectionID]; ok {
		created = existing.CreatedTimestamp
	}
	projection := domain.LogicGateProjection{
		CompanyID:        companyID,
		LogicGateID:      logicGateID,
		Type:             infoType,
		Information:      information,
		InformationID:    projectionID,
		CreatedTimestamp: created,
		UpdatedTimestamp: item.UpdatedTimestamp,
	}
	r.logicGateText[k][projectionID] = projection
	if eventInput, ok := EditorProjectionUpsertEventInput(companyID, "", "", EditorProjectionRowFromLogicGate(projection)); ok {
		if _, err := r.appendEventRowsLocked([]EventRowInput{eventInput}); err != nil {
			rollback()
			return domain.LogicGateInformation{}, err
		}
	}
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
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedTimestamp.Before(items[j].UpdatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) DeleteLogicGateProjection(companyID, logicGateID, informationID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return ErrNotFound
	}
	k := key(companyID, logicGateID)
	beforeText := cloneMemoryLogicGateProjectionMap(r.logicGateText[k])
	if _, ok := r.logicGateText[k][informationID]; ok {
		delete(r.logicGateText[k], informationID)
		if eventInput, ok := EditorProjectionDeleteEventInput(companyID, "", "", EntityTypeLogicGate, logicGateID, informationID); ok {
			if _, err := r.appendEventRowsLocked([]EventRowInput{eventInput}); err != nil {
				r.logicGateText[k] = beforeText
				return err
			}
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

	relationships := make([]domain.LogicGateRelationship, 0)
	for _, rel := range r.logicGateRels[companyID] {
		if rel.LogicGateIDA == logicGateID || rel.LogicGateIDB == logicGateID {
			relationships = append(relationships, rel)
		}
	}
	sort.Slice(relationships, func(i, j int) bool {
		return relationships[i].CreatedTimestamp.Before(relationships[j].CreatedTimestamp)
	})

	return domain.LogicGateDetails{
		LogicGate:     r.withLogicGateRaciLocked(logicGate),
		Information:   info,
		Relationships: relationships,
	}, nil
}
