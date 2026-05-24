package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) CreateWorkspaceEntityBatch(input WorkspaceEntityBatchInput) (WorkspaceEntityBatchResult, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return WorkspaceEntityBatchResult{}, err
	}
	defer tx.Rollback()

	result := WorkspaceEntityBatchResult{
		CompanyID:      input.CompanyID,
		EntityKind:     input.EntityKind,
		EntityMappings: make([]WorkspaceEntityBatchEntityMapping, 0, len(input.Items)),
	}

	input.CreatorUserID = strings.TrimSpace(input.CreatorUserID)
	var creatorAssignee postgresNodeAssigneeReadModel
	if input.CreatorUserID != "" {
		creatorAssignee, err = loadPostgresNodeAssigneeReadModel(ctx, tx, input.CompanyID, input.CreatorUserID)
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		input.CreatorUserID = creatorAssignee.UserID
	}

	targetFolderID := input.FolderID
	targetFolderKind := input.EntityKind
	if input.EntityKind == "node" {
		activeFolder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, input.CompanyID, CompanyExplorerSystemActiveNodesKey)
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		targetFolderID = activeFolder.FolderID
		targetFolderKind = activeFolder.FolderKind
	} else if input.FolderID == "" {
		activeFolder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, input.CompanyID, CompanyExplorerSystemActiveLogicGatesKey)
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		targetFolderID = activeFolder.FolderID
		targetFolderKind = activeFolder.FolderKind
	} else if input.FolderID != "" {
		if err := tx.QueryRowContext(ctx,
			`select folder_kind
			 from company_explorer_folders
			 where company_id=$1 and folder_id=$2`,
			input.CompanyID, input.FolderID,
		).Scan(&targetFolderKind); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return WorkspaceEntityBatchResult{}, ErrNotFound
			}
			return WorkspaceEntityBatchResult{}, err
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
				`insert into nodes (company_id, node_id, title, assignee_user_id, created_timestamp)
				 values ($1, $2, $3, nullif($4::text, '')::uuid, now())
				 returning company_id, node_id, title, created_timestamp`,
				created.CompanyID, created.NodeID, created.Title, input.CreatorUserID,
			).Scan(&created.CompanyID, &created.NodeID, &created.Title, &created.CreatedTimestamp); err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			if input.CreatorUserID != "" {
				applyPostgresNodeAssigneeReadModel(&created, creatorAssignee)
				if _, err := tx.ExecContext(ctx, `
insert into resource_access_grants
  (company_id, resource_type, resource_id, principal_type, principal_id, access_level, created_timestamp)
values ($1::uuid, 'node', $2::uuid, 'user', $3::uuid, 'admin', now())
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do update set
  access_level=excluded.access_level`, input.CompanyID, created.NodeID, input.CreatorUserID); err != nil {
					return WorkspaceEntityBatchResult{}, err
				}
				if err := recomputeDirectGrantEffectiveAccessForResourceTx(ctx, tx, input.CompanyID, EntityTypeNode, created.NodeID); err != nil {
					return WorkspaceEntityBatchResult{}, err
				}
			}
			created.LogicGateIDs = []string{}
			result.Nodes = append(result.Nodes, created)
			clientToEntityID[item.ClientID] = created.NodeID
			result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.NodeID})

			var position domain.NodeMapPosition
			if err := tx.QueryRowContext(ctx,
				`insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
				 values ($1, $2, $3, $4, now())
				 returning company_id, node_id, x, y, updated_timestamp`,
				input.CompanyID, created.NodeID, item.X, item.Y,
			).Scan(&position.CompanyID, &position.NodeID, &position.X, &position.Y, &position.UpdatedTimestamp); err != nil {
				return WorkspaceEntityBatchResult{}, err
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
			return WorkspaceEntityBatchResult{}, err
		}
		if input.CreatorUserID != "" {
			if _, err := tx.ExecContext(ctx, `
insert into resource_access_grants
  (company_id, resource_type, resource_id, principal_type, principal_id, access_level, created_timestamp)
values ($1::uuid, 'logic_gate', $2::uuid, 'user', $3::uuid, 'admin', now())
on conflict (company_id, resource_type, resource_id, principal_type, principal_id) do update set
  access_level=excluded.access_level`, input.CompanyID, created.LogicGateID, input.CreatorUserID); err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			if err := recomputeDirectGrantEffectiveAccessForResourceTx(ctx, tx, input.CompanyID, EntityTypeLogicGate, created.LogicGateID); err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
		}
		if err := ensureLogicGateKanbanBoardSQL(ctx, tx, input.CompanyID, created.LogicGateID, created.Header); err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		if input.CreatorUserID != "" && input.CreatorLogicGateRaciRole != "" {
			assignment := domain.LogicGateRaciAssignment{
				CompanyID:   input.CompanyID,
				LogicGateID: created.LogicGateID,
				Role:        input.CreatorLogicGateRaciRole,
				UserID:      input.CreatorUserID,
			}
			if err := tx.QueryRowContext(ctx, `
insert into logic_gate_raci_assignments
  (company_id, logic_gate_id, role, user_id, created_timestamp)
values ($1, $2, $3, $4, now())
on conflict (company_id, logic_gate_id, role, user_id) do update set
  created_timestamp=logic_gate_raci_assignments.created_timestamp
returning company_id, logic_gate_id, role::text, user_id::text, created_timestamp`,
				input.CompanyID,
				created.LogicGateID,
				input.CreatorLogicGateRaciRole,
				input.CreatorUserID,
			).Scan(
				&assignment.CompanyID,
				&assignment.LogicGateID,
				&assignment.Role,
				&assignment.UserID,
				&assignment.CreatedTimestamp,
			); err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			if creatorAssignee.Name != nil {
				assignment.UserDisplayName = strings.TrimSpace(*creatorAssignee.Name)
			}
			if creatorAssignee.Email != nil {
				assignment.UserEmail = strings.TrimSpace(*creatorAssignee.Email)
			}
			created.RaciAssignments = []domain.LogicGateRaciAssignment{assignment}
			if err := recomputeLogicGateRaciEffectiveAccessTx(ctx, tx, input.CompanyID, created.LogicGateID); err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			if err := recomputeLogicGateAssignedNodeVisibilityTx(ctx, tx, input.CompanyID, []string{created.LogicGateID}, nil); err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
		}
		result.LogicGates = append(result.LogicGates, created)
		clientToEntityID[item.ClientID] = created.LogicGateID
		result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.LogicGateID})

		var position domain.LogicGateMapPosition
		if err := tx.QueryRowContext(ctx,
			`insert into logic_gate_map_positions (company_id, logic_gate_id, x, y, updated_timestamp)
			 values ($1, $2, $3, $4, now())
			 returning company_id, logic_gate_id, x, y, updated_timestamp`,
			input.CompanyID, created.LogicGateID, item.X, item.Y,
		).Scan(&position.CompanyID, &position.LogicGateID, &position.X, &position.Y, &position.UpdatedTimestamp); err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		result.LogicGateMapPositions = append(result.LogicGateMapPositions, position)
	}

	if targetFolderID != "" {
		position, err := nextCompanyExplorerSQLRowPosition(ctx, tx, input.CompanyID, targetFolderKind, targetFolderID)
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		for index, mapping := range result.EntityMappings {
			itemPosition := position
			if input.EntityKind != "node" && index < len(input.Items) && input.Items[index].Position > 0 {
				itemPosition = input.Items[index].Position
			}
			var item domain.CompanyExplorerFolderItem
			if err := tx.QueryRowContext(ctx,
				`insert into company_explorer_folder_items
				 (company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp)
				 values ($1, $2, $3, $4, $5, now(), now())
				 returning company_id, folder_id, item_type, item_id, position, created_timestamp, updated_timestamp`,
				input.CompanyID, targetFolderID, input.EntityKind, mapping.EntityID, itemPosition,
			).Scan(
				&item.CompanyID,
				&item.FolderID,
				&item.ItemType,
				&item.ItemID,
				&item.Position,
				&item.CreatedTimestamp,
				&item.UpdatedTimestamp,
			); err != nil {
				return WorkspaceEntityBatchResult{}, err
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
		entityIDA, entityIDB, err := resolveWorkspaceEntityBatchRelationshipIDs(tx, ctx, input, clientToEntityID, relationship)
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
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
				return WorkspaceEntityBatchResult{}, err
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
			return WorkspaceEntityBatchResult{}, err
		}
		result.LogicGateRelationships = append(result.LogicGateRelationships, item)
	}

	if err := tx.Commit(); err != nil {
		return WorkspaceEntityBatchResult{}, err
	}
	return result, nil
}

func resolveWorkspaceEntityBatchRelationshipIDs(tx *sql.Tx, ctx context.Context, input WorkspaceEntityBatchInput, clientToEntityID map[string]string, relationship WorkspaceEntityBatchRelationshipInput) (string, string, error) {
	entityIDA, err := resolveWorkspaceEntityBatchRelationshipID(tx, ctx, input, clientToEntityID, relationship.EntityIDA, relationship.ClientIDA)
	if err != nil {
		return "", "", err
	}
	entityIDB, err := resolveWorkspaceEntityBatchRelationshipID(tx, ctx, input, clientToEntityID, relationship.EntityIDB, relationship.ClientIDB)
	if err != nil {
		return "", "", err
	}
	if entityIDA == "" || entityIDB == "" || entityIDA == entityIDB {
		return "", "", ErrInvalid
	}
	return entityIDA, entityIDB, nil
}

func resolveWorkspaceEntityBatchRelationshipID(tx *sql.Tx, ctx context.Context, input WorkspaceEntityBatchInput, clientToEntityID map[string]string, entityID, clientID string) (string, error) {
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
