package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresSharedEmailDraftClaimRecoveryContract(t *testing.T) {
	raw, err := os.ReadFile("shared_email_draft_send.go")
	if err != nil {
		t.Fatalf("read shared_email_draft_send.go: %v", err)
	}
	claim := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(
		t, string(raw), "func (r *PostgresRepo) ClaimCommunicationsEmailDraftSend",
	)), " "))
	for _, required := range []string{
		"for update",
		"claimsharedemaildraftsend(draft, input.providergrantid, input.now)",
		"send_idempotency_grant_id=$5",
		"send_idempotency_timestamp=$6",
		"send_claimed_revision=$7",
		"send_claimed_timestamp=$8",
		"send_state=$9 and send_claim_token=$10",
		"recovered: previoussendstate == communicationsemaildraftsendstatesending",
	} {
		if !strings.Contains(claim, required) {
			t.Fatalf("Postgres claim recovery missing %q", required)
		}
	}
	release := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(
		t, string(raw), "func (r *PostgresRepo) ReleaseCommunicationsEmailDraftSend",
	)), " "))
	for _, required := range []string{
		"send_idempotency_key=''",
		"send_idempotency_grant_id=''",
		"send_idempotency_timestamp=null",
		"send_claim_token=$3",
	} {
		if !strings.Contains(release, required) {
			t.Fatalf("Postgres definitive release missing %q", required)
		}
	}

	raw, err = os.ReadFile("shared_email_drafts.go")
	if err != nil {
		t.Fatalf("read shared_email_drafts.go: %v", err)
	}
	discard := strings.ToLower(strings.Join(strings.Fields(extractFunctionSourceForTest(
		t, string(raw), "func (r *PostgresRepo) softDeleteParticipantSharedCommunicationsEmailDraft",
	)), " "))
	for _, required := range []string{
		"send_claimed_timestamp <= $6::timestamptz - interval '5 minutes'",
	} {
		if !strings.Contains(discard, required) {
			t.Fatalf("Postgres expired-claim discard missing %q", required)
		}
	}

	for _, path := range []string{"../../db/schema.sql", "../../db/migrations/20260713_email_thread_collaboration.sql"} {
		schema, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatalf("read %s: %v", path, readErr)
		}
		if !strings.Contains(strings.ToLower(string(schema)), "send_idempotency_timestamp timestamptz") {
			t.Fatalf("%s missing send idempotency origin timestamp", path)
		}
		if !strings.Contains(strings.ToLower(string(schema)), "send_idempotency_grant_id text") {
			t.Fatalf("%s missing send idempotency grant binding", path)
		}
	}
}
