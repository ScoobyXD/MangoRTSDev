package store

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestEmailCollaborationEnsureStagePreservesWrappedErrors(t *testing.T) {
	err := wrapEmailCollaborationEnsureStage("lookup_existing", ErrInvalid)
	if got := EmailCollaborationEnsureErrorStage(err); got != "lookup_existing" {
		t.Fatalf("stage=%q, want lookup_existing", got)
	}
	if !errors.Is(err, ErrInvalid) {
		t.Fatal("staged error must preserve errors.Is for domain sentinels")
	}
	if strings.Contains(err.Error(), ErrInvalid.Error()) {
		t.Fatalf("staged error string leaked wrapped cause: %q", err.Error())
	}
	if got := EmailCollaborationEnsureErrorSQLState(err); got != "" {
		t.Fatalf("SQLSTATE=%q for non-Postgres error", got)
	}
	if got := EmailCollaborationEnsureErrorCategory(err); got != "store_error" {
		t.Fatalf("category=%q, want store_error", got)
	}
}

func TestEmailCollaborationStorageNotReadySQLStates(t *testing.T) {
	tests := []struct {
		code     string
		category string
		want     bool
	}{
		{code: "42P01", category: "undefined_table", want: true},
		{code: "42703", category: "undefined_column", want: true},
		{code: "42704", category: "undefined_object", want: true},
		{code: "42883", category: "undefined_function", want: true},
		{code: "42501", category: "insufficient_privilege", want: true},
		{code: "42804", category: "datatype_mismatch", want: true},
		{code: "42P10", category: "missing_unique_constraint", want: true},
		{code: "23514", category: "check_constraint_drift", want: true},
		{code: "23505", category: "postgres_error", want: false},
	}
	for _, test := range tests {
		t.Run(test.code, func(t *testing.T) {
			pgErr := &pgconn.PgError{
				Code:    test.code,
				Message: "safe primary message",
				Detail:  "must-not-log serialized email body",
			}
			err := wrapEmailCollaborationEnsureStage("insert_collaboration", pgErr)
			if got := EmailCollaborationEnsureErrorSQLState(err); got != test.code {
				t.Fatalf("SQLSTATE=%q, want %q", got, test.code)
			}
			if got := EmailCollaborationEnsureErrorCategory(err); got != test.category {
				t.Fatalf("category=%q, want %q", got, test.category)
			} else if strings.Contains(got, pgErr.Detail) || strings.Contains(got, pgErr.Message) {
				t.Fatalf("safe category leaked Postgres content: %q", got)
			}
			if got := IsEmailCollaborationStorageNotReady(err); got != test.want {
				t.Fatalf("storage-not-ready=%t, want %t", got, test.want)
			}
		})
	}
}

func TestEmailCollaborationInvalidEnumValueIsStorageDriftOnlyAtAttachedEmailStages(t *testing.T) {
	tests := []struct {
		stage string
		want  bool
	}{
		{stage: "insert_attached_email_history", want: true},
		{stage: "insert_attached_email_projection", want: true},
		{stage: "check_creator_membership", want: false},
		{stage: "insert_collaboration", want: false},
	}
	for _, test := range tests {
		t.Run(test.stage, func(t *testing.T) {
			err := wrapEmailCollaborationEnsureStage(test.stage, &pgconn.PgError{
				Code:    "22P02",
				Message: "invalid input value for enum information_type",
			})
			if got := EmailCollaborationEnsureErrorCategory(err); got != "invalid_schema_value" {
				t.Fatalf("category=%q, want invalid_schema_value", got)
			}
			if got := IsEmailCollaborationStorageNotReady(err); got != test.want {
				t.Fatalf("storage-not-ready=%t, want %t", got, test.want)
			}
		})
	}
}

func TestPostgresEmailRelationshipCreationUsesFinalTablesAndOrdinaryPermissions(t *testing.T) {
	raw, err := os.ReadFile("postgres_email_collaboration.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (r *PostgresRepo) EnsureCommunicationsEmailCollaboration")
	end := strings.Index(source, "func (r *PostgresRepo) ListCommunicationsEmailCollaborations")
	if start < 0 || end <= start {
		t.Fatal("could not isolate EnsureCommunicationsEmailCollaboration source")
	}
	ensureSource := source[start:end]
	for _, required := range []string{"upsertPostgresCommunicationsEmailThreadTx", "linkPostgresCommunicationsEmailThreadToNodeTx", "customizeNewPostgresResourcePermissionForCreatorTx", "customizeNewPostgresResourceRACIForCreatorTx"} {
		if !strings.Contains(ensureSource, required) {
			t.Fatalf("final email relationship creation missing %q", required)
		}
	}
	for _, forbidden := range []string{"communications_email_collaborations", "communications_email_collaboration_participants", "syncNodeProjectionDependenciesTx"} {
		if strings.Contains(ensureSource, forbidden) {
			t.Fatalf("final email relationship creation retained %q", forbidden)
		}
	}
}
