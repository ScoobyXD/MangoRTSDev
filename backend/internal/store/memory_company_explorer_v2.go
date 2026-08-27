package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type memoryCompanyExplorerV2Entity struct {
	CompanyID        string
	EntityID         string
	EntityType       string
	ResourceID       string
	Name             string
	DefaultAccess    string
	CreatedTimestamp time.Time
	UpdatedTimestamp time.Time
}

type memoryCompanyExplorerV2Edge struct {
	CompanyID        string
	EdgeID           string
	ParentEntityID   string
	ChildEntityID    string
	Position         int
	CreatedTimestamp time.Time
	UpdatedTimestamp time.Time
}
type memoryCompanyExplorerV2Subscription struct {
	CompanyID        string
	SubscriptionID   string
	OwnerType        string
	OwnerID          string
	AnchorEntityID   string
	Position         int
	CreatedByUserID  string
	CreatedTimestamp time.Time
	UpdatedTimestamp time.Time
}
type memoryCompanyExplorerV2TreeEdge struct {
	CompanyID        string
	EdgeID           string
	ParentEntityID   string
	ChildEntityID    string
	Position         int
	CreatedTimestamp time.Time
	UpdatedTimestamp time.Time
	SourcePriority   int
}

func (r *MemoryRepo) ListCompanyExplorerV2RootRows(query CompanyExplorerV2RowsQuery) (CompanyExplorerV2Rows, error) {
	query, err := normalizeCompanyExplorerV2RowsQuery(query, false)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	r.ensureCompanyExplorerV2CompanyGraphLocked(query.CompanyID)
	return r.listCompanyExplorerV2RootRowsLocked(query), nil
}

func (r *MemoryRepo) ListCompanyExplorerV2ChildRows(query CompanyExplorerV2RowsQuery) (CompanyExplorerV2Rows, error) {
	query, err := normalizeCompanyExplorerV2RowsQuery(query, true)
	if err != nil {
		return CompanyExplorerV2Rows{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	r.ensureCompanyExplorerV2CompanyGraphLocked(query.CompanyID)
	parent, ok := r.companyExplorerV2Entities[key(query.CompanyID, query.ParentEntityID)]
	if !ok || !r.companyExplorerV2EntityVisibleLocked(query, parent) {
		return CompanyExplorerV2Rows{}, ErrNotFound
	}
	if parent.EntityType == CompanyExplorerV2EntityCompany {
		return r.listCompanyExplorerV2RootRowsLocked(query), nil
	}
	if parent.EntityType != CompanyExplorerV2EntityFolder {
		return CompanyExplorerV2Rows{Rows: []CompanyExplorerV2Row{}}, nil
	}
	rows := CompanyExplorerV2Rows{Rows: []CompanyExplorerV2Row{}}
	for _, edge := range r.companyExplorerV2DirectChildEdgesLocked(query.CompanyID, parent.EntityID) {
		child, ok := r.companyExplorerV2Entities[key(query.CompanyID, edge.ChildEntityID)]
		if !ok || !companyExplorerV2EntityIsFinalTreeRow(child.EntityType) || !r.companyExplorerV2EntityVisibleLocked(query, child) {
			continue
		}
		rowEdge := edge.memoryEdge()
		rows.Rows = append(rows.Rows, r.companyExplorerV2RowLocked(query, child, &rowEdge))
	}
	sortCompanyExplorerV2Rows(rows.Rows)
	return rows, nil
}

func (r *MemoryRepo) listCompanyExplorerV2RootRowsLocked(query CompanyExplorerV2RowsQuery) CompanyExplorerV2Rows {
	rows := CompanyExplorerV2Rows{Rows: []CompanyExplorerV2Row{}}
	companyRootID := companyExplorerV2NativeEntityID(query.CompanyID, CompanyExplorerV2EntityCompany, query.CompanyID)
	for _, edge := range r.companyExplorerV2DirectChildEdgesLocked(query.CompanyID, companyRootID) {
		child, ok := r.companyExplorerV2Entities[key(query.CompanyID, edge.ChildEntityID)]
		if !ok || !companyExplorerV2EntityIsFinalTreeRow(child.EntityType) || !r.companyExplorerV2EntityVisibleLocked(query, child) {
			continue
		}
		rowEdge := edge.memoryEdge()
		row := r.companyExplorerV2RowLocked(query, child, &rowEdge)
		row.ParentEntityID = ""
		rows.Rows = append(rows.Rows, row)
	}
	sortCompanyExplorerV2Rows(rows.Rows)
	return rows
}

func companyExplorerV2EntityIsFinalTreeRow(entityType string) bool {
	switch entityType {
	case CompanyExplorerV2EntityFolder, CompanyExplorerV2EntityProject, CompanyExplorerV2EntityLogicGate, CompanyExplorerV2EntityNode:
		return true
	default:
		return false
	}
}

func (edge memoryCompanyExplorerV2TreeEdge) memoryEdge() memoryCompanyExplorerV2Edge {
	return memoryCompanyExplorerV2Edge{
		CompanyID:        edge.CompanyID,
		EdgeID:           edge.EdgeID,
		ParentEntityID:   edge.ParentEntityID,
		ChildEntityID:    edge.ChildEntityID,
		Position:         edge.Position,
		CreatedTimestamp: edge.CreatedTimestamp,
		UpdatedTimestamp: edge.UpdatedTimestamp,
	}
}

func (r *MemoryRepo) companyExplorerV2DirectChildEdgesLocked(companyID, parentEntityID string) []memoryCompanyExplorerV2TreeEdge {
	edges := make([]memoryCompanyExplorerV2TreeEdge, 0)
	for _, edge := range r.companyExplorerV2DirectTreeEdgesLocked(companyID) {
		if edge.ParentEntityID == parentEntityID {
			edges = append(edges, edge)
		}
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].Position != edges[j].Position {
			return edges[i].Position < edges[j].Position
		}
		if !edges[i].CreatedTimestamp.Equal(edges[j].CreatedTimestamp) {
			return edges[i].CreatedTimestamp.Before(edges[j].CreatedTimestamp)
		}
		return edges[i].ChildEntityID < edges[j].ChildEntityID
	})
	return edges
}

