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
	CollaborationID string                        `json:"collaboration_id"`
	ThreadID        string                        `json:"thread_id"`
	Messages        []domain.EmailMessageSnapshot `json:"messages"`
	HistoryComplete bool                          `json:"history_complete"`
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
	result, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	return result.Collaboration
}

func newEmailCollaborationThreadTestServer(repo store.Repository, client NylasClient) *Server {
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: client, NylasConfig: testNylasConfig(),
		EmailQueue:                     &recordingEmailQueueSender{},
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
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

func emailCollaborationThreadTestMessageIDs(messages []domain.EmailMessageSnapshot) string {
	ids := make([]string, 0, len(messages))
	for _, message := range messages {
		ids = append(ids, message.ID)
	}
	return strings.Join(ids, ",")
}
