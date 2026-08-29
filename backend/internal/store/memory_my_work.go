package store

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"miraeopus/backend/internal/domain"
)

func (r *MemoryRepo) GetMyWork(ctx context.Context, query MyWorkQuery) (domain.MyWorkResponse, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return domain.MyWorkResponse{}, err
	}
	query, cursor, err := normalizeMyWorkQuery(query)
	if err != nil {
		return domain.MyWorkResponse{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return domain.MyWorkResponse{}, err
	}
	if query.Section != MyWorkSectionActionItems && r.effectiveAccessErr != nil {
		return domain.MyWorkResponse{}, r.effectiveAccessErr
	}

	response := domain.MyWorkResponse{CompanyID: query.CompanyID, UserID: query.UserID}
	if myWorkIncludesSection(query, MyWorkSectionActionItems) {
		page := r.memoryMyWorkActionItemsLocked(query, cursor)
		response.ActionItems = &page
	}
	if myWorkIncludesSection(query, MyWorkSectionNodes) {
		page := r.memoryMyWorkNodesLocked(query, cursor)
		response.Nodes = &page
	}
	if myWorkIncludesSection(query, MyWorkSectionProcesses) {
		page := r.memoryMyWorkProcessesLocked(query, cursor)
		response.Processes = &page
	}
	if myWorkIncludesSection(query, MyWorkSectionProjects) {
		page := r.memoryMyWorkProjectsLocked(query, cursor)
		response.Projects = &page
	}
	return response, nil
}

func (r *MemoryRepo) memoryMyWorkActionItemsLocked(query MyWorkQuery, cursor myWorkCursor) domain.MyWorkActionItemPage {
	grouping, groupingTerms := myWorkEffectiveGrouping(query, MyWorkSectionActionItems)
	type row struct {
		item      domain.MyWorkActionItem
		colorRank int
		colorKey  string
		dateNull  bool
		date      string
	}
	rows := make([]row, 0)
	for _, entity := range r.entities {
		if entity.CompanyID != query.CompanyID || entity.EntityTypeID != ActionItemEntityTypeID {
			continue
		}
		fields := r.memoryActionItemFieldsLocked(entity.CompanyID, entity.EntityID)
		if fields.personInCharge != query.UserID || myWorkStatusDone(fields.status) {
			continue
		}
		item := domain.MyWorkActionItem{EntityID: entity.EntityID, Name: entity.Name}
		if fields.color != "" {
			item.Color = stringPointer(fields.color)
		}
		if fields.completionDueDate != "" {
			item.CompletionDueDate = stringPointer(fields.completionDueDate)
		}
		rows = append(rows, row{item: item, colorRank: myWorkColorRank(fields.color), colorKey: fields.color, dateNull: fields.completionDueDate == "", date: fields.completionDueDate})
	}
	sort.Slice(rows, func(i, j int) bool {
		return compareMyWorkActionValues(
			rows[i].colorRank, rows[i].colorKey, rows[i].dateNull, rows[i].date, rows[i].item.EntityID,
			rows[j].colorRank, rows[j].colorKey, rows[j].dateNull, rows[j].date, rows[j].item.EntityID,
			groupingTerms,
		) < 0
	})
	if query.Cursor != "" {
		filtered := rows[:0]
		for _, item := range rows {
			if compareMyWorkActionCursor(item.colorRank, item.colorKey, item.dateNull, item.date, item.item.EntityID, cursor, groupingTerms) > 0 {
				filtered = append(filtered, item)
			}
		}
		rows = filtered
	}
	page := domain.MyWorkActionItemPage{Items: []domain.MyWorkActionItem{}}
	page.HasMore = len(rows) > query.Limit
	if page.HasMore {
		rows = rows[:query.Limit]
	}
	for _, item := range rows {
		page.Items = append(page.Items, item.item)
	}
	if page.HasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionActionItems, Grouping: grouping, GroupNull: last.colorKey == "", GroupInt: last.colorRank, GroupText: last.colorKey, DateNull: last.dateNull, Date: last.date, ResourceID: last.item.EntityID})
	}
	return page
}

