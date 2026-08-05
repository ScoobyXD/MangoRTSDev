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
	if !strings.EqualFold(infoType, "Attached email") {
		return domain.NodeProjection{}, ErrInvalid
	}
	projection, err := addPostgresNodeEmailRelationshipTx(ctx, tx, input, informationID)
	if err != nil {
		return domain.NodeProjection{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.NodeProjection{}, err
	}
	return projection, nil
}

func (r *PostgresRepo) UpsertLogicGateProjection(input LogicGateProjectionInput) (domain.LogicGateProjection, error) {
	return domain.LogicGateProjection{}, ErrInvalid
}
func (r *PostgresRepo) CreateNodeEditorSaveVersion(input EditorSaveVersionInput) (domain.EditorSaveVersion, error) {
	return createPostgresEditorTextboxHistory(r, input, EntityTypeNode)
}

func (r *PostgresRepo) CreateLogicGateEditorSaveVersion(input EditorSaveVersionInput) (domain.EditorSaveVersion, error) {
	return createPostgresEditorTextboxHistory(r, input, EntityTypeLogicGate)
}

func (r *PostgresRepo) ListNodeEditorSaveVersions(companyID, nodeID string) ([]domain.EditorSaveVersion, error) {
	return listPostgresEditorTextboxHistory(r, companyID, EntityTypeNode, nodeID)
}

func (r *PostgresRepo) ListLogicGateEditorSaveVersions(companyID, logicGateID string) ([]domain.EditorSaveVersion, error) {
	return listPostgresEditorTextboxHistory(r, companyID, EntityTypeLogicGate, logicGateID)
}

func (r *PostgresRepo) RestoreNodeEditorSaveVersion(input EditorSaveVersionRestoreInput) (domain.EditorSaveVersion, error) {
	return restorePostgresEditorTextboxHistory(r, input, EntityTypeNode)
}

func (r *PostgresRepo) RestoreLogicGateEditorSaveVersion(input EditorSaveVersionRestoreInput) (domain.EditorSaveVersion, error) {
	return restorePostgresEditorTextboxHistory(r, input, EntityTypeLogicGate)
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
