package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateWorkspaceEntityBatch(input WorkspaceEntityBatchInput) (result WorkspaceEntityBatchResult, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.createWorkspaceEntityBatchLocked(input)
}

func (r *MemoryRepo) createWorkspaceEntityBatchLocked(input WorkspaceEntityBatchInput) (result WorkspaceEntityBatchResult, err error) {
	input, err = normalizeWorkspaceProcessDefinition(input)
	if err != nil {
		return WorkspaceEntityBatchResult{}, err
	}

	input.MutationOrigin = NormalizeMutationOrigin(input.MutationOrigin)
	if input.EntityKind == EntityTypeLogicGate && len(input.Relationships) > 0 {
		return WorkspaceEntityBatchResult{}, ErrInvalid
	}
	if input.EntityKind == EntityTypeNode && strings.TrimSpace(input.FolderID) != "" {
		return WorkspaceEntityBatchResult{}, ErrInvalid
	}
	now := time.Now().UTC()
	result = WorkspaceEntityBatchResult{
		CompanyID:      input.CompanyID,
		EntityKind:     input.EntityKind,
		EntityMappings: make([]WorkspaceEntityBatchEntityMapping, 0, len(input.Items)),
	}

	input.CreatorUserID = strings.TrimSpace(input.CreatorUserID)
	if input.CreatorUserID != "" {
		if _, ok := r.memberships[membershipKey(input.CompanyID, input.CreatorUserID)]; !ok {
			return WorkspaceEntityBatchResult{}, ErrPrincipalNotInCompany
		}
	}

	targetFolderID := strings.TrimSpace(input.FolderID)
	targetFolderKind := input.EntityKind
	syncDefaultFolderItems := input.EntityKind != EntityTypeNode && targetFolderID == "" && MutationOriginNeedsCompanyExplorerDefaultPlacement(input.MutationOrigin)
	if targetFolderID != "" && input.EntityKind != EntityTypeNode {
		folder, ok := r.folders[key(input.CompanyID, targetFolderID)]
		if !ok {
			return WorkspaceEntityBatchResult{}, ErrNotFound
		}
		if input.CreatorUserID != "" && !r.userHasEffectiveAccessLocked(input.CompanyID, input.CreatorUserID, EntityTypeCompanyExplorerFolder, targetFolderID, EntityPermissionEdit) {
			return WorkspaceEntityBatchResult{}, ErrNotFound
		}
		targetFolderKind = folder.FolderKind
	}

	inputClientIDs := make(map[string]struct{}, len(input.Items))
	for _, item := range input.Items {
		inputClientIDs[item.ClientID] = struct{}{}
	}

	for _, relationship := range input.Relationships {
		if relationship.EntityIDA != "" {
			if input.EntityKind == "node" {
				if _, ok := r.nodes[key(input.CompanyID, relationship.EntityIDA)]; !ok {
					return WorkspaceEntityBatchResult{}, ErrNotFound
				}
			} else if _, ok := r.logicGates[key(input.CompanyID, relationship.EntityIDA)]; !ok {
				return WorkspaceEntityBatchResult{}, ErrNotFound
			}
		} else if _, ok := inputClientIDs[relationship.ClientIDA]; !ok {
			return WorkspaceEntityBatchResult{}, ErrInvalid
		}
		if relationship.EntityIDB != "" {
			if input.EntityKind == "node" {
				if _, ok := r.nodes[key(input.CompanyID, relationship.EntityIDB)]; !ok {
					return WorkspaceEntityBatchResult{}, ErrNotFound
				}
			} else if _, ok := r.logicGates[key(input.CompanyID, relationship.EntityIDB)]; !ok {
				return WorkspaceEntityBatchResult{}, ErrNotFound
			}
		} else if _, ok := inputClientIDs[relationship.ClientIDB]; !ok {
			return WorkspaceEntityBatchResult{}, ErrInvalid
		}
		if relationship.EntityIDA != "" && relationship.EntityIDA == relationship.EntityIDB {
			return WorkspaceEntityBatchResult{}, ErrInvalid
		}
		if relationship.ClientIDA != "" && relationship.ClientIDA == relationship.ClientIDB {
			return WorkspaceEntityBatchResult{}, ErrInvalid
		}
	}

	if definition := input.ProcessDefinition; definition != nil {
		if _, exists := r.logicGates[key(input.CompanyID, definition.LogicGateID)]; exists {
			return WorkspaceEntityBatchResult{}, ErrConflict
		}
		for _, step := range definition.Steps {
			if _, exists := r.processSteps[key(input.CompanyID, step.ProcessStepID)]; exists {
				return WorkspaceEntityBatchResult{}, ErrConflict
			}
		}
		for _, edge := range definition.Relationships {
			if _, exists := r.resourceOperationalRelationships[key(input.CompanyID, edge.ResourceOperationalRelationshipID)]; exists {
				return WorkspaceEntityBatchResult{}, ErrConflict
			}
		}
	}
	beforeMutation := r.snapshotProcessMapMutationLocked()
	if definition := input.ProcessDefinition; definition != nil {
		defer func() {
			if err != nil {
				r.restoreProcessMapMutationLocked(beforeMutation)
				for _, step := range definition.Steps {
					delete(r.processSteps, key(input.CompanyID, step.ProcessStepID))
				}
				delete(r.processStepMaps, key(input.CompanyID, definition.LogicGateID))
				delete(r.editorJSONDocuments, editorJSONMemoryKey(EditorJSONDocumentRef{CompanyID: input.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: definition.LogicGateID, DocumentID: "logic-gate-overview"}))
			}
		}()
	}
	clientToEntityID := make(map[string]string, len(input.Items))
	for _, item := range input.Items {
		if input.EntityKind == "node" {
			created := domain.Node{
				CompanyID:        input.CompanyID,
				NodeID:           newUUIDv7String(),
				Title:            item.Title,
				DefaultAccess:    ResourceDefaultAccessEdit,
				CreatedTimestamp: now,
			}
			r.nodes[key(input.CompanyID, created.NodeID)] = created
			result.Nodes = append(result.Nodes, r.withNodeReadModelLocked(created))
			clientToEntityID[item.ClientID] = created.NodeID
			result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.NodeID})
			continue
		}

		created := domain.LogicGate{
			CompanyID:        input.CompanyID,
			LogicGateID:      newUUIDv7String(),
			Header:           item.Title,
			DefaultAccess:    ResourceDefaultAccessEdit,
			CreatedTimestamp: now,
		}
		if input.ProcessDefinition != nil {
			created.LogicGateID = input.ProcessDefinition.LogicGateID
		}
		r.logicGates[key(input.CompanyID, created.LogicGateID)] = created
		result.LogicGates = append(result.LogicGates, created)
		clientToEntityID[item.ClientID] = created.LogicGateID
		result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.LogicGateID})
	}

	if targetFolderID != "" {
		position := nextCompanyExplorerFolderChildPosition(r.folders, r.folderItems, input.CompanyID, targetFolderID, targetFolderKind)
		for index, mapping := range result.EntityMappings {
			itemPosition := position
			if input.EntityKind != "node" && index < len(input.Items) && input.Items[index].Position > 0 {
				itemPosition = input.Items[index].Position
			}
			item := domain.CompanyExplorerFolderItem{
				CompanyID:        input.CompanyID,
				FolderID:         targetFolderID,
				ItemType:         input.EntityKind,
				ItemID:           mapping.EntityID,
				Position:         itemPosition,
				CreatedTimestamp: now,
				UpdatedTimestamp: now,
			}
			if itemPosition >= position {
				position = itemPosition + 1000
			} else {
				position += 1000
			}
			r.folderItems[folderItemKey(input.CompanyID, input.EntityKind, mapping.EntityID)] = item
			result.FolderItems = append(result.FolderItems, item)
		}
	}

	if syncDefaultFolderItems {
		r.ensureCompanyExplorerV2CompanyGraphLocked(input.CompanyID)
		defaultFolders := r.ensureCompanyExplorerDefaultFoldersLocked(input.CompanyID)
		if err := r.syncMemoryDefaultFolderProcessMapPlacementsLocked(input.CompanyID, defaultFolders); err != nil {
			r.restoreProcessMapMutationLocked(beforeMutation)
			return WorkspaceEntityBatchResult{}, err
		}
		for _, mapping := range result.EntityMappings {
			if !r.placeCompanyExplorerItemInDefaultFolderLocked(input.CompanyID, input.EntityKind, mapping.EntityID, true) {
				continue
			}
			if item, ok := r.folderItems[folderItemKey(input.CompanyID, input.EntityKind, mapping.EntityID)]; ok {
				result.FolderItems = append(result.FolderItems, item)
			}
		}
	}
	if input.EntityKind == EntityTypeLogicGate {
		for _, mapping := range result.EntityMappings {
			folderItem, ok := r.folderItems[folderItemKey(input.CompanyID, EntityTypeLogicGate, mapping.EntityID)]
			if !ok {
				continue
			}
			parentID := folderItem.FolderID
			if _, err := r.syncAutomaticMemoryProcessMapPlacementLocked(input.CompanyID, domain.ProcessMapResourceTypeProcess, mapping.EntityID, &parentID, input.CreatorUserID); err != nil {
				r.restoreProcessMapMutationLocked(beforeMutation)
				return WorkspaceEntityBatchResult{}, err
			}
		}
	}
	if input.CreatorUserID != "" {
		if _, ok := r.companyUserByIDLocked(input.CompanyID, input.CreatorUserID); !ok {
			return WorkspaceEntityBatchResult{}, ErrPrincipalNotInCompany
		}
		for _, mapping := range result.EntityMappings {
			role := domain.RACIRoleResponsible
			if input.EntityKind == EntityTypeLogicGate {
				role = input.CreatorLogicGateRACIRole
			}
			if role == "" {
				continue
			}
			policy, err := r.customizeNewMemoryResourceRACIForCreatorLocked(input.CompanyID, input.EntityKind, mapping.EntityID, role, input.CreatorUserID)
			if err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			if input.EntityKind == EntityTypeNode {
				for index := range result.Nodes {
					if result.Nodes[index].NodeID == mapping.EntityID {
						result.Nodes[index] = r.withNodeReadModelLocked(result.Nodes[index])
						result.Nodes[index].EffectiveAccess = r.effectiveAccessLevelForUserLocked(input.CompanyID, input.CreatorUserID, EntityTypeNode, mapping.EntityID)
					}
				}
			} else {
				for index := range result.LogicGates {
					if result.LogicGates[index].LogicGateID == mapping.EntityID {
						result.LogicGates[index].RACIAssignments = logicGateRACIAssignmentsFromResources(policy.RACIAssignments)
						result.LogicGates[index].EffectiveAccess = r.effectiveAccessLevelForUserLocked(input.CompanyID, input.CreatorUserID, EntityTypeLogicGate, mapping.EntityID)
					}
				}
			}
		}
	}
	for _, relationship := range input.Relationships {
		if input.EntityKind != EntityTypeNode {
			return WorkspaceEntityBatchResult{}, ErrInvalid
		}
		entityIDA := relationship.EntityIDA
		if entityIDA == "" {
			entityIDA = clientToEntityID[relationship.ClientIDA]
		}
		entityIDB := relationship.EntityIDB
		if entityIDB == "" {
			entityIDB = clientToEntityID[relationship.ClientIDB]
		}
		if entityIDA == "" || entityIDB == "" || entityIDA == entityIDB {
			return WorkspaceEntityBatchResult{}, ErrInvalid
		}

		if _, ok := r.nodes[key(input.CompanyID, entityIDA)]; !ok {
			return WorkspaceEntityBatchResult{}, ErrNotFound
		}
		if _, ok := r.nodes[key(input.CompanyID, entityIDB)]; !ok {
			return WorkspaceEntityBatchResult{}, ErrNotFound
		}
		item := domain.NodeRelationship{
			CompanyID:          input.CompanyID,
			NodeRelationshipID: newUUIDv7String(),
			NodeIDA:            entityIDA,
			NodeIDB:            entityIDB,
			APosition:          relationship.APosition,
			BPosition:          relationship.BPosition,
			CreatedTimestamp:   now,
		}
		r.nodeRels[input.CompanyID] = append(r.nodeRels[input.CompanyID], item)
		result.Relationships = append(result.Relationships, item)
	}

	if definition := input.ProcessDefinition; definition != nil {
		if !r.ensureV2PolicySettingsLocked(input.CompanyID, EntityTypeLogicGate, definition.LogicGateID) {
			return WorkspaceEntityBatchResult{}, ErrNotFound
		}
		policy := r.memoryV2RACIPolicyLocked(input.CompanyID, EntityTypeLogicGate, definition.LogicGateID)
		if definition.RACIAssignments != nil {
			normalized, err := normalizeResourceRACIAssignmentInputs(definition.RACIAssignments)
			if err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			for _, assignment := range normalized {
				if err := r.validateRACIPrincipalLocked(input.CompanyID, assignment.principalType, assignment.principalID); err != nil {
					return WorkspaceEntityBatchResult{}, err
				}
			}
			if policy.ParentPolicy == nil || !normalizedRACIAssignmentsMatch(normalized, policy.ParentPolicy.Assignments) {
				settingKey := resourcePolicyKey(input.CompanyID, EntityTypeLogicGate, definition.LogicGateID)
				setting := r.gvicV2Settings[settingKey]
				setting.Mode, setting.CustomizedSequence = PolicyModeCustomized, r.nextRACIV2SequenceLocked()
				r.gvicV2Settings[settingKey] = setting
				edges := make([]domain.ResourceRACIAssignment, 0, len(normalized))
				for _, assignment := range normalized {
					edges = append(edges, domain.ResourceRACIAssignment{Role: assignment.role, PrincipalType: assignment.principalType, PrincipalID: assignment.principalID})
				}
				r.replaceMemoryRACIEdgesLocked(input.CompanyID, EntityTypeLogicGate, definition.LogicGateID, edges)
				policy = r.memoryV2RACIPolicyLocked(input.CompanyID, EntityTypeLogicGate, definition.LogicGateID)
			}
		}
		result.LogicGates[0].RACIAssignments = logicGateRACIAssignmentsFromResources(policy.RACIAssignments)
		if definition.EditorDocument != nil {
			ref := EditorJSONDocumentRef{CompanyID: input.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: definition.LogicGateID, DocumentID: "logic-gate-overview"}
			r.editorJSONDocuments[editorJSONMemoryKey(ref)] = memoryEditorJSONDocument{Ref: ref, Revision: 1, SchemaVersion: MangoTiptapSchemaVersion, CollaborationEpoch: newUUIDv7String(), JSONDocument: definition.EditorDocument, Annotations: []EditorJSONAnnotation{}, UpdatedTimestamp: now}
		}
		result.ProcessSteps = make([]domain.ProcessStep, 0, len(definition.Steps))
		result.StepRelationships = make([]domain.ResourceOperationalRelationship, 0, len(definition.Relationships))
		for index, source := range definition.Steps {
			step := domain.ProcessStep{CompanyID: input.CompanyID, ProcessStepID: source.ProcessStepID, LogicGateID: definition.LogicGateID, Name: source.Name, Position: (index + 1) * processStepPositionStride, BodyJSON: source.BodyJSON, CreatedTimestamp: now, UpdatedTimestamp: now}
			r.processSteps[key(input.CompanyID, step.ProcessStepID)] = cloneProcessStep(step)
			result.ProcessSteps = append(result.ProcessSteps, step)
		}
		for _, source := range definition.Relationships {
			edge := domain.ResourceOperationalRelationship{CompanyID: input.CompanyID, ResourceOperationalRelationshipID: source.ResourceOperationalRelationshipID, Source: source.Source, Target: source.Target, CreatedTimestamp: now}
			r.resourceOperationalRelationships[key(input.CompanyID, edge.ResourceOperationalRelationshipID)] = edge
			result.StepRelationships = append(result.StepRelationships, edge)
		}
		layout := domain.ProcessStepMapLayout{CompanyID: input.CompanyID, LogicGateID: definition.LogicGateID, Revision: memoryProcessStepMapRevision.Add(1), Steps: definition.Layout.Steps, Routes: definition.Layout.Routes}
		r.processStepMaps[key(input.CompanyID, definition.LogicGateID)] = cloneProcessStepMap(layout)
		result.StepMap = &layout
		inputs := append(WorkspaceEntityBatchEventInputs(result, input.TimingRecorder), processWorkChangedEvent(input.CompanyID, definition.LogicGateID, input.CreatorUserID))
		result.Events, err = r.appendDomainEventsLocked(inputs)
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
	}
	return result, nil
}
