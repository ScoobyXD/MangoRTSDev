package store

func (r *MemoryRepo) CreateRacioMatrixNode(input RacioMatrixNodeCreateInput) (RacioMatrixNodeCreateResult, error) {
	input, err := NormalizeRacioMatrixNodeCreateInput(input)
	if err != nil {
		return RacioMatrixNodeCreateResult{}, err
	}

	result := RacioMatrixNodeCreateResult{}
	ownedProjectionDeltas := []ProjectionDelta{}
	logicGateID := input.LogicGateID
	if input.CreateLogicGateHeader != "" {
		batch, err := r.CreateWorkspaceEntityBatch(WorkspaceEntityBatchInput{
			CompanyID:                input.CompanyID,
			EntityKind:               "logic_gate",
			CreatorUserID:            input.ActorUserID,
			CreatorLogicGateRaciRole: input.CreatorLogicGateRaciRole,
			Items: []WorkspaceEntityBatchItemInput{{
				ClientID: "racio-matrix-logic-gate",
				Title:    input.CreateLogicGateHeader,
			}},
		})
		if err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		if len(batch.LogicGates) == 0 {
			return RacioMatrixNodeCreateResult{}, ErrNotFound
		}
		logicGate := batch.LogicGates[0]
		logicGateID = logicGate.LogicGateID
		result.LogicGate = &logicGate
		result.FolderItems = append(result.FolderItems, batch.FolderItems...)
		r.mu.RLock()
		deltas := diffRacioProjectionRows(nil, r.racioProjectionRowsForResourcesLocked(input.CompanyID, nil, []string{logicGateID}))
		result.ProjectionDeltas = append(result.ProjectionDeltas, deltas...)
		ownedProjectionDeltas = append(ownedProjectionDeltas, deltas...)
		r.mu.RUnlock()
		eventInputs := []DomainEventInput{
			logicGateCreatedWorkspaceEventInput(logicGate, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)),
		}
		if len(batch.FolderItems) > 0 {
			eventInputs = append([]DomainEventInput{folderItemAssignedWorkspaceEventInput(batch.FolderItems[0], workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey))}, eventInputs...)
		}
		events, err := r.AppendDomainEvents(eventInputs)
		if err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		result.Events = append(result.Events, events...)
		if _, err := r.AppendEventRows(RacioProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, ownedProjectionDeltas)); err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
	}

	if logicGateID != "" {
		assignmentResult, err := r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
			CompanyID:           input.CompanyID,
			LogicGateID:         logicGateID,
			NodeID:              input.NodeID,
			Status:              input.Status,
			ColumnID:            input.ColumnID,
			NodeTitle:           input.Title,
			CreateNodeTitle:     input.Title,
			DescriptionSnapshot: input.DescriptionSnapshot,
			Position:            input.Position,
			Priority:            input.Priority,
			PrioritySet:         input.PrioritySet,
			IsIssue:             input.IsIssue,
			IsIssueSet:          input.IsIssueSet,
			AssigneePolicy:      input.AssigneePolicy,
			ActorUserID:         input.ActorUserID,
			IdempotencyKey:      input.IdempotencyKey,
		})
		if err != nil {
			return RacioMatrixNodeCreateResult{}, err
		}
		assignment := assignmentResult.Assignment
		card := assignmentResult.Card
		result.Node = assignmentResult.Node
		result.Assignment = &assignment
		result.Card = &card
		result.Events = append(result.Events, assignmentResult.Events...)
		result.ProjectionDeltas = append(result.ProjectionDeltas, assignmentResult.ProjectionDeltas...)
		r.mu.RLock()
		if folderItem, ok := r.folderItems[folderItemKey(input.CompanyID, "node", input.NodeID)]; ok {
			result.FolderItems = append(result.FolderItems, folderItem)
		}
		r.mu.RUnlock()
		return result, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	snapshot := r.snapshotNodeGraphEventStateLocked()
	node, err := r.createNodeWithAssigneeIDLocked(input.CompanyID, input.NodeID, input.Title, input.ActorUserID)
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return RacioMatrixNodeCreateResult{}, err
	}
	result.Node = node
	if folderItem, ok := r.folderItems[folderItemKey(input.CompanyID, "node", node.NodeID)]; ok {
		result.FolderItems = append(result.FolderItems, folderItem)
	}
	result.ProjectionDeltas = diffRacioProjectionRows(nil, r.racioProjectionRowsForResourcesLocked(input.CompanyID, []string{node.NodeID}, nil))
	event, err := r.appendDomainEventLocked(nodeCreatedWorkspaceEventInputWithMetadata(result.Node, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return RacioMatrixNodeCreateResult{}, err
	}
	result.Events = append(result.Events, event)
	if _, err := r.appendEventRowsLocked(RacioProjectionDeltaEventInputs(input.CompanyID, input.ActorUserID, input.IdempotencyKey, result.ProjectionDeltas)); err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return RacioMatrixNodeCreateResult{}, err
	}
	return result, nil
}
