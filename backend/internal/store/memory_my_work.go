package store

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

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
	if r.effectiveAccessErr != nil {
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
	ordering, orderingTerms := myWorkEffectiveOrdering(query)
	actionTerms := append(append([]myWorkGroupingTerm{}, groupingTerms...), orderingTerms...)
	type row struct {
		item           domain.MyWorkActionItem
		colorRank      int
		colorKey       string
		huddleNull     bool
		huddleSortName string
		huddleID       string
		dateNull       bool
		date           string
		personSortName string
	}
	rows := make([]row, 0)
	for _, entity := range r.entities {
		if entity.CompanyID != query.CompanyID || entity.EntityTypeID != ActionItemEntityTypeID {
			continue
		}
		fields := r.memoryActionItemFieldsLocked(entity.CompanyID, entity.EntityID)
		matchesPerspective := (query.Perspective == MyWorkActionItemPerspectiveMine && fields.personInCharge == query.UserID) ||
			(query.Perspective == MyWorkActionItemPerspectiveDelegated && fields.assignedBy == query.UserID && fields.personInCharge != "" && fields.personInCharge != query.UserID)
		if !matchesPerspective || myWorkStatusDone(fields.status) != query.History {
			continue
		}
		person, _ := r.memoryUserByIDLocked(fields.personInCharge)
		personName := myWorkPersonInChargeName(person.DisplayName, person.Email, fields.personInCharge)
		assignedBy, _ := r.memoryUserByIDLocked(fields.assignedBy)
		assignedByName := myWorkPersonInChargeName(assignedBy.DisplayName, assignedBy.Email, fields.assignedBy)
		source, huddleProcess := r.memoryMyWorkActionItemContextLocked(query.CompanyID, query.ViewerUserID, fields.sourceResourceType, fields.sourceResourceID)
		item := domain.MyWorkActionItem{
			EntityID:                 entity.EntityID,
			Name:                     entity.Name,
			PersonInChargeUserID:     fields.personInCharge,
			PersonInChargeName:       personName,
			AssignedByUserID:         fields.assignedBy,
			AssignedByName:           assignedByName,
			CreatedTimestamp:         entity.CreatedTimestamp,
			Source:                   source,
			HuddleProcess:            huddleProcess,
			CompletionDueDateFieldID: fields.completionDueDateFieldID,
			Status:                   fields.status,
		}
		if query.History {
			completed := fields.statusUpdatedTimestamp
			if completed.IsZero() {
				completed = entity.UpdatedTimestamp
			}
			item.CompletedTimestamp = &completed
		}
		if fields.color != "" {
			item.Color = stringPointer(fields.color)
		}
		if fields.analysisDueDate != "" {
			item.AnalysisDueDate = stringPointer(fields.analysisDueDate)
		}
		if fields.completionDueDate != "" {
			item.CompletionDueDate = stringPointer(fields.completionDueDate)
		}
		huddleSortName, huddleID := "", ""
		if huddleProcess != nil {
			huddleSortName = strings.ToLower(strings.TrimSpace(huddleProcess.Name))
			huddleID = huddleProcess.HuddleLogicGateID
		}
		rows = append(rows, row{
			item: item, colorRank: myWorkColorRank(fields.color), colorKey: fields.color,
			huddleNull: huddleProcess == nil, huddleSortName: huddleSortName, huddleID: huddleID,
			dateNull: fields.completionDueDate == "", date: fields.completionDueDate,
			personSortName: myWorkPersonInChargeSortName(personName),
		})
	}
	if query.History {
		sort.Slice(rows, func(i, j int) bool {
			return compareMyWorkHistoryItems(
				*rows[i].item.CompletedTimestamp, rows[i].item.EntityID,
				*rows[j].item.CompletedTimestamp, rows[j].item.EntityID,
			) < 0
		})
	} else {
		sort.Slice(rows, func(i, j int) bool {
			return compareMyWorkActionValues(myWorkActionSortValueFromRow(
				rows[i].colorRank, rows[i].colorKey, rows[i].huddleNull, rows[i].huddleSortName, rows[i].huddleID, rows[i].dateNull, rows[i].date, rows[i].personSortName, rows[i].item.PersonInChargeUserID, rows[i].item.EntityID,
			), myWorkActionSortValueFromRow(
				rows[j].colorRank, rows[j].colorKey, rows[j].huddleNull, rows[j].huddleSortName, rows[j].huddleID, rows[j].dateNull, rows[j].date, rows[j].personSortName, rows[j].item.PersonInChargeUserID, rows[j].item.EntityID,
			), actionTerms) < 0
		})
	}
	if query.Cursor != "" {
		filtered := rows[:0]
		for _, item := range rows {
			if (query.History && myWorkHistoryItemAfter(*item.item.CompletedTimestamp, item.item.EntityID, cursor)) ||
				(!query.History && compareMyWorkActionCursor(myWorkActionSortValueFromRow(item.colorRank, item.colorKey, item.huddleNull, item.huddleSortName, item.huddleID, item.dateNull, item.date, item.personSortName, item.item.PersonInChargeUserID, item.item.EntityID), cursor, actionTerms) > 0) {
				filtered = append(filtered, item)
			}
		}
		rows = filtered
	}
	page := domain.MyWorkActionItemPage{Perspective: query.Perspective, Items: []domain.MyWorkActionItem{}}
	page.HasMore = len(rows) > query.Limit
	if page.HasMore {
		rows = rows[:query.Limit]
	}
	for _, item := range rows {
		page.Items = append(page.Items, item.item)
	}
	if page.HasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		if query.History {
			page.NextCursor = encodeMyWorkCursor(query, myWorkCursor{Section: MyWorkSectionActionItems, Perspective: query.Perspective, History: true, CompletedTimestamp: last.item.CompletedTimestamp.Format(time.RFC3339Nano), ResourceID: last.item.EntityID})
		} else {
			nextCursor := myWorkCursor{Section: MyWorkSectionActionItems, Perspective: query.Perspective, Grouping: grouping, Ordering: ordering, GroupNull: last.colorKey == "", GroupInt: last.colorRank, GroupText: last.colorKey, DateNull: last.dateNull, Date: last.date, ResourceID: last.item.EntityID}
			if myWorkGroupingHasField(actionTerms, MyWorkActionItemGroupingPersonInCharge) {
				nextCursor.PersonInChargeName = last.personSortName
				nextCursor.PersonInChargeID = last.item.PersonInChargeUserID
			}
			if myWorkGroupingHasField(actionTerms, MyWorkActionItemGroupingHuddleProcess) {
				nextCursor.HuddleProcessNull = last.huddleNull
				nextCursor.HuddleProcessName = last.huddleSortName
				nextCursor.HuddleProcessID = last.huddleID
			}
			page.NextCursor = encodeMyWorkCursor(query, nextCursor)
		}
	}
	return page
}

