package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmailNodeHTTPWorkSemanticsMentionParticipationAndCanonicalSafety(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000101"
	repo.EnsureCompany(companyID, "Email node HTTP company")
	creator := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "email-node-http-creator", "creator@example.com", domain.RoleCompanyUser)
	target := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "email-node-http-target", "target@example.com", domain.RoleCompanyUser)
	admin := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "email-node-http-admin", "admin@example.com", domain.RoleCompanyAdmin)
	priority := 3
	created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, CreatedByUserID: creator.UserID, Priority: &priority,
		Message: domain.EmailMessageSnapshot{
			ID: "email-node-http-message", ThreadID: "email-node-http-thread", Subject: "Email node thread",
			From: []domain.EmailAddressSnapshot{{Name: "Sender", Email: "sender@example.com"}},
			To:   []domain.EmailAddressSnapshot{{Email: creator.Email}},
		},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	collaboration := created.Collaboration
	handler := NewServerWithOptions(repo, ServerOptions{}).Routes()

	grantBody, _ := json.Marshal(map[string]any{"company_id": companyID, "mentioned_user_ids": []string{target.UserID}})
	grantReq := httptest.NewRequest(http.MethodPost, "/v1/communications/email-collaborations/"+collaboration.CollaborationID+"/participants", bytes.NewReader(grantBody))
	grantReq = attachmentRequestWithActor(grantReq, creator, companyID, domain.RoleCompanyUser)
	grantRec := httptest.NewRecorder()
	handler.ServeHTTP(grantRec, grantReq)
	if grantRec.Code != http.StatusNotFound {
		t.Fatalf("standalone participant grant status = %d body=%s, want 404", grantRec.Code, grantRec.Body.String())
	}

	beforeCanonical := httpEmailCollaborationProjectionInformation(t, repo, companyID, collaboration.NodeID, collaboration.AttachedEmailInformationID)
	canonicalBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": "Attached email", "information": `{"subject":"overwritten"}`,
		"information_id": collaboration.AttachedEmailInformationID,
	})
	canonicalReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/projection", bytes.NewReader(canonicalBody))
	canonicalReq = attachmentRequestWithActor(canonicalReq, creator, companyID, domain.RoleCompanyUser)
	canonicalRec := httptest.NewRecorder()
	handler.ServeHTTP(canonicalRec, canonicalReq)
	if canonicalRec.Code != http.StatusConflict {
		t.Fatalf("canonical projection overwrite status = %d body=%s, want 409", canonicalRec.Code, canonicalRec.Body.String())
	}
	if got := httpEmailCollaborationProjectionInformation(t, repo, companyID, collaboration.NodeID, collaboration.AttachedEmailInformationID); got != beforeCanonical {
		t.Fatalf("canonical projection changed from %q to %q", beforeCanonical, got)
	}

	textID := store.NewUUIDv7String()
	textBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": "Text box", "information": `{"title":"Notes","document":"work"}`, "information_id": textID,
	})
	textReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/information", bytes.NewReader(textBody))
	textReq = attachmentRequestWithActor(textReq, creator, companyID, domain.RoleCompanyUser)
	textRec := httptest.NewRecorder()
	handler.ServeHTTP(textRec, textReq)
	if textRec.Code != http.StatusCreated || !httpEmailCollaborationHasProjection(t, repo, companyID, collaboration.NodeID, textID) {
		t.Fatalf("email node Text box status = %d body=%s", textRec.Code, textRec.Body.String())
	}

	chatID := store.NewUUIDv7String()
	mentionInformation, _ := json.Marshal(map[string]any{
		"block_id":           collaboration.AttachedEmailInformationID,
		"message":            "@Target please review",
		"mentioned_user_ids": []string{target.UserID},
	})
	chatBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": store.CommunicationsEmailCollaborationChatInformationType,
		"information": string(mentionInformation), "information_id": chatID,
	})
	chatReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/information", bytes.NewReader(chatBody))
	chatReq = attachmentRequestWithActor(chatReq, creator, companyID, domain.RoleCompanyUser)
	chatRec := httptest.NewRecorder()
	handler.ServeHTTP(chatRec, chatReq)
	if chatRec.Code != http.StatusCreated {
		t.Fatalf("email node chat mention status = %d body=%s", chatRec.Code, chatRec.Body.String())
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, collaboration.CollaborationID, target.UserID); err != nil {
		t.Fatalf("mentioned user did not become a safe node-chat participant: %v", err)
	}

	saveBody, _ := json.Marshal(map[string]any{"company_id": companyID, "save_kind": "manual"})
	saveReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/save-versions", bytes.NewReader(saveBody))
	saveReq = attachmentRequestWithActor(saveReq, creator, companyID, domain.RoleCompanyUser)
	saveRec := httptest.NewRecorder()
	handler.ServeHTTP(saveRec, saveReq)
	if saveRec.Code != http.StatusCreated {
		t.Fatalf("email node save-version create status = %d body=%s", saveRec.Code, saveRec.Body.String())
	}

	logicGate, err := repo.CreateLogicGate(companyID, "Email node gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	logicGateBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "node_id": collaboration.NodeID, "priority": priority, "status": store.LogicGateWorkStatusPending,
	})
	logicGateReq := httptest.NewRequest(http.MethodPost, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes", bytes.NewReader(logicGateBody))
	logicGateReq = attachmentRequestWithActor(logicGateReq, creator, companyID, domain.RoleCompanyUser)
	logicGateRec := httptest.NewRecorder()
	handler.ServeHTTP(logicGateRec, logicGateReq)
	if logicGateRec.Code != http.StatusCreated || !bytes.Contains(logicGateRec.Body.Bytes(), []byte(`"created_from_email":true`)) {
		t.Fatalf("email node Logic Gate assignment status = %d body=%s", logicGateRec.Code, logicGateRec.Body.String())
	}

	updateBody, _ := json.Marshal(map[string]any{"company_id": companyID, "name": "Renamed email node"})
	updateReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+collaboration.NodeID, bytes.NewReader(updateBody))
	updateReq = attachmentRequestWithActor(updateReq, creator, companyID, domain.RoleCompanyUser)
	updateRec := httptest.NewRecorder()
	handler.ServeHTTP(updateRec, updateReq)
	if updateRec.Code != http.StatusOK {
		t.Fatalf("email node update status = %d body=%s", updateRec.Code, updateRec.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+collaboration.NodeID+"?company_id="+companyID, nil)
	deleteReq.Header.Set(confirmationDisplayNameHeader, creator.DisplayName)
	deleteReq = attachmentRequestWithActor(deleteReq, creator, companyID, domain.RoleCompanyUser)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusConflict {
		t.Fatalf("canonical email node delete status = %d body=%s, want 409", deleteRec.Code, deleteRec.Body.String())
	}

	projectionDeleteReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+collaboration.NodeID+"/projection/"+collaboration.AttachedEmailInformationID+"?company_id="+companyID, nil)
	projectionDeleteReq = attachmentRequestWithActor(projectionDeleteReq, creator, companyID, domain.RoleCompanyUser)
	projectionDeleteRec := httptest.NewRecorder()
	handler.ServeHTTP(projectionDeleteRec, projectionDeleteReq)
	if projectionDeleteRec.Code != http.StatusConflict {
		t.Fatalf("canonical Attached email delete status = %d body=%s, want 409", projectionDeleteRec.Code, projectionDeleteRec.Body.String())
	}

	permissionBody, _ := json.Marshal(map[string]any{"company_id": companyID, "default_access": store.ResourceDefaultAccessEdit, "permissions": []any{}})
	permissionReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+collaboration.NodeID+"/permissions", bytes.NewReader(permissionBody))
	permissionReq = attachmentRequestWithActor(permissionReq, admin, companyID, domain.RoleCompanyAdmin)
	permissionRec := httptest.NewRecorder()
	handler.ServeHTTP(permissionRec, permissionReq)
	if permissionRec.Code != http.StatusConflict {
		t.Fatalf("email node permission replace status = %d body=%s, want 409", permissionRec.Code, permissionRec.Body.String())
	}

	assertEmailCollaborationAttachmentAdminPrivacy(t, repo, companyID, collaboration, creator, target, admin)
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

