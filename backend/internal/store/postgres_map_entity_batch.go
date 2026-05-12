package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

func (r *PostgresRepo) CreateMapEntityBatch(input MapEntityBatchInput) (MapEntityBatchResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return MapEntityBatchResult{}, err
	}
	defer tx.Rollback()

	result := MapEntityBatchResult{
		CompanyID:      input.CompanyID,
		EntityKind:     input.EntityKind,
		EntityMappings: make([]MapEntityBatchEntityMapping, 0, len(input.Items)),
	}

	targetFolderKind := input.EntityKind
	if input.FolderID != "" {
		if err := tx.QueryRowContext(ctx,
			`select folder_kind
			 from company_explorer_folders
			 where company_id=$1 and folder_id=$2`,
			input.CompanyID, input.FolderID,
		).Scan(&targetFolderKind); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return MapEntityBatchResult{}, ErrNotFound
			}
			return MapEntityBatchResult{}, err
		}
	}

	clientToEntityID := make(map[string]string, len(input.Items))
	for _, item := range input.Items {
		if input.EntityKind == "node" {
			created := domain.Node{
				CompanyID: input.CompanyID,
				NodeID:    newUUIDv7String(),
				Title:     item.Title,
			}
			if err := tx.QueryRowContext(ctx,
				`insert into nodes (company_id, node_id, title, created_timestamp)
				 values ($1, $2, $3, now())
				 returning company_id, node_id, title, created_timestamp`,
				created.CompanyID, created.NodeID, created.Title,
			).Scan(&created.CompanyID, &created.NodeID, &created.Title, &created.CreatedTimestamp); err != nil {
				return MapEntityBatchResult{}, err
			}
			result.Nodes = append(result.Nodes, created)
			clientToEntityID[item.ClientID] = created.NodeID
			result.EntityMappings = append(result.EntityMappings, MapEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.NodeID})

			var position domain.NodeMapPosition
			if err := tx.QueryRowContext(ctx,
				`insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
				 values ($1, $2, $3, $4, now())
				 returning company_id, node_id, x, y, updated_timestamp`,
				input.CompanyID, created.NodeID, item.X, item.Y,
			).Scan(&position.CompanyID, &position.NodeID, &position.X, &position.Y, &position.UpdatedTimestamp); err != nil {
				return MapEntityBatchResult{}, err
			}
			result.NodeMapPositions = append(result.NodeMapPositions, position)
			continue
		}

		created := domain.LogicGate{
			CompanyID:   input.CompanyID,
			LogicGateID: newUUIDv7String(),
			Header:      item.Title,
		}
		if err := tx.QueryRowContext(ctx,
			`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
			 values ($1, $2, $3, now())
			 returning company_id, logic_gate_id, header, created_timestamp`,
			created.CompanyID, created.LogicGateID, created.Header,
		).Scan(&created.CompanyID, &created.LogicGateID, &created.Header, &created.CreatedTimestamp); err != nil {
			return MapEntityBatchResult{}, err
		}
		if err := ensureLogicGateKanbanBoardSQL(ctx, tx, input.CompanyID, created.LogicGateID, created.Header); err != nil {
			return MapEntityBatchResult{}, err
		}
		result.LogicGates = append(result.LogicGates, created)
		clientToEntityID[item.ClientID] = created.LogicGateID
		result.EntityMappings = append(result.EntityMappings, MapEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.LogicGateID})

		var position domain.LogicGateMapPosition
		if err := tx.QueryRowContext(ctx,
			`insert into logic_gate_map_positions (company_id, logic_gate_id, x, y, updated_timestamp)
			 values ($1, $2, $3, $4, now())
			 returning company_id, logic_gate_id, x, y, updated_timestamp`,
			input.CompanyID, created.LogicGateID, item.X, item.Y,
		).Scan(&position.CompanyID, &position.LogicGateID, &position.X, &position.Y, &position.UpdatedTimestamp); err != nil {
			return MapEntityBatchResult{}, err
		}
		result.LogicGateMapPositions = append(result.LogicGateMapPositions, position)
	}

	if input.FolderID != "" {
		position, err := nextCompanyExplorerSQLRowPosition(ctx, tx, input.CompanyID, targetFolderKind, input.FolderID)
		if err != nil {
			return MapEntityBatchResult{}, err
		}
		for index, mapping := range result.EntityMappings {
			itemPosition := position
			if index < len(input.Items) && input.Items[index].Position > 0 {
				itemPosition = input.Items[index].Position
			}
			var item domain.CompanyExplorerFolderItem
			if err := tx.QueryRowContext(ctx,
				`insert into company_explorer_folder_items
				 (company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp)
				 values ($1, $2, $3, $4, $5, now(), now())
				 returning company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp`,
				input.CompanyID, input.FolderID, input.EntityKind, mapping.EntityID, itemPosition,
			).Scan(
				&item.CompanyID,
				&item.FolderID,
				&item.ItemType,
				&item.ItemID,
				&item.Position,
				&item.CreatedTimestamp,
				&item.UpdatedTimestamp,
			); err != nil {
				return MapEntityBatchResult{}, err
			}
			if itemPosition >= position {
				position = itemPosition + 1000
			} else {
				position += 1000
			}
			result.FolderItems = append(result.FolderItems, item)
		}
	}

	for _, relationship := range input.Relationships {
		entityIDA, entityIDB, err := resolveMapEntityBatchRelationshipIDs(tx, ctx, input, clientToEntityID, relationship)
		if err != nil {
			return MapEntityBatchResult{}, err
		}
		if input.EntityKind == "node" {
			item := domain.NodeRelationship{
				CompanyID:          input.CompanyID,
				NodeRelationshipID: newUUIDv7String(),
				NodeIDA:            entityIDA,
				NodeIDB:            entityIDB,
				APosition:          relationship.APosition,
				BPosition:          relationship.BPosition,
			}
			if err := tx.QueryRowContext(ctx,
				`insert into node_relationships
				 (company_id, node_relationship_id, node_id_a, node_id_b, a_position, b_position, created_timestamp)
				 values ($1, $2, $3, $4, $5::node_relationship_position, $6::node_relationship_position, now())
				 returning company_id, node_relationship_id, node_id_a, node_id_b, a_position::text, b_position::text, created_timestamp`,
				item.CompanyID, item.NodeRelationshipID, item.NodeIDA, item.NodeIDB, item.APosition, item.BPosition,
			).Scan(
				&item.CompanyID,
				&item.NodeRelationshipID,
				&item.NodeIDA,
				&item.NodeIDB,
				&item.APosition,
				&item.BPosition,
				&item.CreatedTimestamp,
			); err != nil {
				return MapEntityBatchResult{}, err
			}
			result.Relationships = append(result.Relationships, item)
			continue
		}

		item := domain.LogicGateRelationship{
			CompanyID:               input.CompanyID,
			LogicGateRelationshipID: newUUIDv7String(),
			LogicGateIDA:            entityIDA,
			LogicGateIDB:            entityIDB,
			APosition:               relationship.APosition,
			BPosition:               relationship.BPosition,
		}
		if err := tx.QueryRowContext(ctx,
			`insert into logic_gate_relationships
			 (company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position, b_position, created_timestamp)
			 values ($1, $2, $3, $4, $5::logic_gate_relationship_position, $6::logic_gate_relationship_position, now())
			 returning company_id, logic_gate_relationship_id, logic_gate_id_a, logic_gate_id_b, a_position::text, b_position::text, created_timestamp`,
			item.CompanyID, item.LogicGateRelationshipID, item.LogicGateIDA, item.LogicGateIDB, item.APosition, item.BPosition,
		).Scan(
			&item.CompanyID,
			&item.LogicGateRelationshipID,
			&item.LogicGateIDA,
			&item.LogicGateIDB,
			&item.APosition,
			&item.BPosition,
			&item.CreatedTimestamp,
		); err != nil {
			return MapEntityBatchResult{}, err
		}
		result.LogicGateRelationships = append(result.LogicGateRelationships, item)
	}

	if err := tx.Commit(); err != nil {
		return MapEntityBatchResult{}, err
	}
	return result, nil
}

