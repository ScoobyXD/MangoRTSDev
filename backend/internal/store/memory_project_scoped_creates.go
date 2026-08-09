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
	RACIMatrixProjectionRows      map[string]memoryRACIMatrixProjectionRow
	effectiveAccess               map[string]domain.EffectiveResourceAccess
	domainEvents                  map[string]domain.DomainEvent
	workspaceReadVersions         map[string]int64
}

func (r *MemoryRepo) snapshotProjectScopedCreateLocked() memoryProjectScopedCreateSnapshot {
	return memoryProjectScopedCreateSnapshot{
		nodes:                         cloneMemoryMap(r.nodes),
		nodeInfo:                      cloneMemorySliceMap(r.nodeInfo),
		nodeText:                      cloneMemoryNodeText(r.nodeText),
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
		RACIMatrixProjectionRows:      cloneMemoryMap(r.RACIMatrixProjectionRows),
		effectiveAccess:               cloneMemoryMap(r.effectiveAccess),
		domainEvents:                  cloneMemoryMap(r.domainEvents),
		workspaceReadVersions:         cloneMemoryMap(r.workspaceReadVersions),
	}
}

func (r *MemoryRepo) restoreProjectScopedCreateLocked(snapshot memoryProjectScopedCreateSnapshot) {
	r.nodes = snapshot.nodes
	r.nodeInfo = snapshot.nodeInfo
	r.nodeText = snapshot.nodeText
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
	r.RACIMatrixProjectionRows = snapshot.RACIMatrixProjectionRows
	r.effectiveAccess = snapshot.effectiveAccess
	r.domainEvents = snapshot.domainEvents
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
		assignmentEvents = append(assignmentEvents, assignmentResult.Events...)
	}
	gateProjection, err := r.upsertProjectRelationshipSourceLocked(ProjectRelationshipInput{
		CompanyID: input.CompanyID, ProjectID: input.ProjectID, ResourceType: EntityTypeLogicGate,
		ResourceID: input.InitialAssignment.LogicGateID, Position: input.Position,
	})
	if err != nil {
		rollback()
		return ProjectScopedNodeCreateResult{}, err
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
	if err := r.syncProjectRelationshipProjectionLocked(input.CompanyID, relationshipID); err != nil {
		rollback()
		return ProjectScopedNodeCreateResult{}, err
	}
	projection := r.projectRelationshipProjection[projectRelationshipKey(input.CompanyID, relationshipID)]
	r.syncRACIMatrixProjectionForProjectResourcesLocked(input.CompanyID, []string{node.NodeID}, []string{input.InitialAssignment.LogicGateID})
	r.bumpLogicGateWorkReadVersionLocked(input.CompanyID, input.InitialAssignment.LogicGateID)
	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	events, err := r.appendDomainEventsLocked([]DomainEventInput{
		nodeCreatedWorkspaceEventInputWithMetadata(node, meta),
		projectRelationshipUpsertedWorkspaceEventInput(gateProjection, input.ActorUserID),
		projectRelationshipUpsertedWorkspaceEventInput(projection, input.ActorUserID),
	})
	if err != nil {
		rollback()
		return ProjectScopedNodeCreateResult{}, err
	}
	events = append(assignmentEvents, events...)
	return ProjectScopedNodeCreateResult{
		Node:                  r.withNodeReadModelLocked(node),
		Relationship:          &projection,
		ImplicitRelationships: []domain.ProjectRelationshipProjection{gateProjection},
		Information:           information,
		Assignment:            assignment,
		Card:                  card,
		Events:                events,
	}, nil
}

func (r *MemoryRepo) CreateLogicGateAssociatedWithProject(input ProjectScopedLogicGateCreateInput) (ProjectScopedLogicGateCreateResult, error) {
	return ProjectScopedLogicGateCreateResult{}, ErrDirectProjectLogicGate
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
	if assignmentInput.PrioritySet {
		priority, ok := logicGateAssignmentInputPriority(assignmentInput)
		if !ok {
			return LogicGateNodeAssignmentResult{}, ErrInvalid
		}
		nodeValue := r.nodes[key(assignmentInput.CompanyID, assignmentInput.NodeID)]
		nodeValue.Priority = cloneIntPointer(priority)
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
	r.syncRACIResourceKeysLocked(assignmentInput.CompanyID, []resourceRACIKey{{companyID: assignmentInput.CompanyID, resourceType: EntityTypeNode, resourceID: assignmentInput.NodeID}})
	assignment, ok := r.nodeLogicGateAssignmentLocked(assignmentInput.CompanyID, assignmentInput.NodeID, assignmentInput.LogicGateID)
	if !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	result := LogicGateNodeAssignmentResult{
		Card:       r.withKanbanCardProjectionFieldsLocked(card),
		Node:       r.withNodeReadModelLocked(r.nodes[key(assignmentInput.CompanyID, assignmentInput.NodeID)]),
		Assignment: assignment,
	}
	events, err := r.appendDomainEventsLocked(logicGateAssignmentSavedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
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
	return item, nil
}
