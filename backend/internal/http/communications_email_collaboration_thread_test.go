package httpapi

import (
	"context"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const emailCollaborationThreadTestCompanyID = "11111111-1111-1111-1111-111111111111"

type emailCollaborationThreadTestClient struct {
	*fakeNylasClient
	mu                  sync.Mutex
	threadsByID         map[string]NylasThread
	messagesByID        map[string]NylasMessage
	threadErrorsByID    map[string]error
	messageErrorsByID   map[string]error
	threadGrantIDs      []string
	threadIDs           []string
	messageGrantIDs     []string
	requestedMessageIDs []string
}

func newEmailCollaborationThreadTestClient() *emailCollaborationThreadTestClient {
	return &emailCollaborationThreadTestClient{
		fakeNylasClient:   &fakeNylasClient{},
		threadsByID:       map[string]NylasThread{},
		messagesByID:      map[string]NylasMessage{},
		threadErrorsByID:  map[string]error{},
		messageErrorsByID: map[string]error{},
	}
}

func (c *emailCollaborationThreadTestClient) GetThread(_ context.Context, grantID, threadID string) (NylasThread, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.threadGrantIDs = append(c.threadGrantIDs, grantID)
	c.threadIDs = append(c.threadIDs, threadID)
	if err := c.threadErrorsByID[threadID]; err != nil {
		return NylasThread{}, err
	}
	thread, ok := c.threadsByID[threadID]
	if !ok {
		return NylasThread{}, NylasAPIError{StatusCode: http.StatusNotFound, Code: "not_found"}
	}
	return thread, nil
}

func (c *emailCollaborationThreadTestClient) GetMessage(_ context.Context, grantID, messageID string) (NylasMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.messageGrantIDs = append(c.messageGrantIDs, grantID)
	c.requestedMessageIDs = append(c.requestedMessageIDs, messageID)
	if err := c.messageErrorsByID[messageID]; err != nil {
		return NylasMessage{}, err
	}
	message, ok := c.messagesByID[messageID]
	if !ok {
		return NylasMessage{}, NylasAPIError{StatusCode: http.StatusNotFound, Code: "not_found"}
	}
	return message, nil
}

func (c *emailCollaborationThreadTestClient) calls() ([]string, []string, []string, []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.threadGrantIDs...),
		append([]string(nil), c.threadIDs...),
		append([]string(nil), c.messageGrantIDs...),
		append([]string(nil), c.requestedMessageIDs...)
}

type emailCollaborationThreadTestResponse struct {
	CollaborationID string         `json:"collaboration_id"`
	ThreadID        string         `json:"thread_id"`
	Messages        []NylasMessage `json:"messages"`
	HistoryComplete bool           `json:"history_complete"`
}

func TestEmailCollaborationThreadPersonalOwnerReadsCompleteProviderHistory(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: "owner@example.com",
		Scope: "personal", GrantID: "personal-source-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	collaboration := ensureEmailCollaborationThreadTestCollaboration(t, repo, store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID,
		PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "personal-root", ThreadID: "personal-thread", Subject: "Durable subject"},
	})
	client := newEmailCollaborationThreadTestClient()
	client.threadsByID["personal-thread"] = NylasThread{
		ID: "personal-thread", MessageIDs: []string{"personal-old", "personal-new", "personal-old", ""},
	}
	client.messagesByID["personal-old"] = NylasMessage{
		ID: "personal-old", ThreadID: "personal-thread", Subject: "Personal", Body: "Older complete body", Date: 1,
	}
	client.messagesByID["personal-new"] = NylasMessage{
		ID: "personal-new", ThreadID: "personal-thread", Subject: "Personal", Body: "Newer complete body", Date: 2,
	}

	response := performEmailCollaborationThreadTestRequest(t, repo, client, collaboration.CollaborationID, owner, domain.RoleCompanyUser, "")
	if response.HistoryComplete {
		t.Fatalf("history_complete=true before durable worker completion: %+v", response)
	}
	if got := emailCollaborationThreadTestMessageIDs(response.Messages); got != "personal-root" {
		t.Fatalf("stored messages=%q, want immediate selected message only", got)
	}
	threadGrants, threadIDs, messageGrants, requestedMessageIDs := client.calls()
	if len(threadGrants)+len(threadIDs)+len(messageGrants)+len(requestedMessageIDs) != 0 {
		t.Fatalf("collaboration read called Nylas: %v %v %v %v", threadGrants, threadIDs, messageGrants, requestedMessageIDs)
	}
}

