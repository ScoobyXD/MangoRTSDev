package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) CreateWorkspaceEntityBatch(input WorkspaceEntityBatchInput) (WorkspaceEntityBatchResult, error) {
	ctx := ContextWithTimingRecorder(context.Background(), input.TimingRecorder)
	defer observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.transaction")()
	input.MutationOrigin = NormalizeMutationOrigin(input.MutationOrigin)
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
		stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.creator_assignee_read")
		creatorAssignee, err = loadPostgresNodeAssigneeReadModel(ctx, tx, input.CompanyID, input.CreatorUserID)
		stop()
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		input.CreatorUserID = creatorAssignee.UserID
	}

	syncFolderItems := MutationOriginNeedsCompanyExplorerFolderItem(input.MutationOrigin)
	if (input.MutationOrigin == MutationOriginNodeMap || input.MutationOrigin == MutationOriginLogicGateMap) && strings.TrimSpace(input.FolderID) != "" {
		syncFolderItems = true
	}
	syncMapPositions := (input.EntityKind == "node" && MutationOriginNeedsNodeMapPosition(input.MutationOrigin)) ||
		(input.EntityKind == "logic_gate" && MutationOriginNeedsLogicGateMapPosition(input.MutationOrigin))

	targetFolderID := input.FolderID
	targetFolderKind := input.EntityKind
	if syncFolderItems {
		stopFolderSetup := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.folder_setup")
		if input.EntityKind == "node" {
			activeFolder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, input.CompanyID, CompanyExplorerSystemActiveNodesKey)
			if err != nil {
				stopFolderSetup()
				return WorkspaceEntityBatchResult{}, err
			}
			targetFolderID = activeFolder.FolderID
			targetFolderKind = activeFolder.FolderKind
		} else if input.FolderID == "" {
			activeFolder, err := ensureCompanyExplorerSystemFolderSQL(ctx, tx, input.CompanyID, CompanyExplorerSystemActiveLogicGatesKey)
			if err != nil {
				stopFolderSetup()
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
					stopFolderSetup()
					return WorkspaceEntityBatchResult{}, ErrNotFound
				}
				stopFolderSetup()
				return WorkspaceEntityBatchResult{}, err
			}
		}
		stopFolderSetup()
	}

	clientToEntityID := make(map[string]string, len(input.Items))
	for _, item := range input.Items {
		if input.EntityKind == "node" {
			created := domain.Node{
				CompanyID:     input.CompanyID,
				NodeID:        newUUIDv7String(),
				Title:         item.Title,
				DefaultAccess: ResourceDefaultAccessEdit,
			}
			stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.node_writes")
			if err := tx.QueryRowContext(ctx,
				`insert into nodes (company_id, node_id, title, assignee_user_id, created_timestamp)
				 values ($1, $2, $3, nullif($4::text, '')::uuid, now())
				 returning company_id, node_id, title, created_timestamp`,
				created.CompanyID, created.NodeID, created.Title, input.CreatorUserID,
			).Scan(&created.CompanyID, &created.NodeID, &created.Title, &created.CreatedTimestamp); err != nil {
				stop()
				return WorkspaceEntityBatchResult{}, err
			}
			stop()
			if input.CreatorUserID != "" {
				applyPostgresNodeAssigneeReadModel(&created, creatorAssignee)
			}
			if err := syncPostgresRacioProjectionForNewNodeTx(ctx, tx, input.CompanyID, created.NodeID); err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			if input.CreatorUserID != "" {
				created.EffectiveAccess, _ = r.effectiveAccessLevelForUserTx(ctx, tx, input.CompanyID, input.CreatorUserID, EntityTypeNode, created.NodeID)
			}
			created.LogicGateIDs = []string{}
			result.Nodes = append(result.Nodes, created)
			clientToEntityID[item.ClientID] = created.NodeID
			result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.NodeID})

			position := domain.NodeMapPosition{CompanyID: input.CompanyID, NodeID: created.NodeID, X: item.X, Y: item.Y}
			if syncMapPositions {
				stop = observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.map_position_writes")
				if err := tx.QueryRowContext(ctx,
					`insert into node_map_positions (company_id, node_id, x, y, updated_timestamp)
					 values ($1, $2, $3, $4, now())
					 returning company_id, node_id, x, y, updated_timestamp`,
					input.CompanyID, created.NodeID, item.X, item.Y,
				).Scan(&position.CompanyID, &position.NodeID, &position.X, &position.Y, &position.UpdatedTimestamp); err != nil {
					stop()
					return WorkspaceEntityBatchResult{}, err
				}
				stop()
				result.NodeMapPositions = append(result.NodeMapPositions, position)
			} else {
				result.DeferredNodeMapPositions = append(result.DeferredNodeMapPositions, position)
			}
			continue
		}

		created := domain.LogicGate{
			CompanyID:     input.CompanyID,
			LogicGateID:   newUUIDv7String(),
			Header:        item.Title,
			DefaultAccess: ResourceDefaultAccessEdit,
		}
		stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.logic_gate_writes")
		if err := tx.QueryRowContext(ctx,
			`insert into logic_gates (company_id, logic_gate_id, header, created_timestamp)
			 values ($1, $2, $3, now())
			 returning company_id, logic_gate_id, header, created_timestamp`,
			created.CompanyID, created.LogicGateID, created.Header,
		).Scan(&created.CompanyID, &created.LogicGateID, &created.Header, &created.CreatedTimestamp); err != nil {
			stop()
			return WorkspaceEntityBatchResult{}, err
		}
		stop()
		if input.CreatorUserID != "" && input.CreatorLogicGateRaciRole != "" {
			assignment := domain.LogicGateRaciAssignment{
				CompanyID:   input.CompanyID,
				LogicGateID: created.LogicGateID,
				Role:        input.CreatorLogicGateRaciRole,
				UserID:      input.CreatorUserID,
			}
			stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.raci_assignment_writes")
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
				stop()
				return WorkspaceEntityBatchResult{}, err
			}
			stop()
			if creatorAssignee.Name != nil {
				assignment.UserDisplayName = strings.TrimSpace(*creatorAssignee.Name)
			}
			if creatorAssignee.Email != nil {
				assignment.UserEmail = strings.TrimSpace(*creatorAssignee.Email)
			}
			created.RaciAssignments = []domain.LogicGateRaciAssignment{assignment}
			stop = observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.racio_projection_sync")
			if err := syncPostgresRacioProjectionForLogicGateAssignmentsTx(ctx, tx, input.CompanyID, created.LogicGateID, nil, created.RaciAssignments); err != nil {
				stop()
				return WorkspaceEntityBatchResult{}, err
			}
			stop()
		}
		if input.CreatorUserID != "" {
			created.EffectiveAccess, _ = r.effectiveAccessLevelForUserTx(ctx, tx, input.CompanyID, input.CreatorUserID, EntityTypeLogicGate, created.LogicGateID)
		}
		result.LogicGates = append(result.LogicGates, created)
		clientToEntityID[item.ClientID] = created.LogicGateID
		result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.LogicGateID})

		position := domain.LogicGateMapPosition{CompanyID: input.CompanyID, LogicGateID: created.LogicGateID, X: item.X, Y: item.Y}
		if syncMapPositions {
			stop = observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.map_position_writes")
			if err := tx.QueryRowContext(ctx,
				`insert into logic_gate_map_positions (company_id, logic_gate_id, x, y, updated_timestamp)
				 values ($1, $2, $3, $4, now())
				 returning company_id, logic_gate_id, x, y, updated_timestamp`,
				input.CompanyID, created.LogicGateID, item.X, item.Y,
			).Scan(&position.CompanyID, &position.LogicGateID, &position.X, &position.Y, &position.UpdatedTimestamp); err != nil {
				stop()
				return WorkspaceEntityBatchResult{}, err
			}
			stop()
			result.LogicGateMapPositions = append(result.LogicGateMapPositions, position)
		} else {
			result.DeferredLogicGateMapPositions = append(result.DeferredLogicGateMapPositions, position)
		}
	}

	if syncFolderItems && targetFolderID != "" {
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
			stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.folder_item_writes")
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
				stop()
				return WorkspaceEntityBatchResult{}, err
			}
			stop()
			if itemPosition >= position {
				position = itemPosition + 1000
			} else {
				position += 1000
			}
			result.FolderItems = append(result.FolderItems, item)
		}
	} else if !syncFolderItems {
		systemFolderKey := CompanyExplorerSystemActiveLogicGatesKey
		if input.EntityKind == "node" {
			systemFolderKey = CompanyExplorerSystemActiveNodesKey
		}
		for _, mapping := range result.EntityMappings {
			result.DeferredFolderItems = append(result.DeferredFolderItems, DeferredCompanyExplorerFolderItemAssignment{
				FolderID:        input.FolderID,
				SystemFolderKey: systemFolderKey,
				ItemType:        input.EntityKind,
				ItemID:          mapping.EntityID,
			})
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
			stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.relationship_writes")
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
				stop()
				return WorkspaceEntityBatchResult{}, err
			}
			stop()
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
		stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.relationship_writes")
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
			stop()
			return WorkspaceEntityBatchResult{}, err
		}
		stop()
		result.LogicGateRelationships = append(result.LogicGateRelationships, item)
	}

	stopCommit := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.commit")
	if err := tx.Commit(); err != nil {
		stopCommit()
		return WorkspaceEntityBatchResult{}, err
	}
	stopCommit()
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
