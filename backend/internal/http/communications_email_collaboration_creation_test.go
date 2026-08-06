package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type emailCollaborationCreationTestClient struct {
	*fakeNylasClient

	mu         sync.Mutex
	message    NylasMessage
	err        error
	grantIDs   []string
	messageIDs []string
}

func newEmailCollaborationCreationTestClient(message NylasMessage, err error) *emailCollaborationCreationTestClient {
	return &emailCollaborationCreationTestClient{
		fakeNylasClient: &fakeNylasClient{},
		message:         message,
		err:             err,
	}
}

func (c *emailCollaborationCreationTestClient) GetMessage(_ context.Context, grantID, messageID string) (NylasMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.grantIDs = append(c.grantIDs, grantID)
	c.messageIDs = append(c.messageIDs, messageID)
	return c.message, c.err
}

func (c *emailCollaborationCreationTestClient) calls() ([]string, []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.grantIDs...), append([]string(nil), c.messageIDs...)
}

func TestEmailCollaborationCreationUsesProviderTruth(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		Scope: "personal", GrantID: "personal-source-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	providerMessage := NylasMessage{
		ID: "provider-message", ThreadID: "provider-thread", Subject: "Provider subject",
		Snippet: "Provider snippet", Body: "Provider body", Date: 42, Unread: true, Starred: true,
		From:    []NylasEmailAddress{{Name: "Trusted Sender", Email: "sender@example.com"}},
		To:      []NylasEmailAddress{{Name: "Owner", Email: owner.Email}},
		Cc:      []NylasEmailAddress{{Email: "trusted-cc@example.com"}},
		Folders: []string{"inbox"}, FolderIDs: []string{"folder-provider"},
	}
	client := newEmailCollaborationCreationTestClient(providerMessage, nil)
	request := communicationsEmailCollaborationRequest{
		CompanyID:    emailCollaborationThreadTestCompanyID,
		AccountEmail: owner.Email,
		Message: domain.EmailMessageSnapshot{
			ID: providerMessage.ID, ThreadID: providerMessage.ThreadID,
			Subject: "FORGED subject", Snippet: "FORGED snippet", Body: "FORGED body", Date: 999,
			From:    []domain.EmailAddressSnapshot{{Email: "attacker@example.com"}},
			To:      []domain.EmailAddressSnapshot{{Email: "victim@example.com"}},
			Folders: []string{"forged"}, FolderIDs: []string{"folder-forged"},
		},
	}

	rec := performEmailCollaborationCreationTestRequest(t, repo, client, owner, domain.RoleCompanyUser, request)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d, want 201 body=%s", rec.Code, rec.Body.String())
	}
	var result store.CommunicationsEmailCollaborationEnsureResult
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	message := result.Collaboration.Message
	if message.Subject != providerMessage.Subject || message.Snippet != providerMessage.Snippet || message.Body != providerMessage.Body || message.Date != providerMessage.Date {
		t.Fatalf("stored message did not use provider truth: %+v", message)
	}
	if len(message.From) != 1 || message.From[0].Email != "sender@example.com" || len(message.To) != 1 || message.To[0].Email != owner.Email {
		t.Fatalf("stored address snapshot did not use provider truth: %+v", message)
	}
	if strings.Join(message.Folders, ",") != "inbox" || strings.Join(message.FolderIDs, ",") != "folder-provider" {
		t.Fatalf("stored folders did not use provider truth: %+v", message)
	}
	grants, messageIDs := client.calls()
	if strings.Join(grants, ",") != "personal-source-grant" || strings.Join(messageIDs, ",") != providerMessage.ID {
		t.Fatalf("provider calls grants=%v message_ids=%v", grants, messageIDs)
	}
}

