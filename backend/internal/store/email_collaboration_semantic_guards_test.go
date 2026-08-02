package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresEmailNodeWorkPathsAreOpenWhileCanonicalEmailRemainsProtected(t *testing.T) {
	allowed := []struct {
		file      string
		signature string
	}{
		{file: "postgres_editor_textbox_history.go", signature: "func createPostgresEditorTextboxHistory"},
		{file: "postgres_editor_textbox_history.go", signature: "func restorePostgresEditorTextboxHistory"},
		{file: "postgres_kanban.go", signature: "func (r *PostgresRepo) assignNodeToLogicGateStatusTx"},
		{file: "postgres_kanban.go", signature: "func (r *PostgresRepo) MoveLogicGateNodeAssignment"},
		{file: "postgres_kanban.go", signature: "func (r *PostgresRepo) RemoveLogicGateNodeAssignment"},
		{file: "postgres_kanban.go", signature: "func (r *PostgresRepo) SetLogicGateNodeAssignmentIssue"},
		{file: "postgres_gvic.go", signature: "func (r *PostgresRepo) applyResourceGVICAssignmentCommand"},
		{file: "accounts.go", signature: "func (r *PostgresRepo) SetNodeAccountAssignments"},
		{file: "postgres_projects.go", signature: "func (r *PostgresRepo) UpsertProjectRelationship"},
		{file: "postgres_company_explorer.go", signature: "func postgresDeleteNodeWithDependentProjectionsTx"},
	}
	for _, test := range allowed {
		raw, err := os.ReadFile(test.file)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", test.file, err)
		}
		body := emailCollaborationPostgresFunctionBodyForTest(t, strings.ReplaceAll(string(raw), "\r\n", "\n"), test.signature)
		if strings.Contains(body, "postgresRejectEmailCollaborationNodeMutation") {
			t.Errorf("%s in %s still rejects normal email-node work semantics", test.signature, test.file)
		}
	}

	canonical := []struct {
		file      string
		signature string
	}{
		{file: "postgres_nodes.go", signature: "func (r *PostgresRepo) addNodeInformation"},
		{file: "postgres_editor_save_versions.go", signature: "func (r *PostgresRepo) UpsertNodeProjectionWithActor"},
		{file: "postgres_nodes.go", signature: "func (r *PostgresRepo) deleteNodeProjection"},
	}
	for _, test := range canonical {
		raw, err := os.ReadFile(test.file)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", test.file, err)
		}
		body := emailCollaborationPostgresFunctionBodyForTest(t, strings.ReplaceAll(string(raw), "\r\n", "\n"), test.signature)
		if strings.Contains(body, "ErrProtectedEmailCollaborationResource") || strings.Contains(body, "postgresRejectEmailCollaborationNodeMutation") {
			t.Errorf("%s in %s still applies retired protected-collaboration behavior", test.signature, test.file)
		}
	}
}

func emailCollaborationPostgresFunctionBodyForTest(t *testing.T, source, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("missing function %q", signature)
	}
	remaining := source[start+len(signature):]
	end := strings.Index(remaining, "\nfunc ")
	if end < 0 {
		return remaining
	}
	return remaining[:end]
}
