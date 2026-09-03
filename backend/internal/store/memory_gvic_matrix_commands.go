package store

func (r *MemoryRepo) CreateRACIMatrixNode(input RACIMatrixNodeCreateInput) (RACIMatrixNodeCreateResult, error) {
	input, err := NormalizeRACIMatrixNodeCreateInput(input)
	if err != nil {
		return RACIMatrixNodeCreateResult{}, err
	}

	result := RACIMatrixNodeCreateResult{}
	logicGateID := input.LogicGateID
	if input.CreateLogicGateHeader != "" {
		batch, err := r.CreateWorkspaceEntityBatch(WorkspaceEntityBatchInput{
			CompanyID:                input.CompanyID,
			EntityKind:               "logic_gate",
			CreatorUserID:            input.ActorUserID,
			CreatorLogicGateRACIRole: input.CreatorLogicGateRACIRole,
			Items: []WorkspaceEntityBatchItemInput{{
				ClientID: "RACIMatrix-matrix-logic-gate",
				Title:    input.CreateLogicGateHeader,
			}},
		})
		if err != nil {
			return RACIMatrixNodeCreateResult{}, err
		}
		if len(batch.LogicGates) == 0 {
			return RACIMatrixNodeCreateResult{}, ErrNotFound
		}
		logicGate := batch.LogicGates[0]
		logicGateID = logicGate.LogicGateID
		result.LogicGate = &logicGate
		result.FolderItems = append(result.FolderItems, batch.FolderItems...)
		r.mu.Lock()
		r.syncRACIMatrixProjectionForLogicGateAssignmentsLocked(input.CompanyID, logicGateID, nil, nil)
		r.mu.Unlock()
		eventInputs := []DomainEventInput{
			logicGateCreatedWorkspaceEventInput(logicGate, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)),
		}
		if len(batch.FolderItems) > 0 {
			eventInputs = append([]DomainEventInput{folderItemAssignedWorkspaceEventInput(batch.FolderItems[0], workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey))}, eventInputs...)
		}
		events, err := r.AppendDomainEvents(eventInputs)
		if err != nil {
			return RACIMatrixNodeCreateResult{}, err
		}
		result.Events = append(result.Events, events...)
	}

	if logicGateID != "" {
		assignmentResult, err := r.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
			CompanyID:           input.CompanyID,
			LogicGateID:         logicGateID,
			NodeID:              input.NodeID,
			Status:              input.Status,
			ProcessStepID:input.ProcessStepID,
 ProcessStepIDSet:input.ProcessStepIDSet,
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
			return RACIMatrixNodeCreateResult{}, err
		}
		assignment := assignmentResult.Assignment
		result.Node = assignmentResult.Node
		result.Assignment = &assignment
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
		return RACIMatrixNodeCreateResult{}, err
	}
	result.Node = node
	if folderItem, ok := r.folderItems[folderItemKey(input.CompanyID, "node", node.NodeID)]; ok {
		result.FolderItems = append(result.FolderItems, folderItem)
	}
	event, err := r.appendDomainEventLocked(nodeCreatedWorkspaceEventInputWithMetadata(result.Node, workItemAssignmentEventMetadataFromValues(input.ActorUserID, input.IdempotencyKey)))
	if err != nil {
		r.restoreNodeGraphEventStateLocked(snapshot)
		return RACIMatrixNodeCreateResult{}, err
	}
	result.Events = append(result.Events, event)
	return result, nil
}