func (r *MemoryRepo) companyExplorerV2DirectTreeEdgesLocked(companyID string) []memoryCompanyExplorerV2TreeEdge {
	bestByParentChild := map[string]memoryCompanyExplorerV2TreeEdge{}
	add := func(candidate memoryCompanyExplorerV2TreeEdge) {
		if candidate.CompanyID != companyID || candidate.ParentEntityID == "" || candidate.ChildEntityID == "" || candidate.ParentEntityID == candidate.ChildEntityID {
			return
		}
		if _, ok := r.companyExplorerV2Entities[key(companyID, candidate.ParentEntityID)]; !ok {
			return
		}
		if _, ok := r.companyExplorerV2Entities[key(companyID, candidate.ChildEntityID)]; !ok {
			return
		}
		edgeKey := key(candidate.ParentEntityID, candidate.ChildEntityID)
		current, ok := bestByParentChild[edgeKey]
		if !ok || candidate.SourcePriority < current.SourcePriority || (candidate.SourcePriority == current.SourcePriority && companyExplorerV2TreeEdgeLess(candidate, current)) {
			bestByParentChild[edgeKey] = candidate
		}
	}
	for _, edge := range r.companyExplorerV2Edges {
		if edge.CompanyID != companyID {
			continue
		}
		add(memoryCompanyExplorerV2TreeEdge{CompanyID: edge.CompanyID, EdgeID: edge.EdgeID, ParentEntityID: edge.ParentEntityID, ChildEntityID: edge.ChildEntityID, Position: edge.Position, CreatedTimestamp: edge.CreatedTimestamp, UpdatedTimestamp: edge.UpdatedTimestamp, SourcePriority: 10})
	}
	edges := make([]memoryCompanyExplorerV2TreeEdge, 0, len(bestByParentChild))
	for _, edge := range bestByParentChild {
		edges = append(edges, edge)
	}
	return edges
}

func companyExplorerV2TreeEdgeLess(left, right memoryCompanyExplorerV2TreeEdge) bool {
	if !left.CreatedTimestamp.Equal(right.CreatedTimestamp) {
		return left.CreatedTimestamp.Before(right.CreatedTimestamp)
	}
	if left.Position != right.Position {
		return left.Position < right.Position
	}
	leftID := left.EdgeID
	if leftID == "" {
		leftID = left.ChildEntityID
	}
	rightID := right.EdgeID
	if rightID == "" {
		rightID = right.ChildEntityID
	}
	return leftID < rightID
}

