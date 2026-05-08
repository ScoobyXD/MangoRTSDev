package store

import (
	"miraeopus/backend/internal/domain"
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

	targetFolderKind := input.EntityKind
	if input.FolderID != "" {
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
			r.nodes[key(input.CompanyID, created.NodeID)] = created
			result.Nodes = append(result.Nodes, created)
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

	if input.FolderID != "" {
		position := nextCompanyExplorerFolderChildPosition(r.folders, r.folderItems, input.CompanyID, input.FolderID, targetFolderKind)
		for index, mapping := range result.EntityMappings {
			itemPosition := position
			if index < len(input.Items) && input.Items[index].Position > 0 {
				itemPosition = input.Items[index].Position
			}
			item := domain.CompanyExplorerFolderItem{
				CompanyID:        input.CompanyID,
				FolderID:         input.FolderID,
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
