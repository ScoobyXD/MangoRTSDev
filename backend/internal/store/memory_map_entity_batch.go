package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateMapEntityBatch(input MapEntityBatchInput) (MapEntityBatchResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	result := MapEntityBatchResult{
		CompanyID:      input.CompanyID,
		EntityKind:     input.EntityKind,
		EntityMappings: make([]MapEntityBatchEntityMapping, 0, len(input.Items)),
	}

	input.CreatorUserID = strings.TrimSpace(input.CreatorUserID)
	if input.CreatorUserID != "" {
		if _, ok := r.memberships[membershipKey(input.CompanyID, input.CreatorUserID)]; !ok {
			return MapEntityBatchResult{}, ErrAssigneeNotInCompany
		}
	}

	targetFolderID := input.FolderID
	targetFolderKind := input.EntityKind
	if input.EntityKind == "node" {
		activeFolder, ok := r.ensureCompanyExplorerSystemFolderLocked(input.CompanyID, CompanyExplorerSystemActiveNodesKey)
		if !ok {
			return MapEntityBatchResult{}, ErrNotFound
		}
		targetFolderID = activeFolder.FolderID
		targetFolderKind = activeFolder.FolderKind
	} else if input.FolderID != "" {
		folder, ok := r.folders[key(input.CompanyID, input.FolderID)]
		if !ok {
			return MapEntityBatchResult{}, ErrNotFound
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
					return MapEntityBatchResult{}, ErrNotFound
				}
			} else if _, ok := r.logicGates[key(input.CompanyID, relationship.EntityIDA)]; !ok {
				return MapEntityBatchResult{}, ErrNotFound
			}
		} else if _, ok := inputClientIDs[relationship.ClientIDA]; !ok {
			return MapEntityBatchResult{}, ErrInvalid
		}
		if relationship.EntityIDB != "" {
			if input.EntityKind == "node" {
				if _, ok := r.nodes[key(input.CompanyID, relationship.EntityIDB)]; !ok {
					return MapEntityBatchResult{}, ErrNotFound
				}
			} else if _, ok := r.logicGates[key(input.CompanyID, relationship.EntityIDB)]; !ok {
				return MapEntityBatchResult{}, ErrNotFound
			}
		} else if _, ok := inputClientIDs[relationship.ClientIDB]; !ok {
			return MapEntityBatchResult{}, ErrInvalid
		}
		if relationship.EntityIDA != "" && relationship.EntityIDA == relationship.EntityIDB {
			return MapEntityBatchResult{}, ErrInvalid
		}
		if relationship.ClientIDA != "" && relationship.ClientIDA == relationship.ClientIDB {
			return MapEntityBatchResult{}, ErrInvalid
		}
	}

	clientToEntityID := make(map[string]string, len(input.Items))
	for _, item := range input.Items {
		if input.EntityKind == "node" {
			created := domain.Node{
				CompanyID:        input.CompanyID,
				NodeID:           newUUIDv7String(),
				Title:            item.Title,
				CreatedTimestamp: now,
			}
			if input.CreatorUserID != "" {
				created.AssigneeUserID = &input.CreatorUserID
			}
			r.nodes[key(input.CompanyID, created.NodeID)] = created
			if input.CreatorUserID != "" {
				permission := domain.EntityPermission{
					CompanyID:        input.CompanyID,
					EntityType:       EntityTypeNode,
					EntityID:         created.NodeID,
					SubjectType:      EntityPermissionSubjectUser,
					SubjectID:        input.CreatorUserID,
					Permission:       EntityPermissionAdmin,
					AccessLevel:      EntityPermissionAdmin,
					CreatedTimestamp: now,
				}
				r.entityPermissions[entityPermissionKey(input.CompanyID, EntityTypeNode, created.NodeID, EntityPermissionSubjectUser, input.CreatorUserID, EntityPermissionAdmin)] = permission
				if err := r.recomputeDirectGrantEffectiveAccessForResourceLocked(input.CompanyID, EntityTypeNode, created.NodeID); err != nil {
					return MapEntityBatchResult{}, err
				}
			}
			result.Nodes = append(result.Nodes, r.withNodeReadModelLocked(created))
			clientToEntityID[item.ClientID] = created.NodeID
			result.EntityMappings = append(result.EntityMappings, MapEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.NodeID})

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
			CreatedTimestamp: now,
		}
		r.logicGates[key(input.CompanyID, created.LogicGateID)] = created
		if input.CreatorUserID != "" {
			permission := domain.EntityPermission{
				CompanyID:        input.CompanyID,
				EntityType:       EntityTypeLogicGate,
				EntityID:         created.LogicGateID,
				SubjectType:      EntityPermissionSubjectUser,
				SubjectID:        input.CreatorUserID,
				Permission:       EntityPermissionAdmin,
				AccessLevel:      EntityPermissionAdmin,
				CreatedTimestamp: now,
			}
			r.entityPermissions[entityPermissionKey(input.CompanyID, EntityTypeLogicGate, created.LogicGateID, EntityPermissionSubjectUser, input.CreatorUserID, EntityPermissionAdmin)] = permission
			if err := r.recomputeDirectGrantEffectiveAccessForResourceLocked(input.CompanyID, EntityTypeLogicGate, created.LogicGateID); err != nil {
				return MapEntityBatchResult{}, err
			}
		}
		r.ensureLogicGateKanbanBoardLocked(input.CompanyID, created.LogicGateID, created.Header)
		if input.CreatorUserID != "" && input.CreatorLogicGateRaciRole != "" {
			user, ok := r.companyUserByIDLocked(input.CompanyID, input.CreatorUserID)
			if !ok {
				return MapEntityBatchResult{}, ErrAssigneeNotInCompany
			}
			assignment := domain.LogicGateRaciAssignment{
				CompanyID:        input.CompanyID,
				LogicGateID:      created.LogicGateID,
				Role:             input.CreatorLogicGateRaciRole,
				UserID:           input.CreatorUserID,
				UserDisplayName:  strings.TrimSpace(user.DisplayName),
				UserEmail:        strings.TrimSpace(user.Email),
				CreatedTimestamp: now,
			}
			r.logicGateRaci[key(input.CompanyID, created.LogicGateID)] = []domain.LogicGateRaciAssignment{assignment}
			created.RaciAssignments = []domain.LogicGateRaciAssignment{assignment}
			if err := r.recomputeLogicGateRaciEffectiveAccessLocked(input.CompanyID, created.LogicGateID); err != nil {
				return MapEntityBatchResult{}, err
			}
			if err := r.recomputeLogicGateAssignedNodeVisibilityLocked(input.CompanyID, []string{created.LogicGateID}, nil); err != nil {
				return MapEntityBatchResult{}, err
			}
			r.rebuildWorkItemInboxEntriesForLogicGateLocked(input.CompanyID, created.LogicGateID)
		}
		result.LogicGates = append(result.LogicGates, created)
		clientToEntityID[item.ClientID] = created.LogicGateID
		result.EntityMappings = append(result.EntityMappings, MapEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.LogicGateID})

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
			return MapEntityBatchResult{}, ErrInvalid
		}

		if input.EntityKind == "node" {
			if _, ok := r.nodes[key(input.CompanyID, entityIDA)]; !ok {
				return MapEntityBatchResult{}, ErrNotFound
			}
			if _, ok := r.nodes[key(input.CompanyID, entityIDB)]; !ok {
				return MapEntityBatchResult{}, ErrNotFound
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
			return MapEntityBatchResult{}, ErrNotFound
		}
		if _, ok := r.logicGates[key(input.CompanyID, entityIDB)]; !ok {
			return MapEntityBatchResult{}, ErrNotFound
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