func TestEmailCollaborationThreadSharedParticipantReadsWithoutSharedInboxAccess(t *testing.T) {
	repo, owner, participant, _ := newEmailCollaborationThreadTestRepo(t)
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, Provider: "microsoft",
		AccountEmail: "support@example.com", GrantID: "shared-source-grant", Status: "connected",
		ConnectedByUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	collaboration := ensureEmailCollaborationThreadTestCollaboration(t, repo, store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, SharedInboxID: "22222222-2222-2222-2222-222222222222",
		AccountEmail: "support@example.com", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "shared-root", ThreadID: "shared-thread", Subject: "Shared durable"},
	})
	if _, err := repo.AddCommunicationsEmailCollaborationParticipants(store.CommunicationsEmailCollaborationParticipantInput{
		CompanyID: emailCollaborationThreadTestCompanyID, CollaborationID: collaboration.CollaborationID,
		ActorUserID: owner.UserID, MentionedUserIDs: []string{participant.UserID},
	}); err != nil {
		t.Fatal(err)
	}
	client := newEmailCollaborationThreadTestClient()
	client.threadsByID["shared-thread"] = NylasThread{ID: "shared-thread", MessageIDs: []string{"shared-root", "shared-reply"}}
	client.messagesByID["shared-root"] = NylasMessage{ID: "shared-root", ThreadID: "shared-thread", Body: "Shared root body", Date: 1}
	client.messagesByID["shared-reply"] = NylasMessage{ID: "shared-reply", ThreadID: "shared-thread", Body: "Shared reply body", Date: 2}

	// The participant is only a company user and has no shared-inbox folder
	// grant. Permanent collaboration participation is the authorization here.
	response := performEmailCollaborationThreadTestRequest(t, repo, client, collaboration.CollaborationID, participant, domain.RoleCompanyUser, "")
	if response.HistoryComplete || emailCollaborationThreadTestMessageIDs(response.Messages) != "shared-root" {
		t.Fatalf("shared participant response = %+v", response)
	}
	threadGrants, threadIDs, messageGrants, messageIDs := client.calls()
	if len(threadGrants)+len(threadIDs)+len(messageGrants)+len(messageIDs) != 0 {
		t.Fatalf("participant read called source mailbox: %v %v %v %v", threadGrants, threadIDs, messageGrants, messageIDs)
	}
}

func TestEmailCollaborationThreadDeniesCompanyNonparticipantBeforeProviderRead(t *testing.T) {
	repo, owner, _, outsider := newEmailCollaborationThreadTestRepo(t)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		Scope: "personal", GrantID: "owner-source-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	collaboration := ensureEmailCollaborationThreadTestCollaboration(t, repo, store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID,
		PersonalAccountEmail: owner.Email, AccountEmail: owner.Email, CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "private-root", ThreadID: "private-thread", Subject: "Private"},
	})
	client := newEmailCollaborationThreadTestClient()
	server := newEmailCollaborationThreadTestServer(repo, client)
	defer server.Close()
	req := httptest.NewRequest(http.MethodGet,
		"/v1/communications/email-collaborations/"+collaboration.CollaborationID+"/thread?company_id="+emailCollaborationThreadTestCompanyID, nil)
	req = emailCollaborationThreadTestRequestWithActor(req, outsider, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d, want 404 body=%s", rec.Code, rec.Body.String())
	}
	threadGrants, threadIDs, messageGrants, messageIDs := client.calls()
	if len(threadGrants)+len(threadIDs)+len(messageGrants)+len(messageIDs) != 0 {
		t.Fatalf("provider called before participant authorization: %v %v %v %v", threadGrants, threadIDs, messageGrants, messageIDs)
	}
}

