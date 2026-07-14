package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestEmailCollaborationSharedDraftAttachmentMutationsFreezeWhileSending(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-701300000317"
	repo, owner, collaboration, draft, _ := seedEmailCollaborationSharedDraftRecoveryHTTPTest(t, companyID, "attachment-freeze")
	server := NewServer(repo)
	resourceID := communicationsEmailDraftResourceID(draft)
	listPath := "/v1/resources/email_draft/" + resourceID + "/attachments?company_id=" + url.QueryEscape(companyID)
	listRequest := attachmentRequestWithActor(httptest.NewRequest(http.MethodGet, listPath, nil), owner, companyID, domain.RoleCompanyUser)
	listBefore := httptest.NewRecorder()
	server.Routes().ServeHTTP(listBefore, listRequest)
	if listBefore.Code != http.StatusOK {
		t.Fatalf("pre-send attachment read status=%d body=%s", listBefore.Code, listBefore.Body.String())
	}
	if _, err := repo.ClaimCommunicationsEmailDraftSend(store.CommunicationsEmailDraftSendClaimInput{
		CompanyID: companyID, DraftID: draft.DraftID, CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: owner.UserID, ExpectedRevision: draft.Revision, ProviderGrantID: "shared-send-recovery-grant-attachment-freeze",
	}); err != nil {
		t.Fatalf("claim shared draft send: %v", err)
	}

	linkBody, _ := json.Marshal(map[string]string{
		"company_id": companyID, "attachment_id": "must-not-link", "relationship_kind": "file_attachment",
	})
	linkRequest := attachmentRequestWithActor(httptest.NewRequest(http.MethodPost, listPath, bytes.NewReader(linkBody)), owner, companyID, domain.RoleCompanyUser)
	linkRecorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(linkRecorder, linkRequest)
	if linkRecorder.Code != http.StatusConflict || !strings.Contains(linkRecorder.Body.String(), "email_draft_send_in_progress") {
		t.Fatalf("sending attachment link status=%d body=%s", linkRecorder.Code, linkRecorder.Body.String())
	}
	unlinkRequest := attachmentRequestWithActor(httptest.NewRequest(http.MethodDelete, "/v1/resources/email_draft/"+resourceID+"/attachments/must-not-unlink?company_id="+url.QueryEscape(companyID), nil), owner, companyID, domain.RoleCompanyUser)
	unlinkRecorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(unlinkRecorder, unlinkRequest)
	if unlinkRecorder.Code != http.StatusConflict || !strings.Contains(unlinkRecorder.Body.String(), "email_draft_send_in_progress") {
		t.Fatalf("sending attachment unlink status=%d body=%s", unlinkRecorder.Code, unlinkRecorder.Body.String())
	}
	listAfter := httptest.NewRecorder()
	server.Routes().ServeHTTP(listAfter, listRequest)
	if listAfter.Code != http.StatusOK {
		t.Fatalf("sending attachment read status=%d body=%s", listAfter.Code, listAfter.Body.String())
	}
}