type memoryActionItemFields struct {
	personInCharge    string
	completionDueDate string
	status            string
	color             string
}

func (r *MemoryRepo) memoryActionItemFieldsLocked(companyID, entityID string) memoryActionItemFields {
	result := memoryActionItemFields{}
	for _, field := range r.entityFields {
		if field.CompanyID != companyID || field.EntityID != entityID || field.EntityFieldTypeID == nil {
			continue
		}
		value := myWorkJSONText(field.Value)
		switch *field.EntityFieldTypeID {
		case ActionItemPersonInChargeFieldTypeID:
			result.personInCharge = cleanUUIDText(value)
		case ActionItemCompletionDueDateFieldTypeID:
			result.completionDueDate = strings.TrimSpace(value)
		case ActionItemStatusFieldTypeID:
			result.status = value
		case ActionItemColorFieldTypeID:
			result.color = strings.ToLower(strings.TrimSpace(value))
		}
	}
	return result
}

func (r *MemoryRepo) memoryMyWorkNodesLocked(query MyWorkQuery, cursor myWorkCursor) domain.MyWorkNodePage {
	grouping, groupingTerms := myWorkEffectiveGrouping(query, MyWorkSectionNodes)
	rows := make([]domain.MyWorkNode, 0)
	for _, node := range r.nodes {
		if node.CompanyID != query.CompanyID {
			continue
		}
		node = r.withDerivedNodeStatusLocked(node)
		if myWorkStatusDone(myWorkOptionalString(node.Status)) {
			continue
		}
		if !r.gvicEffectiveUserHasRoleLocked(query.CompanyID, EntityTypeNode, node.NodeID, query.UserID, domain.RACIRoleResponsible) {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeNode, node.NodeID, EntityPermissionEdit) {
			continue
		}
		item := domain.MyWorkNode{NodeID: node.NodeID, Name: node.Title, Priority: cloneIntPointer(node.Priority), DueDate: cloneStringPointer(node.DueDate)}
		assignments := make([]domain.NodeLogicGateAssignment, 0, 1)
		for _, assignment := range r.nodeLogicGateAssignments {
			if assignment.CompanyID != query.CompanyID || assignment.NodeID != node.NodeID {
				continue
			}
			assignments = append(assignments, assignment)
		}
		sort.Slice(assignments, func(i, j int) bool {
			if !assignments[i].CreatedTimestamp.Equal(assignments[j].CreatedTimestamp) {
				return assignments[i].CreatedTimestamp.Before(assignments[j].CreatedTimestamp)
			}
			return assignments[i].AssignmentID < assignments[j].AssignmentID
		})
		for _, assignment := range assignments {
			if gate, ok := r.logicGates[key(query.CompanyID, assignment.LogicGateID)]; ok && r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit) {
				item.Process = &domain.MyWorkProcessReference{LogicGateID: gate.LogicGateID, Name: gate.Header}
				break
			}
		}
		relationships := make([]domain.ProjectRelationship, 0, 1)
		for _, relationship := range r.projectRelationships {
			if relationship.CompanyID != query.CompanyID || relationship.ResourceType != EntityTypeNode || relationship.ResourceID != node.NodeID {
				continue
			}
			relationships = append(relationships, relationship)
		}
		sort.Slice(relationships, func(i, j int) bool {
			if relationships[i].Position != relationships[j].Position {
				return relationships[i].Position < relationships[j].Position
			}
			if !relationships[i].CreatedTimestamp.Equal(relationships[j].CreatedTimestamp) {
				return relationships[i].CreatedTimestamp.Before(relationships[j].CreatedTimestamp)
			}
			return relationships[i].RelationshipID < relationships[j].RelationshipID
		})
		for _, relationship := range relationships {
			if project, ok := r.projects[key(query.CompanyID, relationship.ProjectID)]; ok && r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeProject, project.ProjectID, EntityPermissionEdit) {
				item.Project = &domain.MyWorkProjectReference{ProjectID: project.ProjectID, Name: project.Name}
				break
			}
		}
		if query.Cursor == "" || compareMyWorkNodeCursor(item, cursor, groupingTerms) > 0 {
			rows = append(rows, item)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return compareMyWorkNodes(rows[i], rows[j], groupingTerms) < 0 })
	page := domain.MyWorkNodePage{Items: []domain.MyWorkNode{}}
	page.HasMore = len(rows) > query.Limit
	if page.HasMore {
		rows = rows[:query.Limit]
	}
	page.Items = append(page.Items, rows...)
	if page.HasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionNodes, Grouping: grouping, GroupNull: last.Priority == nil, GroupInt: myWorkOptionalInt(last.Priority), DateNull: last.DueDate == nil, Date: myWorkOptionalString(last.DueDate), ResourceID: last.NodeID})
	}
	return page
}