func TestEmailCollaborationCreationRejectsProviderIdentityMismatchBeforeEnsure(t *testing.T) {
	for _, test := range []struct {
		name             string
		requestedMessage domain.EmailMessageSnapshot
		providerMessage  NylasMessage
	}{
		{
			name:             "message id",
			requestedMessage: domain.EmailMessageSnapshot{ID: "requested-message", ThreadID: "requested-thread"},
			providerMessage:  NylasMessage{ID: "different-message", ThreadID: "requested-thread"},
		},
		{
			name:             "thread membership",
			requestedMessage: domain.EmailMessageSnapshot{ID: "requested-message", ThreadID: "requested-thread"},
			providerMessage:  NylasMessage{ID: "requested-message", ThreadID: "different-thread"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
			if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
				UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
				GrantID: "personal-source-grant", Status: "connected",
			}); err != nil {
				t.Fatal(err)
			}
			client := newEmailCollaborationCreationTestClient(test.providerMessage, nil)
			rec := performEmailCollaborationCreationTestRequest(t, repo, client, owner, domain.RoleCompanyUser, communicationsEmailCollaborationRequest{
				CompanyID: emailCollaborationThreadTestCompanyID, AccountEmail: owner.Email, Message: test.requestedMessage,
			})
			if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "email_provider_message_mismatch") {
				t.Fatalf("status=%d, want 409 mismatch body=%s", rec.Code, rec.Body.String())
			}
			assertNoEmailCollaborationCreated(t, repo, owner.UserID)
		})
	}
}

func TestEmailCollaborationCreationProviderFailureDoesNotCreateNode(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		GrantID: "personal-source-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	client := newEmailCollaborationCreationTestClient(NylasMessage{}, errors.New("provider unavailable"))
	rec := performEmailCollaborationCreationTestRequest(t, repo, client, owner, domain.RoleCompanyUser, communicationsEmailCollaborationRequest{
		CompanyID: emailCollaborationThreadTestCompanyID, AccountEmail: owner.Email,
		Message: domain.EmailMessageSnapshot{ID: "provider-failure-message", ThreadID: "provider-failure-thread"},
	})
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "nylas_request_failed") {
		t.Fatalf("status=%d, want 502 provider failure body=%s", rec.Code, rec.Body.String())
	}
	assertNoEmailCollaborationCreated(t, repo, owner.UserID)
}

