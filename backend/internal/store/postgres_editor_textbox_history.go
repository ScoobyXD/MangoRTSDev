package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"miraeopus/backend/internal/domain"
)

type postgresEditorTextboxHistoryStorage struct {
	resourceType string
	currentTable string
	historyTable string
	ownerColumn  string
	textboxUUID  bool
	displayOrder bool
}

func postgresEditorTextboxHistoryStorageFor(resourceType string) (postgresEditorTextboxHistoryStorage, bool) {
	switch resourceType {
	case EntityTypeNode:
		return postgresEditorTextboxHistoryStorage{resourceType, "node_textboxes", "node_textboxes_history", "node_id", true, true}, true
	case EntityTypeLogicGate:
		return postgresEditorTextboxHistoryStorage{resourceType, "logic_gate_textboxes", "logic_gate_textboxes_history", "logic_gate_id", false, false}, true
	default:
		return postgresEditorTextboxHistoryStorage{}, false
	}
}

func createPostgresEditorTextboxHistory(r *PostgresRepo, input EditorSaveVersionInput, resourceType string) (domain.EditorSaveVersion, error) {
	storage, ok := postgresEditorTextboxHistoryStorageFor(resourceType)
	if !ok {
		return domain.EditorSaveVersion{}, ErrInvalid
	}
	companyID, resourceID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.ResourceID)
	actorUserID := cleanUUIDText(input.ActorUserID)
	if companyID == "" || resourceID == "" {
		return domain.EditorSaveVersion{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	defer tx.Rollback()
	displayColumn := "0::bigint"
	orderBy := "updated_timestamp, textbox_id"
	if storage.displayOrder {
		displayColumn = "display_order"
		orderBy = "display_order, textbox_id"
	}
	query := fmt.Sprintf(`select textbox_id::text,body_json,%s,created_timestamp,updated_timestamp
		from %s where company_id=$1::uuid and %s=$2::uuid and deleted_timestamp is null
		order by %s`, displayColumn, storage.currentTable, storage.ownerColumn, orderBy)
	rows, err := tx.QueryContext(ctx, query, companyID, resourceID)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	type currentRow struct {
		textboxID string
		body      []byte
		display   int64
		created   time.Time
		updated   time.Time
	}
	current := make([]currentRow, 0)
	for rows.Next() {
		var row currentRow
		if err := rows.Scan(&row.textboxID, &row.body, &row.display, &row.created, &row.updated); err != nil {
			rows.Close()
			return domain.EditorSaveVersion{}, err
		}
		current = append(current, row)
	}
	if err := rows.Close(); err != nil {
		return domain.EditorSaveVersion{}, err
	}
	if len(current) == 0 {
		return domain.EditorSaveVersion{}, ErrInvalid
	}
	batchID, savedAt := newUUIDv7String(), time.Now().UTC()
	items := make([]domain.EditorSaveVersionItem, 0, len(current))
	for _, row := range current {
		textboxExpr := "$3"
		if storage.textboxUUID {
			textboxExpr = "$3::uuid"
		}
		columns := "company_id," + storage.ownerColumn + ",textbox_id,batch_id,body_json,saved_by_user_id,saved_timestamp"
		values := "$1::uuid,$2::uuid," + textboxExpr + ",$4::uuid,$5::jsonb,nullif($6,'')::uuid,$7"
		args := []any{companyID, resourceID, row.textboxID, batchID, row.body, actorUserID, savedAt}
		if storage.displayOrder {
			columns = "company_id," + storage.ownerColumn + ",textbox_id,batch_id,body_json,display_order,saved_by_user_id,saved_timestamp"
			values = "$1::uuid,$2::uuid," + textboxExpr + ",$4::uuid,$5::jsonb,$6,nullif($7,'')::uuid,$8"
			args = []any{companyID, resourceID, row.textboxID, batchID, row.body, row.display, actorUserID, savedAt}
		}
		insert := fmt.Sprintf(`insert into %s(%s) values(%s)`, storage.historyTable, columns, values)
		if _, err := tx.ExecContext(ctx, insert, args...); err != nil {
			return domain.EditorSaveVersion{}, err
		}
		document, _, err := decodeEditorTextboxBody(row.body)
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		items = append(items, domain.EditorSaveVersionItem{
			InformationID: row.textboxID, SourceInformationID: row.textboxID,
			Type: "Text box", Information: string(document),
			CreatedTimestamp: row.created, UpdatedTimestamp: row.updated,
		})
	}
	if err := tx.Commit(); err != nil {
		return domain.EditorSaveVersion{}, err
	}
	version := editorSaveVersionFromItems(companyID, resourceType, resourceID, batchID,
		editorSaveKindManual, actorUserID, "", items)
	version.CreatedTimestamp, version.UpdatedTimestamp = savedAt, savedAt
	return version, nil
}

func listPostgresEditorTextboxHistory(r *PostgresRepo, companyID, resourceType, resourceID string) ([]domain.EditorSaveVersion, error) {
	storage, ok := postgresEditorTextboxHistoryStorageFor(resourceType)
	if !ok {
		return nil, ErrInvalid
	}
	companyID, resourceID = cleanUUIDText(companyID), cleanUUIDText(resourceID)
	if companyID == "" || resourceID == "" {
		return nil, ErrInvalid
	}
	query := fmt.Sprintf(`select batch_id::text,textbox_id::text,body_json,
		coalesce(saved_by_user_id::text,''),saved_timestamp
		from %s where company_id=$1::uuid and %s=$2::uuid
		order by saved_timestamp desc,batch_id desc,textbox_id`, storage.historyTable, storage.ownerColumn)
	rows, err := r.db.QueryContext(context.Background(), query, companyID, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	versions := make([]domain.EditorSaveVersion, 0)
	byBatch := map[string]int{}
	for rows.Next() {
		var batchID, textboxID, actorUserID string
		var body []byte
		var savedAt time.Time
		if err := rows.Scan(&batchID, &textboxID, &body, &actorUserID, &savedAt); err != nil {
			return nil, err
		}
		document, _, err := decodeEditorTextboxBody(body)
		if err != nil {
			return nil, err
		}
		index, exists := byBatch[batchID]
		if !exists {
			versions = append(versions, domain.EditorSaveVersion{
				CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID,
				SaveID: batchID, SaveKind: editorSaveKindManual, SavedByUserID: actorUserID,
				CreatedTimestamp: savedAt, UpdatedTimestamp: savedAt,
				Items: []domain.EditorSaveVersionItem{},
			})
			index = len(versions) - 1
			byBatch[batchID] = index
		}
		version := &versions[index]
		version.Items = append(version.Items, domain.EditorSaveVersionItem{
			InformationID: textboxID, SourceInformationID: textboxID, Type: "Text box",
			Information: string(document), CreatedTimestamp: savedAt, UpdatedTimestamp: savedAt,
		})
		version.ItemCount = len(version.Items)
	}
	return versions, rows.Err()
}

func selectPostgresEditorTextboxHistoryBatch(r *PostgresRepo, companyID, resourceType, resourceID, batchID string) (map[string]json.RawMessage, error) {
	storage, ok := postgresEditorTextboxHistoryStorageFor(resourceType)
	if !ok {
		return nil, ErrInvalid
	}
	query := fmt.Sprintf(`select textbox_id::text,body_json from %s
		where company_id=$1::uuid and %s=$2::uuid and batch_id=$3::uuid`, storage.historyTable, storage.ownerColumn)
	rows, err := r.db.QueryContext(context.Background(), query, companyID, resourceID, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]json.RawMessage{}
	for rows.Next() {
		var textboxID string
		var body []byte
		if err := rows.Scan(&textboxID, &body); err != nil {
			return nil, err
		}
		result[textboxID] = append(json.RawMessage(nil), body...)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(result) == 0 {
		return nil, ErrNotFound
	}
	return result, nil
}

func restorePostgresEditorTextboxHistory(r *PostgresRepo, input EditorSaveVersionRestoreInput, resourceType string) (domain.EditorSaveVersion, error) {
	companyID, resourceID, batchID := cleanUUIDText(input.CompanyID), cleanUUIDText(input.ResourceID), cleanUUIDText(input.SaveID)
	if companyID == "" || resourceID == "" || batchID == "" {
		return domain.EditorSaveVersion{}, ErrInvalid
	}
	desired, err := selectPostgresEditorTextboxHistoryBatch(r, companyID, resourceType, resourceID, batchID)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	storage, _ := postgresEditorTextboxHistoryStorageFor(resourceType)
	query := fmt.Sprintf(`select textbox_id::text,revision from %s
		where company_id=$1::uuid and %s=$2::uuid and deleted_timestamp is null`, storage.currentTable, storage.ownerColumn)
	rows, err := r.db.QueryContext(context.Background(), query, companyID, resourceID)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	current := map[string]int64{}
	for rows.Next() {
		var id string
		var revision int64
		if err := rows.Scan(&id, &revision); err != nil {
			rows.Close()
			return domain.EditorSaveVersion{}, err
		}
		current[id] = revision
	}
	if err := rows.Close(); err != nil {
		return domain.EditorSaveVersion{}, err
	}
	ids := make([]string, 0, len(current))
	for id := range current {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if _, keep := desired[id]; keep {
			continue
		}
		_, err := r.DeleteEditorJSONDocument(EditorJSONDeleteInput{
			Document:    EditorJSONDocumentRef{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, DocumentID: id},
			OperationID: newUUIDv7String(), ClientID: "manual-history-restore",
			ActorUserID: input.ActorUserID, BaseRevision: current[id],
		})
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
	}
	ids = ids[:0]
	for id := range desired {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		document, annotations, err := decodeEditorTextboxBody(desired[id])
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		snapshot, err := r.GetEditorJSONSnapshot(EditorJSONDocumentRef{
			CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, DocumentID: id,
		})
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		_, err = r.CommitEditorJSONDocument(EditorJSONCommitInput{
			Document: snapshot.Document, OperationID: newUUIDv7String(), ClientID: "manual-history-restore",
			ActorUserID: input.ActorUserID, BaseRevision: snapshot.Revision,
			SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document, Annotations: annotations,
		})
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
	}
	versions, err := listPostgresEditorTextboxHistory(r, companyID, resourceType, resourceID)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	for _, version := range versions {
		if version.SaveID == batchID {
			return version, nil
		}
	}
	return domain.EditorSaveVersion{}, ErrNotFound
}

func listPostgresEditorTextboxHistoryCompatible(r *PostgresRepo, companyID, resourceType, resourceID string) ([]domain.EditorSaveVersion, error) {
	current, err := listPostgresEditorTextboxHistory(r, companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	legacy, err := r.listEditorSaveVersions(companyID, resourceType, resourceID)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(current))
	for _, version := range current {
		seen[version.SaveID] = struct{}{}
	}
	for _, version := range legacy {
		if _, migrated := seen[version.SaveID]; !migrated {
			current = append(current, version)
		}
	}
	sort.SliceStable(current, func(i, j int) bool {
		return current[i].CreatedTimestamp.After(current[j].CreatedTimestamp)
	})
	return current, nil
}

func restorePostgresEditorTextboxHistoryCompatible(r *PostgresRepo, input EditorSaveVersionRestoreInput, resourceType string) (domain.EditorSaveVersion, error) {
	version, err := restorePostgresEditorTextboxHistory(r, input, resourceType)
	if err == nil {
		return version, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return domain.EditorSaveVersion{}, err
	}
	// An HTML-era manual save stays readable and restorable until a later
	// conversion moves it. The cleanup script refuses to delete such a row.
	return r.restoreEditorSaveVersion(input, resourceType)
}
