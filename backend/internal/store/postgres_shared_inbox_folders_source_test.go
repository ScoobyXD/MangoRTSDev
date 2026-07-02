package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresVisibleSharedInboxListQueryUsesOnlyDeclaredArgs(t *testing.T) {
	raw, err := os.ReadFile("postgres_shared_inbox_folders.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_shared_inbox_folders.go: %v", err)
	}
	source := strings.ReplaceAll(string(raw), "\r\n", "\n")
	body := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) ListVisibleCommunicationsSharedInboxFolders")
	if strings.Contains(body, "ResourceDefaultAccessNoAccess") {
		t.Fatalf("ListVisibleCommunicationsSharedInboxFolders should not pass an unused fourth SQL argument")
	}
	if !strings.Contains(body, "companyID, userID, ResourceDefaultAccessEdit)") {
		t.Fatalf("ListVisibleCommunicationsSharedInboxFolders should pass exactly the three SQL arguments it references")
	}
}
