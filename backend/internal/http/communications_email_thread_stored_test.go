package httpapi

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmailCollaborationThreadDefaultReadUsesMangoWithoutProviderCall(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		Scope: "personal", GrantID: "must-not-be-used", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	collaboration := ensureEmailCollaborationThreadTestCollaboration(t, repo, store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID,
		PersonalAccountEmail: owner.Email, AccountEmail: owner.Email, CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "stored-root", ThreadID: "stored-thread", Subject: "Stored immediately",
			Body: "<p><strong>Stored rich body</strong></p>",
		},
	})
	client := newEmailCollaborationThreadTestClient()
	client.threadsByID["stored-thread"] = NylasThread{ID: "stored-thread", MessageIDs: []string{"provider-secret"}}
	client.messagesByID["provider-secret"] = NylasMessage{ID: "provider-secret", ThreadID: "stored-thread", Body: "Provider-only body"}

	server := newEmailCollaborationThreadTestServer(repo, client)
	defer server.Close()
	path := "/v1/communications/email-collaborations/" + collaboration.CollaborationID + "/thread?company_id=" + emailCollaborationThreadTestCompanyID
	req := emailCollaborationThreadTestRequestWithActor(httptest.NewRequest(http.MethodGet, path, nil), owner, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var response emailCollaborationThreadTestResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.HistoryComplete || len(response.Messages) != 1 || response.Messages[0].ID != "stored-root" ||
		response.Messages[0].Body != "<p><strong>Stored rich body</strong></p>" {
		t.Fatalf("stored default response = %+v", response)
	}
	threadGrants, threadIDs, messageGrants, messageIDs := client.calls()
	if len(threadGrants)+len(threadIDs)+len(messageGrants)+len(messageIDs) != 0 {
		t.Fatalf("default stored read called provider: %v %v %v %v", threadGrants, threadIDs, messageGrants, messageIDs)
	}
}

func TestNodeEmailThreadRouteReturnsDurableStoredHistory(t *testing.T) {
	repo, owner, _, _ := newEmailCollaborationThreadTestRepo(t)
	collaboration := ensureEmailCollaborationThreadTestCollaboration(t, repo, store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID,
		PersonalAccountEmail: owner.Email, AccountEmail: owner.Email, CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "node-thread-root", ThreadID: "node-thread", Subject: "Stored root", Body: "Stored root body", Date: 1,
		},
	})
	stored, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID,
		PersonalAccountEmail: owner.Email, AccountEmail: owner.Email,
		ProviderThreadID: "node-thread", SelectedMessageID: "node-thread-root", HistoryComplete: true,
		Messages: []domain.EmailMessageSnapshot{
			{ID: "node-thread-root", ThreadID: "node-thread", Subject: "Stored root", Body: "Stored root body", Date: 1},
			{ID: "node-thread-reply", ThreadID: "node-thread", Subject: "Stored reply", Body: "Stored reply body", Date: 2},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if stored.EmailThreadID != collaboration.EmailThreadID {
		t.Fatalf("stored email thread id=%q, want collaboration thread %q", stored.EmailThreadID, collaboration.EmailThreadID)
	}

	client := newEmailCollaborationThreadTestClient()
	server := newEmailCollaborationThreadTestServer(repo, client)
	defer server.Close()
	path := "/v1/nodes/" + collaboration.NodeID + "/email-threads/" + collaboration.EmailThreadID + "?company_id=" + emailCollaborationThreadTestCompanyID
	req := emailCollaborationThreadTestRequestWithActor(httptest.NewRequest(http.MethodGet, path, nil), owner, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var response struct {
		NodeID            string         `json:"node_id"`
		InformationID     string         `json:"information_id"`
		EmailThreadID     string         `json:"email_thread_id"`
		SelectedMessageID string         `json:"selected_message_id"`
		ThreadID          string         `json:"thread_id"`
		Messages          []NylasMessage `json:"messages"`
		HistoryComplete   bool           `json:"history_complete"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.NodeID != collaboration.NodeID || response.InformationID != collaboration.AttachedEmailInformationID ||
		response.EmailThreadID != collaboration.EmailThreadID || response.SelectedMessageID != "node-thread-root" ||
		response.ThreadID != "node-thread" || !response.HistoryComplete {
		t.Fatalf("node email thread response = %+v", response)
	}
	if got := emailCollaborationThreadTestMessageIDs(response.Messages); got != "node-thread-root,node-thread-reply" {
		t.Fatalf("message ids=%q, want node-thread-root,node-thread-reply", got)
	}
	if response.Messages[0].Body != "Stored root body" || response.Messages[1].Body != "Stored reply body" {
		t.Fatalf("stored node thread bodies = %+v", response.Messages)
	}
	threadGrants, threadIDs, messageGrants, messageIDs := client.calls()
	if len(threadGrants)+len(threadIDs)+len(messageGrants)+len(messageIDs) != 0 {
		t.Fatalf("node stored read called provider: %v %v %v %v", threadGrants, threadIDs, messageGrants, messageIDs)
	}
}
