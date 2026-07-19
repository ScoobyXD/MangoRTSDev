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