func (r *MemoryRepo) GetCompanyExplorerV2FolderDefaultAccess(companyID, entityID string) (string, error) {
	companyID = strings.TrimSpace(companyID)
	entityID = strings.TrimSpace(entityID)
	if companyID == "" || entityID == "" {
		return "", ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	r.ensureCompanyExplorerV2CompanyGraphLocked(companyID)
	entity, ok := r.companyExplorerV2Entities[key(companyID, entityID)]
	if !ok || entity.EntityType != CompanyExplorerV2EntityFolder {
		return "", ErrNotFound
	}
	return defaultResourceAccessOrEdit(entity.DefaultAccess), nil
}

func (r *MemoryRepo) GetCompanyExplorerV2Entity(companyID, entityID, permissionUserID string) (CompanyExplorerV2Row, error) {
	companyID = strings.TrimSpace(companyID)
	entityID = strings.TrimSpace(entityID)
	permissionUserID = strings.TrimSpace(permissionUserID)
	if companyID == "" || entityID == "" {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	query := CompanyExplorerV2RowsQuery{
		CompanyID:        companyID,
		View:             CompanyExplorerLazyScopeAll,
		ParentEntityID:   entityID,
		PermissionUserID: permissionUserID,
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ensureCompanyExplorerV2CompanyGraphLocked(companyID)
	entity, ok := r.companyExplorerV2Entities[key(companyID, entityID)]
	if !ok || !r.companyExplorerV2EntityVisibleLocked(query, entity) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	return r.companyExplorerV2RowLocked(query, entity, nil), nil
}

func (r *MemoryRepo) CreateCompanyExplorerV2Folder(input CompanyExplorerV2FolderInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2FolderInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if input.PermissionUserID != "" && !r.userHasCompanyMembershipLocked(input.CompanyID, input.PermissionUserID) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	r.ensureCompanyExplorerV2CompanyGraphLocked(input.CompanyID)
	parent, ok := r.companyExplorerV2Entities[key(input.CompanyID, input.ParentEntityID)]
	if !ok {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if input.PermissionUserID != "" && !r.companyExplorerV2EntityCanEditLocked(input.CompanyID, input.PermissionUserID, parent) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	defaultAccess := input.DefaultAccess
	if defaultAccess == "" {
		defaultAccess = ResourceDefaultAccessEdit
	}
	now := time.Now().UTC()
	entity := memoryCompanyExplorerV2Entity{
		CompanyID:        input.CompanyID,
		EntityID:         newUUIDv7String(),
		EntityType:       CompanyExplorerV2EntityFolder,
		Name:             input.Name,
		DefaultAccess:    defaultAccess,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.companyExplorerV2Entities[key(entity.CompanyID, entity.EntityID)] = entity
	position := input.Position
	if position <= 0 {
		position = r.nextCompanyExplorerV2EdgePositionLocked(input.CompanyID, input.ParentEntityID)
	}
	edge := memoryCompanyExplorerV2Edge{
		CompanyID:        input.CompanyID,
		EdgeID:           companyExplorerV2EdgeID(input.CompanyID, input.ParentEntityID, entity.EntityID),
		ParentEntityID:   input.ParentEntityID,
		ChildEntityID:    entity.EntityID,
		Position:         position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.companyExplorerV2Edges[key(edge.CompanyID, edge.EdgeID)] = edge

	r.shadowCompanyExplorerV2FolderToLegacyLocked(parent, entity, edge)
	var mapParentID *string
	if parent.EntityType == CompanyExplorerV2EntityFolder {
		parentID := parent.EntityID
		mapParentID = &parentID
	}
	r.syncAutomaticMemoryProcessMapPlacementLocked(input.CompanyID, domain.ProcessMapResourceTypeFolder, entity.EntityID, mapParentID)
	if parent.EntityType == CompanyExplorerV2EntityFolder {
		entity = r.companyExplorerV2Entities[key(entity.CompanyID, entity.EntityID)]
	}
	return r.companyExplorerV2RowLocked(CompanyExplorerV2RowsQuery{CompanyID: input.CompanyID, PermissionUserID: input.PermissionUserID}, entity, &edge), nil
}

func (r *MemoryRepo) UpsertCompanyExplorerV2Edge(input CompanyExplorerV2EdgeInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2EdgeInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if input.PermissionUserID != "" && !r.userHasCompanyMembershipLocked(input.CompanyID, input.PermissionUserID) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	r.ensureCompanyExplorerV2CompanyGraphLocked(input.CompanyID)
	parent, ok := r.companyExplorerV2Entities[key(input.CompanyID, input.ParentEntityID)]
	if !ok {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if input.PermissionUserID != "" && !r.companyExplorerV2EntityCanEditLocked(input.CompanyID, input.PermissionUserID, parent) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if parent.EntityType != CompanyExplorerV2EntityCompany && parent.EntityType != CompanyExplorerV2EntityFolder {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	child, ok := r.companyExplorerV2Entities[key(input.CompanyID, input.ChildEntityID)]
	if !ok {
		child, ok = r.companyExplorerV2EntityForNativeLocked(input.CompanyID, input.ChildEntityType, input.ChildResourceID)
	}
	if !ok || (input.PermissionUserID != "" && !r.companyExplorerV2EntityCanEditLocked(input.CompanyID, input.PermissionUserID, child)) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if child.EntityType != CompanyExplorerV2EntityProject && child.EntityType != CompanyExplorerV2EntityLogicGate {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	if r.companyExplorerV2CreatesCycleLocked(input.CompanyID, input.ParentEntityID, child.EntityID) {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	now := time.Now().UTC()
	position := input.Position
	if position <= 0 {
		position = r.nextCompanyExplorerV2EdgePositionLocked(input.CompanyID, input.ParentEntityID)
	}
	edge := memoryCompanyExplorerV2Edge{
		CompanyID:        input.CompanyID,
		EdgeID:           companyExplorerV2EdgeID(input.CompanyID, input.ParentEntityID, child.EntityID),
		ParentEntityID:   input.ParentEntityID,
		ChildEntityID:    child.EntityID,
		Position:         position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	previousParentEntityID := ""
	hadPreviousEdge := false
	for _, existing := range r.companyExplorerV2Edges {
		if existing.CompanyID != input.CompanyID || existing.ChildEntityID != child.EntityID {
			continue
		}
		previousParentEntityID = existing.ParentEntityID
		hadPreviousEdge = true
		if edge.CreatedTimestamp.Equal(now) {
			edge.CreatedTimestamp = existing.CreatedTimestamp
		}
	}
	if !hadPreviousEdge || previousParentEntityID != input.ParentEntityID {
		childResourceID := child.ResourceID
		if childResourceID == "" {
			childResourceID = child.EntityID
		}
		eventInput := workspaceDomainEventInput(input.CompanyID, "company_explorer_item_placed", map[string]any{
			"item_id": edge.EdgeID, "parent_entity_id": input.ParentEntityID,
			"target_type": child.EntityType, "target_id": childResourceID,
		})
		eventInput.ActorUserID = input.ActorUserID
		if _, err := r.appendDomainEventLocked(eventInput); err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	for edgeKey, existing := range r.companyExplorerV2Edges {
		if existing.CompanyID == input.CompanyID && existing.ChildEntityID == child.EntityID {
			delete(r.companyExplorerV2Edges, edgeKey)
		}
	}
	r.companyExplorerV2Edges[key(edge.CompanyID, edge.EdgeID)] = edge
	r.shadowCompanyExplorerV2EdgeToLegacyLocked(parent, child, edge)
	if child.EntityType == CompanyExplorerV2EntityLogicGate {
		var mapParentID *string
		if parent.EntityType == CompanyExplorerV2EntityFolder {
			parentID := parent.EntityID
			mapParentID = &parentID
		}
		r.syncAutomaticMemoryProcessMapPlacementLocked(input.CompanyID, domain.ProcessMapResourceTypeProcess, child.ResourceID, mapParentID)
	}
	r.reconcileMemoryRACITabsCompanyLocked(input.CompanyID)
	return r.companyExplorerV2RowLocked(CompanyExplorerV2RowsQuery{CompanyID: input.CompanyID, PermissionUserID: input.PermissionUserID}, child, &edge), nil
}

func (r *MemoryRepo) MoveCompanyExplorerV2Edge(input CompanyExplorerV2MoveEdgeInput) (CompanyExplorerV2Row, error) {
	input, err := normalizeCompanyExplorerV2MoveEdgeInput(input)
	if err != nil {
		return CompanyExplorerV2Row{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if input.PermissionUserID != "" && !r.userHasCompanyMembershipLocked(input.CompanyID, input.PermissionUserID) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	r.ensureCompanyExplorerV2CompanyGraphLocked(input.CompanyID)
	edge, ok := r.companyExplorerV2Edges[key(input.CompanyID, input.EdgeID)]
	if !ok {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	child, ok := r.companyExplorerV2Entities[key(input.CompanyID, edge.ChildEntityID)]
	if !ok {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if input.PermissionUserID != "" && !r.companyExplorerV2EntityCanEditLocked(input.CompanyID, input.PermissionUserID, child) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	parent, ok := r.companyExplorerV2Entities[key(input.CompanyID, input.ParentEntityID)]
	if !ok {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if input.PermissionUserID != "" && !r.companyExplorerV2EntityCanEditLocked(input.CompanyID, input.PermissionUserID, parent) {
		return CompanyExplorerV2Row{}, ErrNotFound
	}
	if r.companyExplorerV2CreatesCycleLocked(input.CompanyID, input.ParentEntityID, child.EntityID) {
		return CompanyExplorerV2Row{}, ErrInvalid
	}
	if input.Position > 0 {
		edge.Position = input.Position
	}
	previousParentEntityID := edge.ParentEntityID
	oldEdgeKey := key(input.CompanyID, edge.EdgeID)
	edge.ParentEntityID = input.ParentEntityID
	edge.EdgeID = companyExplorerV2EdgeID(input.CompanyID, input.ParentEntityID, child.EntityID)
	edge.UpdatedTimestamp = time.Now().UTC()
	if previousParentEntityID != input.ParentEntityID {
		childResourceID := child.ResourceID
		if childResourceID == "" {
			childResourceID = child.EntityID
		}
		eventInput := workspaceDomainEventInput(input.CompanyID, "company_explorer_item_placed", map[string]any{
			"item_id": edge.EdgeID, "parent_entity_id": input.ParentEntityID,
			"target_type": child.EntityType, "target_id": childResourceID,
		})
		eventInput.ActorUserID = input.ActorUserID
		if _, err := r.appendDomainEventLocked(eventInput); err != nil {
			return CompanyExplorerV2Row{}, err
		}
	}
	delete(r.companyExplorerV2Edges, oldEdgeKey)
	r.companyExplorerV2Edges[key(input.CompanyID, edge.EdgeID)] = edge
	r.shadowCompanyExplorerV2EdgeToLegacyLocked(parent, child, edge)
	var mapParentID *string
	if parent.EntityType == CompanyExplorerV2EntityFolder {
		parentID := parent.EntityID
		mapParentID = &parentID
	}
	switch child.EntityType {
	case CompanyExplorerV2EntityFolder:
		r.syncAutomaticMemoryProcessMapPlacementLocked(input.CompanyID, domain.ProcessMapResourceTypeFolder, child.EntityID, mapParentID)
	case CompanyExplorerV2EntityLogicGate:
		r.syncAutomaticMemoryProcessMapPlacementLocked(input.CompanyID, domain.ProcessMapResourceTypeProcess, child.ResourceID, mapParentID)
	}
	r.reconcileMemoryRACITabsCompanyLocked(input.CompanyID)
	return r.companyExplorerV2RowLocked(CompanyExplorerV2RowsQuery{CompanyID: input.CompanyID, PermissionUserID: input.PermissionUserID}, child, &edge), nil
}

func (r *MemoryRepo) DeleteCompanyExplorerV2Edge(companyID, edgeID, actorUserID, permissionUserID string) error {
	companyID = strings.TrimSpace(companyID)
	edgeID = strings.TrimSpace(edgeID)
	actorUserID = strings.TrimSpace(actorUserID)
	permissionUserID = strings.TrimSpace(permissionUserID)
	if companyID == "" || edgeID == "" || (actorUserID == "") != (permissionUserID == "") || (actorUserID != "" && actorUserID != permissionUserID) {
		return ErrInvalid
	}
	return r.DeleteCompanyExplorerV2Edges(companyID, []string{edgeID}, actorUserID, permissionUserID)
}

func (r *MemoryRepo) DeleteCompanyExplorerV2Edges(companyID string, edgeIDs []string, actorUserID, permissionUserID string) error {
	companyID = strings.TrimSpace(companyID)
	actorUserID = strings.TrimSpace(actorUserID)
	permissionUserID = strings.TrimSpace(permissionUserID)
	edgeIDs = normalizeCompanyExplorerV2EdgeIDs(edgeIDs)
	if companyID == "" || len(edgeIDs) == 0 || (actorUserID == "") != (permissionUserID == "") || (actorUserID != "" && actorUserID != permissionUserID) {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if permissionUserID != "" && !r.userHasCompanyMembershipLocked(companyID, permissionUserID) {
		return ErrNotFound
	}
	for _, edgeID := range edgeIDs {
		edge, ok := r.companyExplorerV2Edges[key(companyID, edgeID)]
		if !ok {
			return ErrNotFound
		}
		child, ok := r.companyExplorerV2Entities[key(companyID, edge.ChildEntityID)]
		if !ok || (permissionUserID != "" && !r.companyExplorerV2EntityCanEditLocked(companyID, permissionUserID, child)) {
			return ErrNotFound
		}
	}
	eventInputs := make([]DomainEventInput, 0, len(edgeIDs))
	for _, edgeID := range edgeIDs {
		edge := r.companyExplorerV2Edges[key(companyID, edgeID)]
		payload := map[string]any{"item_id": edgeID, "parent_entity_id": edge.ParentEntityID}
		if child, ok := r.companyExplorerV2Entities[key(companyID, edge.ChildEntityID)]; ok {
			resourceID := child.ResourceID
			if resourceID == "" {
				resourceID = child.EntityID
			}
			payload["target_type"] = child.EntityType
			payload["target_id"] = resourceID
		}
		eventInput := workspaceDomainEventInput(companyID, "company_explorer_item_removed", payload)
		eventInput.ActorUserID = strings.TrimSpace(actorUserID)
		eventInputs = append(eventInputs, eventInput)
	}
	if _, err := r.appendDomainEventsLocked(eventInputs); err != nil {
		return err
	}
	for _, edgeID := range edgeIDs {
		edge := r.companyExplorerV2Edges[key(companyID, edgeID)]
		if child, ok := r.companyExplorerV2Entities[key(companyID, edge.ChildEntityID)]; ok {
			switch child.EntityType {
			case CompanyExplorerV2EntityLogicGate:
				delete(r.folderItems, folderItemKey(companyID, child.EntityType, child.ResourceID))
				r.deleteAutomaticMemoryProcessMapPlacementLocked(companyID, domain.ProcessMapResourceTypeProcess, child.ResourceID)
			case CompanyExplorerV2EntityProject:
				delete(r.folderItems, folderItemKey(companyID, child.EntityType, child.ResourceID))
			case CompanyExplorerV2EntityFolder:
				r.deleteAutomaticMemoryProcessMapPlacementLocked(companyID, domain.ProcessMapResourceTypeFolder, child.EntityID)
			}
		}
		delete(r.companyExplorerV2Edges, key(companyID, edgeID))
	}
	r.reconcileMemoryRACITabsCompanyLocked(companyID)
	return nil
}

func (r *MemoryRepo) UpsertCompanyExplorerV2Subscription(input CompanyExplorerV2SubscriptionInput) (CompanyExplorerV2Subscription, error) {
	input, err := normalizeCompanyExplorerV2SubscriptionInput(input)
	if err != nil {
		return CompanyExplorerV2Subscription{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	r.ensureCompanyExplorerV2CompanyGraphLocked(input.CompanyID)
	if !r.companyExplorerV2SubscriptionOwnerCanEditLocked(input.CompanyID, input.OwnerType, input.OwnerID, input.ActorUserID) {
		return CompanyExplorerV2Subscription{}, ErrNotFound
	}
	anchor, ok := r.companyExplorerV2Entities[key(input.CompanyID, input.AnchorEntityID)]
	if !ok || !r.companyExplorerV2EntityVisibleLocked(CompanyExplorerV2RowsQuery{CompanyID: input.CompanyID, PermissionUserID: input.PermissionUserID}, anchor) {
		return CompanyExplorerV2Subscription{}, ErrNotFound
	}
	now := time.Now().UTC()
	position := input.Position
	if position <= 0 {
		position = r.nextCompanyExplorerV2SubscriptionPositionLocked(input.CompanyID, input.OwnerType, input.OwnerID)
	}
	subscription := memoryCompanyExplorerV2Subscription{
		CompanyID:        input.CompanyID,
		SubscriptionID:   newUUIDv7String(),
		OwnerType:        input.OwnerType,
		OwnerID:          input.OwnerID,
		AnchorEntityID:   input.AnchorEntityID,
		Position:         position,
		CreatedByUserID:  input.ActorUserID,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	for subscriptionKey, existing := range r.companyExplorerV2Subscriptions {
		if existing.CompanyID == input.CompanyID && existing.OwnerType == input.OwnerType && existing.OwnerID == input.OwnerID && existing.AnchorEntityID == input.AnchorEntityID {
			subscription.SubscriptionID = existing.SubscriptionID
			subscription.CreatedByUserID = existing.CreatedByUserID
			subscription.CreatedTimestamp = existing.CreatedTimestamp
			delete(r.companyExplorerV2Subscriptions, subscriptionKey)
			break
		}
	}
	r.companyExplorerV2Subscriptions[key(subscription.CompanyID, subscription.SubscriptionID)] = subscription
	return companyExplorerV2SubscriptionFromMemory(subscription), nil
}

func (r *MemoryRepo) DeleteCompanyExplorerV2Subscription(companyID, subscriptionID, actorUserID string) error {
	companyID = strings.TrimSpace(companyID)
	subscriptionID = strings.TrimSpace(subscriptionID)
	actorUserID = strings.TrimSpace(actorUserID)
	if companyID == "" || subscriptionID == "" || actorUserID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	subscription, ok := r.companyExplorerV2Subscriptions[key(companyID, subscriptionID)]
	if !ok {
		return ErrNotFound
	}
	if !r.companyExplorerV2SubscriptionOwnerCanEditLocked(companyID, subscription.OwnerType, subscription.OwnerID, actorUserID) {
		return ErrNotFound
	}
	delete(r.companyExplorerV2Subscriptions, key(companyID, subscriptionID))
	return nil
}

func (r *MemoryRepo) companyExplorerV2SubscriptionOwnerCanEditLocked(companyID, ownerType, ownerID, actorUserID string) bool {
	if r.userHasRoleAdminAccessLocked(companyID, actorUserID) {
		return true
	}
	if ownerType == CompanyExplorerV2SubscriptionOwnerUser {
		return ownerID == actorUserID
	}
	if ownerType == CompanyExplorerV2SubscriptionOwnerTeam {
		for _, member := range r.userGroupMembers {
			if member.CompanyID == companyID && member.GroupID == ownerID && member.UserID == actorUserID {
				return true
			}
		}
	}
	return false
}

func (r *MemoryRepo) nextCompanyExplorerV2SubscriptionPositionLocked(companyID, ownerType, ownerID string) int {
	next := 1000
	for _, subscription := range r.companyExplorerV2Subscriptions {
		if subscription.CompanyID == companyID && subscription.OwnerType == ownerType && subscription.OwnerID == ownerID && subscription.Position >= next {
			next = subscription.Position + 1000
		}
	}
	return next
}

func companyExplorerV2SubscriptionFromMemory(item memoryCompanyExplorerV2Subscription) CompanyExplorerV2Subscription {
	return CompanyExplorerV2Subscription{
		CompanyID:        item.CompanyID,
		SubscriptionID:   item.SubscriptionID,
		OwnerType:        item.OwnerType,
		OwnerID:          item.OwnerID,
		AnchorEntityID:   item.AnchorEntityID,
		Position:         item.Position,
		CreatedByUserID:  item.CreatedByUserID,
		CreatedTimestamp: item.CreatedTimestamp,
		UpdatedTimestamp: item.UpdatedTimestamp,
	}
}
func (r *MemoryRepo) ensureCompanyExplorerV2CompanyGraphLocked(companyID string) {
	now := time.Now().UTC()
	for _, company := range r.companies {
		if company.CompanyID == companyID {
			r.ensureCompanyExplorerV2NativeEntityLocked(companyID, CompanyExplorerV2EntityCompany, company.CompanyID, company.Name, company.CreatedTimestamp, company.UpdatedTimestamp)
		}
	}
	for _, membership := range r.memberships {
		if membership.CompanyID != companyID {
			continue
		}
		user, _ := r.memoryUserByIDLocked(membership.UserID)
		name := strings.TrimSpace(user.DisplayName)
		if name == "" {
			name = strings.TrimSpace(user.Email)
		}
		r.ensureCompanyExplorerV2NativeEntityLocked(companyID, CompanyExplorerV2EntityUser, membership.UserID, name, user.CreatedTimestamp, user.UpdatedTimestamp)
	}
	for _, group := range r.userGroups {
		if group.CompanyID == companyID {
			r.ensureCompanyExplorerV2NativeEntityLocked(companyID, CompanyExplorerV2EntityUserGroup, group.GroupID, group.Name, group.CreatedTimestamp, group.UpdatedTimestamp)
		}
	}
	for _, project := range r.projects {
		if project.CompanyID == companyID {
			r.ensureCompanyExplorerV2NativeEntityLocked(companyID, CompanyExplorerV2EntityProject, project.ProjectID, project.Name, project.CreatedTimestamp, project.UpdatedTimestamp)
		}
	}
	for _, logicGate := range r.logicGates {
		if logicGate.CompanyID == companyID {
			r.ensureCompanyExplorerV2NativeEntityLocked(companyID, CompanyExplorerV2EntityLogicGate, logicGate.LogicGateID, logicGate.Header, logicGate.CreatedTimestamp, logicGate.CreatedTimestamp)
		}
	}
	for _, node := range r.nodes {
		if node.CompanyID == companyID {
			r.ensureCompanyExplorerV2NativeEntityLocked(companyID, CompanyExplorerV2EntityNode, node.NodeID, node.Title, node.CreatedTimestamp, node.CreatedTimestamp)
		}
	}
	for _, folder := range r.folders {
		if folder.CompanyID != companyID || folder.FolderKind == "communications" {
			continue
		}
		entity := memoryCompanyExplorerV2Entity{
			CompanyID:        companyID,
			EntityID:         folder.FolderID,
			EntityType:       CompanyExplorerV2EntityFolder,
			Name:             folder.Name,
			DefaultAccess:    folder.DefaultAccess,
			CreatedTimestamp: folder.CreatedTimestamp,
			UpdatedTimestamp: folder.UpdatedTimestamp,
		}
		if entity.DefaultAccess == "" {
			entity.DefaultAccess = ResourceDefaultAccessEdit
		}
		r.companyExplorerV2Entities[key(companyID, entity.EntityID)] = entity
	}
	for _, folder := range r.folders {
		if folder.CompanyID != companyID || folder.FolderKind == "communications" {
			continue
		}
		parentEntityID := ""
		if folder.ParentFolderID != nil && *folder.ParentFolderID != "" {
			parentEntityID = *folder.ParentFolderID
		} else {
			scopeID := companyExplorerFolderScopeID(folder)
			scopeType := companyExplorerFolderScopeType(folder)
			if scopeID != nil && (scopeType == CompanyExplorerFolderScopeUser || scopeType == CompanyExplorerFolderScopeTeam) {
				ownerType := CompanyExplorerV2SubscriptionOwnerUser
				if scopeType == CompanyExplorerFolderScopeTeam {
					ownerType = CompanyExplorerV2SubscriptionOwnerTeam
				}
				subscriptionID := companyExplorerV2SubscriptionID(companyID, ownerType, *scopeID, folder.FolderID)
				if _, ok := r.companyExplorerV2Subscriptions[key(companyID, subscriptionID)]; !ok {
					r.companyExplorerV2Subscriptions[key(companyID, subscriptionID)] = memoryCompanyExplorerV2Subscription{
						CompanyID:        companyID,
						SubscriptionID:   subscriptionID,
						OwnerType:        ownerType,
						OwnerID:          *scopeID,
						AnchorEntityID:   folder.FolderID,
						Position:         folder.Position,
						CreatedTimestamp: folder.CreatedTimestamp,
						UpdatedTimestamp: folder.UpdatedTimestamp,
					}
				}
			}
			parentEntityID = companyExplorerV2NativeEntityID(companyID, CompanyExplorerV2EntityCompany, companyID)
		}
		if parentEntityID == "" || parentEntityID == folder.FolderID {
			continue
		}
		edge := memoryCompanyExplorerV2Edge{
			CompanyID:        companyID,
			EdgeID:           companyExplorerV2EdgeID(companyID, parentEntityID, folder.FolderID),
			ParentEntityID:   parentEntityID,
			ChildEntityID:    folder.FolderID,
			Position:         folder.Position,
			CreatedTimestamp: folder.CreatedTimestamp,
			UpdatedTimestamp: folder.UpdatedTimestamp,
		}
		r.companyExplorerV2Edges[key(companyID, edge.EdgeID)] = edge
	}
	for _, item := range r.folderItems {
		if item.CompanyID != companyID || item.ItemType == "kanban" {
			continue
		}
		child, ok := r.companyExplorerV2EntityForNativeLocked(companyID, item.ItemType, item.ItemID)
		if !ok {
			continue
		}
		edge := memoryCompanyExplorerV2Edge{
			CompanyID:        companyID,
			EdgeID:           companyExplorerV2EdgeID(companyID, item.FolderID, child.EntityID),
			ParentEntityID:   item.FolderID,
			ChildEntityID:    child.EntityID,
			Position:         item.Position,
			CreatedTimestamp: item.CreatedTimestamp,
			UpdatedTimestamp: item.UpdatedTimestamp,
		}
		r.companyExplorerV2Edges[key(companyID, edge.EdgeID)] = edge
	}
	if _, ok := r.companyExplorerV2Entities[key(companyID, companyExplorerV2NativeEntityID(companyID, CompanyExplorerV2EntityCompany, companyID))]; !ok {
		r.ensureCompanyExplorerV2NativeEntityLocked(companyID, CompanyExplorerV2EntityCompany, companyID, companyID, now, now)
	}
}

func (r *MemoryRepo) ensureCompanyExplorerV2NativeEntityLocked(companyID, entityType, resourceID, name string, created, updated time.Time) memoryCompanyExplorerV2Entity {
	entityID := companyExplorerV2NativeEntityID(companyID, entityType, resourceID)
	if created.IsZero() {
		created = time.Now().UTC()
	}
	if updated.IsZero() {
		updated = created
	}
	entity := memoryCompanyExplorerV2Entity{
		CompanyID:        companyID,
		EntityID:         entityID,
		EntityType:       entityType,
		ResourceID:       resourceID,
		Name:             strings.TrimSpace(name),
		CreatedTimestamp: created,
		UpdatedTimestamp: updated,
	}
	if previous, ok := r.companyExplorerV2Entities[key(companyID, entityID)]; ok {
		entity.CreatedTimestamp = previous.CreatedTimestamp
		if entity.Name == "" {
			entity.Name = previous.Name
		}
	}
	r.companyExplorerV2Entities[key(companyID, entityID)] = entity
	return entity
}

func (r *MemoryRepo) companyExplorerV2EntityForNativeLocked(companyID, entityType, resourceID string) (memoryCompanyExplorerV2Entity, bool) {
	entityID := companyExplorerV2NativeEntityID(companyID, entityType, resourceID)
	entity, ok := r.companyExplorerV2Entities[key(companyID, entityID)]
	return entity, ok
}

func (r *MemoryRepo) appendCompanyExplorerV2DerivedNativeRowLocked(query CompanyExplorerV2RowsQuery, rows *CompanyExplorerV2Rows, seen map[string]bool, entityType, resourceID string, position int, created time.Time) {
	entity, ok := r.companyExplorerV2EntityForNativeLocked(query.CompanyID, entityType, resourceID)
	if !ok || seen[entity.EntityID] || !r.companyExplorerV2EntityVisibleLocked(query, entity) {
		return
	}
	seen[entity.EntityID] = true
	row := r.companyExplorerV2RowLocked(query, entity, nil)
	row.ParentEntityID = query.ParentEntityID
	row.Position = position
	if row.Position <= 0 {
		row.Position = 1_000_000
	}
	if !created.IsZero() {
		row.CreatedTimestamp = created
	}
	rows.Rows = append(rows.Rows, row)
}

func (r *MemoryRepo) companyExplorerV2RowLocked(query CompanyExplorerV2RowsQuery, entity memoryCompanyExplorerV2Entity, edge *memoryCompanyExplorerV2Edge) CompanyExplorerV2Row {
	row := CompanyExplorerV2Row{
		CompanyID:        entity.CompanyID,
		EntityID:         entity.EntityID,
		EntityType:       entity.EntityType,
		ResourceID:       entity.ResourceID,
		Name:             r.companyExplorerV2EntityNameLocked(entity),
		Position:         1000,
		EffectiveAccess:  r.companyExplorerV2EffectiveAccessLocked(query, entity),
		NativeContext:    companyExplorerV2NativeContext(entity.EntityType, entity.EntityID, entity.ResourceID),
		CreatedTimestamp: entity.CreatedTimestamp,
		UpdatedTimestamp: entity.UpdatedTimestamp,
	}
	applyCompanyExplorerDefaultFolderNativeContext(&row)
	if edge != nil {
		row.ParentEntityID = edge.ParentEntityID
		row.EdgeID = edge.EdgeID
		row.Position = edge.Position
		row.CreatedTimestamp = edge.CreatedTimestamp
		row.UpdatedTimestamp = edge.UpdatedTimestamp
		if row.ParentEntityID == query.CompanyID {
			row.ParentEntityID = ""
		}
	}
	row.HasChildren = r.companyExplorerV2HasChildrenLocked(query.CompanyID, entity)
	return row
}

func (r *MemoryRepo) deleteCompanyExplorerV2NativeEntityProjectionLocked(companyID, entityType, resourceID string) {
	for _, entity := range r.companyExplorerV2Entities {
		if entity.CompanyID == companyID && entity.EntityType == entityType && entity.ResourceID == resourceID {
			r.deleteCompanyExplorerV2EntityProjectionLocked(companyID, entity.EntityID)
			return
		}
	}
}

func (r *MemoryRepo) deleteCompanyExplorerV2EntityProjectionLocked(companyID, entityID string) {
	delete(r.companyExplorerV2Entities, key(companyID, entityID))
	for subscriptionKey, subscription := range r.companyExplorerV2Subscriptions {
		if subscription.CompanyID == companyID && subscription.AnchorEntityID == entityID {
			delete(r.companyExplorerV2Subscriptions, subscriptionKey)
		}
	}
	for edgeKey, edge := range r.companyExplorerV2Edges {
		if edge.CompanyID == companyID && (edge.ParentEntityID == entityID || edge.ChildEntityID == entityID) {
			delete(r.companyExplorerV2Edges, edgeKey)
		}
	}
}

func (r *MemoryRepo) companyExplorerV2EntityNameLocked(entity memoryCompanyExplorerV2Entity) string {
	switch entity.EntityType {
	case CompanyExplorerV2EntityCompany:
		if company, ok := r.companies[entity.ResourceID]; ok && strings.TrimSpace(company.Name) != "" {
			return company.Name
		}
	case CompanyExplorerV2EntityUserGroup:
		if group, ok := r.userGroups[userGroupKey(entity.CompanyID, entity.ResourceID)]; ok && strings.TrimSpace(group.Name) != "" {
			return group.Name
		}
	case CompanyExplorerV2EntityUser:
		if user, ok := r.memoryUserByIDLocked(entity.ResourceID); ok {
			if strings.TrimSpace(user.DisplayName) != "" {
				return user.DisplayName
			}
			if strings.TrimSpace(user.Email) != "" {
				return user.Email
			}
		}
	case CompanyExplorerV2EntityProject:
		if project, ok := r.projects[key(entity.CompanyID, entity.ResourceID)]; ok && strings.TrimSpace(project.Name) != "" {
			return project.Name
		}
	case CompanyExplorerV2EntityLogicGate:
		if gate, ok := r.logicGates[key(entity.CompanyID, entity.ResourceID)]; ok && strings.TrimSpace(gate.Header) != "" {
			return gate.Header
		}
	case CompanyExplorerV2EntityNode:
		if node, ok := r.nodes[key(entity.CompanyID, entity.ResourceID)]; ok && strings.TrimSpace(node.Title) != "" {
			return node.Title
		}
	}
	if strings.TrimSpace(entity.Name) != "" {
		return entity.Name
	}
	if entity.ResourceID != "" {
		return entity.ResourceID
	}
	return entity.EntityID
}

func (r *MemoryRepo) companyExplorerV2EntityVisibleLocked(query CompanyExplorerV2RowsQuery, entity memoryCompanyExplorerV2Entity) bool {
	if entity.CompanyID != query.CompanyID {
		return false
	}
	if query.PermissionUserID == "" {
		return true
	}
	resourceType := companyExplorerV2ResourcePermissionType(entity.EntityType)
	if resourceType == "" {
		return r.userHasCompanyMembershipLocked(entity.CompanyID, query.PermissionUserID)
	}
	resourceID := entity.ResourceID
	if entity.EntityType == CompanyExplorerV2EntityFolder {
		resourceID = entity.EntityID
	}
	return r.userHasEffectiveAccessLocked(entity.CompanyID, query.PermissionUserID, resourceType, resourceID, EntityPermissionEdit)
}

func (r *MemoryRepo) companyExplorerV2EntityCanEditLocked(companyID, userID string, entity memoryCompanyExplorerV2Entity) bool {
	resourceType := companyExplorerV2ResourcePermissionType(entity.EntityType)
	if resourceType == "" {
		return r.userHasRoleAdminAccessLocked(companyID, userID) || r.userHasCompanyMembershipLocked(companyID, userID)
	}
	resourceID := entity.ResourceID
	if entity.EntityType == CompanyExplorerV2EntityFolder {
		resourceID = entity.EntityID
	}
	return r.userHasEffectiveAccessLocked(companyID, userID, resourceType, resourceID, EntityPermissionEdit)
}

func (r *MemoryRepo) companyExplorerV2EffectiveAccessLocked(query CompanyExplorerV2RowsQuery, entity memoryCompanyExplorerV2Entity) string {
	if query.PermissionUserID == "" {
		return ""
	}
	resourceType := companyExplorerV2ResourcePermissionType(entity.EntityType)
	if resourceType == "" {
		if r.userHasRoleAdminAccessLocked(entity.CompanyID, query.PermissionUserID) {
			return EntityPermissionEdit
		}
		if r.userHasCompanyMembershipLocked(entity.CompanyID, query.PermissionUserID) {
			return EntityPermissionEdit
		}
		return ""
	}
	resourceID := entity.ResourceID
	if entity.EntityType == CompanyExplorerV2EntityFolder {
		resourceID = entity.EntityID
	}
	return r.effectiveAccessLevelLocked(entity.CompanyID, query.PermissionUserID, resourceType, resourceID, EntityPermissionEdit)
}

func (r *MemoryRepo) userHasCompanyMembershipLocked(companyID, userID string) bool {
	if r.userHasRoleAdminAccessLocked(companyID, userID) {
		return true
	}
	_, ok := r.memberships[membershipKey(companyID, userID)]
	return ok
}

func (r *MemoryRepo) companyExplorerV2HasChildrenLocked(companyID string, entity memoryCompanyExplorerV2Entity) bool {
	if entity.EntityType != CompanyExplorerV2EntityCompany && entity.EntityType != CompanyExplorerV2EntityFolder {
		return false
	}
	for _, edge := range r.companyExplorerV2DirectTreeEdgesLocked(companyID) {
		if edge.ParentEntityID == entity.EntityID {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) nextCompanyExplorerV2EdgePositionLocked(companyID, parentEntityID string) int {
	next := 1000
	for _, edge := range r.companyExplorerV2Edges {
		if edge.CompanyID == companyID && edge.ParentEntityID == parentEntityID && edge.Position >= next {
			next = edge.Position + 1000
		}
	}
	return next
}

func (r *MemoryRepo) companyExplorerV2CreatesCycleLocked(companyID, parentEntityID, childEntityID string) bool {
	if parentEntityID == childEntityID {
		return true
	}
	seen := map[string]bool{}
	var visit func(entityID string) bool
	visit = func(entityID string) bool {
		if entityID == childEntityID {
			return true
		}
		if seen[entityID] {
			return false
		}
		seen[entityID] = true
		for _, edge := range r.companyExplorerV2Edges {
			if edge.CompanyID == companyID && edge.ChildEntityID == entityID && visit(edge.ParentEntityID) {
				return true
			}
		}
		return false
	}
	return visit(parentEntityID)
}

func (r *MemoryRepo) shadowCompanyExplorerV2FolderToLegacyLocked(parent memoryCompanyExplorerV2Entity, entity memoryCompanyExplorerV2Entity, edge memoryCompanyExplorerV2Edge) {
	if _, ok := r.folders[key(entity.CompanyID, entity.EntityID)]; ok {
		return
	}
	var parentFolderID *string
	scopeType := CompanyExplorerFolderScopeCompany
	var scopeID *string
	if parent.EntityType == CompanyExplorerV2EntityFolder {
		value := parent.EntityID
		parentFolderID = &value
		if parentFolder, ok := r.folders[key(parent.CompanyID, parent.EntityID)]; ok {
			scopeType = companyExplorerFolderScopeType(parentFolder)
			scopeID = companyExplorerFolderScopeID(parentFolder)
		}
	} else if parent.EntityType == CompanyExplorerV2EntityUser {
		scopeType = CompanyExplorerFolderScopeUser
		value := parent.ResourceID
		scopeID = &value
	} else if parent.EntityType == CompanyExplorerV2EntityUserGroup {
		scopeType = CompanyExplorerFolderScopeTeam
		value := parent.ResourceID
		scopeID = &value
	}
	r.folders[key(entity.CompanyID, entity.EntityID)] = domain.CompanyExplorerFolder{
		CompanyID:        entity.CompanyID,
		FolderID:         entity.EntityID,
		ParentFolderID:   parentFolderID,
		FolderKind:       "node",
		Name:             entity.Name,
		DefaultAccess:    entity.DefaultAccess,
		ScopeType:        scopeType,
		ScopeID:          scopeID,
		Position:         edge.Position,
		CreatedTimestamp: entity.CreatedTimestamp,
		UpdatedTimestamp: entity.UpdatedTimestamp,
	}
}

func (r *MemoryRepo) shadowCompanyExplorerV2EdgeToLegacyLocked(parent, child memoryCompanyExplorerV2Entity, edge memoryCompanyExplorerV2Edge) {
	if child.EntityType == CompanyExplorerV2EntityFolder {
		folder, ok := r.folders[key(child.CompanyID, child.EntityID)]
		if !ok {
			return
		}
		switch parent.EntityType {
		case CompanyExplorerV2EntityCompany:
			folder.ParentFolderID = nil
		case CompanyExplorerV2EntityFolder:
			parentID := parent.EntityID
			folder.ParentFolderID = &parentID
		default:
			return
		}
		folder.Position = edge.Position
		folder.UpdatedTimestamp = edge.UpdatedTimestamp
		r.folders[key(child.CompanyID, child.EntityID)] = folder
		return
	}
	if child.EntityType != CompanyExplorerV2EntityLogicGate && child.EntityType != CompanyExplorerV2EntityProject && child.EntityType != CompanyExplorerV2EntityNode {
		return
	}
	itemKey := folderItemKey(edge.CompanyID, child.EntityType, child.ResourceID)
	if parent.EntityType != CompanyExplorerV2EntityFolder {
		delete(r.folderItems, itemKey)
		return
	}
	item := domain.CompanyExplorerFolderItem{
		CompanyID:        edge.CompanyID,
		FolderID:         parent.EntityID,
		ItemType:         child.EntityType,
		ItemID:           child.ResourceID,
		Position:         edge.Position,
		CreatedTimestamp: edge.CreatedTimestamp,
		UpdatedTimestamp: edge.UpdatedTimestamp,
	}
	r.folderItems[itemKey] = item
}

func (r *MemoryRepo) memoryUserByIDLocked(userID string) (domain.User, bool) {
	for _, user := range r.users {
		if user.UserID == userID {
			return user, true
		}
	}
	return domain.User{}, false
}

func sortCompanyExplorerV2Rows(rows []CompanyExplorerV2Row) {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Position != rows[j].Position {
			return rows[i].Position < rows[j].Position
		}
		if !rows[i].CreatedTimestamp.Equal(rows[j].CreatedTimestamp) {
			return rows[i].CreatedTimestamp.Before(rows[j].CreatedTimestamp)
		}
		if rows[i].Name != rows[j].Name {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].EntityID < rows[j].EntityID
	})
}
