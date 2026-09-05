package store

import (
	"context"
	"database/sql"
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
	if err := lockPostgresProcessEditorOwnerTx(ctx, tx, EditorJSONDocumentRef{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID}); err != nil {
		return domain.EditorSaveVersion{}, err
	}
	displayColumn := "0::bigint"
	orderBy := "updated_timestamp, textbox_id"
	if storage.displayOrder {
		displayColumn = "display_order"
		orderBy = "display_order, textbox_id"
	}
	query := fmt.Sprintf(`select textbox_id::text,body_json,%s,created_timestamp,updated_timestamp,'%s'::text
		from %s where company_id=$1::uuid and %s=$2::uuid and deleted_timestamp is null
		order by %s`, displayColumn, resourceType, storage.currentTable, storage.ownerColumn, orderBy)
	if resourceType == EntityTypeLogicGate {
		query = `select textbox_id::text,body_json,0::bigint,created_timestamp,updated_timestamp,'logic_gate'::text
			from logic_gate_textboxes where company_id=$1::uuid and logic_gate_id=$2::uuid and deleted_timestamp is null
			union all
			select process_step_id::text,body_json,position::bigint,created_timestamp,updated_timestamp,'process_step'::text
			from process_steps where company_id=$1::uuid and logic_gate_id=$2::uuid
			order by 6,3,1`
	}
	rows, err := tx.QueryContext(ctx, query, companyID, resourceID)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	type currentRow struct {
		resourceType string
		textboxID    string
		body         []byte
		display      int64
		created      time.Time
		updated      time.Time
	}
	current := make([]currentRow, 0)
	hasOverview := false
	for rows.Next() {
		var row currentRow
		if err := rows.Scan(&row.textboxID, &row.body, &row.display, &row.created, &row.updated, &row.resourceType); err != nil {
			rows.Close()
			return domain.EditorSaveVersion{}, err
		}
		hasOverview = hasOverview || row.resourceType == EntityTypeLogicGate
		current = append(current, row)
	}
	if err := rows.Close(); err != nil {
		return domain.EditorSaveVersion{}, err
	}
	if len(current) == 0 {
		return domain.EditorSaveVersion{}, ErrInvalid
	}
	batchID, savedAt := newUUIDv7String(), time.Now().UTC()
	if resourceType == EntityTypeLogicGate && !hasOverview {
		current = append(current, currentRow{resourceType: EntityTypeLogicGate, textboxID: "logic-gate-overview", body: emptyEditorTextboxBody(), created: savedAt, updated: savedAt})
	}
	items := make([]domain.EditorSaveVersionItem, 0, len(current))
	for _, row := range current {
		textboxExpr := "$3"
		if storage.textboxUUID {
			textboxExpr = "$3::uuid"
		}
		columns := "company_id," + storage.ownerColumn + ",textbox_id,batch_id,body_json,saved_by_user_id,saved_timestamp"
		values := "$1::uuid,$2::uuid," + textboxExpr + ",$4::uuid,$5::jsonb,nullif($6,'')::uuid,$7"
		args := []any{companyID, resourceID, row.textboxID, batchID, string(row.body), actorUserID, savedAt}
		if storage.displayOrder {
			columns = "company_id," + storage.ownerColumn + ",textbox_id,batch_id,body_json,display_order,saved_by_user_id,saved_timestamp"
			values = "$1::uuid,$2::uuid," + textboxExpr + ",$4::uuid,$5::jsonb,$6,nullif($7,'')::uuid,$8"
			args = []any{companyID, resourceID, row.textboxID, batchID, string(row.body), row.display, actorUserID, savedAt}
		}
		if resourceType == EntityTypeLogicGate {
			columns += ",resource_type"
			values += ",$8"
			args = append(args, row.resourceType)
		}
		insert := fmt.Sprintf(`insert into %s(%s) values(%s)`, storage.historyTable, columns, values)
		if _, err := tx.ExecContext(ctx, insert, args...); err != nil {
			return domain.EditorSaveVersion{}, err
		}
		document, _, err := decodeEditorTextboxBody(row.body)
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		item := domain.EditorSaveVersionItem{
			InformationID: row.textboxID, SourceInformationID: row.textboxID,
			Type: "Text box", Information: string(document),
			CreatedTimestamp: row.created, UpdatedTimestamp: row.updated,
		}
		if resourceType == EntityTypeLogicGate {
			item.Information = string(row.body)
		}
		if row.resourceType == EntityTypeProcessStep {
			stepID := row.textboxID
			item.ProcessStepID = &stepID
		}
		items = append(items, item)
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
	typeColumn := "'" + resourceType + "'::text"
	if resourceType == EntityTypeLogicGate {
		typeColumn = "resource_type"
	}
	query := fmt.Sprintf(`select batch_id::text,textbox_id::text,body_json,
		coalesce(saved_by_user_id::text,''),saved_timestamp,%s
		from %s where company_id=$1::uuid and %s=$2::uuid
		order by saved_timestamp desc,batch_id desc,%s,textbox_id`, typeColumn, storage.historyTable, storage.ownerColumn, typeColumn)
	rows, err := r.db.QueryContext(context.Background(), query, companyID, resourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	versions := make([]domain.EditorSaveVersion, 0)
	byBatch := map[string]int{}
	for rows.Next() {
		var batchID, textboxID, actorUserID, itemResourceType string
		var body []byte
		var savedAt time.Time
		if err := rows.Scan(&batchID, &textboxID, &body, &actorUserID, &savedAt, &itemResourceType); err != nil {
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
		item := domain.EditorSaveVersionItem{
			InformationID: textboxID, SourceInformationID: textboxID, Type: "Text box",
			Information: string(document), CreatedTimestamp: savedAt, UpdatedTimestamp: savedAt,
		}
		if resourceType == EntityTypeLogicGate {
			item.Information = string(body)
		}
		if itemResourceType == EntityTypeProcessStep {
			stepID := textboxID
			item.ProcessStepID = &stepID
		}
		version.Items = append(version.Items, item)
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
	if resourceType == EntityTypeLogicGate {
		return restorePostgresProcessEditorHistory(r, input, companyID, resourceID, batchID)
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
		if input.AfterDeleteCommit != nil {
			input.AfterDeleteCommit()
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

func restorePostgresProcessEditorHistory(r *PostgresRepo, input EditorSaveVersionRestoreInput, companyID, logicGateID, batchID string) (domain.EditorSaveVersion, error) {
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	defer tx.Rollback()
	if err := lockPostgresProcessEditorOwnerTx(ctx, tx, EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: logicGateID}); err != nil {
		return domain.EditorSaveVersion{}, err
	}
	rows, err := tx.QueryContext(ctx, `select resource_type,textbox_id,body_json,coalesce(saved_by_user_id::text,''),saved_timestamp
		from logic_gate_textboxes_history where company_id=$1::uuid and logic_gate_id=$2::uuid and batch_id=$3::uuid
		order by resource_type,textbox_id`, companyID, logicGateID, batchID)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	type savedDocument struct {
		ref  EditorJSONDocumentRef
		body []byte
	}
	desired := []savedDocument{}
	desiredOverview := map[string]bool{}
	version := domain.EditorSaveVersion{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: logicGateID, SaveID: batchID, SaveKind: editorSaveKindManual, Items: []domain.EditorSaveVersionItem{}}
	for rows.Next() {
		var itemType, documentID string
		var body []byte
		if err := rows.Scan(&itemType, &documentID, &body, &version.SavedByUserID, &version.CreatedTimestamp); err != nil {
			rows.Close()
			return domain.EditorSaveVersion{}, err
		}
		if _, _, err := decodeEditorTextboxBody(body); err != nil {
			rows.Close()
			return domain.EditorSaveVersion{}, err
		}
		ref := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: itemType, ResourceID: logicGateID, DocumentID: documentID}
		item := domain.EditorSaveVersionItem{InformationID: documentID, SourceInformationID: documentID, Type: "Text box", Information: string(body), CreatedTimestamp: version.CreatedTimestamp, UpdatedTimestamp: version.CreatedTimestamp}
		if itemType == EntityTypeProcessStep {
			ref.ResourceID = documentID
			stepID := documentID
			item.ProcessStepID = &stepID
		} else if itemType != EntityTypeLogicGate {
			rows.Close()
			return domain.EditorSaveVersion{}, ErrInvalid
		} else {
			desiredOverview[documentID] = true
		}
		desired = append(desired, savedDocument{ref: ref, body: body})
		version.Items = append(version.Items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return domain.EditorSaveVersion{}, err
	}
	if err := rows.Close(); err != nil {
		return domain.EditorSaveVersion{}, err
	}
	if len(desired) == 0 {
		return domain.EditorSaveVersion{}, ErrNotFound
	}
	currentRows, err := tx.QueryContext(ctx, `select textbox_id,revision from logic_gate_textboxes where company_id=$1::uuid and logic_gate_id=$2::uuid and deleted_timestamp is null order by textbox_id for update`, companyID, logicGateID)
	if err != nil {
		return domain.EditorSaveVersion{}, err
	}
	deletions := []EditorJSONDeleteInput{}
	for currentRows.Next() {
		var documentID string
		var revision int64
		if err := currentRows.Scan(&documentID, &revision); err != nil {
			currentRows.Close()
			return domain.EditorSaveVersion{}, err
		}
		if !desiredOverview[documentID] {
			deletions = append(deletions, EditorJSONDeleteInput{Document: EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: logicGateID, DocumentID: documentID}, OperationID: newUUIDv7String(), ClientID: "manual-history-restore", ActorUserID: input.ActorUserID, BaseRevision: revision})
		}
	}
	if err := currentRows.Err(); err != nil {
		currentRows.Close()
		return domain.EditorSaveVersion{}, err
	}
	if err := currentRows.Close(); err != nil {
		return domain.EditorSaveVersion{}, err
	}
	type replacement struct {
		input      EditorJSONCommitInput
		sizeChange int
	}
	replacements := make([]replacement, 0, len(desired))
	for _, saved := range desired {
		query := `select revision,body_json from logic_gate_textboxes where company_id=$1::uuid and logic_gate_id=$2::uuid and textbox_id=$3 for update`
		if saved.ref.ResourceType == EntityTypeProcessStep {
			query = `select revision,body_json from process_steps where company_id=$1::uuid and logic_gate_id=$2::uuid and process_step_id=$3::uuid for update`
		}
		var revision int64
		var current []byte
		err := tx.QueryRowContext(ctx, query, companyID, logicGateID, saved.ref.DocumentID).Scan(&revision, &current)
		if errors.Is(err, sql.ErrNoRows) {
			if saved.ref.ResourceType == EntityTypeProcessStep {
				continue
			}
		} else if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		document, annotations, err := decodeEditorTextboxBody(saved.body)
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		commit, err := NormalizeEditorJSONCommit(EditorJSONCommitInput{Document: saved.ref, OperationID: newUUIDv7String(), ClientID: "manual-history-restore", ActorUserID: input.ActorUserID, BaseRevision: revision, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document, Annotations: annotations})
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		replacements = append(replacements, replacement{input: commit, sizeChange: len(saved.body) - len(current)})
	}
	// Apply shrinking bodies first so an atomic restore does not exceed the
	// Process text limit temporarily while exchanging space between sections.
	sort.SliceStable(replacements, func(i, j int) bool { return replacements[i].sizeChange < replacements[j].sizeChange })
	for _, deletion := range deletions {
		if _, err := deletePostgresEditorTextboxDocumentTx(r, ctx, tx, deletion); err != nil {
			return domain.EditorSaveVersion{}, err
		}
	}
	for _, replacement := range replacements {
		if _, err := commitPostgresEditorTextboxDocumentTx(r, ctx, tx, replacement.input); err != nil {
			return domain.EditorSaveVersion{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.EditorSaveVersion{}, err
	}
	if len(deletions) > 0 && input.AfterDeleteCommit != nil {
		input.AfterDeleteCommit()
	}
	version.ItemCount = len(version.Items)
	version.UpdatedTimestamp = version.CreatedTimestamp
	return version, nil
}
