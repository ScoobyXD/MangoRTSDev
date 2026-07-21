package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *MemoryRepo) GetSeenUpdatesRange(input UpdatesQuery) (UpdatesSeenRange, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	if input.UserID == "" || input.CompanyID == "" {
		return UpdatesSeenRange{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	var oldest, newest *domain.Notification
	for _, item := range r.notifications {
		if item.RecipientUserID != input.UserID || item.CompanyID != input.CompanyID || item.ReadTimestamp == nil || !r.notificationVisibleToUserLocked(item, input.UserID) {
			continue
		}
		copy := item
		if oldest == nil || copy.CreatedTimestamp.Before(oldest.CreatedTimestamp) {
			oldest = &copy
		}
		if newest == nil || copy.CreatedTimestamp.After(newest.CreatedTimestamp) {
			newest = &copy
		}
	}
	result := UpdatesSeenRange{}
	if oldest != nil {
		value := oldest.CreatedTimestamp.UTC()
		result.OldestCreatedTimestamp = &value
	}
	if newest != nil {
		value := newest.CreatedTimestamp.UTC()
		result.NewestCreatedTimestamp = &value
	}
	return result, nil
}

func (r *MemoryRepo) ListUpdateRootGroups(input UpdatesQuery) ([]UpdatesNestedGroup, error) {
	items, ctx, err := r.listUpdatesForQuery(input)
	if err != nil {
		return nil, err
	}
	return buildUpdateRootGroups(items, ctx), nil
}

func (r *MemoryRepo) ListUpdateBranch(input UpdatesQuery) (UpdatesNestedGroup, error) {
	items, ctx, err := r.listUpdatesForQuery(input)
	if err != nil {
		return UpdatesNestedGroup{}, err
	}
	return buildUpdateBranch(items, ctx, input.RootID)
}

func (r *MemoryRepo) listUpdatesForQuery(input UpdatesQuery) ([]domain.Notification, updatesBuildContext, error) {
	input, filter, err := normalizeUpdatesQuery(input)
	if err != nil {
		return nil, updatesBuildContext{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Notification, 0)
	for _, item := range r.notifications {
		if item.RecipientUserID != input.UserID || item.CompanyID != input.CompanyID {
			continue
		}
		if !updateNotificationMatchesView(item, input) {
			continue
		}
		if !updatesNotificationMatchesFilter(item, filter) {
			continue
		}
		if !r.notificationVisibleToUserLocked(item, input.UserID) {
			continue
		}
		items = append(items, cloneNotification(item))
	}
	return items, r.updatesBuildContextLocked(input, items), nil
}

func (r *MemoryRepo) updatesBuildContextLocked(input UpdatesQuery, items []domain.Notification) updatesBuildContext {
	ctx := updatesBuildContext{
		NodeLabels:               map[string]string{},
		LogicGateLabels:          map[string]string{},
		ProjectLabels:            map[string]string{},
		NodeLogicGateIDs:         map[string]string{},
		NodeProjectContexts:      map[string][]updatesProjectContext{},
		LogicGateProjectContexts: map[string][]updatesProjectContext{},
	}
	for _, node := range r.nodes {
		if node.CompanyID == input.CompanyID {
			ctx.NodeLabels[node.NodeID] = node.Title
		}
	}
	for _, gate := range r.logicGates {
		if gate.CompanyID == input.CompanyID {
			ctx.LogicGateLabels[gate.LogicGateID] = gate.Header
		}
	}
	for _, project := range r.projects {
		if project.CompanyID == input.CompanyID {
			ctx.ProjectLabels[project.ProjectID] = project.Name
		}
	}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID == input.CompanyID {
			ctx.NodeLogicGateIDs[assignment.NodeID] = assignment.LogicGateID
		}
	}
	for _, projection := range r.projectRelationshipProjection {
		if projection.CompanyID != input.CompanyID {
			continue
		}
		if input.UserID != "" && !r.userHasEffectiveAccessLocked(input.CompanyID, input.UserID, EntityTypeProject, projection.ProjectID, EntityPermissionEdit) {
			continue
		}
		projectName := strings.TrimSpace(projection.ProjectName)
		if project, ok := r.projects[key(input.CompanyID, projection.ProjectID)]; ok && strings.TrimSpace(project.Name) != "" {
			projectName = project.Name
		}
		project := updatesProjectContext{
			ProjectID:    projection.ProjectID,
			ProjectName:  projectName,
			Position:     projection.Position,
			Created:      projection.RelationshipCreatedTimestamp,
			Relationship: projection.RelationshipID,
		}
		if projection.NodeID != nil && strings.TrimSpace(*projection.NodeID) != "" {
			nodeID := strings.TrimSpace(*projection.NodeID)
			ctx.NodeProjectContexts[nodeID] = append(ctx.NodeProjectContexts[nodeID], project)
		}
		if projection.LogicGateID != nil && strings.TrimSpace(*projection.LogicGateID) != "" {
			logicGateID := strings.TrimSpace(*projection.LogicGateID)
			ctx.LogicGateProjectContexts[logicGateID] = append(ctx.LogicGateProjectContexts[logicGateID], project)
		}
	}
	return ctx
}
