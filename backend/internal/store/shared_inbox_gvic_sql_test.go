package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresSharedInboxGVICUsesGenericResourceTable(t *testing.T) {
	raw, err := os.ReadFile("postgres_shared_inbox_GVIC.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_shared_inbox_GVIC.go: %v", err)
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
			t.Fatalf("shared inbox GVIC source missing %q", needle)
		}
	}
	for _, forbidden := range []string{
		"with recursive",
		"child.parent_folder_id",
		"shared_inbox_GVIC_assignments",
		"shared_inbox_GVIC_group_assignments",
		"resource_GVIC_assignments",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("shared inbox GVIC source should not use %q", forbidden)
		}
	}
	for _, needle := range []string{
		"CommunicationsSharedInboxGVICResourceType",
		"postgresResourceGVICAssignmentsForResource",
	} {
		if !strings.Contains(source, needle) {
			t.Fatalf("shared inbox GVIC attachment source missing %q", needle)
		}
	}
}
