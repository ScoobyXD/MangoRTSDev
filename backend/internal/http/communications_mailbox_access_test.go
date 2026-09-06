package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/emailqueue"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// Existing mailbox fixtures model accounts that predate public signup. New
// account tests deliberately use the underlying repository without this wrapper.
type legacyMailboxTestRepository struct{ store.Repository }

func (r legacyMailboxTestRepository) GetAuthUserByIDContext(ctx context.Context, userID string) (domain.User, error) {
	user, err := r.Repository.GetAuthUserByIDContext(ctx, userID)
	user.MailboxEnabled = true
	return user, err
}

func (r legacyMailboxTestRepository) ResolveAuthUserContext(ctx context.Context, subject, email, name string, issuedAt time.Time) (domain.User, error) {
	user, err := r.Repository.ResolveAuthUserContext(ctx, subject, email, name, issuedAt)
	user.MailboxEnabled = true
	return user, err
}

func newLegacyMailboxTestServer(repo store.Repository, options ServerOptions) *Server {
	return NewServerWithOptions(legacyMailboxTestRepository{Repository: repo}, options)
}

func TestNewAccountCannotUseMailboxAPIAfterJoiningCompany(t *testing.T) {
	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("new-mailbox-free-user", "new@example.com", "New user")
	if err != nil {
		t.Fatal(err)
	}
	company := "11111111-1111-1111-1111-111111111111"
	repo.EnsureCompany(company, "Existing company")
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	key := mustRSAKey(t)
	server := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: &fakeNylasClient{}})
	defer server.Close()
	for _, path := range []string{
		"/v1/communications/status", "/v1/communications/auth-url?provider=google", "/v1/communications/messages?company_id=" + company,
		"/v1/communications/shared-inboxes?company_id=" + company, "/v1/communications/stored-messages?company_id=" + company,
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", user.CognitoSubject, user.Email))
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "mailbox_disabled") {
			t.Fatalf("%s: status=%d body=%s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestNewAccountOAuthCallbackNeverExchangesGrant(t *testing.T) {
	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("new-oauth-user", "new@example.com", "New user")
	if err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{UserID: user.UserID, Email: user.Email, UserEmail: user.Email, Provider: "google", StrictEmail: true}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	client := &fakeNylasClient{grant: NylasGrant{GrantID: "forbidden-grant", Email: user.Email, Provider: "google"}}
	server := NewServerWithOptions(repo, ServerOptions{NylasConfig: config, NylasClient: client})
	defer server.Close()
	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=forbidden&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusFound || !strings.Contains(rec.Header().Get("Location"), "nylas_error=mailbox_disabled") || client.exchangeCalls != 0 {
		t.Fatalf("callback status=%d redirect=%s exchanges=%d", rec.Code, rec.Header().Get("Location"), client.exchangeCalls)
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("connection unexpectedly stored: %v", err)
	}
}

func TestNewAccountPersonalMailboxJobsNeverReadProvider(t *testing.T) {
	repo, job, client := newEmailOutboxBoundaryFixture(t)
	queue := &recordingEmailQueueSender{}
	server := NewServerWithOptions(repo, ServerOptions{NylasConfig: testNylasConfig(), NylasClient: client, EmailQueue: queue})
	defer server.Close()
	ctx := context.Background()
	if err := server.enqueueCommunicationsEmailIngestionJob(ctx, job); !errors.Is(err, errMailboxDisabled) {
		t.Fatalf("enqueue error=%v", err)
	}
	if err := server.processCommunicationsEmailIngestionProviderWork(ctx, job); !errors.Is(err, errMailboxDisabled) {
		t.Fatalf("provider work error=%v", err)
	}
	message := emailqueue.Message{JobID: job.IngestionJobID, CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID}
	if ack, err := server.processEmailIngestionDelivery(ctx, message); !ack || err != nil {
		t.Fatalf("disabled queued job ack=%t err=%v", ack, err)
	}
	if ack, err := server.processEmailReconciliationConnection(ctx, message); !ack || err != nil {
		t.Fatalf("disabled reconciliation ack=%t err=%v", ack, err)
	}
	connection, err := repo.GetEmailConnectionByIDContext(ctx, job.CompanyID, job.EmailConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := server.loadCommunicationsWebhookGrantContext(ctx, connection.GrantID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("webhook grant was admitted: %v", err)
	}
	threadGrants, threadIDs, messageGrants, messageIDs := client.calls()
	if len(threadGrants)+len(threadIDs)+len(messageGrants)+len(messageIDs) != 0 || client.folderCalls != 0 || client.messageCalls != 0 {
		t.Fatal("disabled personal mailbox called provider")
	}
	if err := server.checkPersonalMailboxConnection(ctx, domain.UserEmailConnection{Scope: "shared", UserID: "not-a-user"}); err != nil {
		t.Fatalf("company-owned mailbox was blocked by creator identity: %v", err)
	}
}

func TestNewAccountCannotReadStoredResourceEmailOrEmailAttachments(t *testing.T) {
	server := &Server{}
	actor := ActorContext{User: domain.User{UserID: "new-user", MailboxEnabled: false}}
	for _, handler := range []func(http.ResponseWriter, *http.Request){
		func(w http.ResponseWriter, r *http.Request) { server.handleNodeEmailThread(w, r, "node", "thread") },
		func(w http.ResponseWriter, r *http.Request) {
			server.handleProjectEmailThread(w, r, "project", "thread")
		},
		func(w http.ResponseWriter, r *http.Request) {
			server.requireFinalEmailAttachmentResourceAccess(w, r, "company", "email_message", "message", false)
		},
	} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req = req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
		rec := httptest.NewRecorder()
		handler(rec, req)
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "mailbox_disabled") {
			t.Fatalf("email access status=%d body=%s", rec.Code, rec.Body.String())
		}
	}
}

