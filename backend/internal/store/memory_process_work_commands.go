package store

import (
	"time"
)

func (r *MemoryRepo) nextProcessWorkPositionLocked(companyID, logicGateID string) int {
	position := 1000
	for _, assignment := range r.nodeLogicGateAssignments {
		if assignment.CompanyID == companyID && assignment.LogicGateID == logicGateID && assignment.Position >= position {
			position = assignment.Position + 1000
		}
	}
	return position
}

func (r *MemoryRepo) AssignNodeToLogicGateStatus(input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()
	result, err := r.assignNodeToLogicGateStatusLocked(input)
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
	}
	return result, err
}
func (r *MemoryRepo) assignNodeToLogicGateStatusLocked(input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error) {
	if _, ok := r.logicGates[key(input.CompanyID, input.LogicGateID)]; !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	if input.Status != "" {
		if status, ok := NormalizeLogicGateWorkStatusKey(input.Status); !ok || status == "" {
			return LogicGateNodeAssignmentResult{}, ErrInvalid
		}
	}
	previous, hadPrevious := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, "")
	stepID := processStepIDForMove(previous.ProcessStepID, previous.LogicGateID, input.LogicGateID, input.ProcessStepID, input.ProcessStepIDSet)
	if !r.processStepBelongsLocked(input.CompanyID, input.LogicGateID, stepID) {
		return LogicGateNodeAssignmentResult{}, ErrInvalid
	}
	nodeKey := key(input.CompanyID, input.NodeID)
	node, exists := r.nodes[nodeKey]
	created := false
	if !exists {
		if input.CreateNodeTitle == "" {
			return LogicGateNodeAssignmentResult{}, ErrNotFound
		}
		var err error
		node, err = r.createNodeWithIDLocked(input.CompanyID, input.NodeID, input.CreateNodeTitle)
		if err != nil {
			return LogicGateNodeAssignmentResult{}, err
		}
		created = true
	}
	previousStatus := nodeWorkStatus(node)
	status := previousStatus
	if input.Status != "" {
		status = LogicGateWorkStatusTitle(input.Status)
	}
	if _, err := normalizeNodeStatusForAssignment(&status, true); err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	node.Status = &status
	if input.PrioritySet {
		node.Priority = cloneIntPointer(input.Priority)
	}
	r.nodes[nodeKey] = node
	position := input.Position
	if position <= 0 {
		position = r.nextProcessWorkPositionLocked(input.CompanyID, input.LogicGateID)
	}
	placedBy := previous.PlacedByUserID
	if !hadPrevious || previous.LogicGateID != input.LogicGateID {
		placedBy = input.ActorUserID
	}
	issue := previous.IsIssue
	if input.IsIssueSet {
		issue = input.IsIssue
	}
	requestedBy := previous.RequestedByUserID
	if !hadPrevious || previous.LogicGateID != input.LogicGateID || previousStatus != status {
		requestedBy = input.ActorUserID
	}
	assignment := r.upsertNodeLogicGateAssignmentLocked(nodeLogicGateAssignmentMutation{CompanyID: input.CompanyID, NodeID: input.NodeID, LogicGateID: input.LogicGateID, ProcessStepID: stepID, IsIssue: issue, Position: position, RequestedByUserID: requestedByUserIDForLogicGateStatus(status, requestedBy, input.ActorUserID), PlacedByUserID: placedBy})
	r.syncRACIResourceKeysLocked(input.CompanyID, []resourceRACIKey{{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: input.NodeID}})
	result := LogicGateNodeAssignmentResult{Node: r.withNodeReadModelLocked(node), Assignment: assignment}
	meta := workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)
	inputs := logicGateAssignmentSavedWorkspaceEventInputs(result, meta)
	if hadPrevious {
		inputs = logicGateAssignmentMovedWorkspaceEventInputs(result, previous, meta)
	}
	if created {
		inputs = append([]DomainEventInput{nodeCreatedWorkspaceEventInputWithMetadata(node, meta)}, inputs...)
	}
	events, err := r.appendDomainEventsLocked(inputs)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	if hadPrevious && previous.LogicGateID != input.LogicGateID {
		r.appendLogicGateTransferTimelineEventLocked(input.CompanyID, input.NodeID, input.ActorUserID, previous.LogicGateID, input.LogicGateID, time.Now().UTC())
	}
	return result, nil
}
func (r *MemoryRepo) MoveLogicGateNodeAssignment(input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentMoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()
	previous, ok := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, "")
	if !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	position := input.Position
	if position <= 0 {
		position = previous.Position
	}
	if previous.LogicGateID != input.LogicGateID && input.Position <= 0 {
		position = 0
	}
	result, err := r.assignNodeToLogicGateStatusLocked(LogicGateNodeAssignmentInput{CompanyID: input.CompanyID, LogicGateID: input.LogicGateID, NodeID: input.NodeID, Status: input.Status, ProcessStepID: input.ProcessStepID, ProcessStepIDSet: input.ProcessStepIDSet, Position: position, Priority: input.Priority, PrioritySet: input.PrioritySet, ActorUserID: input.ActorUserID, IdempotencyKey: input.IdempotencyKey})
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return result, err
	}
	return result, nil
}
func (r *MemoryRepo) RemoveLogicGateNodeAssignment(input LogicGateNodeAssignmentRemoveInput) (LogicGateNodeAssignmentRemoveResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentRemoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()
	assignment, ok := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if !ok {
		return LogicGateNodeAssignmentRemoveResult{}, ErrNotFound
	}
	node, ok := r.nodes[key(input.CompanyID, input.NodeID)]
	if !ok {
		return LogicGateNodeAssignmentRemoveResult{}, ErrNotFound
	}
	delete(r.nodeLogicGateAssignments, nodeLogicGateAssignmentKey(input.CompanyID, input.NodeID))
	r.bumpNodeViewVersionLocked(input.CompanyID, input.NodeID)
	if input.FallbackStatus != nil {
		node.Status = cloneStringPointer(input.FallbackStatus)
		r.nodes[key(input.CompanyID, input.NodeID)] = node
	}
	r.syncRACIResourceKeysLocked(input.CompanyID, []resourceRACIKey{{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: input.NodeID}})
	result := LogicGateNodeAssignmentRemoveResult{Node: r.withNodeReadModelLocked(node), Assignment: assignment}
	events, err := r.appendDomainEventsLocked(logicGateAssignmentRemovedWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentRemoveResult{}, err
	}
	result.Events = events
	return result, nil
}
func (r *MemoryRepo) SetLogicGateNodeAssignmentIssue(input LogicGateNodeAssignmentIssueInput) (LogicGateNodeAssignmentResult, error) {
	input, err := NormalizeLogicGateNodeAssignmentIssueInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotWorkItemAssignmentEventStateLocked()
	assignment, ok := r.nodeLogicGateAssignmentLocked(input.CompanyID, input.NodeID, input.LogicGateID)
	if !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	node, ok := r.nodes[key(input.CompanyID, input.NodeID)]
	if !ok {
		return LogicGateNodeAssignmentResult{}, ErrNotFound
	}
	assignment.IsIssue = input.IsIssue
	assignment.Version++
	assignment.UpdatedTimestamp = time.Now().UTC()
	r.nodeLogicGateAssignments[nodeLogicGateAssignmentKey(input.CompanyID, input.NodeID)] = assignment
	r.bumpNodeViewVersionLocked(input.CompanyID, input.NodeID)
	result := LogicGateNodeAssignmentResult{Node: r.withNodeReadModelLocked(node), Assignment: assignment}
	events, err := r.appendDomainEventsLocked(logicGateAssignmentIssueWorkspaceEventInputs(result, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		r.restoreWorkItemAssignmentEventStateLocked(snapshot)
		return LogicGateNodeAssignmentResult{}, err
	}
	result.Events = events
	return result, nil
}
