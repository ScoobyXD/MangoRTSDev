package store

import (
	"os"
	"strings"
	"testing"
)

func TestEmailRelationshipsUseOrdinaryHostResourceSemantics(t *testing.T) {
	for _, file := range []string{
		"postgres_nodes.go",
		"postgres_editor_save_versions.go",
		"postgres_company_explorer_v2.go",
		"postgres_projects.go",
		"postgres_entity_permissions.go",
		"memory_company_explorer_v2.go",
		"memory_entity_permissions.go",
		"memory_resource_policy_pointers.go",
		"email_collaboration_guards.go",
		"../http/account_handlers.go",
		"../http/company_explorer_handlers.go",
		"../http/entity_permission_handlers.go",
		"../http/gvic_handlers.go",
		"../http/logic_gate_work_handlers.go",
		"../http/node_handlers.go",
		"../http/work_item_handlers.go",
	} {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", file, err)
		}
		source := string(raw)
		for _, forbidden := range []string{"postgresRejectEmailCollaborationNodeMutation", "ErrProtectedEmailCollaborationResource", "emailCollaborationForNodeLocked", "email_collaboration_node_managed", "email_collaboration_explorer_item_managed", "email_collaboration_permissions_managed", "email_collaboration_attached_email_managed", "communications_email_collaboration_participants"} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s retains special email ownership/participant guard %q", file, forbidden)
			}
		}
	}
}

func TestEmailCollaborationAndExplorerDefaultsHaveNoNodePlacementPath(t *testing.T) {
	for _, file := range []string{"memory_email_collaboration.go", "postgres_email_collaboration.go"} {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", file, err)
		}
		source := strings.ToLower(string(raw))
		for _, forbidden := range []string{"placeemailcollaborationnode", "company_explorer_items", "unfiled_nodes"} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s retains Node placement marker %q", file, forbidden)
			}
		}
	}
	for _, file := range []string{"company_explorer_defaults.go", "memory_company_explorer_search.go", "postgres_company_explorer_defaults.go"} {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", file, err)
		}
		source := strings.ToLower(string(raw))
		for _, forbidden := range []string{"defaultnodes", "unfiled_nodes", "allowemailcollaborationnode", "placeemailcollaborationnode"} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s retains deterministic Nodes-folder marker %q", file, forbidden)
			}
		}
	}
}
