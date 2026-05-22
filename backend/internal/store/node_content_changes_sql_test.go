package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresUnseenNodeContentChangesComparesActorAsUUID(t *testing.T) {
	raw, err := os.ReadFile("postgres_nodes.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_nodes.go: %v", err)
	}
	body := extractNodeContentChangeFunctionSourceForTest(t, string(raw), "func (r *PostgresRepo) ListUnseenNodeContentChanges")
	normalized := strings.ToLower(strings.Join(strings.Fields(body), " "))

	if !strings.Contains(normalized, "seen.user_id=$3::uuid") {
		t.Fatalf("ListUnseenNodeContentChanges must bind the viewer id as uuid for seen rows")
	}
	if !strings.Contains(normalized, "change.actor_user_id is distinct from $3::uuid") {
		t.Fatalf("ListUnseenNodeContentChanges must compare actor_user_id to the viewer id as uuid")
	}
	for _, forbidden := range []string{
		"coalesce(change.actor_user_id::text, '') <> $3",
		"change.actor_user_id::text <> $3",
		"actor_user_id::text <> $3",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("ListUnseenNodeContentChanges contains broken text-to-uuid comparison %q", forbidden)
		}
	}
}

func extractNodeContentChangeFunctionSourceForTest(t *testing.T, source, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("function %q not found", signature)
	}
	rest := source[start+len(signature):]
	next := strings.Index(rest, "\nfunc ")
	if next < 0 {
		return source[start:]
	}
	return source[start : start+len(signature)+next]
}
