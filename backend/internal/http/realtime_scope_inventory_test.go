package httpapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRealtimeProductionScopeInventoryIsExplicitAndNarrow(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	var production strings.Builder
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		payload, err := os.ReadFile(filepath.Clean(name))
		if err != nil {
			t.Fatal(err)
		}
		production.Write(payload)
	}
	source := production.String()
	for _, required := range []string{"notifications:user:", "mailbox:personal:account:", "mailbox:shared:", "chat:node:", "board:"} {
		if !strings.Contains(source, required) {
			t.Errorf("retained realtime scope %q missing from production transport", required)
		}
	}
	for _, forbidden := range []string{
		"workspace:user:", "company_explorer:user:", "node_graph:user:", "logic_gate_graph:user:",
		"gvic_matrix:user:", "project_management:user:", "communications:user:", "mailbox:personal:user:",
		"editor:node:", "editor:logic_gate:", "projection.delta", "workspace.event",
		"communications.event", "snapshot.refetch", "permission.revoked",
	} {
		if strings.Contains(source, forbidden) {
			t.Errorf("forbidden broad realtime protocol token %q remains in production HTTP source", forbidden)
		}
	}
}
