package httpapi

import (
	"os"
	"strings"
	"testing"
)

func TestHTTPHandlersDoNotCallEffectiveAccessRepairProjection(t *testing.T) {
	t.Parallel()

	paths := []string{
		"communications_shared_inbox_handlers.go",
		"company_explorer_handlers.go",
		"entity_permission_handlers.go",
		"kanban_handlers.go",
		"logic_gate_handlers.go",
		"logic_gate_raci_command_handlers.go",
		"logic_gate_work_handlers.go",
		"work_item_handlers.go",
	}
	for _, path := range paths {
		path := path
		t.Run(path, func(t *testing.T) {
			t.Parallel()
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read %s: %v", path, err)
			}
			if strings.Contains(string(data), "refreshEffectiveAccessProjection(") {
				t.Fatalf("%s still calls handler-level effective-access repair", path)
			}
		})
	}
}
