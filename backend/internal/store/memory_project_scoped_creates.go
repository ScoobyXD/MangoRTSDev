package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type memoryProjectScopedCreateSnapshot struct {
	nodes                         map[string]domain.Node
	nodeInfo                      map[string][]domain.NodeInformation
	nodeText                      map[string]map[string]domain.NodeProjection
	nodeContentChanges            map[string]domain.NodeContentChange
	nodeContentChangeSeen         map[string]time.Time
	logicGates                    map[string]domain.LogicGate
	logicGateInfo                 map[string][]domain.LogicGateInformation
	logicGateText                 map[string]map[string]domain.LogicGateProjection
	projectRelationships          map[string]domain.ProjectRelationship
	projectRelationshipProjection map[string]domain.ProjectRelationshipProjection
	folders                       map[string]domain.CompanyExplorerFolder
	folderItems                   map[string]domain.CompanyExplorerFolderItem
	defaultFolderSeed             map[string]bool
	kanbanBoards                  map[string]domain.KanbanBoard
	kanbanColumns                 map[string][]domain.KanbanColumn
	kanbanCards                   map[string][]domain.KanbanCard
	nodeLogicGateAssignments      map[string]domain.NodeLogicGateAssignment
	GVICMatrixProjectionRows      map[string]memoryGVICMatrixProjectionRow
	effectiveAccess               map[string]domain.EffectiveResourceAccess
	domainEvents                  map[string]domain.DomainEvent
	eventRows                     map[string]EventRow
	workspaceReadVersions         map[string]int64
}

func (r *MemoryRepo) snapshotProjectScopedCreateLocked() memoryProjectScopedCreateSnapshot {
	return memoryProjectScopedCreateSnapshot{
		nodes:                         cloneMemoryMap(r.nodes),
		nodeInfo:                      cloneMemorySliceMap(r.nodeInfo),
		nodeText:                      cloneMemoryNodeText(r.nodeText),
		nodeContentChanges:            cloneMemoryMap(r.nodeContentChanges),
		nodeContentChangeSeen:         cloneMemoryMap(r.nodeContentChangeSeen),
		logicGates:                    cloneMemoryMap(r.logicGates),
		logicGateInfo:                 cloneMemorySliceMap(r.logicGateInfo),
		logicGateText:                 cloneMemoryLogicGateText(r.logicGateText),
		projectRelationships:          cloneMemoryMap(r.projectRelationships),
		projectRelationshipProjection: cloneMemoryMap(r.projectRelationshipProjection),
		folders:                       cloneMemoryMap(r.folders),
		folderItems:                   cloneMemoryMap(r.folderItems),
		defaultFolderSeed:             cloneMemoryMap(r.defaultFolderSeed),
		kanbanBoards:                  cloneMemoryMap(r.kanbanBoards),
		kanbanColumns:                 cloneMemorySliceMap(r.kanbanColumns),
		kanbanCards:                   cloneMemorySliceMap(r.kanbanCards),
		nodeLogicGateAssignments:      cloneMemoryMap(r.nodeLogicGateAssignments),
		GVICMatrixProjectionRows:      cloneMemoryMap(r.GVICMatrixProjectionRows),
		effectiveAccess:               cloneMemoryMap(r.effectiveAccess),
		domainEvents:                  cloneMemoryMap(r.domainEvents),
		eventRows:                     cloneMemoryMap(r.eventRows),
		workspaceReadVersions:         cloneMemoryMap(r.workspaceReadVersions),
	}
}

func (r *MemoryRepo) restoreProjectScopedCreateLocked(snapshot memoryProjectScopedCreateSnapshot) {
	r.nodes = snapshot.nodes
	r.nodeInfo = snapshot.nodeInfo
	r.nodeText = snapshot.nodeText
	r.nodeContentChanges = snapshot.nodeContentChanges
	r.nodeContentChangeSeen = snapshot.nodeContentChangeSeen
	r.logicGates = snapshot.logicGates
	r.logicGateInfo = snapshot.logicGateInfo
	r.logicGateText = snapshot.logicGateText
	r.projectRelationships = snapshot.projectRelationships
	r.projectRelationshipProjection = snapshot.projectRelationshipProjection
	r.folders = snapshot.folders
	r.folderItems = snapshot.folderItems
	r.defaultFolderSeed = snapshot.defaultFolderSeed
	r.kanbanBoards = snapshot.kanbanBoards
	r.kanbanColumns = snapshot.kanbanColumns
	r.kanbanCards = snapshot.kanbanCards
	r.nodeLogicGateAssignments = snapshot.nodeLogicGateAssignments
	r.GVICMatrixProjectionRows = snapshot.GVICMatrixProjectionRows
	r.effectiveAccess = snapshot.effectiveAccess
	r.domainEvents = snapshot.domainEvents
	r.eventRows = snapshot.eventRows
	r.workspaceReadVersions = snapshot.workspaceReadVersions
}