func (r *MemoryRepo) memoryMyWorkProcessesLocked(query MyWorkQuery, cursor myWorkCursor) domain.MyWorkProcessPage {
	items := make([]domain.MyWorkProcess, 0)
	for _, gate := range r.logicGates {
		if gate.CompanyID != query.CompanyID || !r.gvicEffectiveUserHasRoleLocked(query.CompanyID, EntityTypeLogicGate, gate.LogicGateID, query.UserID, query.Role) {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit) {
			continue
		}
		item := domain.MyWorkProcess{LogicGateID: gate.LogicGateID, Name: gate.Header}
		if query.Cursor == "" || compareMyWorkNamedCursor(strings.ToLower(item.Name), item.LogicGateID, cursor) > 0 {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		left, right := strings.ToLower(items[i].Name), strings.ToLower(items[j].Name)
		return left < right || (left == right && items[i].LogicGateID < items[j].LogicGateID)
	})
	page := domain.MyWorkProcessPage{Role: query.Role, Items: []domain.MyWorkProcess{}}
	page.HasMore = len(items) > query.Limit
	if page.HasMore {
		items = items[:query.Limit]
	}
	page.Items = append(page.Items, items...)
	if page.HasMore && len(items) > 0 {
		last := items[len(items)-1]
		page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionProcesses, Role: query.Role, Name: strings.ToLower(last.Name), ResourceID: last.LogicGateID})
	}
	return page
}

func (r *MemoryRepo) memoryMyWorkProjectsLocked(query MyWorkQuery, cursor myWorkCursor) domain.MyWorkProjectPage {
	items := make([]domain.MyWorkProject, 0)
	for _, project := range r.projects {
		if project.CompanyID != query.CompanyID || !r.memoryUserIsProjectTeamMemberLocked(query.CompanyID, project.ProjectID, query.UserID) {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeProject, project.ProjectID, EntityPermissionEdit) {
			continue
		}
		item := domain.MyWorkProject{ProjectID: project.ProjectID, Name: project.Name}
		if query.Cursor == "" || compareMyWorkNamedCursor(strings.ToLower(item.Name), item.ProjectID, cursor) > 0 {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		left, right := strings.ToLower(items[i].Name), strings.ToLower(items[j].Name)
		return left < right || (left == right && items[i].ProjectID < items[j].ProjectID)
	})
	page := domain.MyWorkProjectPage{Items: []domain.MyWorkProject{}}
	page.HasMore = len(items) > query.Limit
	if page.HasMore {
		items = items[:query.Limit]
	}
	page.Items = append(page.Items, items...)
	if page.HasMore && len(items) > 0 {
		last := items[len(items)-1]
		page.NextCursor = encodeMyWorkCursor(myWorkCursor{Section: MyWorkSectionProjects, Name: strings.ToLower(last.Name), ResourceID: last.ProjectID})
	}
	return page
}

func (r *MemoryRepo) memoryUserIsProjectTeamMemberLocked(companyID, projectID, userID string) bool {
	for assignmentKey := range r.projectTeamAssignments {
		assignmentCompanyID, assignmentProjectID, teamID, ok := splitProjectAssignmentKey(assignmentKey)
		if ok && assignmentCompanyID == companyID && assignmentProjectID == projectID {
			if _, member := r.userGroupPermissionDepthLocked(companyID, userID, teamID); member {
				return true
			}
		}
	}
	return false
}

