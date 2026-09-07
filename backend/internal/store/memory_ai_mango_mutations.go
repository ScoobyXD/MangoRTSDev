package store

import "context"

// In-memory AI storage is only a fixture; reuse the existing state snapshots to
// give fixture failures the same all-or-nothing behavior as the SQL transaction.
func memoryAIMutation[T any](r *MemoryRepo, ctx context.Context, requested AIRun, action aiActionKey, authorize func() bool, command func() (T, error)) (T, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result T
	if err := ctx.Err(); err != nil {
		return result, err
	}
	run, err := r.aiRunLocked(requested.CompanyID, requested.UserID, requested.RunID)
	if err != nil {
		return result, err
	}
	if !aiMutationRunMatches(run, requested, action) || !authorize() {
		return result, ErrNotFound
	}
	if found, err := r.loadAIActionLocked(run, action, &result); err != nil {
		return result, err
	} else if found {
		return result, nil
	}
	snapshot := r.snapshotRecycleStateLocked()
	events, timeline := cloneMap(r.domainEvents), cloneMap(r.nodeTimelineEvents)
	outbox, sequence := cloneMap(r.realtimeOutbox), r.realtimeOutboxSequence
	versions, readVersions := cloneMemorySliceMap(r.editorJSONVersions), cloneMap(r.workspaceReadVersions)
	completion := cloneMap(r.nodeCompletionTransitions)
	result, err = command()
	if err == nil {
		run, err = appendAIHistory(run, aiMutationEvent(action))
	}
	if err == nil {
		err = r.saveAIActionLocked(run, action, result)
	}
	if err != nil {
		r.restoreRecycleSnapshotLocked(snapshot)
		r.domainEvents, r.nodeTimelineEvents = events, timeline
		r.realtimeOutbox, r.realtimeOutboxSequence = outbox, sequence
		r.editorJSONVersions, r.workspaceReadVersions = versions, readVersions
		r.nodeCompletionTransitions = completion
		return result, err
	}
	r.aiRuns[aiScopeKey(run.CompanyID, run.UserID, run.RunID)] = run
	return result, nil
}

func (r *MemoryRepo) AIUpdateNode(ctx context.Context, run AIRun, actionKey string, input UpdateNodeInput) (AINodeUpdateResult, error) {
	input.CompanyID, input.ActorUserID = run.CompanyID, run.UserID
	return memoryAIMutation(r, ctx, run, aiActionKey{"mango_update_node", actionKey}, func() bool {
		return r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeNode, input.NodeID, EntityPermissionEdit)
	}, func() (AINodeUpdateResult, error) {
		node, event, err := r.updateNodeAndWorkspaceEventLocked(input)
		return AINodeUpdateResult{Node: node, Event: event}, err
	})
}

func (r *MemoryRepo) AIMoveNode(ctx context.Context, run AIRun, actionKey string, input LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error) {
	input.CompanyID, input.ActorUserID = run.CompanyID, run.UserID
	input.IdempotencyKey = "ai:" + run.RunID + ":mango_move_node:" + actionKey
	input, err := NormalizeLogicGateNodeAssignmentMoveInput(input)
	if err != nil {
		return LogicGateNodeAssignmentResult{}, err
	}
	return memoryAIMutation(r, ctx, run, aiActionKey{"mango_move_node", actionKey}, func() bool {
		previous, found := r.nodeLogicGateAssignmentLocked(run.CompanyID, input.NodeID, "")
		return found && r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeNode, input.NodeID, EntityPermissionEdit) &&
			r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeLogicGate, input.LogicGateID, EntityPermissionEdit) &&
			r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeLogicGate, previous.LogicGateID, EntityPermissionEdit)
	}, func() (LogicGateNodeAssignmentResult, error) { return r.moveLogicGateNodeAssignmentLocked(input) })
}

func (r *MemoryRepo) AICommitEditor(ctx context.Context, run AIRun, actionKey string, input EditorJSONCommitInput) (EditorJSONCommit, error) {
	input, err := aiEditorInput(run, actionKey, input)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	return memoryAIMutation(r, ctx, run, aiActionKey{"mango_update_editor", actionKey}, func() bool {
		resourceType, resourceID := input.Document.ResourceType, input.Document.ResourceID
		if resourceType == EntityTypeProcessStep {
			step, found := r.processSteps[key(run.CompanyID, resourceID)]
			if !found {
				return false
			}
			resourceType, resourceID = EntityTypeLogicGate, step.LogicGateID
		}
		return r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, resourceType, resourceID, EntityPermissionEdit)
	}, func() (EditorJSONCommit, error) { return r.commitEditorJSONDocumentLocked(input) })
}

func (r *MemoryRepo) AICreateEditor(ctx context.Context, run AIRun, actionKey string, input EditorJSONCommitInput) (AIEditorCreateResult, error) {
	input, err := aiNewEditorInput(run, actionKey, input)
	if err != nil {
		return AIEditorCreateResult{}, err
	}
	return memoryAIMutation(r, ctx, run, aiActionKey{"mango_create_editor", actionKey}, func() bool {
		return r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, input.Document.ResourceType, input.Document.ResourceID, EntityPermissionEdit)
	}, func() (AIEditorCreateResult, error) {
		commit, err := r.commitEditorJSONDocumentLocked(input)
		return AIEditorCreateResult{Document: input.Document, Commit: commit}, err
	})
}