func cloneMemoryLogicGateText(items map[string]map[string]domain.LogicGateProjection) map[string]map[string]domain.LogicGateProjection {
	out := make(map[string]map[string]domain.LogicGateProjection, len(items))
	for k, v := range items {
		out[k] = cloneMemoryMap(v)
	}
	return out
}

func (r *MemoryRepo) CreateNodeAssociatedWithProject(input ProjectScopedNodeCreateInput) (ProjectScopedNodeCreateResult, error) {
	input, err := NormalizeProjectScopedNodeCreateInput(input)
	if err != nil {
		return ProjectScopedNodeCreateResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotProjectScopedCreateLocked()
	rollback := func() { r.restoreProjectScopedCreateLocked(snapshot) }
	if _, ok := r.projects[key(input.CompanyID, input.ProjectID)]; !ok {
		return ProjectScopedNodeCreateResult{}, ErrNotFound
	}
	node, err := r.createNodeWithIDLocked(input.CompanyID, input.NodeID, input.Title)
	if err != nil {
		rollback()
		return ProjectScopedNodeCreateResult{}, err
	}
	var information *domain.NodeInformation
	if input.InitialInformation != nil {
		item, err := r.addInitialNodeInformationLocked(NodeInformationInput{
			CompanyID:        input.CompanyID,
			NodeID:           node.NodeID,
			Type:             input.InitialInformation.Type,
			Information:      input.InitialInformation.Information,
			InformationID:    input.InitialInformation.InformationID,
			ActorUserID:      input.ActorUserID,
			ActorDisplayName: input.ActorDisplayName,
		})
		if err != nil {
			rollback()
			return ProjectScopedNodeCreateResult{}, err
		}
		information = &item
	}
	var assignment *domain.NodeLogicGateAssignment
	var card *domain.KanbanCard
	assignmentDeltas := make([]ProjectionDelta, 0)
	assignmentEvents := make([]domain.DomainEvent, 0)
	if input.InitialAssignment != nil {
		assignmentResult, err := r.assignInitialProjectScopedNodeToLogicGateLocked(input, node)
		if err != nil {
			rollback()
			return ProjectScopedNodeCreateResult{}, err
		}
		node = assignmentResult.Node
		assignment = &assignmentResult.Assignment
		cardValue := assignmentResult.Card
		card = &cardValue
		assignmentDeltas = append(assignmentDeltas, assignmentResult.ProjectionDeltas...)
		assignmentEvents = append(assignmentEvents, assignmentResult.Events...)
	}
	relationshipID := newUUIDv7String()
	relationship := domain.ProjectRelationship{
		CompanyID:        input.CompanyID,
		RelationshipID:   relationshipID,
		ProjectID:        input.ProjectID,
		ResourceType:     EntityTypeNode,
		ResourceID:       node.NodeID,
		Position:         input.Position,
		CreatedTimestamp: time.Now().UTC(),
		UpdatedTimestamp: time.Now().UTC(),
	}
	r.projectRelationships[projectRelationshipKey(input.CompanyID, relationshipID)] = relationship
	beforeRelationship := r.projectRelationshipProjectionRowsForRelationshipLocked(input.CompanyID, relationshipID)
	if err := r.syncProjectRelationshipProjectionLocked(input.CompanyID, relationshipID); err != nil {
		rollback()
		return ProjectScopedNodeCreateResult{}, err
	}
	afterRelationship := r.projectRelationshipProjectionRowsForRelationshipLocked(input.CompanyID, relationshipID)
	eventDeltas := make([]ProjectionDelta, 0)
	if input.InitialAssignment == nil {
		eventDeltas = append(eventDeltas, diffGVICMatrixProjectionRows(nil, r.GVICMatrixProjectionRowsForResourcesLocked(input.CompanyID, []string{node.NodeID}, nil))...)
	}
	eventDeltas = append(eventDeltas, diffProjectRelationshipProjectionRows(beforeRelationship, afterRelationship)...)
	projection := r.projectRelationshipProjection[projectRelationshipKey(input.CompanyID, relationshipID)]
	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	events, err := r.appendDomainEventsLocked([]DomainEventInput{
		nodeCreatedWorkspaceEventInputWithMetadata(node, meta),
		projectRelationshipUpsertedWorkspaceEventInput(projection, input.ActorUserID),
	})
	if err != nil {
		rollback()
		return ProjectScopedNodeCreateResult{}, err
	}
	events = append(assignmentEvents, events...)
	if _, err := r.appendEventRowsLocked(ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, eventDeltas)); err != nil {
		rollback()
		return ProjectScopedNodeCreateResult{}, err
	}
	projectionDeltas := append([]ProjectionDelta{}, assignmentDeltas...)
	projectionDeltas = append(projectionDeltas, eventDeltas...)
	return ProjectScopedNodeCreateResult{
		Node:             r.withNodeReadModelLocked(node),
		Relationship:     &projection,
		Information:      information,
		Assignment:       assignment,
		Card:             card,
		Events:           events,
		ProjectionDeltas: projectionDeltas,
	}, nil
}