func emailCollaborationMentionInformation(t *testing.T, userID string) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"block_id": store.NewUUIDv7String(), "content": "@Target please review", "mentioned_user_ids": []string{userID},
	})
	if err != nil {
		t.Fatalf("marshal mention information: %v", err)
	}
	return string(raw)
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

func httpEmailCollaborationProjectionInformation(t *testing.T, repo *store.MemoryRepo, companyID, nodeID, informationID string) string {
	t.Helper()
	projections, err := repo.ListNodeProjections(companyID, nodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections: %v", err)
	}
	for _, projection := range projections {
		if projection.InformationID == informationID {
			return projection.Information
		}
	}
	t.Fatalf("projection %s not found", informationID)
	return ""
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

func assertEmailCollaborationAttachmentAdminPrivacy(t *testing.T, repo *store.MemoryRepo, companyID string, collaboration domain.CommunicationsEmailCollaboration, creator, participant, admin domain.User) {
	t.Helper()
	draftID := "guard-shared-draft"
	if _, err := repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaboration.CollaborationID, IsShared: true,
		ParticipantUserID: creator.UserID, CreatedByUserID: creator.UserID, UpdatedByUserID: creator.UserID,
		Kind: "reply", SourceMessageID: collaboration.RootMessageID, Subject: "Shared reply", BodyEditorHTML: "<p>Draft</p>",
	}); err != nil {
		t.Fatalf("UpsertCommunicationsEmailDraft shared: %v", err)
	}
	body := []byte("participant-private attachment")
	sum := sha256.Sum256(body)
	attachmentID := store.NewUUIDv7String()
	storage := newFakeAttachmentObjectStorage()
	storageKey := attachmentOriginalObjectKey(companyID, attachmentID)
	storage.objects[storageKey] = fakeAttachmentObject{contentType: "text/plain", body: body}
	resourceID := "collaboration:" + collaboration.CollaborationID + ":" + draftID
	if _, _, err := repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
		CompanyID: companyID, AttachmentID: attachmentID, UploadedByUserID: creator.UserID,
		OriginalFilename: "private.txt", MimeType: "text/plain", ByteSize: int64(len(body)),
		SHA256: fmt.Sprintf("%x", sum[:]), SHA256VerificationMethod: "server_stream",
		StorageBucket: storage.bucket, StorageKey: storageKey, SourceKind: store.AttachmentSourceUserUpload,
		ResourceLink: store.ResourceAttachmentInput{CompanyID: companyID, ResourceType: "email_draft", ResourceID: resourceID,
			RelationshipKind: store.AttachmentRelationshipFileAttachment, CreatedByUserID: creator.UserID},
	}); err != nil {
		t.Fatalf("CreateAttachmentWithResourceLink: %v", err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{AttachmentStorage: storage}).Routes()
	adminReq := httptest.NewRequest(http.MethodGet, "/v1/attachments/"+attachmentID+"/content?company_id="+companyID, nil)
	adminReq = attachmentRequestWithActor(adminReq, admin, companyID, domain.RoleCompanyAdmin)
	adminRec := httptest.NewRecorder()
	handler.ServeHTTP(adminRec, adminReq)
	if adminRec.Code != http.StatusNotFound {
		t.Fatalf("nonparticipant admin attachment content status = %d body=%s, want 404", adminRec.Code, adminRec.Body.String())
	}
	participantReq := httptest.NewRequest(http.MethodGet, "/v1/attachments/"+attachmentID+"/content?company_id="+companyID, nil)
	participantReq = attachmentRequestWithActor(participantReq, participant, companyID, domain.RoleCompanyUser)
	participantRec := httptest.NewRecorder()
	handler.ServeHTTP(participantRec, participantReq)
	if participantRec.Code != http.StatusOK || !bytes.Equal(participantRec.Body.Bytes(), body) {
		t.Fatalf("participant attachment content status = %d body=%q", participantRec.Code, participantRec.Body.Bytes())
	}
}
