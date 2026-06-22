package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateWorkspaceEntityBatch(input WorkspaceEntityBatchInput) (WorkspaceEntityBatchResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	result := WorkspaceEntityBatchResult{
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
	if targetFolderID != "" {
		folder, ok := r.folders[key(input.CompanyID, targetFolderID)]
		if !ok {
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
			if input.CreatorUserID != "" {
				if _, ok := r.companyUserByIDLocked(input.CompanyID, input.CreatorUserID); !ok {
					return WorkspaceEntityBatchResult{}, ErrPrincipalNotInCompany
				}
				assignment := r.resourceGVICAssignmentForPrincipalLocked(resourceGVICKey{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: created.NodeID}, normalizedGVICAssignmentInput{
					role:          domain.GVICRoleGenerated,
					principalType: EntityPermissionSubjectUser,
					principalID:   input.CreatorUserID,
				}, now)
				assignment.UpdatedTimestamp = now
				r.gvicAssignments[gvicSourceAssignmentKey(assignment.CompanyID, assignment.ResourceType, assignment.ResourceID, assignment.Role, assignment.PrincipalType, assignment.PrincipalID)] = assignment
			}
			r.nodes[key(input.CompanyID, created.NodeID)] = created
			r.syncGVICMatrixProjectionForNodeLocked(input.CompanyID, created.NodeID)
			r.syncResourceGVICEffectiveAssignmentsLocked([]resourceGVICKey{{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: created.NodeID}})
			if input.CreatorUserID != "" {
				created.EffectiveAccess = r.effectiveAccessLevelForUserLocked(input.CompanyID, input.CreatorUserID, EntityTypeNode, created.NodeID)
			}
			result.Nodes = append(result.Nodes, r.withNodeReadModelLocked(created))
			clientToEntityID[item.ClientID] = created.NodeID
			result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.NodeID})

			position := domain.NodeMapPosition{
				CompanyID:        input.CompanyID,
				NodeID:           created.NodeID,
				X:                item.X,
				Y:                item.Y,
				UpdatedTimestamp: now,
			}
			r.nodeMapPositions[key(input.CompanyID, created.NodeID)] = position
			result.NodeMapPositions = append(result.NodeMapPositions, position)
			continue
		}

		created := domain.LogicGate{
			CompanyID:        input.CompanyID,
			LogicGateID:      newUUIDv7String(),
			Header:           item.Title,
			DefaultAccess:    ResourceDefaultAccessEdit,
			CreatedTimestamp: now,
		}
		r.logicGates[key(input.CompanyID, created.LogicGateID)] = created
		r.ensureLogicGateKanbanBoardLocked(input.CompanyID, created.LogicGateID, created.Header)
		if input.CreatorUserID != "" && input.CreatorLogicGateGVICRole != "" {
			if _, ok := r.companyUserByIDLocked(input.CompanyID, input.CreatorUserID); !ok {
				return WorkspaceEntityBatchResult{}, ErrPrincipalNotInCompany
			}
			assignment := r.resourceGVICAssignmentForPrincipalLocked(resourceGVICKey{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: created.LogicGateID}, normalizedGVICAssignmentInput{
				role:          input.CreatorLogicGateGVICRole,
				principalType: EntityPermissionSubjectUser,
				principalID:   input.CreatorUserID,
			}, now)
			assignment.UpdatedTimestamp = now
			r.gvicAssignments[gvicSourceAssignmentKey(assignment.CompanyID, assignment.ResourceType, assignment.ResourceID, assignment.Role, assignment.PrincipalType, assignment.PrincipalID)] = assignment
			created.GVICAssignments = logicGateGVICAssignmentsFromResources([]domain.ResourceGVICAssignment{assignment})
			r.syncResourceGVICEffectiveAssignmentsLocked([]resourceGVICKey{{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: created.LogicGateID}})
		}
		if input.CreatorUserID != "" {
			created.EffectiveAccess = r.effectiveAccessLevelForUserLocked(input.CompanyID, input.CreatorUserID, EntityTypeLogicGate, created.LogicGateID)
		}
		result.LogicGates = append(result.LogicGates, created)
		clientToEntityID[item.ClientID] = created.LogicGateID
		result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.LogicGateID})

		position := domain.LogicGateMapPosition{
			CompanyID:        input.CompanyID,
			LogicGateID:      created.LogicGateID,
			X:                item.X,
			Y:                item.Y,
			UpdatedTimestamp: now,
		}
		r.logicMapPositions[key(input.CompanyID, created.LogicGateID)] = position
		result.LogicGateMapPositions = append(result.LogicGateMapPositions, position)
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

	for _, relationship := range input.Relationships {
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

		if input.EntityKind == "node" {
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
			continue
		}

		if _, ok := r.logicGates[key(input.CompanyID, entityIDA)]; !ok {
			return WorkspaceEntityBatchResult{}, ErrNotFound
		}
		if _, ok := r.logicGates[key(input.CompanyID, entityIDB)]; !ok {
			return WorkspaceEntityBatchResult{}, ErrNotFound
		}
		item := domain.LogicGateRelationship{
			CompanyID:               input.CompanyID,
			LogicGateRelationshipID: newUUIDv7String(),
			LogicGateIDA:            entityIDA,
			LogicGateIDB:            entityIDB,
			APosition:               relationship.APosition,
			BPosition:               relationship.BPosition,
			CreatedTimestamp:        now,
		}
		r.logicGateRels[input.CompanyID] = append(r.logicGateRels[input.CompanyID], item)
		result.LogicGateRelationships = append(result.LogicGateRelationships, item)
	}

	return result, nil
}
