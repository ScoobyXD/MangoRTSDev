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

func TestEmailRelationshipHTTPUsesOrdinaryNodeSemanticsAndDeletesOnlyRelationship(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000101"
	repo.EnsureCompany(companyID, "Email relationship HTTP company")
	creator := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "email-node-http-creator", "creator@example.com", domain.RoleCompanyUser)
	target := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "email-node-http-target", "target@example.com", domain.RoleCompanyUser)
	admin := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "email-node-http-admin", "admin@example.com", domain.RoleCompanyAdmin)
	created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "email-node-http-message", ThreadID: "email-node-http-thread", Subject: "Email node thread",
			From: []domain.EmailAddressSnapshot{{Name: "Sender", Email: "sender@example.com"}},
			To:   []domain.EmailAddressSnapshot{{Email: creator.Email}},
		},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	relationship := created.Collaboration
	handler := NewServerWithOptions(repo, ServerOptions{}).Routes()

	grantBody, _ := json.Marshal(map[string]any{"company_id": companyID, "mentioned_user_ids": []string{target.UserID}})
	grantReq := httptest.NewRequest(http.MethodPost, "/v1/communications/email-collaborations/"+relationship.CollaborationID+"/participants", bytes.NewReader(grantBody))
	grantReq = attachmentRequestWithActor(grantReq, creator, companyID, domain.RoleCompanyUser)
	grantRec := httptest.NewRecorder()
	handler.ServeHTTP(grantRec, grantReq)
	if grantRec.Code != http.StatusNotFound {
		t.Fatalf("obsolete participant endpoint status = %d body=%s, want 404", grantRec.Code, grantRec.Body.String())
	}

	permissionBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "default_access": store.ResourceDefaultAccessNoAccess,
		"permission_mode": store.PolicyModeCustomized,
		"permissions": []map[string]any{
			{"subject_type": store.EntityPermissionSubjectUser, "subject_id": creator.UserID, "access_level": store.EntityPermissionEdit},
			{"subject_type": store.EntityPermissionSubjectUser, "subject_id": target.UserID, "access_level": store.EntityPermissionEdit},
		},
	})
	permissionReq := httptest.NewRequest(http.MethodPut, "/v1/resources/node/"+relationship.NodeID+"/permissions", bytes.NewReader(permissionBody))
	permissionReq = attachmentRequestWithActor(permissionReq, admin, companyID, domain.RoleCompanyAdmin)
	permissionRec := httptest.NewRecorder()
	handler.ServeHTTP(permissionRec, permissionReq)
	if permissionRec.Code != http.StatusOK {
		t.Fatalf("ordinary Node permission replace status = %d body=%s, want 200", permissionRec.Code, permissionRec.Body.String())
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, relationship.CollaborationID, target.UserID); err != nil {
		t.Fatalf("ordinary Node editor cannot read relationship: %v", err)
	}

	textID := store.NewUUIDv7String()
	textBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": "Text box", "information": `{"title":"Notes","document":"work"}`, "information_id": textID,
	})
	textReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+relationship.NodeID+"/information", bytes.NewReader(textBody))
	textReq = attachmentRequestWithActor(textReq, creator, companyID, domain.RoleCompanyUser)
	textRec := httptest.NewRecorder()
	handler.ServeHTTP(textRec, textReq)
	if textRec.Code != http.StatusCreated || !httpEmailCollaborationHasProjection(t, repo, companyID, relationship.NodeID, textID) {
		t.Fatalf("ordinary Node Text box status = %d body=%s", textRec.Code, textRec.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+relationship.NodeID+"/projection/"+relationship.AttachedEmailInformationID+"?company_id="+companyID, nil)
	deleteReq = attachmentRequestWithActor(deleteReq, creator, companyID, domain.RoleCompanyUser)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("email relationship delete status = %d body=%s, want 200", deleteRec.Code, deleteRec.Body.String())
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, relationship.CollaborationID, creator.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted relationship error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetNode(companyID, relationship.NodeID); err != nil {
		t.Fatalf("relationship deletion removed host Node: %v", err)
	}
	if !httpEmailCollaborationHasProjection(t, repo, companyID, relationship.NodeID, textID) {
		t.Fatal("relationship deletion removed unrelated Node content")
	}
	thread, err := repo.GetCommunicationsEmailThread(companyID, relationship.EmailThreadID)
	if err != nil || len(thread.Messages) != 1 || thread.Messages[0].EmailMessageID != relationship.RootMessageID {
		t.Fatalf("relationship deletion changed stored email thread: %+v err=%v", thread, err)
	}
}

type emailCollaborationDefaultFoldersHTTPTest struct{ nodesID string }

func emailCollaborationDefaultFolderIDsForHTTPTest(t *testing.T, repo *store.MemoryRepo, companyID string) emailCollaborationDefaultFoldersHTTPTest {
	t.Helper()
	rows, err := repo.ListCompanyExplorerV2RootRows(store.CompanyExplorerV2RowsQuery{CompanyID: companyID})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2RootRows: %v", err)
	}
	var unfiledID string
	for _, row := range rows.Rows {
		if row.EntityType == store.CompanyExplorerV2EntityFolder && row.Name == store.CompanyExplorerDefaultRootFolderName {
			unfiledID = row.EntityID
		}
	}
	if unfiledID == "" {
		t.Fatal("Unfiled folder not found")
	}
	children, err := repo.ListCompanyExplorerV2ChildRows(store.CompanyExplorerV2RowsQuery{CompanyID: companyID, ParentEntityID: unfiledID})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows Unfiled: %v", err)
	}
	for _, row := range children.Rows {
		if row.EntityType == store.CompanyExplorerV2EntityFolder && row.Name == store.CompanyExplorerDefaultNodesFolderName {
			return emailCollaborationDefaultFoldersHTTPTest{nodesID: row.EntityID}
		}
	}
	t.Fatal("Unfiled/Nodes folder not found")
	return emailCollaborationDefaultFoldersHTTPTest{}
}

func mustHTTPEmailCollaborationGuardUser(t *testing.T, repo *store.MemoryRepo, companyID, subject, email, role string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, email, subject)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, role); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func httpEmailCollaborationHasProjection(t *testing.T, repo *store.MemoryRepo, companyID, nodeID, informationID string) bool {
	t.Helper()
	projections, err := repo.ListNodeProjections(companyID, nodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections: %v", err)
	}
	for _, projection := range projections {
		if projection.InformationID == informationID {
			return true
		}
	}
	return false
}