func TestPersonalEmailDraftAttachmentsAreOwnerOnlyEvenForCompanyManagers(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	const draftID = "personal-attachment-draft"
	if _, err := fixture.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, DraftID: draftID, PersonalUserID: fixture.owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: fixture.owner.UserID, UpdatedByUserID: fixture.owner.UserID, Kind: "compose", AccountEmail: "owner-a@example.com",
	}); err != nil {
		t.Fatal(err)
	}
	resourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":" + url.QueryEscape("owner-a@example.com") + ":" + url.QueryEscape(draftID)
	path := "/v1/resources/email_draft/" + resourceID + "/attachments?company_id=" + url.QueryEscape(fixture.companyID)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.manager, domain.RoleCompanyManager, http.StatusNotFound)
	unknownAccountResourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":" + url.QueryEscape("unknown@example.com") + ":" + url.QueryEscape(draftID)
	fixture.expectStatus(t, http.MethodGet, "/v1/resources/email_draft/"+unknownAccountResourceID+"/attachments?company_id="+url.QueryEscape(fixture.companyID), nil, fixture.owner, domain.RoleCompanyUser, http.StatusNotFound)
	legacyResourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":" + url.QueryEscape(draftID)
	fixture.expectStatus(t, http.MethodGet, "/v1/resources/email_draft/"+legacyResourceID+"/attachments?company_id="+url.QueryEscape(fixture.companyID), nil, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
	fixture.expectStatus(t, http.MethodGet, "/v1/resources/email_draft/"+legacyResourceID+"/attachments?company_id="+url.QueryEscape(fixture.companyID), nil, fixture.manager, domain.RoleCompanyAdmin, http.StatusNotFound)

	server := NewServer(fixture.repo)
	ownerRequest := emailDraftAttachmentScopeRequest(fixture.owner, fixture.companyID, domain.RoleCompanyUser)
	if recorder := httptest.NewRecorder(); !server.requireAttachmentResourceEdit(recorder, ownerRequest, fixture.companyID, "email_draft", resourceID) {
		t.Fatalf("owner edit denied status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	legacyEditRecorder := httptest.NewRecorder()
	if server.requireAttachmentResourceEdit(legacyEditRecorder, ownerRequest, fixture.companyID, "email_draft", legacyResourceID) {
		t.Fatal("owner unexpectedly received write access through a legacy accountless draft resource")
	}
	if legacyEditRecorder.Code != http.StatusBadRequest {
		t.Fatalf("legacy draft edit denial status=%d body=%s", legacyEditRecorder.Code, legacyEditRecorder.Body.String())
	}
	managerRequest := emailDraftAttachmentScopeRequest(fixture.manager, fixture.companyID, domain.RoleCompanyManager)
	managerRecorder := httptest.NewRecorder()
	if server.requireAttachmentResourceEdit(managerRecorder, managerRequest, fixture.companyID, "email_draft", resourceID) {
		t.Fatal("company manager unexpectedly received personal-draft attachment edit access")
	}
	if managerRecorder.Code != http.StatusNotFound {
		t.Fatalf("manager edit denial status=%d body=%s", managerRecorder.Code, managerRecorder.Body.String())
	}
}

func TestPersonalEmailDraftAttachmentContentRequiresExactOwnerAccount(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	storage := newFakeAttachmentObjectStorage()
	handler := NewServerWithOptions(fixture.repo, ServerOptions{AttachmentStorage: storage}).Routes()
	exactResourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":" + url.QueryEscape("owner-a@example.com") + ":content-draft"
	wrongAccountResourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":" + url.QueryEscape("unknown@example.com") + ":content-draft"
	disconnectedAccountResourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":" + url.QueryEscape("disconnected@example.com") + ":content-draft"
	legacyResourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":content-draft"
	if _, err := fixture.repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: fixture.owner.UserID, Provider: "google", AccountEmail: "disconnected@example.com", GrantID: "disconnected", Status: "reauth_required",
	}); err != nil {
		t.Fatal(err)
	}
	exactAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, exactResourceID, "exact.txt", "text/plain", []byte("exact"))
	wrongAccountAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, wrongAccountResourceID, "wrong.txt", "text/plain", []byte("wrong"))
	disconnectedAccountAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, disconnectedAccountResourceID, "disconnected.txt", "text/plain", []byte("disconnected"))
	legacyAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, legacyResourceID, "legacy.txt", "text/plain", []byte("legacy"))

	exact := serveEmailAttachmentScopeRequest(handler, fixture.owner, fixture.companyID, domain.RoleCompanyUser, exactAttachmentID)
	if exact.Code != http.StatusOK || exact.Body.String() != "exact" {
		t.Fatalf("exact owner content status=%d body=%q", exact.Code, exact.Body.String())
	}
	manager := serveEmailAttachmentScopeRequest(handler, fixture.manager, fixture.companyID, domain.RoleCompanyManager, exactAttachmentID)
	if manager.Code != http.StatusNotFound {
		t.Fatalf("manager content status=%d body=%s", manager.Code, manager.Body.String())
	}
	companyAdmin := serveEmailAttachmentScopeRequest(handler, fixture.manager, fixture.companyID, domain.RoleCompanyAdmin, exactAttachmentID)
	if companyAdmin.Code != http.StatusNotFound {
		t.Fatalf("company-admin content status=%d body=%s", companyAdmin.Code, companyAdmin.Body.String())
	}
	wrongAccount := serveEmailAttachmentScopeRequest(handler, fixture.owner, fixture.companyID, domain.RoleCompanyUser, wrongAccountAttachmentID)
	if wrongAccount.Code != http.StatusNotFound {
		t.Fatalf("wrong-account content status=%d body=%s", wrongAccount.Code, wrongAccount.Body.String())
	}
	disconnectedAccount := serveEmailAttachmentScopeRequest(handler, fixture.owner, fixture.companyID, domain.RoleCompanyUser, disconnectedAccountAttachmentID)
	if disconnectedAccount.Code != http.StatusOK || disconnectedAccount.Body.String() != "disconnected" {
		t.Fatalf("disconnected-account content status=%d body=%s", disconnectedAccount.Code, disconnectedAccount.Body.String())
	}
	legacy := serveEmailAttachmentScopeRequest(handler, fixture.owner, fixture.companyID, domain.RoleCompanyUser, legacyAttachmentID)
	if legacy.Code != http.StatusOK || legacy.Body.String() != "legacy" {
		t.Fatalf("legacy draft content status=%d body=%s", legacy.Code, legacy.Body.String())
	}
	legacyAdmin := serveEmailAttachmentScopeRequest(handler, fixture.manager, fixture.companyID, domain.RoleCompanyAdmin, legacyAttachmentID)
	if legacyAdmin.Code != http.StatusNotFound {
		t.Fatalf("legacy draft admin content status=%d body=%s", legacyAdmin.Code, legacyAdmin.Body.String())
	}
}

