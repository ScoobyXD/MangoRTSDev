package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresEmailCollaborationSemanticMutationWritePathsRemainGuarded(t *testing.T) {
	tests := []struct {
		file      string
		signature string
	}{
		{file: "postgres_nodes.go", signature: "func (r *PostgresRepo) addNodeInformation"},
		{file: "postgres_editor_save_versions.go", signature: "func (r *PostgresRepo) UpsertNodeProjectionWithActor"},
		{file: "postgres_editor_save_versions.go", signature: "func (r *PostgresRepo) createEditorSaveVersion"},
		{file: "postgres_editor_save_versions.go", signature: "func (r *PostgresRepo) restoreEditorSaveVersion"},
		{file: "postgres_kanban.go", signature: "func (r *PostgresRepo) assignNodeToLogicGateStatusTx"},
		{file: "postgres_kanban.go", signature: "func (r *PostgresRepo) MoveLogicGateNodeAssignment"},
		{file: "postgres_kanban.go", signature: "func (r *PostgresRepo) RemoveLogicGateNodeAssignment"},
		{file: "postgres_kanban.go", signature: "func (r *PostgresRepo) SetLogicGateNodeAssignmentIssue"},
		{file: "postgres_gvic.go", signature: "func (r *PostgresRepo) applyResourceGVICAssignmentCommand"},
		{file: "accounts.go", signature: "func (r *PostgresRepo) SetNodeAccountAssignments"},
	}

	sources := map[string]string{}
	for _, test := range tests {
		source, ok := sources[test.file]
		if !ok {
			raw, err := os.ReadFile(test.file)
			if err != nil {
				t.Fatalf("ReadFile %s: %v", test.file, err)
			}
			source = strings.ReplaceAll(string(raw), "\r\n", "\n")
			sources[test.file] = source
		}
		body := emailCollaborationPostgresFunctionBodyForTest(t, source, test.signature)
		if !strings.Contains(body, "postgresRejectEmailCollaborationNodeMutation") {
			t.Errorf("%s in %s lacks the collaboration-Node mutation guard", test.signature, test.file)
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
