package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const (
	editorSaveKindLegacy = "legacy"
	editorSaveKindManual = "manual"
	editorSaveKindAuto   = "auto"
)

func normalizeEditorSaveKind(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case editorSaveKindManual:
		return editorSaveKindManual
	case editorSaveKindAuto:
		return editorSaveKindAuto
	default:
		return editorSaveKindLegacy
	}
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return strings.TrimSpace(value.String)
}

func (r *PostgresRepo) UpsertNodeProjectionWithActor(input NodeInformationInput) (domain.NodeProjection, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	defer tx.Rollback()

	companyID := cleanUUIDText(input.CompanyID)
	nodeID := cleanUUIDText(input.NodeID)
	informationID := cleanUUIDText(input.InformationID)
	infoType := strings.TrimSpace(input.Type)
	if companyID == "" || nodeID == "" || informationID == "" || infoType == "" || strings.TrimSpace(input.Information) == "" {
		return domain.NodeProjection{}, ErrInvalid
	}

	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`,
		companyID, nodeID,
	).Scan(&exists); err != nil {
		return domain.NodeProjection{}, err
	}
	if !exists {
		return domain.NodeProjection{}, ErrNotFound
	}
	if collaboration, err := postgresEmailCollaborationByNode(ctx, tx, companyID, nodeID); err == nil && collaboration.AttachedEmailInformationID == informationID {
		return domain.NodeProjection{}, ErrProtectedEmailCollaborationResource
	} else if err != nil && !errors.Is(err, ErrNotFound) {
		return domain.NodeProjection{}, err
	}

	if isEditorTextBoxType(infoType) {
		return upsertPostgresNodeTextProjection(ctx, tx, input, companyID, nodeID, informationID, infoType)
	}
	if isNodeTextboxChatType(infoType) {
		previous, previousFound, err := postgresNodeTextboxChatProjectionTx(ctx, tx, companyID, nodeID, informationID)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		projection, _, err := upsertPostgresNodeTextboxChatTx(ctx, tx, input, informationID)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		var previousPtr *domain.NodeProjection
		if previousFound {
			previousPtr = &previous
		}
		if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
			if err := insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
				companyID, nodeID, informationID, infoType, previousPtr, projection.Information,
				normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName), time.Now().UTC(),
			)); err != nil {
				return domain.NodeProjection{}, err
			}
		}
		if previousFound {
			outboxInput, err := nodeChatUpdatedOutboxInput(projection)
			if err != nil {
				return domain.NodeProjection{}, err
			}
			if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
				return domain.NodeProjection{}, err
			}
		} else {
			item := domain.NodeInformation{
				CompanyID: projection.CompanyID, InformationID: projection.InformationID, NodeID: projection.NodeID,
				Type: projection.Type, Information: projection.Information,
				CreatedTimestamp: projection.CreatedTimestamp, UpdatedTimestamp: projection.UpdatedTimestamp,
			}
			outboxInput, err := nodeChatCreatedOutboxInput(item, projection.InformationID)
			if err != nil {
				return domain.NodeProjection{}, err
			}
			if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
				return domain.NodeProjection{}, err
			}
		}
		if err := tx.Commit(); err != nil {
			return domain.NodeProjection{}, err
		}
		return projection, nil
	}
	previous, previousFound, err := postgresNodeProjectionTx(ctx, tx, companyID, nodeID, informationID)
	if err != nil {
		return domain.NodeProjection{}, err
	}

	var projection domain.NodeProjection
	if err := tx.QueryRowContext(ctx,
		`insert into node_projection_table
		 (company_id, node_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
		 on conflict (company_id, node_id, information_id)
		 do update set
		   type=excluded.type,
		   information=excluded.information,
		   updated_timestamp=now(),
		   revision=node_projection_table.revision+1
		 returning company_id::text, node_id::text, information_id::text, type::text, information, revision, created_timestamp, updated_timestamp`,
		companyID, nodeID, informationID, infoType, input.Information,
	).Scan(
		&projection.CompanyID,
		&projection.NodeID,
		&projection.InformationID,
		&projection.Type,
		&projection.Information,
		&projection.Revision,
		&projection.CreatedTimestamp,
		&projection.UpdatedTimestamp,
	); err != nil {
		return domain.NodeProjection{}, err
	}
	if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
		actor := normalizeNodeContentChangeActor(cleanUUIDText(input.ActorUserID), input.ActorDisplayName)
		var previousPtr *domain.NodeProjection
		if previousFound {
			previousPtr = &previous
		}
		if err := insertNodeContentChangesTx(ctx, tx, buildNodeContentChanges(
			companyID,
			nodeID,
			informationID,
			infoType,
			previousPtr,
			input.Information,
			actor,
			time.Now().UTC(),
		)); err != nil {
			return domain.NodeProjection{}, err
		}
	}
	if previousFound && strings.EqualFold(strings.TrimSpace(previous.Type), "Text block chat") && strings.EqualFold(infoType, "Text block chat") {
		outboxInput, err := nodeChatUpdatedOutboxInput(projection)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		if _, err := r.enqueueRealtimeOutboxTx(ctx, tx, outboxInput); err != nil {
			return domain.NodeProjection{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.NodeProjection{}, err
	}
	return projection, nil
}

func (r *PostgresRepo) UpsertLogicGateProjection(input LogicGateProjectionInput) (domain.LogicGateProjection, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.LogicGateProjection{}, err
	}
	defer tx.Rollback()

	companyID := cleanUUIDText(input.CompanyID)
	logicGateID := cleanUUIDText(input.LogicGateID)
	informationID := cleanUUIDText(input.InformationID)
	infoType := strings.TrimSpace(input.Type)
	if companyID == "" || logicGateID == "" || informationID == "" || infoType == "" || strings.TrimSpace(input.Information) == "" {
		return domain.LogicGateProjection{}, ErrInvalid
	}

	var exists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)`,
		companyID, logicGateID,
	).Scan(&exists); err != nil {
		return domain.LogicGateProjection{}, err
	}
	if !exists {
		return domain.LogicGateProjection{}, ErrNotFound
	}
	if isEditorTextBoxType(infoType) {
		return upsertPostgresLogicGateTextProjection(ctx, tx, input, companyID, logicGateID, informationID)
	}

	query := `insert into logic_gate_projection_table
		 (company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
		 on conflict (company_id, logic_gate_id, information_id)
		 do update set
		   type=excluded.type,
		   information=excluded.information,
		   updated_timestamp=now(),
		   revision=logic_gate_projection_table.revision+1
		 returning company_id::text, logic_gate_id::text, information_id::text, type::text, information, revision, created_timestamp, updated_timestamp`
	if isEditorTextBoxType(infoType) {
		query = `insert into logic_gate_projection_table
		 (company_id, logic_gate_id, information_id, type, information, created_timestamp, updated_timestamp)
		 values ($1::uuid, $2::uuid, $3::uuid, $4::information_type, $5, now(), now())
		 on conflict (company_id, logic_gate_id, information_id)
		 do update set
		   information=excluded.information,
		   updated_timestamp=now()
		 returning company_id::text, logic_gate_id::text, information_id::text, type::text, information, created_timestamp, updated_timestamp`
	}

	var projection domain.LogicGateProjection
	if err := tx.QueryRowContext(ctx, query, companyID, logicGateID, informationID, infoType, input.Information).Scan(
		&projection.CompanyID,
		&projection.LogicGateID,
		&projection.InformationID,
		&projection.Type,
		&projection.Information,
		&projection.Revision,
		&projection.CreatedTimestamp,
		&projection.UpdatedTimestamp,
	); err != nil {
		return domain.LogicGateProjection{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.LogicGateProjection{}, err
	}
	return projection, nil
}

func (r *PostgresRepo) CreateNodeEditorSaveVersion(input EditorSaveVersionInput) (domain.EditorSaveVersion, error) {
	return createPostgresEditorTextboxHistory(r, input, EntityTypeNode)
}

func (r *PostgresRepo) CreateLogicGateEditorSaveVersion(input EditorSaveVersionInput) (domain.EditorSaveVersion, error) {
	return createPostgresEditorTextboxHistory(r, input, EntityTypeLogicGate)
}

func (r *PostgresRepo) ListNodeEditorSaveVersions(companyID, nodeID string) ([]domain.EditorSaveVersion, error) {
	return listPostgresEditorTextboxHistoryCompatible(r, companyID, EntityTypeNode, nodeID)
}

func (r *PostgresRepo) ListLogicGateEditorSaveVersions(companyID, logicGateID string) ([]domain.EditorSaveVersion, error) {
	return listPostgresEditorTextboxHistoryCompatible(r, companyID, EntityTypeLogicGate, logicGateID)
}

func (r *PostgresRepo) listEditorSaveVersions(companyID, resourceType, resourceID string) ([]domain.EditorSaveVersion, error) {
	ctx := context.Background()
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	if companyID == "" || resourceID == "" {
		return nil, ErrInvalid
	}

	query := `select company_id::text, node_id::text, save_batch_id::text, save_kind, coalesce(saved_by_user_id::text, ''), saved_by_display_name,
		         information_id::text, coalesce(source_information_id::text, ''), type::text, information, created_timestamp, updated_timestamp
		    from node_information
		   where company_id=$1::uuid and node_id=$2::uuid and save_batch_id is not null
		   order by created_timestamp desc, information_id asc`
	if resourceType == EntityTypeLogicGate {
		query = `select company_id::text, logic_gate_id::text, save_batch_id::text, save_kind, coalesce(saved_by_user_id::text, ''), saved_by_display_name,
		         information_id::text, coalesce(source_information_id::text, ''), type::text, information, created_timestamp, updated_timestamp
		    from logic_gate_information
		   where company_id=$1::uuid and logic_gate_id=$2::uuid and save_batch_id is not null
		   order by created_timestamp desc, information_id asc`
	}
	rows, err := r.db.QueryContext(ctx, query, companyID, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEditorSaveVersions(rows, resourceType)
}

func scanEditorSaveVersions(rows *sql.Rows, resourceType string) ([]domain.EditorSaveVersion, error) {
	versions := make([]domain.EditorSaveVersion, 0)
	versionIndex := map[string]int{}
	for rows.Next() {
		var (
			companyID          string
			resourceID         string
			saveID             string
			saveKind           string
			savedByUserID      string
			savedByDisplayName string
			item               domain.EditorSaveVersionItem
		)
		if err := rows.Scan(
			&companyID,
			&resourceID,
			&saveID,
			&saveKind,
			&savedByUserID,
			&savedByDisplayName,
			&item.InformationID,
			&item.SourceInformationID,
			&item.Type,
			&item.Information,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		index, ok := versionIndex[saveID]
		if !ok {
			version := domain.EditorSaveVersion{
				CompanyID:          companyID,
				ResourceType:       resourceType,
				ResourceID:         resourceID,
				SaveID:             saveID,
				SaveKind:           saveKind,
				SavedByUserID:      savedByUserID,
				SavedByDisplayName: savedByDisplayName,
				CreatedTimestamp:   item.CreatedTimestamp,
				UpdatedTimestamp:   item.UpdatedTimestamp,
				Items:              []domain.EditorSaveVersionItem{},
			}
			versions = append(versions, version)
			index = len(versions) - 1
			versionIndex[saveID] = index
		}
		version := &versions[index]
		if item.CreatedTimestamp.Before(version.CreatedTimestamp) {
			version.CreatedTimestamp = item.CreatedTimestamp
		}
		if item.UpdatedTimestamp.After(version.UpdatedTimestamp) {
			version.UpdatedTimestamp = item.UpdatedTimestamp
		}
		version.Items = append(version.Items, item)
		version.ItemCount = len(version.Items)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return versions, nil
}

func (r *PostgresRepo) RestoreNodeEditorSaveVersion(input EditorSaveVersionRestoreInput) (domain.EditorSaveVersion, error) {
	return restorePostgresEditorTextboxHistoryCompatible(r, input, EntityTypeNode)
}

func (r *PostgresRepo) RestoreLogicGateEditorSaveVersion(input EditorSaveVersionRestoreInput) (domain.EditorSaveVersion, error) {
	return restorePostgresEditorTextboxHistoryCompatible(r, input, EntityTypeLogicGate)
}

func selectEditorSaveVersionTx(ctx context.Context, tx *sql.Tx, companyID, resourceType, resourceID, saveID string) (domain.EditorSaveVersion, error) {
	query := `select company_id::text, node_id::text, save_batch_id::text, save_kind, coalesce(saved_by_user_id::text, ''), saved_by_display_name,
		         information_id::text, coalesce(source_information_id::text, ''), type::text, information, created_timestamp, updated_timestamp
		    from node_information
		   where company_id=$1::uuid and node_id=$2::uuid and save_batch_id=$3::uuid
		   order by created_timestamp asc, information_id asc`
	if resourceType == EntityTypeLogicGate {
		query = `select company_id::text, logic_gate_id::text, save_batch_id::text, save_kind, coalesce(saved_by_user_id::text, ''), saved_by_display_name,
		         information_id::text, coalesce(source_information_id::text, ''), type::text, information, created_timestamp, updated_timestamp
		    from logic_gate_information
		   where company_id=$1::uuid and logic_gate_id=$2::uuid and save_batch_id=$3::uuid
		   order by created_timestamp asc, information_id asc`
	}
	rows, err := tx.QueryContext(ctx, query, companyID, resourceID, saveID)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	defer rows.Close()
	versions, err := scanEditorSaveVersions(rows, resourceType)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	if len(versions) == 0 {
		return domain.EditorSaveVersion{}, ErrNotFound
	}
	return versions[0], nil
}

func editorSaveVersionFromItems(companyID, resourceType, resourceID, saveID, saveKind, savedByUserID, savedByDisplayName string, items []domain.EditorSaveVersionItem) domain.EditorSaveVersion {
	version := domain.EditorSaveVersion{
		CompanyID:          companyID,
		ResourceType:       resourceType,
		ResourceID:         resourceID,
		SaveID:             saveID,
		SaveKind:           saveKind,
		SavedByUserID:      savedByUserID,
		SavedByDisplayName: savedByDisplayName,
		Items:              items,
		ItemCount:          len(items),
	}
	for index, item := range items {
		if index == 0 || item.CreatedTimestamp.Before(version.CreatedTimestamp) {
			version.CreatedTimestamp = item.CreatedTimestamp
		}
		if index == 0 || item.UpdatedTimestamp.After(version.UpdatedTimestamp) {
			version.UpdatedTimestamp = item.UpdatedTimestamp
		}
	}
	if version.CreatedTimestamp.IsZero() {
		now := time.Now().UTC()
		version.CreatedTimestamp = now
		version.UpdatedTimestamp = now
	}
	return version
}

func isEditorSaveVersionNotFound(err error) bool {
	return errors.Is(err, ErrNotFound)
}