func (r *MemoryRepo) CreateLogicGateAssociatedWithProject(input ProjectScopedLogicGateCreateInput) (ProjectScopedLogicGateCreateResult, error) {
	input, err := NormalizeProjectScopedLogicGateCreateInput(input)
	if err != nil {
		return ProjectScopedLogicGateCreateResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotProjectScopedCreateLocked()
	rollback := func() { r.restoreProjectScopedCreateLocked(snapshot) }
	if _, ok := r.projects[key(input.CompanyID, input.ProjectID)]; !ok {
		return ProjectScopedLogicGateCreateResult{}, ErrNotFound
	}
	logicGateID := input.LogicGateID
	if logicGateID == "" {
		logicGateID = newUUIDv7String()
	}
	logicGate := domain.LogicGate{
		CompanyID:        input.CompanyID,
		LogicGateID:      logicGateID,
		Header:           input.Header,
		DefaultAccess:    ResourceDefaultAccessEdit,
		GVICAssignments:  []domain.LogicGateGVICAssignment{},
		CreatedTimestamp: time.Now().UTC(),
	}
	r.logicGates[key(input.CompanyID, logicGate.LogicGateID)] = logicGate
	r.ensureLogicGateKanbanBoardLocked(input.CompanyID, logicGate.LogicGateID, logicGate.Header)
	var information *domain.LogicGateInformation
	if input.InitialInformation != nil {
		item, err := r.addInitialLogicGateInformationLocked(input.CompanyID, logicGate.LogicGateID, *input.InitialInformation, input.ActorUserID)
		if err != nil {
			rollback()
			return ProjectScopedLogicGateCreateResult{}, err
		}
		information = &item
	}
	relationshipID := newUUIDv7String()
	relationship := domain.ProjectRelationship{
		CompanyID:        input.CompanyID,
		RelationshipID:   relationshipID,
		ProjectID:        input.ProjectID,
		ResourceType:     EntityTypeLogicGate,
		ResourceID:       logicGate.LogicGateID,
		Position:         input.Position,
		CreatedTimestamp: time.Now().UTC(),
		UpdatedTimestamp: time.Now().UTC(),
	}
	r.projectRelationships[projectRelationshipKey(input.CompanyID, relationshipID)] = relationship
	beforeRelationship := r.projectRelationshipProjectionRowsForRelationshipLocked(input.CompanyID, relationshipID)
	if err := r.syncProjectRelationshipProjectionLocked(input.CompanyID, relationshipID); err != nil {
		rollback()
		return ProjectScopedLogicGateCreateResult{}, err
	}
	afterRelationship := r.projectRelationshipProjectionRowsForRelationshipLocked(input.CompanyID, relationshipID)
	r.syncGVICMatrixProjectionForLogicGateLocked(input.CompanyID, logicGate.LogicGateID)
	projectionDeltas := diffGVICMatrixProjectionRows(nil, r.GVICMatrixProjectionRowsForResourcesLocked(input.CompanyID, nil, []string{logicGate.LogicGateID}))
	projectionDeltas = append(projectionDeltas, diffProjectRelationshipProjectionRows(beforeRelationship, afterRelationship)...)
	projection := r.projectRelationshipProjection[projectRelationshipKey(input.CompanyID, relationshipID)]
	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	events, err := r.appendDomainEventsLocked([]DomainEventInput{
		logicGateCreatedWorkspaceEventInput(logicGate, meta),
		projectRelationshipUpsertedWorkspaceEventInput(projection, input.ActorUserID),
	})
	if err != nil {
		rollback()
		return ProjectScopedLogicGateCreateResult{}, err
	}
	if _, err := r.appendEventRowsLocked(ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, projectionDeltas)); err != nil {
		rollback()
		return ProjectScopedLogicGateCreateResult{}, err
	}
	return ProjectScopedLogicGateCreateResult{
		LogicGate:        r.withLogicGateGVICLocked(logicGate),
		Relationship:     &projection,
		Information:      information,
		Events:           events,
		ProjectionDeltas: projectionDeltas,
	}, nil
}

