package store

func (r *MemoryRepo) CreateGVICMatrixNode(input GVICMatrixNodeCreateInput) (GVICMatrixNodeCreateResult, error) {
	input, err := NormalizeGVICMatrixNodeCreateInput(input)
	if err != nil {
		return GVICMatrixNodeCreateResult{}, err
	}

	result := GVICMatrixNodeCreateResult{}
	logicGateID := input.LogicGateID
	if input.CreateLogicGateHeader != "" {
		batch, err := r.CreateWorkspaceEntityBatch(WorkspaceEntityBatchInput{
			CompanyID:                input.CompanyID,
			EntityKind:               "logic_gate",
			CreatorUserID:            input.ActorUserID,
			CreatorLogicGateGVICRole: input.CreatorLogicGateGVICRole,
			Items: []WorkspaceEntityBatchItemInput{{
				ClientID: "GVICMatrix-matrix-logic-gate",
				Title:    input.CreateLogicGateHeader,
			}},
		})
		if err != nil {
			return GVICMatrixNodeCreateResult{}, err
		}
		if len(batch.LogicGates) == 0 {
			return GVICMatrixNodeCreateResult{}, ErrNotFound
		}
		logicGate := batch.LogicGates[0]
		logicGateID = logicGate.LogicGateID
		result.LogicGate = &logicGate
		result.FolderItems = append(result.FolderItems, batch.FolderItems...)
		r.mu.Lock()
		r.syncGVICMatrixProjectionForLogicGateAssignmentsLocked(input.CompanyID, logicGateID, nil, nil)
		r.mu.Unlock()
		eventInputs := []DomainEventInput{
			logicGateCreatedWorkspaceEventInput(logicGate, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)),
		}
		if len(batch.FolderItems) > 0 {
			eventInputs = append([]DomainEventInput{folderItemAssignedWorkspaceEventInput(batch.FolderItems[0], workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey))}, eventInputs...)
		}
		events, err := r.AppendDomainEvents(eventInputs)
		if err != nil {
			return GVICMatrixNodeCreateResult{}, err
		}
		result.Events = append(result.Events, events...)
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
			ActorUserID:         input.ActorUserID,
			IdempotencyKey:      input.IdempotencyKey,
		})
		if err != nil {
			return GVICMatrixNodeCreateResult{}, err
		}
		assignment := assignmentResult.Assignment
		card := assignmentResult.Card
		result.Node = assignmentResult.Node
		result.Assignment = &assignment
		result.Card = &card
		result.Events = append(result.Events, assignmentResult.Events...)
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
	node, err := r.createNodeWithIDLocked(input.CompanyID, input.NodeID, input.Title)
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return GVICMatrixNodeCreateResult{}, err
	}
	result.Node = node
	if folderItem, ok := r.folderItems[folderItemKey(input.CompanyID, "node", node.NodeID)]; ok {
		result.FolderItems = append(result.FolderItems, folderItem)
	}
	event, err := r.appendDomainEventLocked(nodeCreatedWorkspaceEventInputWithMetadata(result.Node, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return GVICMatrixNodeCreateResult{}, err
	}
	result.Events = append(result.Events, event)
	return result, nil
}