type memoryActionItemFields struct {
	personInCharge           string
	assignedBy               string
	analysisDueDate          string
	completionDueDate        string
	status                   string
	color                    string
	sourceResourceType       string
	sourceResourceID         string
	completionDueDateFieldID string
	statusUpdatedTimestamp   time.Time
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
		case ActionItemAssignedByFieldTypeID:
			result.assignedBy = cleanUUIDText(value)
		case ActionItemAnalysisDueDateFieldTypeID:
			result.analysisDueDate = strings.TrimSpace(value)
		case ActionItemCompletionDueDateFieldTypeID:
			result.completionDueDate = strings.TrimSpace(value)
			result.completionDueDateFieldID = field.EntityFieldID
		case ActionItemStatusFieldTypeID:
			result.status = value
			result.statusUpdatedTimestamp = field.UpdatedTimestamp
		case ActionItemColorFieldTypeID:
			result.color = strings.ToLower(strings.TrimSpace(value))
		case ActionItemSourceFieldTypeID:
			result.sourceResourceType, result.sourceResourceID, _ = decodeActionItemSourceValue(field.Value)
		}
	}
	return result
}

func (r *MemoryRepo) memoryMyWorkActionItemContextLocked(companyID, viewerUserID, resourceType, resourceID string) (*domain.ActionItemSourceView, *domain.MyWorkHuddleProcessReference) {
	resourceType, valid := NormalizeActionItemSourceResourceType(resourceType)
	resourceID = cleanUUIDText(resourceID)
	if !valid || resourceID == "" {
		return nil, nil
	}
	name, accessType, accessID, parentResourceID, huddleProcessID := "", resourceType, resourceID, "", ""
	switch resourceType {
	case EntityTypeNode:
		item, ok := r.nodes[key(companyID, resourceID)]
		if !ok {
			return nil, nil
		}
		name = item.Title
	case EntityTypeLogicGate:
		item, ok := r.logicGates[key(companyID, resourceID)]
		if !ok {
			return nil, nil
		}
		name = item.Header
	case EntityTypeProject:
		item, ok := r.projects[key(companyID, resourceID)]
		if !ok {
			return nil, nil
		}
		name = item.Name
	case EntityTypeHuddleNode:
		item, ok := r.huddleNodes[key(companyID, resourceID)]
		if !ok {
			return nil, nil
		}
		name = item.Name
		huddleProcessID = item.HuddleLogicGateID
	case EntityTypeHuddleLogicGate:
		item, ok := r.huddleLogicGates[key(companyID, resourceID)]
		if !ok {
			return nil, nil
		}
		name = item.Header
		huddleProcessID = item.HuddleLogicGateID
	case EntityTypeKPI:
		item, ok := r.kpis[key(companyID, resourceID)]
		if !ok {
			return nil, nil
		}
		name = item.Name
		accessType, accessID, parentResourceID = EntityTypeLogicGate, item.LogicGateID, item.LogicGateID
	}
	var source *domain.ActionItemSourceView
	if r.userHasEffectiveAccessLocked(companyID, viewerUserID, accessType, accessID, EntityPermissionEdit) {
		source = &domain.ActionItemSourceView{ResourceType: resourceType, ResourceID: resourceID, Name: name, ParentResourceID: parentResourceID}
	}
	var huddleProcess *domain.MyWorkHuddleProcessReference
	if source != nil && huddleProcessID != "" {
		if item, ok := r.huddleLogicGates[key(companyID, huddleProcessID)]; ok && r.userHasEffectiveAccessLocked(companyID, viewerUserID, EntityTypeHuddleLogicGate, huddleProcessID, EntityPermissionEdit) {
			huddleProcess = &domain.MyWorkHuddleProcessReference{HuddleLogicGateID: item.HuddleLogicGateID, Name: item.Header}
		}
	}
	return source, huddleProcess
}

