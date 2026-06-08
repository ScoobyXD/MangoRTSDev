package store

import (
	"sort"
	"strings"
	"time"
)

type memoryProjectManagementTimelineItem struct {
	CompanyID        string
	ItemID           string
	UserID           string
	EntityType       string
	EntityID         string
	StartDate        string
	DurationDays     int
	Position         int
	CreatedByUserID  string
	CreatedTimestamp time.Time
	UpdatedTimestamp time.Time
}

func projectManagementTimelineItemMemoryKey(companyID, itemID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(itemID)
}

func (r *MemoryRepo) ListProjectManagementTimelineProjectionRows(query ProjectManagementTimelineQuery) ([]ProjectManagementTimelineProjectionRow, error) {
	query = NormalizeProjectManagementTimelineQuery(query)
	if query.CompanyID == "" || query.UserID == "" || query.ViewerUserID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]ProjectManagementTimelineProjectionRow, 0)
	for _, row := range r.projectTimelineProjection {
		if row.CompanyID != query.CompanyID || row.UserID != query.UserID {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, row.ResourceType, row.ResourceID, EntityPermissionView) {
			continue
		}
		items = append(items, cloneProjectManagementTimelineProjectionRow(row))
	}
	sortProjectManagementTimelineRows(items)
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	return items, nil
}

func (r *MemoryRepo) ListProjectManagementTimelineProjectionRowsForNode(companyID, nodeID string) ([]ProjectManagementTimelineProjectionRow, error) {
	return r.projectManagementTimelineProjectionRowsForResource(companyID, EntityTypeNode, nodeID), nil
}

func (r *MemoryRepo) ListProjectManagementTimelineProjectionRowsForLogicGate(companyID, logicGateID string) ([]ProjectManagementTimelineProjectionRow, error) {
	return r.projectManagementTimelineProjectionRowsForResource(companyID, EntityTypeLogicGate, logicGateID), nil
}

func (r *MemoryRepo) GetProjectManagementTimelineItemOwner(companyID, itemID string) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.projectTimelineItems[projectManagementTimelineItemMemoryKey(companyID, itemID)]
	if !ok {
		return "", ErrNotFound
	}
	return item.UserID, nil
}

func (r *MemoryRepo) projectManagementTimelineProjectionRowsForResource(companyID, entityType, entityID string) []ProjectManagementTimelineProjectionRow {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]ProjectManagementTimelineProjectionRow, 0)
	for _, row := range r.projectTimelineProjection {
		if row.CompanyID == companyID && row.ResourceType == entityType && row.ResourceID == entityID {
			items = append(items, cloneProjectManagementTimelineProjectionRow(row))
		}
	}
	sortProjectManagementTimelineRows(items)
	return items
}

func (r *MemoryRepo) UpsertProjectManagementTimelineItem(input ProjectManagementTimelineItemInput) (ProjectManagementTimelineMutationResult, error) {
	input, err := NormalizeProjectManagementTimelineItemInput(input)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	var after []ProjectManagementTimelineProjectionRow
	var deltas []ProjectionDelta
	var item *ProjectManagementTimelineProjectionRow
	r.mu.Lock()
	before := r.projectManagementTimelineProjectionRowsForEntityLocked(input.CompanyID, input.UserID, input.EntityType, input.EntityID)
	itemID := r.projectManagementTimelineItemIDForEntityLocked(input.CompanyID, input.UserID, input.EntityType, input.EntityID)
	if itemID == "" {
		itemID = strings.TrimSpace(input.ItemID)
	}
	if itemID == "" {
		itemID = newUUIDv7String()
	}
	now := time.Now().UTC()
	existing := r.projectTimelineItems[projectManagementTimelineItemMemoryKey(input.CompanyID, itemID)]
	if existing.CreatedTimestamp.IsZero() {
		existing.CreatedTimestamp = now
	}
	existing.CompanyID = input.CompanyID
	existing.ItemID = itemID
	existing.UserID = input.UserID
	existing.EntityType = input.EntityType
	existing.EntityID = input.EntityID
	existing.StartDate = input.StartDate
	existing.DurationDays = input.DurationDays
	existing.Position = input.Position
	existing.CreatedByUserID = input.ActorUserID
	existing.UpdatedTimestamp = now
	r.projectTimelineItems[projectManagementTimelineItemMemoryKey(input.CompanyID, itemID)] = existing
	r.syncProjectManagementTimelineProjectionForItemLocked(input.CompanyID, itemID)
	after = r.projectManagementTimelineProjectionRowsForEntityLocked(input.CompanyID, input.UserID, input.EntityType, input.EntityID)
	deltas = diffProjectManagementProjectionRows(before, after)
	for index := range after {
		if after[index].ItemID == itemID {
			copied := after[index]
			item = &copied
			break
		}
	}
	r.mu.Unlock()
	_, _ = r.AppendEventRows(ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, "", deltas))
	return ProjectManagementTimelineMutationResult{Item: item, UserID: input.UserID, ProjectionDeltas: deltas}, nil
}

