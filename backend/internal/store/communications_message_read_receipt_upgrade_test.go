package store

import (
	"os"
	"strings"
	"testing"
)

func TestCommunicationsReadReceiptExactAccountUpgradeContract(t *testing.T) {
	schema := readCommunicationsReadReceiptContractFile(t, "../../db/schema.sql")
	migration := readCommunicationsReadReceiptContractFile(t, "../../db/migrations/20260713_00_exact_account_communications_read_receipts.sql")
	runtimeSource := readCommunicationsReadReceiptContractFile(t, "postgres_communications.go")
	scopeSource := readCommunicationsReadReceiptContractFile(t, "memory_communications.go")
	for _, required := range []string{"receipt_scope_id like user_id::text || ':%'", "length(receipt_scope_id) > length(user_id::text) + 1"} {
		if !strings.Contains(migration, required) {
			t.Fatalf("migration missing exact personal-account constraint %q", required)
		}
	}
	for _, required := range []string{"(receipt_scope_id)::text ~~ ((user_id)::text || ':%'::text)", "length((receipt_scope_id)::text) > (length((user_id)::text) + 1)"} {
		if !strings.Contains(schema, required) {
			t.Fatalf("canonical schema missing exact personal-account constraint %q", required)
		}
	}
	for _, forbidden := range []string{"create table", "alter table", "drop table", "create index", "create trigger"} {
		if strings.Contains(runtimeSource, forbidden) {
			t.Fatalf("request-time read-receipt store contains schema DDL %q", forbidden)
		}
	}
	for _, required := range []string{"if userid == \"\" || personalaccountemail == \"\"", "return strings.trimspace(userid) + \":\" + normalizeemail(personalaccountemail)"} {
		if !strings.Contains(scopeSource, required) {
			t.Fatalf("store source missing exact personal-account scope rule %q", required)
		}
	}
}

func readCommunicationsReadReceiptContractFile(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	source := string(body)
	if path == "../../db/schema.sql" {
		source = normalizeCanonicalSchemaContract(source)
	}
	return strings.ToLower(strings.Join(strings.Fields(source), " "))
}