func (r *MemoryRepo) memoryMyWorkNodesLocked(query MyWorkQuery, cursor myWorkCursor) domain.MyWorkNodePage {
	grouping, groupingTerms := myWorkEffectiveGrouping(query, MyWorkSectionNodes)
	rows := make([]domain.MyWorkNode, 0)
	for _, node := range r.nodes {
		if node.CompanyID != query.CompanyID {
			continue
		}
		node = r.withDerivedNodeStatusLocked(node)
		if myWorkStatusDone(myWorkOptionalString(node.Status)) != query.History {
			continue
		}
		if !r.gvicEffectiveUserHasRoleLocked(query.CompanyID, EntityTypeNode, node.NodeID, query.UserID, query.Role) {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeNode, node.NodeID, EntityPermissionEdit) {
			continue
		}
		item := domain.MyWorkNode{NodeID: node.NodeID, Name: node.Title, Priority: cloneIntPointer(node.Priority), DueDate: cloneStringPointer(node.DueDate)}
		if query.History {
			completed := node.CreatedTimestamp
			if transitionTimestamp, ok := r.nodeCompletionTransitions[key(query.CompanyID, node.NodeID)]; ok {
				completed = transitionTimestamp
			}
			item.CompletedTimestamp = &completed
		}
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
		if query.Cursor == "" || (query.History && myWorkHistoryItemAfter(*item.CompletedTimestamp, item.NodeID, cursor)) || (!query.History && compareMyWorkNodeCursor(item, cursor, groupingTerms) > 0) {
			rows = append(rows, item)
		}
	}
	if query.History {
		sort.Slice(rows, func(i, j int) bool {
			return compareMyWorkHistoryItems(*rows[i].CompletedTimestamp, rows[i].NodeID, *rows[j].CompletedTimestamp, rows[j].NodeID) < 0
		})
	} else {
		sort.Slice(rows, func(i, j int) bool { return compareMyWorkNodes(rows[i], rows[j], groupingTerms) < 0 })
	}
	page := domain.MyWorkNodePage{Role: query.Role, Items: []domain.MyWorkNode{}}
	page.HasMore = len(rows) > query.Limit
	if page.HasMore {
		rows = rows[:query.Limit]
	}
	page.Items = append(page.Items, rows...)
	if page.HasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		if query.History {
			page.NextCursor = encodeMyWorkCursor(query, myWorkCursor{Section: MyWorkSectionNodes, Role: query.Role, History: true, CompletedTimestamp: last.CompletedTimestamp.Format(time.RFC3339Nano), ResourceID: last.NodeID})
		} else {
			page.NextCursor = encodeMyWorkCursor(query, myWorkCursor{Section: MyWorkSectionNodes, Role: query.Role, Grouping: grouping, GroupNull: last.Priority == nil, GroupInt: myWorkOptionalInt(last.Priority), DateNull: last.DueDate == nil, Date: myWorkOptionalString(last.DueDate), ResourceID: last.NodeID})
		}
	}
	return page
}