func (r *MemoryRepo) assignInitialProjectScopedNodeToLogicGateLocked(input ProjectScopedNodeCreateInput, node domain.Node) (LogicGateNodeAssignmentResult, error) {
	assignmentInput := LogicGateNodeAssignmentInput{
		CompanyID:      input.CompanyID,
		LogicGateID:    input.InitialAssignment.LogicGateID,
		NodeID:         node.NodeID,
		Status:         input.InitialAssignment.Status,
		ColumnID:       input.InitialAssignment.ColumnID,
		Position:       input.InitialAssignment.Position,
		Priority:       input.InitialAssignment.Priority,
		PrioritySet:    input.InitialAssignment.Priority != nil,
		ActorUserID:    input.ActorUserID,
		IdempotencyKey: input.IdempotencyKey,
	}
	if input.InitialAssignment.IsIssue != nil {
		assignmentInput.IsIssue = *input.InitialAssignment.IsIssue
		assignmentInput.IsIssueSet = true
	}
	assignmentInput, err := NormalizeLogicGateNodeAssignmentInput(assignmentInput)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	boardID := LogicGateKanbanBoardID(assignmentInput.LogicGateID)
	board, ok := r.kanbanBoards[boardKey(assignmentInput.CompanyID, boardID)]
	if !ok || board.LogicGateID == nil || *board.LogicGateID != assignmentInput.LogicGateID {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	column, err := resolveLogicGateAssignmentColumn(r.kanbanColumns[boardKey(assignmentInput.CompanyID, boardID)], assignmentInput.ColumnID, assignmentInput.Status)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	if _, ok := logicGateAssignmentInputPriority(assignmentInput); !ok && !logicGateAssignmentNodeHasPriority(r.nodes[key(assignmentInput.CompanyID, assignmentInput.NodeID)].Priority) {
		return LogicGateNodeAssignmentResult{}, ErrPriorityRequired
	}
	kanbanBefore := r.kanbanProjectionRowsForNodeLocked(assignmentInput.CompanyID, assignmentInput.NodeID)
	if assignmentInput.PrioritySet {
		priority, ok := logicGateAssignmentInputPriority(assignmentInput)
		if !ok {
			return LogicGateNodeAssignmentResult{}, ErrPriorityRequired
		}
		nodeValue := r.nodes[key(assignmentInput.CompanyID, assignmentInput.NodeID)]
		value := *priority
		nodeValue.Priority = &value
		r.nodes[key(assignmentInput.CompanyID, assignmentInput.NodeID)] = nodeValue
	}
	card, err := r.upsertKanbanCardLocked(KanbanCardMutationInput{
		CompanyID:  assignmentInput.CompanyID,
		BoardID:    boardID,
		ColumnID:   column.ColumnID,
		NodeID:     assignmentInput.NodeID,
		NodeTitle:  node.Title,
		Position:   assignmentInput.Position,
		IsIssue:    assignmentInput.IsIssue,
		IsIssueSet: assignmentInput.IsIssueSet,
	})
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	kanbanAfter := r.kanbanProjectionRowsForNodeLocked(assignmentInput.CompanyID, assignmentInput.NodeID)
	projectionDeltas := diffKanbanProjectionRows(kanbanBefore, kanbanAfter)
	projectionDeltas = append(projectionDeltas, r.syncGVICMatrixProjectionForNodeDeltasLocked(assignmentInput.CompanyID, assignmentInput.NodeID)...)
	assignment, ok := r.nodeLogicGateAssignmentLocked(assignmentInput.CompanyID, assignmentInput.NodeID, assignmentInput.LogicGateID)
	if !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	result := LogicGateNodeAssignmentResult{
		Card:             r.withKanbanCardProjectionFieldsLocked(card),
		Node:             r.withNodeReadModelLocked(r.nodes[key(assignmentInput.CompanyID, assignmentInput.NodeID)]),
		Assignment:       assignment,
		ProjectionDeltas: projectionDeltas,
	}
	events, err := r.appendDomainEventsLocked(logicGateAssignmentSavedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	if _, err := r.appendEventRowsLocked(ProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, projectionDeltas)); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return result, nil
}

func (r *MemoryRepo) addInitialNodeInformationLocked(input NodeInformationInput) (domain.NodeInformation, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	infoType := strings.TrimSpace(input.Type)
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return domain.NodeInformation{}, ErrNotFound
	}
	now := time.Now().UTC()
	k := key(companyID, nodeID)
	item := domain.NodeInformation{
		CompanyID:        companyID,
		InformationID:    newUUIDv7String(),
		NodeID:           nodeID,
		Type:             infoType,
		Information:      input.Information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.nodeInfo[k] = append(r.nodeInfo[k], item)
	sort.Slice(r.nodeInfo[k], func(i, j int) bool {
		return r.nodeInfo[k][i].CreatedTimestamp.Before(r.nodeInfo[k][j].CreatedTimestamp)
	})
	keyValue := cleanUUIDText(input.InformationID)
	if keyValue == "" {
		keyValue = item.InformationID
	}
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	projection := domain.NodeProjection{
		CompanyID:        companyID,
		NodeID:           nodeID,
		Type:             infoType,
		Information:      input.Information,
		InformationID:    keyValue,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.nodeText[k][keyValue] = projection
	if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
		r.recordNodeContentChangesLocked(buildNodeContentChanges(
			companyID,
			nodeID,
			keyValue,
			infoType,
			nil,
			input.Information,
			normalizeNodeContentChangeActor(input.ActorUserID, input.ActorDisplayName),
			now,
		))
	}
	if eventInput, ok := EditorProjectionUpsertEventInput(companyID, input.ActorUserID, "", EditorProjectionRowFromNode(projection)); ok {
		if _, err := r.appendEventRowsLocked([]EventRowInput{eventInput}); err != nil {
			return domain.NodeInformation{}, err
		}
	}
	return item, nil
}

func (r *MemoryRepo) addInitialLogicGateInformationLocked(companyID, logicGateID string, initial ProjectScopedInitialInformationInput, actorUserID string) (domain.LogicGateInformation, error) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return domain.LogicGateInformation{}, ErrNotFound
	}
	now := time.Now().UTC()
	k := key(companyID, logicGateID)
	item := domain.LogicGateInformation{
		CompanyID:        companyID,
		InformationID:    newUUIDv7String(),
		LogicGateID:      logicGateID,
		Type:             strings.TrimSpace(initial.Type),
		Information:      initial.Information,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.logicGateInfo[k] = append(r.logicGateInfo[k], item)
	sort.Slice(r.logicGateInfo[k], func(i, j int) bool {
		return r.logicGateInfo[k][i].CreatedTimestamp.Before(r.logicGateInfo[k][j].CreatedTimestamp)
	})
	keyValue := cleanUUIDText(initial.InformationID)
	if keyValue == "" {
		keyValue = item.InformationID
	}
	if r.logicGateText[k] == nil {
		r.logicGateText[k] = map[string]domain.LogicGateProjection{}
	}
	projection := domain.LogicGateProjection{
		CompanyID:        companyID,
		LogicGateID:      logicGateID,
		Type:             item.Type,
		Information:      initial.Information,
		InformationID:    keyValue,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.logicGateText[k][keyValue] = projection
	if eventInput, ok := EditorProjectionUpsertEventInput(companyID, actorUserID, "", EditorProjectionRowFromLogicGate(projection)); ok {
		if _, err := r.appendEventRowsLocked([]EventRowInput{eventInput}); err != nil {
			return domain.LogicGateInformation{}, err
		}
	}
	return item, nil
}