func TestEmailCollaborationThreadCannotBeRedirectedOrDownloadedAcrossThreads(t *testing.T) {
	t.Run("query cannot redirect immutable thread", func(t *testing.T) {
		repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
		if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
			UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
			Scope: "personal", GrantID: "cross-thread-source-grant", Status: "connected",
		}); err != nil {
			t.Fatal(err)
		}
		collaboration := ensureEmailCollaborationThreadTestCollaboration(t, repo, store.CommunicationsEmailCollaborationEnsureInput{
			CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID,
			PersonalAccountEmail: owner.Email, AccountEmail: owner.Email, CreatedByUserID: owner.UserID,
			Message: domain.EmailMessageSnapshot{ID: "thread-a-root", ThreadID: "thread-a", Subject: "Thread A"},
		})
		client := newEmailCollaborationThreadTestClient()
		client.threadsByID["thread-a"] = NylasThread{ID: "thread-a", MessageIDs: []string{"thread-a-root"}}
		client.threadsByID["thread-b"] = NylasThread{ID: "thread-b", MessageIDs: []string{"thread-b-secret"}}
		client.messagesByID["thread-a-root"] = NylasMessage{ID: "thread-a-root", ThreadID: "thread-a", Body: "Allowed"}
		client.messagesByID["thread-b-secret"] = NylasMessage{ID: "thread-b-secret", ThreadID: "thread-b", Body: "Secret"}

		response := performEmailCollaborationThreadTestRequest(t, repo, client, collaboration.CollaborationID, owner, domain.RoleCompanyUser,
			"&thread_id=thread-b&message_id=thread-b-secret")
		if response.HistoryComplete || emailCollaborationThreadTestMessageIDs(response.Messages) != "thread-a-root" {
			t.Fatalf("redirected response = %+v", response)
		}
		threadGrants, threadIDs, messageGrants, messageIDs := client.calls()
		if len(threadGrants)+len(threadIDs)+len(messageGrants)+len(messageIDs) != 0 {
			t.Fatalf("stored read called provider: %v %v %v %v", threadGrants, threadIDs, messageGrants, messageIDs)
		}
	})

	t.Run("provider mismatch falls back without cross-thread body", func(t *testing.T) {
		repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
		if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
			UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
			Scope: "personal", GrantID: "mismatch-source-grant", Status: "connected",
		}); err != nil {
			t.Fatal(err)
		}
		collaboration := ensureEmailCollaborationThreadTestCollaboration(t, repo, store.CommunicationsEmailCollaborationEnsureInput{
			CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID,
			PersonalAccountEmail: owner.Email, AccountEmail: owner.Email, CreatedByUserID: owner.UserID,
			Message: domain.EmailMessageSnapshot{ID: "safe-root", ThreadID: "safe-thread", Subject: "Durable safe", Body: "Durable safe body"},
		})
		client := newEmailCollaborationThreadTestClient()
		client.threadsByID["safe-thread"] = NylasThread{ID: "safe-thread", MessageIDs: []string{"cross-thread-secret"}}
		client.messagesByID["cross-thread-secret"] = NylasMessage{
			ID: "cross-thread-secret", ThreadID: "different-thread", Body: "Must never be exposed",
		}

		response := performEmailCollaborationThreadTestRequest(t, repo, client, collaboration.CollaborationID, owner, domain.RoleCompanyUser, "")
		if response.HistoryComplete {
			t.Fatalf("history_complete=true for mismatched provider thread: %+v", response)
		}
		if emailCollaborationThreadTestMessageIDs(response.Messages) != "safe-root" || response.Messages[0].Body != "Durable safe body" {
			t.Fatalf("cross-thread provider body escaped fallback: %+v", response.Messages)
		}
		threadGrants, threadIDs, messageGrants, messageIDs := client.calls()
		if len(threadGrants)+len(threadIDs)+len(messageGrants)+len(messageIDs) != 0 {
			t.Fatalf("stored read called provider: %v %v %v %v", threadGrants, threadIDs, messageGrants, messageIDs)
		}
	})
}