func resolveMapEntityBatchRelationshipIDs(tx *sql.Tx, ctx context.Context, input MapEntityBatchInput, clientToEntityID map[string]string, relationship MapEntityBatchRelationshipInput) (string, string, error) {
	entityIDA, err := resolveMapEntityBatchRelationshipID(tx, ctx, input, clientToEntityID, relationship.EntityIDA, relationship.ClientIDA)
	if err != nil {
		return "", "", err
	}
	entityIDB, err := resolveMapEntityBatchRelationshipID(tx, ctx, input, clientToEntityID, relationship.EntityIDB, relationship.ClientIDB)
	if err != nil {
		return "", "", err
	}
	if entityIDA == "" || entityIDB == "" || entityIDA == entityIDB {
		return "", "", ErrInvalid
	}
	return entityIDA, entityIDB, nil
}

func resolveMapEntityBatchRelationshipID(tx *sql.Tx, ctx context.Context, input MapEntityBatchInput, clientToEntityID map[string]string, entityID, clientID string) (string, error) {
	if entityID == "" {
		resolved := clientToEntityID[clientID]
		if resolved == "" {
			return "", ErrInvalid
		}
		return resolved, nil
	}
	var exists bool
	query := `select exists(select 1 from nodes where company_id=$1 and node_id=$2)`
	if input.EntityKind == "logic_gate" {
		query = `select exists(select 1 from logic_gates where company_id=$1 and logic_gate_id=$2)`
	}
	if err := tx.QueryRowContext(ctx, query, input.CompanyID, entityID).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		return "", ErrNotFound
	}
	return entityID, nil
}
