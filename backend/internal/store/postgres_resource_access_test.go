package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresCopyLogicGateAccessPolicyClosesPermissionRowsBeforeInsert(t *testing.T) {
	raw, err := os.ReadFile("postgres_resource_access.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_resource_access.go: %v", err)
	}
	body := postgresResourceAccessFunctionBodyForTest(t, string(raw), "func copyPostgresLogicGateAccessPolicyToNodeTx")
	if strings.Contains(body, "defer rows.Close()") {
		t.Fatal("copying logic gate access policy should close permission rows before inserting node overrides")
	}
	appendIndex := strings.Index(body, "userIDs = append(userIDs, userID)")
	rowsErrIndex := strings.Index(body, "if err := rows.Err(); err != nil")
	closeIndex := strings.Index(body, "if err := rows.Close(); err != nil")
	insertIndex := strings.Index(body, "insertPostgresResourceOverrideTx")
	if appendIndex < 0 || rowsErrIndex < 0 || closeIndex < 0 || insertIndex < 0 {
		t.Fatal("copying logic gate access policy should buffer permission users, check rows, close rows, then insert overrides")
	}
	if !(appendIndex < rowsErrIndex && rowsErrIndex < closeIndex && closeIndex < insertIndex) {
		t.Fatal("copying logic gate access policy inserts node overrides before closing permission rows")
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