func (r *MemoryRepo) memoryMyWorkProcessesLocked(query MyWorkQuery, cursor myWorkCursor) domain.MyWorkProcessPage {
	items := make([]domain.MyWorkProcess, 0)
	countsByLogicGateID := map[string]domain.RACITabStatusCounts{}
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID != query.CompanyID || !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeNode, assignment.NodeID, EntityPermissionEdit) {
			continue
		}
		counts := countsByLogicGateID[assignment.LogicGateID]
		addRACITabStatusCounts(&counts, raciTabCountsForStatus(assignment.StatusKey))
		countsByLogicGateID[assignment.LogicGateID] = counts
	}
	for _, gate := range r.logicGates {
		if gate.CompanyID != query.CompanyID || !r.gvicEffectiveUserHasRoleLocked(query.CompanyID, EntityTypeLogicGate, gate.LogicGateID, query.UserID, query.Role) {
			continue
		}
		if !r.userHasEffectiveAccessLocked(query.CompanyID, query.ViewerUserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit) {
			continue
		}
		item := domain.MyWorkProcess{
			LogicGateID:  gate.LogicGateID,
			Name:         gate.Header,
			StatusCounts: countsByLogicGateID[gate.LogicGateID],
		}
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
		page.NextCursor = encodeMyWorkCursor(query, myWorkCursor{Section: MyWorkSectionProcesses, Role: query.Role, Name: strings.ToLower(last.Name), ResourceID: last.LogicGateID})
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
		page.NextCursor = encodeMyWorkCursor(query, myWorkCursor{Section: MyWorkSectionProjects, Name: strings.ToLower(last.Name), ResourceID: last.ProjectID})
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

type myWorkActionSortValue struct {
	colorRank      int
	colorKey       string
	huddleNull     bool
	huddleSortName string
	huddleID       string
	dateNull       bool
	date           string
	personSortName string
	personUserID   string
	resourceID     string
}

func myWorkActionSortValueFromRow(colorRank int, colorKey string, huddleNull bool, huddleSortName, huddleID string, dateNull bool, date, personSortName, personUserID, resourceID string) myWorkActionSortValue {
	return myWorkActionSortValue{colorRank: colorRank, colorKey: colorKey, huddleNull: huddleNull, huddleSortName: huddleSortName, huddleID: huddleID, dateNull: dateNull, date: date, personSortName: personSortName, personUserID: personUserID, resourceID: resourceID}
}

func compareMyWorkActionCursor(left myWorkActionSortValue, cursor myWorkCursor, terms []myWorkGroupingTerm) int {
	right := myWorkActionSortValueFromRow(cursor.GroupInt, cursor.GroupText, cursor.HuddleProcessNull, cursor.HuddleProcessName, cursor.HuddleProcessID, cursor.DateNull, cursor.Date, cursor.PersonInChargeName, cursor.PersonInChargeID, cursor.ResourceID)
	return compareMyWorkActionValues(left, right, terms)
}

func compareMyWorkActionValues(left, right myWorkActionSortValue, terms []myWorkGroupingTerm) int {
	for _, term := range terms {
		var comparison int
		switch term.Field {
		case MyWorkActionItemGroupingColor:
			leftNull, rightNull := left.colorKey == "", right.colorKey == ""
			if leftNull != rightNull {
				if leftNull {
					return 1
				}
				return -1
			}
			if !leftNull {
				comparison = compareInts(left.colorRank, right.colorRank)
				if comparison == 0 {
					comparison = strings.Compare(left.colorKey, right.colorKey)
				}
			}
		case MyWorkActionItemGroupingHuddleProcess:
			if left.huddleNull != right.huddleNull {
				if left.huddleNull {
					return 1
				}
				return -1
			}
			if !left.huddleNull {
				comparison = strings.Compare(left.huddleSortName, right.huddleSortName)
				if comparison == 0 {
					comparison = strings.Compare(left.huddleID, right.huddleID)
				}
			}
		case MyWorkActionItemGroupingCompletionDueDate:
			if left.dateNull != right.dateNull {
				if left.dateNull {
					return 1
				}
				return -1
			}
			if !left.dateNull {
				comparison = strings.Compare(left.date, right.date)
			}
		case MyWorkActionItemGroupingPersonInCharge:
			comparison = strings.Compare(left.personSortName, right.personSortName)
			if comparison == 0 {
				comparison = strings.Compare(left.personUserID, right.personUserID)
			}
		}
		if comparison != 0 {
			if term.Direction == "desc" {
				return -comparison
			}
			return comparison
		}
	}
	return strings.Compare(left.resourceID, right.resourceID)
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
