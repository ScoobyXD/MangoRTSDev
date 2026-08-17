package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func openEditorTextboxPostgresIntegration(t *testing.T) (*sql.DB, *PostgresRepo) {
	t.Helper()
	if os.Getenv("MANGORTS_EDITOR_TEXTBOX_POSTGRES_TEST") != "1" {
		t.Skip("disposable editor textbox PostgreSQL integration database not configured")
	}
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), os.Getenv("DB_SSLMODE"))
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db, NewPostgresRepo(db)
}

func TestPostgresEditorTextboxCutoverWorksAfterLegacyTablesAreDropped(t *testing.T) {
	db, repo := openEditorTextboxPostgresIntegration(t)
	companyID, nodeID, projectID, logicGateID := newUUIDv7String(), newUUIDv7String(), newUUIDv7String(), newUUIDv7String()
	nodeTextboxID, projectTextboxID, logicTextboxID := newUUIDv7String(), newUUIDv7String(), newUUIDv7String()
	setup := []struct {
		query string
		args  []any
	}{
		{`insert into companies(company_id,name) values($1::uuid,'Editor textbox integration')`, []any{companyID}},
		{`insert into nodes(company_id,node_id,name,created_timestamp) values($1::uuid,$2::uuid,'Node',now())`, []any{companyID, nodeID}},
		{`insert into projects(company_id,project_id,name) values($1::uuid,$2::uuid,'Project')`, []any{companyID, projectID}},
		{`insert into logic_gates(company_id,logic_gate_id,header,created_timestamp) values($1::uuid,$2::uuid,'Gate',now())`, []any{companyID, logicGateID}},
	}
	for _, statement := range setup {
		if _, err := db.Exec(statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = db.Exec(`delete from companies where company_id=$1::uuid`, companyID) })
	commit := func(resourceType, resourceID, textboxID, blockID, text string) EditorJSONCommit {
		t.Helper()
		document := editorMergeTestDocument(t, fmt.Sprintf(
			`{"type":"paragraph","attrs":{"blockId":%q},"content":[{"type":"text","text":%q}]}`,
			blockID, text))
		result, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
			Document:    EditorJSONDocumentRef{CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, DocumentID: textboxID},
			OperationID: newUUIDv7String(), ClientID: "integration", BaseRevision: 0,
			SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
			Annotations: []EditorJSONAnnotation{{ID: blockID + "-annotation", Kind: "comment", From: 1, To: 2}},
		})
		if err != nil {
			t.Fatalf("commit %s: %v", resourceType, err)
		}
		return result
	}

	commit(EntityTypeNode, nodeID, nodeTextboxID, "node-a", "node")
	projectCommit := commit(EntityTypeProject, projectID, projectTextboxID, "project-a", "server")
	commit(EntityTypeLogicGate, logicGateID, logicTextboxID, "logic-a", "logic")
	if projectCommit.Revision != 1 {
		t.Fatalf("project revision=%d, want 1", projectCommit.Revision)
	}

	local := editorMergeTestDocument(t,
		`{"type":"paragraph","attrs":{"blockId":"project-a"},"content":[{"type":"text","text":"local"}]}`)
	merged, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document:    projectCommit.JSONDocumentRef(companyID, projectID, projectTextboxID),
		OperationID: newUUIDv7String(), ClientID: "integration-stale", BaseRevision: 0,
		SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: local,
	})
	if err != nil {
		t.Fatal(err)
	}
	var mergedEnvelope mangoTiptapMergeEnvelope
	if json.Unmarshal(merged.JSONDocument, &mergedEnvelope) != nil || len(mergedEnvelope.Document.Content) != 2 {
		t.Fatalf("stale merge did not preserve both blocks: %s", merged.JSONDocument)
	}
	deleteResult, err := repo.DeleteEditorJSONDocument(EditorJSONDeleteInput{
		Document:    EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeProject, ResourceID: projectID, DocumentID: projectTextboxID},
		OperationID: newUUIDv7String(), ClientID: "integration-stale-delete", BaseRevision: 0,
	})
	if !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale deletion result=%#v err=%v, want ErrVersionConflict", deleteResult, err)
	}

	if _, err := repo.CreateNodeEditorSaveVersion(EditorSaveVersionInput{
		CompanyID: companyID, ResourceID: nodeID, SaveKind: editorSaveKindManual,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateLogicGateEditorSaveVersion(EditorSaveVersionInput{
		CompanyID: companyID, ResourceID: logicGateID, SaveKind: editorSaveKindManual,
	}); err != nil {
		t.Fatal(err)
	}
	projectSnapshot := projectSavedVersionPrefix + `{"name":"ignored","blocks":[{"id":"` + projectTextboxID + `","title":"Saved title","document":"` +
		strings.ReplaceAll(string(merged.JSONDocument), `"`, `\"`) + `","attachments":[]}]}`
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: companyID, ProjectID: projectID, InformationID: newUUIDv7String(),
		Type: projectSavedVersionType, Information: projectSnapshot,
	}); err != nil {
		t.Fatal(err)
	}
	var nodeHistory, projectHistory, logicHistory, outbox int
	if err := db.QueryRow(`select
		(select count(*) from node_textboxes_history where company_id=$1::uuid),
		(select count(*) from project_textboxes_history where company_id=$1::uuid),
		(select count(*) from logic_gate_textboxes_history where company_id=$1::uuid),
		(select count(*) from realtime_outbox where company_id=$1::uuid)`, companyID).
		Scan(&nodeHistory, &projectHistory, &logicHistory, &outbox); err != nil {
		t.Fatal(err)
	}
	if nodeHistory != 1 || projectHistory != 1 || logicHistory != 1 {
		t.Fatalf("history counts node=%d project=%d logic=%d", nodeHistory, projectHistory, logicHistory)
	}
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	scope := newCompanyExplorerRecycleScope()
	scope.NodeIDs[nodeID] = true
	scope.ProjectIDs[projectID] = true
	scope.LogicGateIDs[logicGateID] = true
	recyclePayload, err := postgresSnapshotRecyclePayloadTx(context.Background(), tx, companyID, scope)
	if rollbackErr := tx.Rollback(); err == nil && rollbackErr != nil {
		err = rollbackErr
	}
	if err != nil {
		t.Fatal(err)
	}
	var recycled map[string][]json.RawMessage
	if err := json.Unmarshal(recyclePayload, &recycled); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{
		"node_textboxes", "project_textboxes", "logic_gate_textboxes",
		"node_textboxes_history", "project_textboxes_history", "logic_gate_textboxes_history",
	} {
		if len(recycled[table]) != 1 {
			t.Fatalf("recycle payload %s rows=%d, want 1", table, len(recycled[table]))
		}
	}

	for _, owner := range []struct {
		table  string
		column string
		id     string
	}{
		{"nodes", "node_id", nodeID},
		{"projects", "project_id", projectID},
		{"logic_gates", "logic_gate_id", logicGateID},
	} {
		query := fmt.Sprintf("delete from %s where company_id=$1::uuid and %s=$2::uuid", owner.table, owner.column)
		if _, err := db.Exec(query, companyID, owner.id); err != nil {
			t.Fatal(err)
		}
	}
	restoreTx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range recycleRestoreTableOrder {
		tableRows := recycled[table]
		if len(tableRows) == 0 {
			continue
		}
		encodedRows, marshalErr := json.Marshal(tableRows)
		if marshalErr != nil {
			_ = restoreTx.Rollback()
			t.Fatal(marshalErr)
		}
		if restoreErr := postgresRestoreRecycleTableTx(context.Background(), restoreTx, table, encodedRows); restoreErr != nil {
			_ = restoreTx.Rollback()
			t.Fatalf("restore %s: %v", table, restoreErr)
		}
	}
	if err := restoreTx.Commit(); err != nil {
		t.Fatal(err)
	}
	var restoredRows int
	if err := db.QueryRow(`select
		(select count(*) from node_textboxes where company_id=$1::uuid)
		+ (select count(*) from project_textboxes where company_id=$1::uuid)
		+ (select count(*) from logic_gate_textboxes where company_id=$1::uuid)
		+ (select count(*) from node_textboxes_history where company_id=$1::uuid)
		+ (select count(*) from project_textboxes_history where company_id=$1::uuid)
		+ (select count(*) from logic_gate_textboxes_history where company_id=$1::uuid)`, companyID).Scan(&restoredRows); err != nil {
		t.Fatal(err)
	}
	if restoredRows != 6 {
		t.Fatalf("restored current/history textbox rows=%d, want 6", restoredRows)
	}

	if outbox != 4 {
		t.Fatalf("outbox rows=%d, want 4 current-save events", outbox)
	}
	versions, err := repo.ListEditorJSONVersions(EditorJSONDocumentRef{
		CompanyID: companyID, ResourceType: EntityTypeProject, ResourceID: projectID, DocumentID: projectTextboxID,
	}, 50)
	if err != nil || len(versions) != 0 {
		t.Fatalf("automatic versions survived cutover: %#v, %v", versions, err)
	}
}

func (commit EditorJSONCommit) JSONDocumentRef(companyID, resourceID, textboxID string) EditorJSONDocumentRef {
	return EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeProject, ResourceID: resourceID, DocumentID: textboxID}
}
