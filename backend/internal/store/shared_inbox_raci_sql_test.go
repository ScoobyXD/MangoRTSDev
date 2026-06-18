package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresSharedInboxRaciUsesMailboxTablesOnly(t *testing.T) {
	raw, err := os.ReadFile("postgres_shared_inbox_raci.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_shared_inbox_raci.go: %v", err)
	}
	source := string(raw)
	for _, needle := range []string{
		"from shared_inboxes",
		"shared_inbox_raci_assignments",
		"shared_inbox_raci_group_assignments",
		"EntityTypeSharedInbox",
	} {
		if !strings.Contains(source, needle) {
			t.Fatalf("shared inbox RACI source missing %q", needle)
		}
	}
	for _, forbidden := range []string{
		"with recursive",
		"child.parent_folder_id",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("shared inbox RACI source should not use %q", forbidden)
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
