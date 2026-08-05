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
	if input.EntityKind == EntityTypeNode && strings.TrimSpace(input.FolderID) != "" {
		return WorkspaceEntityBatchResult{}, ErrInvalid
	}
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
	if input.CreatorUserID != "" {
		stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.creator_user_read")
		creatorUser, err := loadPostgresCompanyMemberReadModel(ctx, tx, input.CompanyID, input.CreatorUserID)
		stop()
		if err != nil {
			return WorkspaceEntityBatchResult{}, err
		}
		input.CreatorUserID = creatorUser.UserID
	}

	syncFolderItems := input.EntityKind != EntityTypeNode && strings.TrimSpace(input.FolderID) != "" && MutationOriginNeedsCompanyExplorerFolderItem(input.MutationOrigin)
	syncDefaultFolderItems := input.EntityKind != EntityTypeNode && strings.TrimSpace(input.FolderID) == "" && MutationOriginNeedsCompanyExplorerDefaultPlacement(input.MutationOrigin)

	targetFolderID := input.FolderID
	targetFolderKind := input.EntityKind
	if syncFolderItems {
		stopFolderSetup := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.folder_setup")
		if input.FolderID != "" {
			if err := tx.QueryRowContext(ctx,
				`select 'folder'::text
				 from company_explorer_folders
				 where company_id=$1::uuid and folder_id=$2::uuid`,
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
				`insert into nodes (company_id, node_id, name, created_timestamp)
				 values ($1, $2, $3, now())
				 returning company_id, node_id, name, created_timestamp`,
				created.CompanyID, created.NodeID, created.Title,
			).Scan(&created.CompanyID, &created.NodeID, &created.Title, &created.CreatedTimestamp); err != nil {
				stop()
				return WorkspaceEntityBatchResult{}, err
			}
			stop()
			if input.CreatorUserID != "" {
				if _, err := tx.ExecContext(ctx, `
insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, 'node', $2::uuid, 'generated', 'user', $3::uuid, now(), now())
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id)
do update set updated_timestamp=resource_gvic_assignments.updated_timestamp`,
					input.CompanyID, created.NodeID, input.CreatorUserID); err != nil {
					return WorkspaceEntityBatchResult{}, err
				}
			}
			if err := syncPostgresGVICMatrixProjectionForNewNodeTx(ctx, tx, input.CompanyID, created.NodeID); err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			err = syncResourceGVICEffectiveAssignmentsTx(ctx, tx, input.CompanyID, []resourceGVICKey{{companyID: input.CompanyID, resourceType: EntityTypeNode, resourceID: created.NodeID}})
			if err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			if input.CreatorUserID != "" {
				created.EffectiveAccess, _ = r.effectiveAccessLevelForUserTx(ctx, tx, input.CompanyID, input.CreatorUserID, EntityTypeNode, created.NodeID)
			}
			created.LogicGateIDs = []string{}
			result.Nodes = append(result.Nodes, created)
			clientToEntityID[item.ClientID] = created.NodeID
			result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.NodeID})
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
		if input.CreatorUserID != "" && input.CreatorLogicGateGVICRole != "" {
			stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.gvic_assignment_writes")
			if _, err := tx.ExecContext(ctx, `
insert into resource_gvic_assignments (
  company_id,
  resource_type,
  resource_id,
  role,
  principal_type,
  principal_id,
  created_timestamp,
  updated_timestamp
) values ($1::uuid, 'logic_gate', $2::uuid, $3, 'user', $4::uuid, now(), now())
on conflict (company_id, resource_type, resource_id, role, principal_type, principal_id)
do update set updated_timestamp=resource_gvic_assignments.updated_timestamp`,
				input.CompanyID,
				created.LogicGateID,
				input.CreatorLogicGateGVICRole,
				input.CreatorUserID,
			); err != nil {
				stop()
				return WorkspaceEntityBatchResult{}, err
			}
			stop()
			stop = observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.gvic_projection_sync")
			err = syncResourceGVICEffectiveAssignmentsTx(ctx, tx, input.CompanyID, []resourceGVICKey{{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: created.LogicGateID}})
			if err != nil {
				stop()
				return WorkspaceEntityBatchResult{}, err
			}
			stop()
			assignments, err := postgresResourceGVICAssignmentsForResource(ctx, tx, resourceGVICKey{companyID: input.CompanyID, resourceType: EntityTypeLogicGate, resourceID: created.LogicGateID})
			if err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			created.GVICAssignments = logicGateGVICAssignmentsFromResources(assignments)
		}
		if input.CreatorUserID != "" {
			created.EffectiveAccess, _ = r.effectiveAccessLevelForUserTx(ctx, tx, input.CompanyID, input.CreatorUserID, EntityTypeLogicGate, created.LogicGateID)
		}
		result.LogicGates = append(result.LogicGates, created)
		clientToEntityID[item.ClientID] = created.LogicGateID
		result.EntityMappings = append(result.EntityMappings, WorkspaceEntityBatchEntityMapping{ClientID: item.ClientID, EntityID: created.LogicGateID})
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
				`insert into company_explorer_items
				 (company_id, item_id, parent_folder_id, target_type, target_id, position, created_timestamp, updated_timestamp)
				 values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, now(), now())
				 on conflict (company_id, target_type, target_id)
				 do update set parent_folder_id=excluded.parent_folder_id, position=excluded.position, updated_timestamp=now()
				 returning company_id::text, coalesce(parent_folder_id::text, '') as folder_id, target_type, target_id::text, position, created_timestamp, updated_timestamp`,
				input.CompanyID, newUUIDv7String(), targetFolderID, input.EntityKind, mapping.EntityID, itemPosition,
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
	}

	if syncDefaultFolderItems {
		for _, mapping := range result.EntityMappings {
			stop := observeTiming(ctx, "repo.CreateWorkspaceEntityBatch.default_folder_item_writes")
			item, inserted, err := placeCompanyExplorerItemInDefaultFolderTx(ctx, tx, input.CompanyID, input.EntityKind, mapping.EntityID, input.CreatorUserID, true)
			stop()
			if err != nil {
				return WorkspaceEntityBatchResult{}, err
			}
			if inserted {
				result.FolderItems = append(result.FolderItems, item)
			}
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
