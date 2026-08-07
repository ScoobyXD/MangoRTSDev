package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresSharedInboxRACIUsesGenericResourceTable(t *testing.T) {
	raw, err := os.ReadFile("postgres_shared_inbox_gvic.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_shared_inbox_gvic.go: %v", err)
	}
	source := string(raw)
	for _, needle := range []string{
		"from shared_inboxes",
		"resource_gvic_assignments",
		"principal_type",
		"principal_id",
		"EntityTypeSharedInbox",
	} {
		if !strings.Contains(source, needle) {
			t.Fatalf("shared inbox RACI source missing %q", needle)
		}
	}
	for _, forbidden := range []string{
		"with recursive",
		"child.parent_folder_id",
		"shared_inbox_gvic_assignments",
		"shared_inbox_gvic_group_assignments",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("shared inbox RACI source should not use %q", forbidden)
		}
	}
	for _, needle := range []string{
		"CommunicationsSharedInboxRACIResourceType",
		"GetResourceRACIPolicy",
	} {
		if !strings.Contains(source, needle) {
			t.Fatalf("shared inbox RACI attachment source missing %q", needle)
		}
	}
}