func (r *MemoryRepo) UpdateProjectManagementTimelineItem(input ProjectManagementTimelineItemUpdateInput) (ProjectManagementTimelineMutationResult, error) {
	input, err := NormalizeProjectManagementTimelineItemUpdateInput(input)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	var before []ProjectManagementTimelineProjectionRow
	var after []ProjectManagementTimelineProjectionRow
	var deltas []ProjectionDelta
	var item *ProjectManagementTimelineProjectionRow
	userID := ""
	r.mu.Lock()
	key := projectManagementTimelineItemMemoryKey(input.CompanyID, input.ItemID)
	existing, ok := r.projectTimelineItems[key]
	if !ok {
		r.mu.Unlock()
		return ProjectManagementTimelineMutationResult{}, ErrNotFound
	}
	userID = existing.UserID
	before = r.projectManagementTimelineProjectionRowsForItemLocked(input.CompanyID, input.ItemID)
	existing.StartDate = input.StartDate
	existing.DurationDays = input.DurationDays
	existing.Position = input.Position
	existing.UpdatedTimestamp = time.Now().UTC()
	r.projectTimelineItems[key] = existing
	r.syncProjectManagementTimelineProjectionForItemLocked(input.CompanyID, input.ItemID)
	after = r.projectManagementTimelineProjectionRowsForItemLocked(input.CompanyID, input.ItemID)
	deltas = diffProjectManagementProjectionRows(before, after)
	if len(after) > 0 {
		copied := after[0]
		item = &copied
	}
	r.mu.Unlock()
	_, _ = r.AppendEventRows(ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, "", deltas))
	return ProjectManagementTimelineMutationResult{Item: item, UserID: userID, ProjectionDeltas: deltas}, nil
}

func (r *MemoryRepo) DeleteProjectManagementTimelineItem(input ProjectManagementTimelineItemDeleteInput) (ProjectManagementTimelineMutationResult, error) {
	input, err := NormalizeProjectManagementTimelineItemDeleteInput(input)
	if err != nil {
		return ProjectManagementTimelineMutationResult{}, err
	}
	var before []ProjectManagementTimelineProjectionRow
	var deltas []ProjectionDelta
	userID := ""
	r.mu.Lock()
	key := projectManagementTimelineItemMemoryKey(input.CompanyID, input.ItemID)
	existing, ok := r.projectTimelineItems[key]
	if !ok {
		r.mu.Unlock()
		return ProjectManagementTimelineMutationResult{}, ErrNotFound
	}
	userID = existing.UserID
	before = r.projectManagementTimelineProjectionRowsForItemLocked(input.CompanyID, input.ItemID)
	delete(r.projectTimelineItems, key)
	delete(r.projectTimelineProjection, key)
	deltas = diffProjectManagementProjectionRows(before, nil)
	r.mu.Unlock()
	_, _ = r.AppendEventRows(ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, "", deltas))
	return ProjectManagementTimelineMutationResult{DeletedItemID: input.ItemID, UserID: userID, ProjectionDeltas: deltas}, nil
}

func (r *MemoryRepo) syncProjectManagementTimelineProjectionForNodeLocked(companyID, nodeID string) {
	for _, item := range r.projectTimelineItems {
		if item.CompanyID == companyID && item.EntityType == EntityTypeNode && item.EntityID == nodeID {
			r.syncProjectManagementTimelineProjectionForItemLocked(companyID, item.ItemID)
		}
	}
}

func (r *MemoryRepo) syncProjectManagementTimelineProjectionForLogicGateLocked(companyID, logicGateID string) {
	for _, item := range r.projectTimelineItems {
		if item.CompanyID == companyID && item.EntityType == EntityTypeLogicGate && item.EntityID == logicGateID {
			r.syncProjectManagementTimelineProjectionForItemLocked(companyID, item.ItemID)
		}
	}
}

