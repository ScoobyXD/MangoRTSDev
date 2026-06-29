package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresResourceOverrideUserIDsClosesPermissionRowsBeforeReturn(t *testing.T) {
	raw, err := os.ReadFile("postgres_resource_access.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_resource_access.go: %v", err)
	}
	body := postgresResourceAccessFunctionBodyForTest(t, string(raw), "func postgresResourceOverrideUserIDsTx")
	if strings.Contains(body, "defer rows.Close()") {
		t.Fatal("resource override reads should close permission rows before returning buffered users")
	}
	appendIndex := strings.Index(body, "userIDs = append(userIDs, userID)")
	rowsErrIndex := strings.Index(body, "if err := rows.Err(); err != nil")
	closeIndex := strings.Index(body, "if err := rows.Close(); err != nil")
	returnIndex := strings.Index(body, "return userIDs, nil")
	if appendIndex < 0 || rowsErrIndex < 0 || closeIndex < 0 || returnIndex < 0 {
		t.Fatal("resource override reads should buffer permission users, check rows, close rows, then return users")
	}
	if !(appendIndex < rowsErrIndex && rowsErrIndex < closeIndex && closeIndex < returnIndex) {
		t.Fatal("resource override reads return before closing permission rows")
	}
}

func TestPostgresResourceAccessPolicySnapshotComparesExactPolicy(t *testing.T) {
	raw, err := os.ReadFile("postgres_resource_access.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_resource_access.go: %v", err)
	}
	body := postgresResourceAccessFunctionBodyForTest(t, string(raw), "func snapshotPostgresResourceAccessPolicyTx")
	if !strings.Contains(body, "sourceDefaultAccess == targetDefaultAccess") {
		t.Fatal("policy snapshot must compare source and target default_access before rewriting")
	}
	if !strings.Contains(body, "orderedStringSlicesEqual(sourceOverrideUserIDs, targetOverrideUserIDs)") {
		t.Fatal("policy snapshot must compare exact override users before rewriting")
	}
	if !strings.Contains(body, "setPostgresResourceDefaultAccessTx(ctx, tx, companyID, targetType, targetID, sourceDefaultAccess)") {
		t.Fatal("policy snapshot must set the target default_access from the source")
	}
	if !strings.Contains(body, "deletePostgresResourceOverridesTx(ctx, tx, companyID, targetType, targetID)") {
		t.Fatal("policy snapshot must replace target override rows atomically")
	}
	if !strings.Contains(body, "insertPostgresResourceOverrideTx(ctx, tx, companyID, targetType, targetID, userID)") {
		t.Fatal("policy snapshot must copy source override users onto the target resource type")
	}
}

func postgresResourceAccessFunctionBodyForTest(t *testing.T, source, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("missing function %q", signature)
	}
	remaining := source[start+len(signature):]
	end := strings.Index(remaining, "\nfunc ")
	if end < 0 {
		return remaining
	}
	return remaining[:end]
}
