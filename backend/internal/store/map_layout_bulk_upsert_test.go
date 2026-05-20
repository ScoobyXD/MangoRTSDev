package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
)

func TestMemoryRepoUpsertNodeMapPositionsBulkPreservesOrderAndIsAtomic(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-node-bulk-upsert"
	nodeA, err := repo.CreateNode(companyID, "Node A")
	if err != nil {
		t.Fatalf("CreateNode A: %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "Node B")
	if err != nil {
		t.Fatalf("CreateNode B: %v", err)
	}

	items, err := repo.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{
		{NodeID: nodeB.NodeID, X: 20, Y: 30},
		{NodeID: nodeA.NodeID, X: 10, Y: 15},
	})
	if err != nil {
		t.Fatalf("UpsertNodeMapPositions: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
	if items[0].NodeID != nodeB.NodeID || items[0].X != 20 || items[0].Y != 30 {
		t.Fatalf("first returned position = %+v, want node B at 20,30", items[0])
	}
	if items[1].NodeID != nodeA.NodeID || items[1].X != 10 || items[1].Y != 15 {
		t.Fatalf("second returned position = %+v, want node A at 10,15", items[1])
	}

	_, err = repo.UpsertNodeMapPositions(companyID, []domain.NodeMapPosition{
		{NodeID: nodeA.NodeID, X: 99, Y: 99},
		{NodeID: "missing-node", X: 1, Y: 1},
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing node err = %v, want ErrNotFound", err)
	}

	positions, err := repo.ListNodeMapPositions(companyID)
	if err != nil {
		t.Fatalf("ListNodeMapPositions: %v", err)
	}
	byID := map[string]domain.NodeMapPosition{}
	for _, position := range positions {
		byID[position.NodeID] = position
	}
	if got := byID[nodeA.NodeID]; got.X != 10 || got.Y != 15 {
		t.Fatalf("node A changed after failed bulk upsert: %+v", got)
	}
	if got := byID[nodeB.NodeID]; got.X != 20 || got.Y != 30 {
		t.Fatalf("node B changed after failed bulk upsert: %+v", got)
	}
}

func TestMemoryRepoUpsertLogicGateMapPositionsBulkPreservesOrderAndIsAtomic(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-logic-gate-bulk-upsert"
	gateA, err := repo.CreateLogicGate(companyID, "Gate A")
	if err != nil {
		t.Fatalf("CreateLogicGate A: %v", err)
	}
	gateB, err := repo.CreateLogicGate(companyID, "Gate B")
	if err != nil {
		t.Fatalf("CreateLogicGate B: %v", err)
	}

	items, err := repo.UpsertLogicGateMapPositions(companyID, []domain.LogicGateMapPosition{
		{LogicGateID: gateB.LogicGateID, X: 120, Y: 130},
		{LogicGateID: gateA.LogicGateID, X: 110, Y: 115},
	})
	if err != nil {
		t.Fatalf("UpsertLogicGateMapPositions: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
	if items[0].LogicGateID != gateB.LogicGateID || items[0].X != 120 || items[0].Y != 130 {
		t.Fatalf("first returned position = %+v, want gate B at 120,130", items[0])
	}
	if items[1].LogicGateID != gateA.LogicGateID || items[1].X != 110 || items[1].Y != 115 {
		t.Fatalf("second returned position = %+v, want gate A at 110,115", items[1])
	}

	_, err = repo.UpsertLogicGateMapPositions(companyID, []domain.LogicGateMapPosition{
		{LogicGateID: gateA.LogicGateID, X: 199, Y: 199},
		{LogicGateID: "missing-logic-gate", X: 1, Y: 1},
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing Logic Gate err = %v, want ErrNotFound", err)
	}

	positions, err := repo.ListLogicGateMapPositions(companyID)
	if err != nil {
		t.Fatalf("ListLogicGateMapPositions: %v", err)
	}
	byID := map[string]domain.LogicGateMapPosition{}
	for _, position := range positions {
		byID[position.LogicGateID] = position
	}
	if got := byID[gateA.LogicGateID]; got.X != 110 || got.Y != 115 {
		t.Fatalf("gate A changed after failed bulk upsert: %+v", got)
	}
	if got := byID[gateB.LogicGateID]; got.X != 120 || got.Y != 130 {
		t.Fatalf("gate B changed after failed bulk upsert: %+v", got)
	}
}

func TestPostgresMapPositionUpsertsUseSetBasedSQL(t *testing.T) {
	tests := []struct {
		name      string
		path      string
		signature string
		table     string
		idColumn  string
	}{
		{
			name:      "nodes",
			path:      "postgres_nodes.go",
			signature: "func (r *PostgresRepo) UpsertNodeMapPositions",
			table:     "node_map_positions",
			idColumn:  "node_id",
		},
		{
			name:      "logic gates",
			path:      "postgres_logic_gates.go",
			signature: "func (r *PostgresRepo) UpsertLogicGateMapPositions",
			table:     "logic_gate_map_positions",
			idColumn:  "logic_gate_id",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := os.ReadFile(tt.path)
			if err != nil {
				t.Fatalf("ReadFile %s: %v", tt.path, err)
			}
			body := extractFunctionSourceForTest(t, string(raw), tt.signature)
			normalized := strings.ToLower(strings.Join(strings.Fields(body), " "))

			required := []string{
				"from unnest($2::text[], $3::double precision[], $4::double precision[]) with ordinality",
				"latest_input as ( select distinct on (" + tt.idColumn + ")",
				"insert into " + tt.table,
				"on conflict (company_id, " + tt.idColumn + ") do update",
				"order by input.ordinality",
			}
			for _, needle := range required {
				if !strings.Contains(normalized, needle) {
					t.Fatalf("%s missing set-based SQL fragment %q", tt.signature, needle)
				}
			}
			if count := strings.Count(normalized, "querycontext"); count != 1 {
				t.Fatalf("%s QueryContext count = %d, want 1", tt.signature, count)
			}
			for _, forbidden := range []string{"queryrowcontext", "begintx"} {
				if strings.Contains(normalized, forbidden) {
					t.Fatalf("%s should not use %s for bulk position upserts", tt.signature, forbidden)
				}
			}
		})
	}
}

func extractFunctionSourceForTest(t *testing.T, source, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("function %q not found", signature)
	}
	rest := source[start+len(signature):]
	next := strings.Index(rest, "\nfunc ")
	if next < 0 {
		return source[start:]
	}
	return source[start : start+len(signature)+next]
}
