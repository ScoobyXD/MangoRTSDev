package store

import (
	"context"
	"database/sql"
	"errors"
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
	for _, query := range exec.queries {
		normalized := strings.ToLower(strings.Join(strings.Fields(query), " "))
		if strings.Contains(normalized, "insert into kanban_columns") {
			columnInsertCount++
			if !strings.Contains(normalized, "do update set") {
				t.Fatalf("default column insert should repair deterministic ID conflicts, query=%s", query)
			}
		}
	}
	if columnInsertCount != 3 {
		t.Fatalf("default column insert count = %d, want 3", columnInsertCount)
	}
}
