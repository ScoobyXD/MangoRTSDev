package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type failingEmailCollaborationEnsureRepo struct {
	store.Repository
	err error
}

func (r failingEmailCollaborationEnsureRepo) EnsureCommunicationsEmailCollaboration(context.Context, store.CommunicationsEmailCollaborationEnsureInput) (store.CommunicationsEmailCollaborationEnsureResult, error) {
	return store.CommunicationsEmailCollaborationEnsureResult{}, r.err
}

func TestEmailCollaborationCreationReportsStorageNotReadyWithoutLeakingPostgresDetail(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		Scope: "personal", GrantID: "personal-source-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	providerMessage := NylasMessage{
		ID: "storage-message", ThreadID: "storage-thread", Subject: "Private subject",
	}
	pgErr := &pgconn.PgError{
		Code:    "42P01",
		Message: `relation "communications_email_collaborations" does not exist`,
		Detail:  "private serialized email body must not appear in logs",
	}
	server := newEmailCollaborationThreadTestServer(failingEmailCollaborationEnsureRepo{Repository: repo, err: pgErr}, newEmailCollaborationCreationTestClient(providerMessage, nil))
	defer server.Close()
	priority := 3
	body, err := json.Marshal(communicationsEmailCollaborationRequest{
		CompanyID: emailCollaborationThreadTestCompanyID, AccountEmail: owner.Email, Priority: &priority,
		Message: domain.EmailMessageSnapshot{ID: providerMessage.ID, ThreadID: providerMessage.ThreadID},
	})
	if err != nil {
		t.Fatal(err)
	}
	req := emailCollaborationThreadTestRequestWithActor(
		httptest.NewRequest(http.MethodPost, "/v1/communications/email-collaborations", bytes.NewReader(body)),
		owner,
		domain.RoleCompanyUser,
	)
	req.Header.Set("X-Request-ID", "email-collaboration-storage-test")
	rec := httptest.NewRecorder()

	var logs bytes.Buffer
	previousWriter, previousFlags := log.Writer(), log.Flags()
	log.SetOutput(&logs)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	}()

	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "email_collaboration_storage_not_ready") {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	logged := logs.String()
	for _, required := range []string{
		"email_collaboration_create outcome=error",
		"request_id=email-collaboration-storage-test",
		"company_id=" + emailCollaborationThreadTestCompanyID,
		"actor_user_id=" + owner.UserID,
		"scope=personal",
		"stage=unknown",
		"sqlstate=42P01",
		"error_category=undefined_table",
	} {
		if !strings.Contains(logged, required) {
			t.Fatalf("safe diagnostic log missing %q: %s", required, logged)
		}
	}
	for _, forbidden := range []string{pgErr.Detail, pgErr.Message, owner.Email, providerMessage.ID, providerMessage.Subject} {
		if forbidden != "" && strings.Contains(logged, forbidden) {
			t.Fatalf("diagnostic log leaked %q: %s", forbidden, logged)
		}
	}
}
