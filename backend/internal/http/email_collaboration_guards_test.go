package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmailCollaborationHTTPGuardsAndMentionOnlyParticipation(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000101"
	repo.EnsureCompany(companyID, "Email collaboration HTTP guard company")
	creator := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "http-guard-creator", "creator@example.com", domain.RoleCompanyUser)
	target := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "http-guard-target", "target@example.com", domain.RoleCompanyUser)
	admin := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "http-guard-admin", "admin@example.com", domain.RoleCompanyAdmin)
	created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "http-guard-message", ThreadID: "http-guard-thread", Subject: "Guarded thread",
			From: []domain.EmailAddressSnapshot{{Name: "Sender", Email: "sender@example.com"}},
			To:   []domain.EmailAddressSnapshot{{Email: creator.Email}},
		},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	collaboration := created.Collaboration
	server := NewServerWithOptions(repo, ServerOptions{})
	handler := server.Routes()

	grantBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "mentioned_user_ids": []string{target.UserID},
	})
	grantReq := httptest.NewRequest(http.MethodPost, "/v1/communications/email-collaborations/"+collaboration.CollaborationID+"/participants", bytes.NewReader(grantBody))
	grantReq = attachmentRequestWithActor(grantReq, creator, companyID, domain.RoleCompanyUser)
	grantRec := httptest.NewRecorder()
	handler.ServeHTTP(grantRec, grantReq)
	if grantRec.Code != http.StatusNotFound {
		t.Fatalf("standalone participant grant status = %d body=%s, want 404", grantRec.Code, grantRec.Body.String())
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, collaboration.CollaborationID, target.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("target after standalone grant error = %v, want ErrNotFound", err)
	}

	mentionInformation := emailCollaborationMentionInformation(t, target.UserID)
	rejectedBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": "Text block chat", "information": mentionInformation,
		"information_id": collaboration.AttachedEmailInformationID,
	})
	rejectedReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/projection", bytes.NewReader(rejectedBody))
	rejectedReq = attachmentRequestWithActor(rejectedReq, creator, companyID, domain.RoleCompanyUser)
	rejectedRec := httptest.NewRecorder()
	handler.ServeHTTP(rejectedRec, rejectedReq)
	if rejectedRec.Code != http.StatusConflict {
		t.Fatalf("canonical projection overwrite status = %d body=%s, want 409", rejectedRec.Code, rejectedRec.Body.String())
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, collaboration.CollaborationID, target.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("target after rejected mention error = %v, want ErrNotFound", err)
	}

	genericProjectionID := store.NewUUIDv7String()
	genericProjectionBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": "Text box", "information": `{"content":"forbidden"}`, "information_id": genericProjectionID,
	})
	genericProjectionReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/projection", bytes.NewReader(genericProjectionBody))
	genericProjectionReq = attachmentRequestWithActor(genericProjectionReq, creator, companyID, domain.RoleCompanyUser)
	genericProjectionRec := httptest.NewRecorder()
	handler.ServeHTTP(genericProjectionRec, genericProjectionReq)
	if genericProjectionRec.Code != http.StatusConflict {
		t.Fatalf("generic collaboration projection status = %d body=%s, want 409", genericProjectionRec.Code, genericProjectionRec.Body.String())
	}

	chatID := store.NewUUIDv7String()
	acceptedBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "type": "Text block chat", "information": mentionInformation, "information_id": chatID,
	})
	acceptedReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/projection", bytes.NewReader(acceptedBody))
	acceptedReq = attachmentRequestWithActor(acceptedReq, creator, companyID, domain.RoleCompanyUser)
	acceptedRec := httptest.NewRecorder()
	handler.ServeHTTP(acceptedRec, acceptedReq)
	if acceptedRec.Code != http.StatusOK {
		t.Fatalf("accepted chat mention status = %d body=%s", acceptedRec.Code, acceptedRec.Body.String())
	}
	if _, err := repo.GetCommunicationsEmailCollaboration(companyID, collaboration.CollaborationID, target.UserID); err != nil {
		t.Fatalf("target did not become permanent participant: %v", err)
	}

	beforeInformation, err := repo.GetNodeDetails(companyID, collaboration.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails before generic information attempts: %v", err)
	}
	beforeCanonical := httpEmailCollaborationProjectionInformation(t, repo, companyID, collaboration.NodeID, collaboration.AttachedEmailInformationID)
	for _, test := range []struct {
		name          string
		informationID string
		infoType      string
		information   string
	}{
		{name: "canonical Attached email overwrite", informationID: collaboration.AttachedEmailInformationID, infoType: "Attached email", information: `{"subject":"overwritten"}`},
		{name: "arbitrary Text box", informationID: store.NewUUIDv7String(), infoType: "Text box", information: `{"content":"forbidden"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			body, _ := json.Marshal(map[string]any{
				"company_id": companyID, "type": test.infoType, "information": test.information, "information_id": test.informationID,
			})
			req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/information", bytes.NewReader(body))
			req = attachmentRequestWithActor(req, creator, companyID, domain.RoleCompanyUser)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusConflict {
				t.Fatalf("status = %d body=%s, want 409", rec.Code, rec.Body.String())
			}
		})
	}
	afterInformation, err := repo.GetNodeDetails(companyID, collaboration.NodeID)
	if err != nil || afterInformation.InformationCount != beforeInformation.InformationCount {
		t.Fatalf("guarded HTTP information writes changed history: before=%d after=%d err=%v", beforeInformation.InformationCount, afterInformation.InformationCount, err)
	}
	if got := httpEmailCollaborationProjectionInformation(t, repo, companyID, collaboration.NodeID, collaboration.AttachedEmailInformationID); got != beforeCanonical {
		t.Fatalf("guarded HTTP information write changed canonical projection from %q to %q", beforeCanonical, got)
	}
	if httpEmailCollaborationHasProjection(t, repo, companyID, collaboration.NodeID, genericProjectionID) {
		t.Fatal("generic HTTP projection write persisted on collaboration Node")
	}

	saveBody, _ := json.Marshal(map[string]any{"company_id": companyID, "save_kind": "manual"})
	saveReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/save-versions", bytes.NewReader(saveBody))
	saveReq = attachmentRequestWithActor(saveReq, creator, companyID, domain.RoleCompanyUser)
	saveRec := httptest.NewRecorder()
	handler.ServeHTTP(saveRec, saveReq)
	if saveRec.Code != http.StatusConflict {
		t.Fatalf("collaboration save-version create status = %d body=%s, want 409", saveRec.Code, saveRec.Body.String())
	}
	restoreBody, _ := json.Marshal(map[string]any{"company_id": companyID})
	restoreReq := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+collaboration.NodeID+"/save-versions/"+store.NewUUIDv7String()+"/restore", bytes.NewReader(restoreBody))
	restoreReq = attachmentRequestWithActor(restoreReq, creator, companyID, domain.RoleCompanyUser)
	restoreRec := httptest.NewRecorder()
	handler.ServeHTTP(restoreRec, restoreReq)
	if restoreRec.Code != http.StatusConflict {
		t.Fatalf("collaboration save-version restore status = %d body=%s, want 409", restoreRec.Code, restoreRec.Body.String())
	}

	accountBody, _ := json.Marshal(map[string]any{"company_id": companyID, "account_ids": []string{}})
	accountReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+collaboration.NodeID+"/accounts", bytes.NewReader(accountBody))
	accountReq = attachmentRequestWithActor(accountReq, creator, companyID, domain.RoleCompanyUser)
	accountRec := httptest.NewRecorder()
	handler.ServeHTTP(accountRec, accountReq)
	if accountRec.Code != http.StatusConflict {
		t.Fatalf("collaboration account assignment status = %d body=%s, want 409", accountRec.Code, accountRec.Body.String())
	}

	gvicBody, _ := json.Marshal(map[string]any{"company_id": companyID, "gvic_assignments": []any{}})
	gvicReq := httptest.NewRequest(http.MethodPut, "/v1/resources/node/"+collaboration.NodeID+"/gvic", bytes.NewReader(gvicBody))
	gvicReq = attachmentRequestWithActor(gvicReq, creator, companyID, domain.RoleCompanyUser)
	gvicRec := httptest.NewRecorder()
	handler.ServeHTTP(gvicRec, gvicReq)
	if gvicRec.Code != http.StatusConflict {
		t.Fatalf("collaboration GVIC assignment status = %d body=%s, want 409", gvicRec.Code, gvicRec.Body.String())
	}

	logicGate, err := repo.CreateLogicGate(companyID, "Collaboration guard gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	logicGateBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "node_id": collaboration.NodeID, "priority": 3, "status": store.LogicGateWorkStatusPending,
	})
	logicGateReq := httptest.NewRequest(http.MethodPost, "/v2/logic-gates/"+logicGate.LogicGateID+"/nodes", bytes.NewReader(logicGateBody))
	logicGateReq = attachmentRequestWithActor(logicGateReq, creator, companyID, domain.RoleCompanyUser)
	logicGateRec := httptest.NewRecorder()
	handler.ServeHTTP(logicGateRec, logicGateReq)
	if logicGateRec.Code != http.StatusConflict {
		t.Fatalf("collaboration Logic Gate assignment status = %d body=%s, want 409", logicGateRec.Code, logicGateRec.Body.String())
	}

	updateBody, _ := json.Marshal(map[string]any{"company_id": companyID, "name": "renamed"})
	updateReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+collaboration.NodeID, bytes.NewReader(updateBody))
	updateReq = attachmentRequestWithActor(updateReq, creator, companyID, domain.RoleCompanyUser)
	updateRec := httptest.NewRecorder()
	handler.ServeHTTP(updateRec, updateReq)
	if updateRec.Code != http.StatusConflict {
		t.Fatalf("generic collaboration node update status = %d body=%s, want 409", updateRec.Code, updateRec.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+collaboration.NodeID+"?company_id="+companyID, nil)
	deleteReq.Header.Set(confirmationDisplayNameHeader, creator.DisplayName)
	deleteReq = attachmentRequestWithActor(deleteReq, creator, companyID, domain.RoleCompanyUser)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusConflict {
		t.Fatalf("generic collaboration node delete status = %d body=%s, want 409", deleteRec.Code, deleteRec.Body.String())
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
		t.Fatalf("generic collaboration permission replace status = %d body=%s, want 409", permissionRec.Code, permissionRec.Body.String())
	}

	folders := emailCollaborationDefaultFolderIDsForHTTPTest(t, repo, companyID)
	children, err := repo.ListCompanyExplorerV2ChildRows(store.CompanyExplorerV2RowsQuery{CompanyID: companyID, ParentEntityID: folders.nodesID})
	if err != nil {
		t.Fatalf("ListCompanyExplorerV2ChildRows Nodes: %v", err)
	}
	edgeID := ""
	for _, row := range children.Rows {
		if row.EntityType == store.CompanyExplorerV2EntityNode && row.ResourceID == collaboration.NodeID {
			edgeID = row.EdgeID
		}
	}
	if edgeID == "" {
		t.Fatal("collaboration Node Explorer edge not found")
	}
	targetFolder, err := repo.CreateCompanyExplorerV2Folder(store.CompanyExplorerV2FolderInput{CompanyID: companyID, ParentEntityID: companyID, Name: "Move target"})
	if err != nil {
		t.Fatalf("CreateCompanyExplorerV2Folder: %v", err)
	}
	moveBody, _ := json.Marshal(map[string]any{"company_id": companyID, "parent_entity_id": targetFolder.EntityID})
	moveReq := httptest.NewRequest(http.MethodPut, "/v1/company-explorer/items/"+edgeID, bytes.NewReader(moveBody))
	moveReq = attachmentRequestWithActor(moveReq, creator, companyID, domain.RoleCompanyUser)
	moveRec := httptest.NewRecorder()
	handler.ServeHTTP(moveRec, moveReq)
	if moveRec.Code != http.StatusConflict {
		t.Fatalf("generic collaboration Explorer move status = %d body=%s, want 409", moveRec.Code, moveRec.Body.String())
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
