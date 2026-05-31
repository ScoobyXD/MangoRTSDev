package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var errColumnInsertWouldConflict = errors.New("column insert would conflict")

type recordingKanbanBoardEnsurer struct {
	queries []string
}

func (e *recordingKanbanBoardEnsurer) ExecContext(_ context.Context, query string, _ ...any) (sql.Result, error) {
	e.queries = append(e.queries, query)
	normalized := strings.ToLower(strings.Join(strings.Fields(query), " "))
	if strings.Contains(normalized, "insert into kanban_columns") &&
		!strings.Contains(normalized, "on conflict (company_id, board_id, column_id)") {
		return nil, errColumnInsertWouldConflict
	}
	return noopSQLResult{}, nil
}

type noopSQLResult struct{}

func (noopSQLResult) LastInsertId() (int64, error) {
	return 0, nil
}

func (noopSQLResult) RowsAffected() (int64, error) {
	return 0, nil
}

func TestEnsureLogicGateKanbanBoardSQL_DefaultColumnsAreConflictSafe(t *testing.T) {
	exec := &recordingKanbanBoardEnsurer{}

	err := ensureLogicGateKanbanBoardSQL(
		context.Background(),
		exec,
		"11111111-1111-1111-1111-111111111111",
		"22222222-2222-4222-8222-222222222222",
		"Assembly gate",
	)
	if err != nil {
		t.Fatalf("ensureLogicGateKanbanBoardSQL failed: %v", err)
	}

	columnInsertCount := 0
	sawAdvisoryLock := false
	sawAttachedBoardLookup := false
	for _, query := range exec.queries {
		normalized := strings.ToLower(strings.Join(strings.Fields(query), " "))
		if strings.Contains(normalized, "pg_advisory_xact_lock") {
			sawAdvisoryLock = true
		}
		if strings.Contains(normalized, "kb.logic_gate_id = p.logic_gate_id") {
			sawAttachedBoardLookup = true
		}
		if strings.Contains(normalized, "insert into kanban_columns") {
			columnInsertCount++
			if !strings.Contains(normalized, "do update set") {
				t.Fatalf("default column insert should repair deterministic ID conflicts, query=%s", query)
			}
		}
	}
	if !sawAdvisoryLock {
		t.Fatal("ensure should take a per-gate advisory lock before repairing arena state")
	}
	if !sawAttachedBoardLookup {
		t.Fatal("ensure should reuse an existing board attached by logic_gate_id before creating a preferred board_id")
	}
	if columnInsertCount != 1 {
		t.Fatalf("default column insert count = %d, want 1 set-based insert", columnInsertCount)
	}
	if normalized := strings.ToLower(strings.Join(strings.Fields(strings.Join(exec.queries, " ")), " ")); !strings.Contains(normalized, "('verify', 3000") || !strings.Contains(normalized, "('done', 4000") {
		t.Fatalf("default column SQL does not put Verify between In Progress and Done: %s", normalized)
	}
}

func TestNodeLogicGateAssignmentMigrationBackfillsAndGuardsLegacyCards(t *testing.T) {
	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260519_node_logic_gate_assignments.sql")
	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("ReadFile migration: %v", err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	required := []string{
		"create table if not exists node_logic_gate_assignments",
		"insert into node_logic_gate_assignments",
		"from kanban_cards card join kanban_columns",
		"where card.logic_gate_id is not null",
		"on conflict (company_id, node_id)",
		"create trigger trg_sync_node_logic_gate_assignment_from_kanban_card after insert or update or delete on kanban_cards",
		"delete from node_logic_gate_assignments assignment",
	}
	for _, needle := range required {
		if !strings.Contains(normalized, needle) {
			t.Fatalf("migration missing %q", needle)
		}
	}

	schemaPath := filepath.Join("..", "..", "db", "schema.sql")
	schemaRaw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("ReadFile schema: %v", err)
	}
	schema := strings.ToLower(strings.Join(strings.Fields(string(schemaRaw)), " "))
	if !strings.Contains(schema, "create table if not exists node_logic_gate_assignments") {
		t.Fatal("canonical schema is missing node_logic_gate_assignments")
	}
	if !strings.Contains(schema, "create trigger trg_sync_node_logic_gate_assignment_from_kanban_card after insert or update or delete on kanban_cards") {
		t.Fatal("canonical schema is missing Kanban-card assignment sync trigger")
	}
}

func TestPostgresMoveLogicGateAssignmentPreservesEmailReferencesAcrossCardIdentityChange(t *testing.T) {
	raw, err := os.ReadFile("postgres_kanban.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_kanban.go: %v", err)
	}
	body := postgresKanbanFunctionBodyForTest(t, strings.ReplaceAll(string(raw), "\r\n", "\n"), "func (r *PostgresRepo) MoveLogicGateNodeAssignment")
	takeIndex := strings.Index(body, "takePostgresCommunicationsEmailNodeReferenceForCardTx")
	deleteIndex := strings.Index(body, "delete from kanban_cards\nwhere company_id=$1 and board_id=$2 and card_id=$3")
	updateBoardIndex := strings.Index(body, "set board_id=$4,")
	restoreIndex := strings.Index(body, "restorePostgresCommunicationsEmailNodeReferenceTx")
	updatePrimaryIndex := strings.Index(body, "updatePostgresCommunicationsEmailNodeReferenceForNodeTx")
	updateAttachmentIndex := strings.Index(body, "updatePostgresCommunicationsEmailAttachmentReferencesForNodeTx")
	for name, index := range map[string]int{
		"take email reference":        takeIndex,
		"delete source card":          deleteIndex,
		"update moved card board":     updateBoardIndex,
		"restore email reference":     restoreIndex,
		"update primary placement":    updatePrimaryIndex,
		"update attachment placement": updateAttachmentIndex,
	} {
		if index < 0 {
			t.Fatalf("MoveLogicGateNodeAssignment missing %s step", name)
		}
	}
	if !(takeIndex < deleteIndex && takeIndex < updateBoardIndex) {
		t.Fatal("MoveLogicGateNodeAssignment should detach email references before deleting or changing the old card identity")
	}
	if !(deleteIndex < restoreIndex && updateBoardIndex < restoreIndex && restoreIndex < updateAttachmentIndex && restoreIndex < updatePrimaryIndex) {
		t.Fatal("MoveLogicGateNodeAssignment should restore/update email references after the final card exists")
	}
}

func postgresKanbanFunctionBodyForTest(t *testing.T, source, signature string) string {
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
