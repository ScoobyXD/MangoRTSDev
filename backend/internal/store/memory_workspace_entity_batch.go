package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateWorkspaceEntityBatch(input WorkspaceEntityBatchInput) (WorkspaceEntityBatchResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	input.MutationOrigin = NormalizeMutationOrigin(input.MutationOrigin)
	if input.EntityKind == EntityTypeNode && strings.TrimSpace(input.FolderID) != "" {
		return WorkspaceEntityBatchResult{}, ErrInvalid
	}
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
	syncDefaultFolderItems := input.EntityKind != EntityTypeNode && targetFolderID == "" && MutationOriginNeedsCompanyExplorerDefaultPlacement(input.MutationOrigin)
	if targetFolderID != "" && input.EntityKind != EntityTypeNode {
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
		r.logicGates[key(input.CompanyID, created.LogicGateID)] = created
		r.ensureLogicGateKanbanBoardLocked(input.CompanyID, created.LogicGateID, created.Header)
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
		r.ensureCompanyExplorerDefaultFoldersLocked(input.CompanyID)
		for _, mapping := range result.EntityMappings {
			if !r.placeCompanyExplorerItemInDefaultFolderLocked(input.CompanyID, input.EntityKind, mapping.EntityID, true) {
				continue
			}
			if item, ok := r.folderItems[folderItemKey(input.CompanyID, input.EntityKind, mapping.EntityID)]; ok {
				result.FolderItems = append(result.FolderItems, item)
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
