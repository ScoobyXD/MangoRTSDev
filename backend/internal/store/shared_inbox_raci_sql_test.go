package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresSharedInboxRaciAncestryCastsUUIDForParentJoin(t *testing.T) {
	raw, err := os.ReadFile("postgres_shared_inbox_raci.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_shared_inbox_raci.go: %v", err)
	}
	source := string(raw)
	if !strings.Contains(source, "child.parent_folder_id = parent.folder_id::text") {
		t.Fatalf("shared inbox ancestry query must compare text parent_folder_id to parent.folder_id::text")
	}
	if strings.Contains(source, "child.parent_folder_id = parent.folder_id\n") {
		t.Fatalf("shared inbox ancestry query compares text to uuid without a cast")
	}
}
