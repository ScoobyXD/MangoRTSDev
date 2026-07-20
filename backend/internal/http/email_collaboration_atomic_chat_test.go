package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmailCollaborationInformationMentionCommitsAtomically(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000301"
	repo.EnsureCompany(companyID, "Atomic email chat HTTP company")
	creator := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "atomic-http-creator", "atomic-http-creator@example.com", domain.RoleCompanyUser)
	target := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "atomic-http-target", "atomic-http-target@example.com", domain.RoleCompanyUser)
	created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{ID: "atomic-http-message", ThreadID: "atomic-http-thread", Subject: "Atomic HTTP chat"},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	collaboration := created.Collaboration
	handler := NewServerWithOptions(repo, ServerOptions{}).Routes()

	invalidChatID := store.NewUUIDv7String()
	invalidInformation, _ := json.Marshal(map[string]any{
		"block_id": invalidChatID, "content": "invalid group",
		"mentioned_group_ids": []string{"11111111-1111-4111-8111-701300000399"},
	})
	invalidBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": store.CommunicationsEmailCollaborationChatInformationType,
		"information": string(invalidInformation), "information_id": invalidChatID,
	})
	invalidReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/information", bytes.NewReader(invalidBody))
	invalidReq = attachmentRequestWithActor(invalidReq, creator, companyID, domain.RoleCompanyUser)
	invalidRec := httptest.NewRecorder()
	handler.ServeHTTP(invalidRec, invalidReq)
	if invalidRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid mention status = %d body=%s, want 400", invalidRec.Code, invalidRec.Body.String())
	}
	details, err := repo.GetNodeDetails(companyID, collaboration.NodeID)
	if err != nil || details.InformationCount != 1 {
		t.Fatalf("invalid mention committed history: %+v err=%v", details, err)
	}
	projections, err := repo.ListNodeProjections(companyID, collaboration.NodeID)
	if err != nil || httpTestHasProjection(projections, invalidChatID) {
		t.Fatalf("invalid mention committed projection: %+v err=%v", projections, err)
	}

	chatID := store.NewUUIDv7String()
	validInformation := emailCollaborationMentionInformation(t, target.UserID)
	validBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": store.CommunicationsEmailCollaborationChatInformationType,
		"information": validInformation, "information_id": chatID,
	})
	validReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/information", bytes.NewReader(validBody))
	validReq = attachmentRequestWithActor(validReq, creator, companyID, domain.RoleCompanyUser)
	validRec := httptest.NewRecorder()
	handler.ServeHTTP(validRec, validReq)
	if validRec.Code != http.StatusCreated {
		t.Fatalf("valid mention status = %d body=%s, want 201", validRec.Code, validRec.Body.String())
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, collaboration.CollaborationID, target.UserID); err != nil {
		t.Fatalf("valid mention did not snapshot participant: %v", err)
	}
	details, err = repo.GetNodeDetails(companyID, collaboration.NodeID)
	if err != nil || details.InformationCount != 2 {
		t.Fatalf("valid mention history = %+v err=%v", details, err)
	}
	projections, err = repo.ListNodeProjections(companyID, collaboration.NodeID)
	if err != nil || !httpTestHasProjection(projections, chatID) {
		t.Fatalf("valid mention projection missing: %+v err=%v", projections, err)
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, collaboration.CollaborationID, "11111111-1111-4111-8111-701300000398"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unmentioned principal error = %v, want ErrNotFound", err)
	}
}

func httpTestHasProjection(items []domain.NodeProjection, informationID string) bool {
	for _, item := range items {
		if item.InformationID == informationID {
			return true
		}
	}
	return false
}
