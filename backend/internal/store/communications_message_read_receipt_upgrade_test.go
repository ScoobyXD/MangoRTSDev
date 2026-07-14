package store

import (
	"os"
	"strings"
	"testing"
)

func TestCommunicationsReadReceiptExactAccountUpgradeContract(t *testing.T) {
	const repairMigrationPath = "../../db/migrations/20260713_00_exact_account_communications_read_receipts.sql"
	const legacyDropMigrationPath = "../../db/migrations/20260713_drop_legacy_communications_message_read_statuses.sql"
	schema := readCommunicationsReadReceiptContractFile(t, "../../db/schema.sql")
	runtimeSchema := readCommunicationsReadReceiptContractFile(t, "postgres_communications.go")
	scopeSource := readCommunicationsReadReceiptContractFile(t, "memory_communications.go")
	migration := readCommunicationsReadReceiptContractFile(t, repairMigrationPath)
	legacyDropMigration := readCommunicationsReadReceiptContractFile(t, legacyDropMigrationPath)

	for name, source := range map[string]string{
		"canonical schema": schema,
		"runtime schema":   runtimeSchema,
		"migration":        migration,
	} {
		for _, required := range []string{
			"receipt_scope_id like user_id::text || ':%'",
			"length(receipt_scope_id) > length(user_id::text) + 1",
		} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s missing exact personal-account constraint %q", name, required)
			}
		}
	}
	if strings.Contains(schema, "create table if not exists communications_message_read_statuses") {
		t.Fatal("canonical schema recreates the retired user-wide receipt table")
	}

	for _, required := range []string{
		"if userid == \"\" || personalaccountemail == \"\"",
		"return strings.trimspace(userid) + \":\" + normalizeemail(personalaccountemail)",
	} {
		if !strings.Contains(scopeSource, required) {
			t.Fatalf("store source missing exact personal-account scope rule %q", required)
		}
	}

	for _, required := range []string{
		"to_regclass('public.communications_message_read_statuses')",
		"from public.communications_message_read_statuses",
		"from public.user_email_connections",
		"min(lower(btrim(account_email))) as account_email",
		"group by user_id having count(*) = 1",
		"legacy.user_id::text || ':' || account.account_email",
		"legacy.receipt_scope_id = legacy.user_id::text",
		"signal_count = greatest(receipt.signal_count, excluded.signal_count)",
		"first_signal_timestamp = least(receipt.first_signal_timestamp, excluded.first_signal_timestamp)",
		"last_signal_timestamp = greatest(receipt.last_signal_timestamp, excluded.last_signal_timestamp)",
		"created_timestamp = least(receipt.created_timestamp, excluded.created_timestamp)",
		"updated_timestamp = greatest(receipt.updated_timestamp, excluded.updated_timestamp)",
		"delete from public.communications_message_read_receipt_summaries where receipt_scope_type = 'personal' and receipt_scope_id = user_id::text",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("exact-account receipt migration missing %q", required)
		}
	}
	if got := strings.Count(migration, "on conflict (receipt_scope_type, receipt_scope_id, message_id) do update set"); got != 2 {
		t.Fatalf("idempotent receipt merges = %d, want two", got)
	}

	if strings.Contains(migration, "drop table if exists") {
		t.Fatal("forward receipt repair must leave the separately committed legacy drop migration immutable")
	}
	if !strings.HasSuffix(legacyDropMigration, "drop table if exists communications_message_read_statuses;") ||
		strings.Contains(legacyDropMigration, "insert into public.communications_message_read_receipt_summaries") ||
		repairMigrationPath >= legacyDropMigrationPath {
		t.Fatal("receipt repair must sort before and preserve the already-committed legacy drop migration")
	}
	copyLegacyAt := strings.Index(migration, "from public.communications_message_read_statuses")
	migrateSingletonAt := strings.Index(migration, "with single_personal_accounts as")
	resolveUnownedAt := strings.Index(migration, "delete from public.communications_message_read_receipt_summaries")
	enforceExactAt := strings.Index(migration, "add constraint communications_message_read_receipt_summaries_personal_chk")
	if copyLegacyAt < 0 || migrateSingletonAt < 0 || resolveUnownedAt < 0 || enforceExactAt < 0 {
		t.Fatal("exact-account receipt migration is missing a required phase")
	}
	if !(copyLegacyAt < migrateSingletonAt &&
		migrateSingletonAt < resolveUnownedAt &&
		resolveUnownedAt < enforceExactAt) {
		t.Fatal("receipt migration must copy, migrate, resolve, then constrain in that order")
	}
}

func readCommunicationsReadReceiptContractFile(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return strings.ToLower(strings.Join(strings.Fields(string(body)), " "))
}