func (r *MemoryRepo) syncProjectManagementTimelineProjectionForItemLocked(companyID, itemID string) {
	itemKey := projectManagementTimelineItemMemoryKey(companyID, itemID)
	item, ok := r.projectTimelineItems[itemKey]
	if !ok {
		delete(r.projectTimelineProjection, itemKey)
		return
	}
	row := ProjectManagementTimelineProjectionRow{
		CompanyID:                  item.CompanyID,
		ItemID:                     item.ItemID,
		UserID:                     item.UserID,
		ResourceType:               item.EntityType,
		ResourceID:                 item.EntityID,
		StartDate:                  item.StartDate,
		EndDate:                    projectManagementEndDate(item.StartDate, item.DurationDays),
		DurationDays:               item.DurationDays,
		Position:                   item.Position,
		CreatedTimestamp:           item.CreatedTimestamp,
		UpdatedTimestamp:           item.UpdatedTimestamp,
		ProjectionUpdatedTimestamp: time.Now().UTC(),
	}
	switch item.EntityType {
	case EntityTypeNode:
		node, ok := r.nodes[key(item.CompanyID, item.EntityID)]
		if !ok {
			delete(r.projectTimelineProjection, itemKey)
			return
		}
		node = r.withNodeReadModelLocked(node)
		row.NodeID = node.NodeID
		row.NodeTitle = node.Title
		row.DisplayTitle = node.Title
		row.Status = cloneStringPointer(node.Status)
		row.StatusColor = cloneStringPointer(node.StatusColor)
		row.DueDate = cloneStringPointer(node.DueDate)
		row.Priority = cloneIntPointer(node.Priority)
		row.AssigneeUserID = cloneStringPointer(node.AssigneeUserID)
		row.AssigneeDisplayName = cloneStringPointer(node.AssigneeName)
		row.AssigneeEmail = cloneStringPointer(node.AssigneeEmail)
		row.Accounts = cloneAccountSnapshots(node.Accounts)
		row.ResourceCreatedTimestamp = node.CreatedTimestamp
	case EntityTypeLogicGate:
		logicGate, ok := r.logicGates[key(item.CompanyID, item.EntityID)]
		if !ok {
			delete(r.projectTimelineProjection, itemKey)
			return
		}
		logicGateID := logicGate.LogicGateID
		row.LogicGateID = &logicGateID
		row.DisplayTitle = logicGate.Header
		status := "Logic Gate"
		color := "#8b5cf6"
		row.Status = &status
		row.StatusColor = &color
		row.ResourceCreatedTimestamp = logicGate.CreatedTimestamp
	default:
		delete(r.projectTimelineProjection, itemKey)
		return
	}
	if strings.TrimSpace(row.DisplayTitle) == "" {
		row.DisplayTitle = row.ResourceID
	}
	r.projectTimelineProjection[itemKey] = row
}

func (r *MemoryRepo) projectManagementTimelineProjectionRowsForItemLocked(companyID, itemID string) []ProjectManagementTimelineProjectionRow {
	row, ok := r.projectTimelineProjection[projectManagementTimelineItemMemoryKey(companyID, itemID)]
	if !ok {
		return nil
	}
	return []ProjectManagementTimelineProjectionRow{cloneProjectManagementTimelineProjectionRow(row)}
}

func (r *MemoryRepo) projectManagementTimelineProjectionRowsForEntityLocked(companyID, userID, entityType, entityID string) []ProjectManagementTimelineProjectionRow {
	items := make([]ProjectManagementTimelineProjectionRow, 0)
	for _, row := range r.projectTimelineProjection {
		if row.CompanyID == companyID && row.UserID == userID && row.ResourceType == entityType && row.ResourceID == entityID {
			items = append(items, cloneProjectManagementTimelineProjectionRow(row))
		}
	}
	sortProjectManagementTimelineRows(items)
	return items
}

func (r *MemoryRepo) projectManagementTimelineProjectionRowsForResourceLocked(companyID, entityType, entityID string) []ProjectManagementTimelineProjectionRow {
	items := make([]ProjectManagementTimelineProjectionRow, 0)
	for _, row := range r.projectTimelineProjection {
		if row.CompanyID == companyID && row.ResourceType == entityType && row.ResourceID == entityID {
			items = append(items, cloneProjectManagementTimelineProjectionRow(row))
		}
	}
	sortProjectManagementTimelineRows(items)
	return items
}

func (r *MemoryRepo) projectManagementTimelineItemIDForEntityLocked(companyID, userID, entityType, entityID string) string {
	for _, item := range r.projectTimelineItems {
		if item.CompanyID == companyID && item.UserID == userID && item.EntityType == entityType && item.EntityID == entityID {
			return item.ItemID
		}
	}
	return ""
}

func sortProjectManagementTimelineRows(items []ProjectManagementTimelineProjectionRow) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].StartDate != items[j].StartDate {
			return items[i].StartDate < items[j].StartDate
		}
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		left := strings.ToLower(strings.TrimSpace(items[i].DisplayTitle))
		right := strings.ToLower(strings.TrimSpace(items[j].DisplayTitle))
		if left != right {
			return left < right
		}
		return items[i].ItemID < items[j].ItemID
	})
}

func projectManagementEndDate(startDate string, durationDays int) string {
	startDate = strings.TrimSpace(startDate)
	parsed, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return startDate
	}
	durationDays = NormalizeProjectManagementDurationDays(durationDays)
	return parsed.AddDate(0, 0, durationDays-1).Format("2006-01-02")
}
