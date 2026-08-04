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

func TestEmailRelationshipChatUsesOrdinaryNodePermissions(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000301"
	repo.EnsureCompany(companyID, "Email relationship chat HTTP company")
	creator := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "atomic-http-creator", "atomic-http-creator@example.com", domain.RoleCompanyUser)
	target := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "atomic-http-target", "atomic-http-target@example.com", domain.RoleCompanyUser)
	outsider := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "atomic-http-outsider", "atomic-http-outsider@example.com", domain.RoleCompanyUser)
	created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{ID: "atomic-http-message", ThreadID: "atomic-http-thread", Subject: "Atomic HTTP chat"},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	relationship := created.Collaboration
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: store.EntityTypeNode, EntityID: relationship.NodeID,
		DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: creator.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: target.UserID, AccessLevel: store.EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{}).Routes()
	chatID := store.NewUUIDv7String()
	information, _ := json.Marshal(map[string]any{
		"block_id": relationship.AttachedEmailInformationID, "content": "Please review",
		"email_message_id": relationship.RootMessageID,
	})
	body, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": store.CommunicationsEmailCollaborationChatInformationType,
		"information": string(information), "information_id": chatID,
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+relationship.NodeID+"/information", bytes.NewReader(body))
	req = attachmentRequestWithActor(req, creator, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("ordinary Node chat status = %d body=%s, want 201", rec.Code, rec.Body.String())
	}
	if projections, err := repo.ListNodeProjections(companyID, relationship.NodeID); err != nil || !httpTestHasProjection(projections, chatID) {
		t.Fatalf("ordinary Node chat projection missing: %+v err=%v", projections, err)
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, relationship.CollaborationID, target.UserID); err != nil {
		t.Fatalf("user with ordinary Node permission cannot read relationship: %v", err)
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, relationship.CollaborationID, outsider.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("user without ordinary Node permission error = %v, want ErrNotFound", err)
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