func TestEmailCollaborationThreadFallsBackWhenImmutableSourceUnavailable(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	collaboration := ensureEmailCollaborationThreadTestCollaboration(t, repo, store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID,
		PersonalAccountEmail: owner.Email, AccountEmail: owner.Email, CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "offline-root", ThreadID: "offline-thread", Subject: "Offline", Body: "Durable offline body"},
	})
	client := newEmailCollaborationThreadTestClient()
	response := performEmailCollaborationThreadTestRequest(t, repo, client, collaboration.CollaborationID, owner, domain.RoleCompanyUser, "")
	if response.HistoryComplete || emailCollaborationThreadTestMessageIDs(response.Messages) != "offline-root" ||
		response.Messages[0].Body != "Durable offline body" {
		t.Fatalf("offline fallback = %+v", response)
	}
	threadGrants, _, _, _ := client.calls()
	if len(threadGrants) != 0 {
		t.Fatalf("provider called without immutable source: %v", threadGrants)
	}
}

func newEmailCollaborationThreadTestRepo(t *testing.T) (*store.MemoryRepo, domain.User, domain.User, domain.User) {
	t.Helper()
	repo := store.NewMemoryRepo()
	repo.EnsureCompany(emailCollaborationThreadTestCompanyID, "Email collaboration thread tests")
	createUser := func(subject, email, displayName string) domain.User {
		t.Helper()
		user, err := repo.UpsertAuthUser(subject, email, displayName)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AddCompanyMembership(subject, emailCollaborationThreadTestCompanyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
		return user
	}
	return repo,
		createUser("collaboration-thread-owner", "owner@example.com", "Owner"),
		createUser("collaboration-thread-participant", "participant@example.com", "Participant"),
		createUser("collaboration-thread-outsider", "outsider@example.com", "Outsider")
}

func ensureEmailCollaborationThreadTestCollaboration(t *testing.T, repo *store.MemoryRepo, input store.CommunicationsEmailCollaborationEnsureInput) domain.CommunicationsEmailCollaboration {
	t.Helper()
	result, err := repo.EnsureCommunicationsEmailCollaboration(input)
	if err != nil {
		t.Fatal(err)
	}
	return result.Collaboration
}

func newEmailCollaborationThreadTestServer(repo store.Repository, client NylasClient) *Server {
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableCommunicationsArchiveWorker: true,
		DisableCommunicationsEmailThreadDownloadWorker: true,
	})
	server.nylasGate = newNylasRequestGate(0)
	return server
}

func performEmailCollaborationThreadTestRequest(t *testing.T, repo store.Repository, client NylasClient, collaborationID string, actor domain.User, role, extraQuery string) emailCollaborationThreadTestResponse {
	t.Helper()
	server := newEmailCollaborationThreadTestServer(repo, client)
	defer server.Close()
	path := "/v1/communications/email-collaborations/" + collaborationID + "/thread?company_id=" + emailCollaborationThreadTestCompanyID + "&refresh=true" + extraQuery
	req := emailCollaborationThreadTestRequestWithActor(httptest.NewRequest(http.MethodGet, path, nil), actor, role)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var response emailCollaborationThreadTestResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	return response
}

func emailCollaborationThreadTestRequestWithActor(req *http.Request, user domain.User, role string) *http.Request {
	actor := ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: emailCollaborationThreadTestCompanyID, UserID: user.UserID, Role: role,
		}},
		CompanyID: emailCollaborationThreadTestCompanyID, CompanyRole: role,
	}
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
}

func emailCollaborationThreadTestMessageIDs(messages []NylasMessage) string {
	ids := make([]string, 0, len(messages))
	for _, message := range messages {
		ids = append(ids, message.ID)
	}
	return strings.Join(ids, ",")
}