func TestMailboxFreeResourceReadKeepsWorkAndRemovesImportedEmail(t *testing.T) {
	items := []domain.NodeProjection{
		{Type: "Attached email", Information: `{"subject":"Private inbox content"}`},
		{Type: "Chat comment", Information: `{"selection_source":"email","selection_quote":"Private email quote"}`},
		{Type: "Text box", Information: `<!-- mango-node-text-block-v1 -->{"title":"Work","document":"Keep work","attachments":[{"name":"work.pdf"}],"email_message_ids":["mail"]}`},
		{Type: "Chat comment", Information: `{"message":"Keep normal chat"}`},
	}
	filtered := withoutNodeMailboxProjections(items)
	if len(filtered) != 2 || !strings.Contains(filtered[0].Information, "Keep work") || !strings.Contains(filtered[0].Information, "work.pdf") || strings.Contains(filtered[0].Information, "email_message_ids") || !strings.Contains(filtered[1].Information, "Keep normal chat") {
		t.Fatalf("filtered work=%+v", filtered)
	}
	if !strings.Contains(items[2].Information, "email_message_ids") {
		t.Fatal("read filtering modified stored/source information")
	}
}

func TestNewAccountNodeHistoryKeepsLightweightTotalsAndFiltersFullRows(t *testing.T) {
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-111111111111"
	repo.EnsureCompany(companyID, "Work")
	user, err := repo.UpsertAuthUser("mailbox-free-history", "new@example.com", "New user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Work with imported history")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "Keep work", "22222222-2222-4222-8222-222222222222"); err != nil {
		t.Fatal(err)
	}
	thread, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: user.UserID, PersonalAccountEmail: user.Email,
		AccountEmail: user.Email, Provider: "google", ProviderThreadID: "thread", SelectedMessageID: "message",
		Messages: []domain.EmailMessageSnapshot{{ID: "message", ThreadID: "thread", Subject: "Private inbox content"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]string{"email_message_id": thread.Messages[0].EmailMessageID, "link_scope": "message"})
	if _, err := repo.AddNodeInformationWithActor(store.NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, Type: "Attached email", Information: string(payload),
		InformationID: "33333333-3333-4333-8333-333333333333", ActorUserID: user.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	server := NewServer(repo)
	defer server.Close()
	for _, test := range []struct {
		path        string
		count, rows int
	}{
		{"/v1/nodes/" + node.NodeID + "?company_id=" + companyID, 2, 0},
		{"/v1/nodes/" + node.NodeID + "?company_id=" + companyID + "&include_information=1", 1, 1},
		{"/v2/nodes/" + node.NodeID + "/view?company_id=" + companyID, 2, 0},
	} {
		req := requestWithActorForTest(httptest.NewRequest(http.MethodGet, test.path, nil), user, companyID)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		var details domain.NodeDetails
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &details) != nil {
			t.Fatalf("GET %s status=%d body=%s", test.path, rec.Code, rec.Body.String())
		}
		if details.InformationCount != test.count || len(details.Information) != test.rows || strings.Contains(rec.Body.String(), "Private inbox content") {
			t.Fatalf("GET %s returned count=%d rows=%d body=%s", test.path, details.InformationCount, len(details.Information), rec.Body.String())
		}
	}
}

func TestNewAccountMailboxRealtimeSubscriptionDenied(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-111111111111"
	const userID = "22222222-2222-4222-8222-222222222222"
	actor := ActorContext{
		User:        domain.User{UserID: userID},
		Memberships: []domain.CompanyMembership{{CompanyID: companyID, UserID: userID, Role: domain.RoleCompanyAdmin}},
	}
	server := &Server{}
	for _, scope := range []string{
		realtimePersonalMailboxScope(userID, "new@example.com"),
		realtimeSharedMailboxScope("33333333-3333-4333-8333-333333333333"),
	} {
		allowed, code, err := server.authorizeRealtimeSubscription(context.Background(), actor, companyID, scope)
		if allowed || code != "mailbox_disabled" || err != nil {
			t.Fatalf("mailbox subscription allowed=%t code=%s err=%v", allowed, code, err)
		}
	}
	allowed, code, err := server.authorizeRealtimeSubscription(context.Background(), actor, companyID, realtimeNotificationScope(userID))
	if !allowed || code != "" || err != nil {
		t.Fatalf("ordinary notification subscription blocked: %t %s %v", allowed, code, err)
	}
}