func myWorkJSONText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	return value
}

func myWorkColorRank(color string) int {
	switch strings.ToLower(strings.TrimSpace(color)) {
	case ActionItemColorRed:
		return 0
	case ActionItemColorYellow:
		return 1
	case "":
		return 3
	default:
		return 2
	}
}

func compareMyWorkActionCursor(colorRank int, colorKey string, dateNull bool, date, resourceID string, cursor myWorkCursor, grouping []myWorkGroupingTerm) int {
	return compareMyWorkActionValues(
		colorRank, colorKey, dateNull, date, resourceID,
		cursor.GroupInt, cursor.GroupText, cursor.DateNull, cursor.Date, cursor.ResourceID,
		grouping,
	)
}

func compareMyWorkActionValues(leftRank int, leftColor string, leftDateNull bool, leftDate, leftID string, rightRank int, rightColor string, rightDateNull bool, rightDate, rightID string, grouping []myWorkGroupingTerm) int {
	for _, term := range grouping {
		var comparison int
		switch term.Field {
		case MyWorkActionItemGroupingColor:
			leftNull, rightNull := leftColor == "", rightColor == ""
			if leftNull != rightNull {
				if leftNull {
					return 1
				}
				return -1
			}
			if !leftNull {
				comparison = compareInts(leftRank, rightRank)
				if comparison == 0 {
					comparison = strings.Compare(leftColor, rightColor)
				}
			}
		case MyWorkActionItemGroupingCompletionDueDate:
			if leftDateNull != rightDateNull {
				if leftDateNull {
					return 1
				}
				return -1
			}
			if !leftDateNull {
				comparison = strings.Compare(leftDate, rightDate)
			}
		}
		if comparison != 0 {
			if term.Direction == "desc" {
				return -comparison
			}
			return comparison
		}
	}
	return strings.Compare(leftID, rightID)
}

func compareMyWorkNodes(left, right domain.MyWorkNode, grouping []myWorkGroupingTerm) int {
	for _, term := range grouping {
		var comparison int
		switch term.Field {
		case MyWorkNodeGroupingPriority:
			if (left.Priority == nil) != (right.Priority == nil) {
				if left.Priority == nil {
					return 1
				}
				return -1
			}
			if left.Priority != nil {
				comparison = compareInts(myWorkOptionalInt(left.Priority), myWorkOptionalInt(right.Priority))
			}
		case MyWorkNodeGroupingDueDate:
			if (left.DueDate == nil) != (right.DueDate == nil) {
				if left.DueDate == nil {
					return 1
				}
				return -1
			}
			if left.DueDate != nil {
				comparison = strings.Compare(myWorkOptionalString(left.DueDate), myWorkOptionalString(right.DueDate))
			}
		}
		if comparison != 0 {
			if term.Direction == "desc" {
				return -comparison
			}
			return comparison
		}
	}
	return strings.Compare(left.NodeID, right.NodeID)
}

func compareMyWorkNodeCursor(item domain.MyWorkNode, cursor myWorkCursor, grouping []myWorkGroupingTerm) int {
	right := domain.MyWorkNode{NodeID: cursor.ResourceID, Priority: myWorkIntPointer(cursor.GroupInt), DueDate: stringPointer(cursor.Date)}
	if cursor.GroupNull {
		right.Priority = nil
	}
	if cursor.DateNull {
		right.DueDate = nil
	}
	return compareMyWorkNodes(item, right, grouping)
}

func compareMyWorkNamedCursor(name, resourceID string, cursor myWorkCursor) int {
	if name != cursor.Name {
		return strings.Compare(name, cursor.Name)
	}
	return strings.Compare(resourceID, cursor.ResourceID)
}

func compareInts(left, right int) int {
	switch {
	case left < right:
		return -1
	case left > right:
		return 1
	default:
		return 0
	}
}

func myWorkOptionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func myWorkOptionalInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func myWorkIntPointer(value int) *int { return &value }