func TestEmailCollaborationCreationUsesAuthorizedSharedSource(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	const sharedAccountEmail = "support@example.com"
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, Provider: "microsoft", AccountEmail: sharedAccountEmail,
		GrantID: "shared-source-grant", Status: "connected", ConnectedByUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	sharedInbox, err := repo.CreateCommunicationsSharedInboxFolder(emailCollaborationThreadTestCompanyID, "", "Support", sharedAccountEmail)
	if err != nil {
		t.Fatal(err)
	}
	providerMessage := NylasMessage{ID: "shared-message", ThreadID: "shared-thread", Subject: "Shared provider subject", Body: "Shared provider body"}
	client := newEmailCollaborationCreationTestClient(providerMessage, nil)
	rec := performEmailCollaborationCreationTestRequest(t, repo, client, owner, domain.RoleCompanyAdmin, communicationsEmailCollaborationRequest{
		CompanyID: emailCollaborationThreadTestCompanyID, SharedInboxID: sharedInbox.SharedInboxID,
		AccountEmail: "attacker-controlled@example.com",
		Message:      domain.EmailMessageSnapshot{ID: providerMessage.ID, ThreadID: providerMessage.ThreadID, Subject: "FORGED"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d, want 201 body=%s", rec.Code, rec.Body.String())
	}
	var result store.CommunicationsEmailCollaborationEnsureResult
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Collaboration.SharedInboxID != sharedInbox.SharedInboxID || result.Collaboration.AccountEmail != sharedAccountEmail {
		t.Fatalf("collaboration source = %+v, want authorized shared inbox/account", result.Collaboration)
	}
	if result.Collaboration.Message.Subject != providerMessage.Subject || result.Collaboration.Message.Body != providerMessage.Body {
		t.Fatalf("shared snapshot = %+v, want provider truth", result.Collaboration.Message)
	}
	grants, messageIDs := client.calls()
	if strings.Join(grants, ",") != "shared-source-grant" || strings.Join(messageIDs, ",") != providerMessage.ID {
		t.Fatalf("provider calls grants=%v message_ids=%v", grants, messageIDs)
	}
}

func TestEmailCollaborationCreationAllowsFloatingNodeWithoutPriority(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		GrantID: "personal-source-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	const requestedNodeID = "019fd5d8-0000-7000-8000-000000000001"
	client := newEmailCollaborationCreationTestClient(NylasMessage{
		ID: "floating-message", ThreadID: "floating-thread", Subject: "Floating node",
	}, nil)
	request := communicationsEmailCollaborationRequest{
		CompanyID:    emailCollaborationThreadTestCompanyID,
		AccountEmail: owner.Email,
		NewNodeID:    requestedNodeID,
		Message:      domain.EmailMessageSnapshot{ID: "floating-message", ThreadID: "floating-thread"},
	}

	first := performEmailCollaborationCreationTestRequest(t, repo, client, owner, domain.RoleCompanyUser, request)
	if first.Code != http.StatusCreated {
		t.Fatalf("first status=%d, want 201 body=%s", first.Code, first.Body.String())
	}
	nodes, err := repo.ListNodes(emailCollaborationThreadTestCompanyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].NodeID != requestedNodeID || nodes[0].Priority != nil {
		t.Fatalf("floating nodes=%+v, want one requested node without priority", nodes)
	}

	second := performEmailCollaborationCreationTestRequest(t, repo, client, owner, domain.RoleCompanyUser, request)
	if second.Code != http.StatusOK {
		t.Fatalf("retry status=%d, want 200 body=%s", second.Code, second.Body.String())
	}
	nodes, err = repo.ListNodes(emailCollaborationThreadTestCompanyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 {
		t.Fatalf("retry created duplicate floating nodes: %+v", nodes)
	}
	request.NewNodeID = "019fd5d8-0000-7000-8000-000000000002"
	third := performEmailCollaborationCreationTestRequest(t, repo, client, owner, domain.RoleCompanyUser, request)
	if third.Code != http.StatusCreated {
		t.Fatalf("second target status=%d, want 201 body=%s", third.Code, third.Body.String())
	}

	server := newEmailCollaborationThreadTestServer(repo, client)
	defer server.Close()
	path := "/v1/communications/email-collaborations?company_id=" + emailCollaborationThreadTestCompanyID +
		"&message_id=floating-message&thread_id=floating-thread&account_email=" + owner.Email
	listRequest := emailCollaborationThreadTestRequestWithActor(
		httptest.NewRequest(http.MethodGet, path, nil), owner, domain.RoleCompanyUser,
	)
	listResponse := httptest.NewRecorder()
	server.Routes().ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status=%d, want 200 body=%s", listResponse.Code, listResponse.Body.String())
	}
	var listResult struct {
		Collaborations []domain.CommunicationsEmailCollaboration `json:"collaborations"`
	}
	if err := json.NewDecoder(listResponse.Body).Decode(&listResult); err != nil {
		t.Fatal(err)
	}
	if len(listResult.Collaborations) != 2 {
		t.Fatalf("listed collaborations=%+v, want both associated Node chats", listResult.Collaborations)
	}

}

func TestEmailCollaborationCreationRejectsInvalidPriorityBeforeProviderRead(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	client := newEmailCollaborationCreationTestClient(NylasMessage{ID: "priority-message", ThreadID: "priority-thread"}, nil)
	server := newEmailCollaborationThreadTestServer(repo, client)
	defer server.Close()
	invalidPriority := 6
	payload, err := json.Marshal(communicationsEmailCollaborationRequest{
		CompanyID:    emailCollaborationThreadTestCompanyID,
		AccountEmail: owner.Email,
		Priority:     &invalidPriority,
		Message:      domain.EmailMessageSnapshot{ID: "priority-message", ThreadID: "priority-thread"},
	})
	if err != nil {
		t.Fatal(err)
	}
	req := emailCollaborationThreadTestRequestWithActor(
		httptest.NewRequest(http.MethodPost, "/v1/communications/email-collaborations", bytes.NewReader(payload)), owner, domain.RoleCompanyUser,
	)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_email_node_priority") {
		t.Fatalf("status=%d body=%s, want 400 invalid_email_node_priority", rec.Code, rec.Body.String())
	}
	grants, messageIDs := client.calls()
	if len(grants) != 0 || len(messageIDs) != 0 {
		t.Fatalf("provider calls before valid priority: grants=%v messages=%v", grants, messageIDs)
	}
}

func performEmailCollaborationCreationTestRequest(t *testing.T, repo store.Repository, client NylasClient, actor domain.User, role string, body communicationsEmailCollaborationRequest) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	server := newEmailCollaborationThreadTestServer(repo, client)
	defer server.Close()
	req := emailCollaborationThreadTestRequestWithActor(
		httptest.NewRequest(http.MethodPost, "/v1/communications/email-collaborations", bytes.NewReader(payload)), actor, role,
	)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	return rec
}

func assertNoEmailCollaborationCreated(t *testing.T, repo store.Repository, _ string) {
	t.Helper()
	items, err := repo.ListNodes(emailCollaborationThreadTestCompanyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("collaborations created before provider validation: %+v", items)
	}
}