func TestPersonalEmailMessageAttachmentsRetainThreePartResourceID(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	resourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":message-attachment"
	path := "/v1/resources/email_message/" + resourceID + "/attachments?company_id=" + url.QueryEscape(fixture.companyID)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
}

func TestCommunicationsEmailDraftResponseIncludesOwnerOnlyLegacyPersonalAttachmentLinks(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	draft, err := fixture.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, DraftID: "response-draft", PersonalUserID: fixture.owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: fixture.owner.UserID, UpdatedByUserID: fixture.owner.UserID, Kind: "compose", AccountEmail: "owner-a@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	storage := newFakeAttachmentObjectStorage()
	exactAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, communicationsEmailDraftResourceID(draft), "exact.txt", "text/plain", []byte("exact"))
	legacyResourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":" + url.QueryEscape(draft.DraftID)
	legacyAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, legacyResourceID, "legacy.txt", "text/plain", []byte("legacy"))

	response := NewServer(fixture.repo).communicationsEmailDraftResponse(draft)
	if len(response.Attachments) != 2 || response.Attachments[0].AttachmentID != exactAttachmentID || response.Attachments[1].AttachmentID != legacyAttachmentID {
		t.Fatalf("draft response attachments=%+v, want exact %q and legacy %q", response.Attachments, exactAttachmentID, legacyAttachmentID)
	}
}

func TestSharedEmailDraftAttachmentsUseSharedInboxViewAndEditPermissions(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	resourceID := "shared:" + url.QueryEscape(fixture.sharedA.FolderID) + ":shared-attachment-draft"
	path := "/v1/resources/email_draft/" + resourceID + "/attachments?company_id=" + url.QueryEscape(fixture.companyID)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.viewer, domain.RoleCompanyUser, http.StatusOK)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.attacker, domain.RoleCompanyUser, http.StatusNotFound)

	server := NewServer(fixture.repo)
	viewerRequest := emailDraftAttachmentScopeRequest(fixture.viewer, fixture.companyID, domain.RoleCompanyUser)
	viewerRecorder := httptest.NewRecorder()
	if server.requireAttachmentResourceEdit(viewerRecorder, viewerRequest, fixture.companyID, "email_draft", resourceID) {
		t.Fatal("view-only shared-inbox member unexpectedly received draft attachment edit access")
	}
	if viewerRecorder.Code != http.StatusForbidden {
		t.Fatalf("view-only edit denial status=%d body=%s", viewerRecorder.Code, viewerRecorder.Body.String())
	}
	editorRequest := emailDraftAttachmentScopeRequest(fixture.editor, fixture.companyID, domain.RoleCompanyUser)
	if recorder := httptest.NewRecorder(); !server.requireAttachmentResourceEdit(recorder, editorRequest, fixture.companyID, "email_draft", resourceID) {
		t.Fatalf("shared-inbox editor denied status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func emailDraftAttachmentScopeRequest(user domain.User, companyID, role string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, ActorContext{
		User:        user,
		Memberships: []domain.CompanyMembership{{CompanyID: companyID, UserID: user.UserID, Role: role}},
		CompanyID:   companyID, CompanyRole: role,
	}))
}

func serveEmailAttachmentScopeRequest(handler http.Handler, user domain.User, companyID, role, attachmentID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/v1/attachments/"+url.PathEscape(attachmentID)+"/content?company_id="+url.QueryEscape(companyID)+"&variant=original", nil)
	req = req.WithContext(emailDraftAttachmentScopeRequest(user, companyID, role).Context())
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}
