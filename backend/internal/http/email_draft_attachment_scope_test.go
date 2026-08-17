package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestPersonalEmailDraftAttachmentsAreOwnerOnlyEvenForCompanyManagers(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	const draftID = "personal-attachment-draft"
	if _, err := fixture.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, DraftID: draftID, PersonalUserID: fixture.owner.UserID,
		PersonalAccountEmail: "owner-a@example.com", AccountEmail: "owner-a@example.com",
		CreatedByUserID: fixture.owner.UserID, UpdatedByUserID: fixture.owner.UserID, Kind: "compose",
	}); err != nil {
		t.Fatal(err)
	}
	path := "/v1/resources/email_draft/" + draftID + "/attachments?company_id=" + url.QueryEscape(fixture.companyID)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.manager, domain.RoleCompanyManager, http.StatusNotFound)
	obsoleteID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":" + url.QueryEscape(draftID)
	fixture.expectStatus(t, http.MethodGet, "/v1/resources/email_draft/"+obsoleteID+"/attachments?company_id="+url.QueryEscape(fixture.companyID), nil, fixture.owner, domain.RoleCompanyUser, http.StatusNotFound)

	server := NewServer(fixture.repo)
	ownerRequest := emailDraftAttachmentScopeRequest(fixture.owner, fixture.companyID, domain.RoleCompanyUser)
	if recorder := httptest.NewRecorder(); !server.requireAttachmentResourceEdit(recorder, ownerRequest, fixture.companyID, "email_draft", draftID) {
		t.Fatalf("owner edit denied status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	managerRequest := emailDraftAttachmentScopeRequest(fixture.manager, fixture.companyID, domain.RoleCompanyManager)
	managerRecorder := httptest.NewRecorder()
	if server.requireAttachmentResourceEdit(managerRecorder, managerRequest, fixture.companyID, "email_draft", draftID) {
		t.Fatal("company manager unexpectedly received personal-draft attachment edit access")
	}
	if managerRecorder.Code != http.StatusNotFound {
		t.Fatalf("manager edit denial status=%d body=%s", managerRecorder.Code, managerRecorder.Body.String())
	}
}

func TestPersonalEmailDraftAttachmentContentUsesDraftIdentityAndSurvivesDisconnect(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	storage := newFakeAttachmentObjectStorage()
	handler := NewServerWithOptions(fixture.repo, ServerOptions{AttachmentStorage: storage}).Routes()
	exactAttachmentID := seedLiveEmailDraftAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, "owner-a@example.com", "content-draft", "exact.txt", "text/plain", []byte("exact"))
	if _, err := fixture.repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: fixture.owner.UserID, Provider: "google", AccountEmail: "disconnected@example.com", GrantID: "disconnected", Status: "reauth_required",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, DraftID: "disconnected-draft", PersonalUserID: fixture.owner.UserID,
		PersonalAccountEmail: "disconnected@example.com", AccountEmail: "disconnected@example.com",
		CreatedByUserID: fixture.owner.UserID, UpdatedByUserID: fixture.owner.UserID, Kind: "compose",
	}); err != nil {
		t.Fatal(err)
	}
	disconnectedAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, "disconnected-draft", "disconnected.txt", "text/plain", []byte("disconnected"))

	exact := serveEmailAttachmentScopeRequest(handler, fixture.owner, fixture.companyID, domain.RoleCompanyUser, exactAttachmentID)
	if exact.Code != http.StatusOK || exact.Body.String() != "exact" {
		t.Fatalf("exact owner content status=%d body=%q", exact.Code, exact.Body.String())
	}
	for name, actor := range map[string]struct {
		user domain.User
		role string
	}{
		"manager":  {fixture.manager, domain.RoleCompanyManager},
		"admin":    {fixture.manager, domain.RoleCompanyAdmin},
		"attacker": {fixture.attacker, domain.RoleCompanyUser},
	} {
		response := serveEmailAttachmentScopeRequest(handler, actor.user, fixture.companyID, actor.role, exactAttachmentID)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s content status=%d body=%s", name, response.Code, response.Body.String())
		}
	}
	disconnected := serveEmailAttachmentScopeRequest(handler, fixture.owner, fixture.companyID, domain.RoleCompanyUser, disconnectedAttachmentID)
	if disconnected.Code != http.StatusOK || disconnected.Body.String() != "disconnected" {
		t.Fatalf("disconnected-account content status=%d body=%s", disconnected.Code, disconnected.Body.String())
	}
}

func TestDeletedEmailDraftAttachmentLinkIsRetiredButSentMessageLinkSurvives(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	storage := newFakeAttachmentObjectStorage()
	handler := NewServerWithOptions(fixture.repo, ServerOptions{AttachmentStorage: storage}).Routes()
	const draftID = "deleted-attachment-draft"
	draftOnlyAttachmentID := seedLiveEmailDraftAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, "owner-a@example.com", draftID, "draft-only.txt", "text/plain", []byte("draft-only"))
	sentAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, draftID, "sent.txt", "text/plain", []byte("sent"))
	ensured, err := fixture.repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: fixture.companyID, PersonalUserID: fixture.owner.UserID,
		PersonalAccountEmail: "owner-a@example.com", AccountEmail: "owner-a@example.com", Provider: "google",
		CreatedByUserID: fixture.owner.UserID,
		Message:         domain.EmailMessageSnapshot{ID: "sent-provider-message", ThreadID: "sent-provider-thread", Subject: "Sent"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.repo.LinkResourceAttachment(store.ResourceAttachmentInput{
		CompanyID: fixture.companyID, ResourceType: "email_message", ResourceID: ensured.Collaboration.RootMessageID,
		AttachmentID: sentAttachmentID, RelationshipKind: store.AttachmentRelationshipEmailAttachment,
		CreatedByUserID: fixture.owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	fixture.expectStatus(t, http.MethodDelete, fixture.draftByIDPath(draftID, "owner-a@example.com", ""), nil, fixture.owner, domain.RoleCompanyUser, http.StatusOK)

	draftOnly := serveEmailAttachmentScopeRequest(handler, fixture.owner, fixture.companyID, domain.RoleCompanyUser, draftOnlyAttachmentID)
	if draftOnly.Code != http.StatusNotFound {
		t.Fatalf("deleted draft-only attachment status=%d body=%s", draftOnly.Code, draftOnly.Body.String())
	}
	sent := serveEmailAttachmentScopeRequest(handler, fixture.owner, fixture.companyID, domain.RoleCompanyUser, sentAttachmentID)
	if sent.Code != http.StatusOK || sent.Body.String() != "sent" {
		t.Fatalf("sent-message attachment after draft deletion status=%d body=%q", sent.Code, sent.Body.String())
	}
}

func TestEmailMessageAttachmentResourceRejectsObsoleteCompositeID(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	resourceID := "personal:" + url.QueryEscape(fixture.owner.UserID) + ":message-attachment"
	path := "/v1/resources/email_message/" + resourceID + "/attachments?company_id=" + url.QueryEscape(fixture.companyID)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.owner, domain.RoleCompanyUser, http.StatusBadRequest)
}

func TestCommunicationsEmailDraftResponseUsesOnlyExactDraftAttachmentLinks(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	draft, err := fixture.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, DraftID: "response-draft", PersonalUserID: fixture.owner.UserID,
		PersonalAccountEmail: "owner-a@example.com", AccountEmail: "owner-a@example.com",
		CreatedByUserID: fixture.owner.UserID, UpdatedByUserID: fixture.owner.UserID, Kind: "compose",
	})
	if err != nil {
		t.Fatal(err)
	}
	storage := newFakeAttachmentObjectStorage()
	exactAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, draft.DraftID, "exact.txt", "text/plain", []byte("exact"))
	obsoleteAttachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, "personal:"+fixture.owner.UserID+":"+draft.DraftID, "obsolete.txt", "text/plain", []byte("obsolete"))

	response := NewServer(fixture.repo).communicationsEmailDraftResponse(draft)
	if len(response.Attachments) != 1 || response.Attachments[0].AttachmentID != exactAttachmentID {
		t.Fatalf("draft response attachments=%+v, want exact %q only; obsolete=%q", response.Attachments, exactAttachmentID, obsoleteAttachmentID)
	}
}

func TestCommunicationsEmailDraftSummaryDoesNotHydrateBodyOrAttachments(t *testing.T) {
	summary := communicationsEmailDraftSummaryResponse(domain.CommunicationsEmailDraft{
		CompanyID: "company", DraftID: "draft", ScopeType: "personal",
		BodyEditorHTML: "private body", ReplyToMessageJSON: `{"id":"message"}`,
	})
	if summary.BodyEditorHTML != "" || len(summary.ReplyToMessage) != 0 || len(summary.Attachments) != 0 {
		t.Fatalf("draft list summary hydrated detail fields: %+v", summary)
	}
}

func TestSharedEmailDraftAttachmentsUseSharedInboxEditPermissions(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	const draftID = "shared-attachment-draft"
	if _, err := fixture.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, DraftID: draftID, SharedInboxID: fixture.sharedA.FolderID,
		CreatedByUserID: fixture.owner.UserID, UpdatedByUserID: fixture.owner.UserID, Kind: "compose",
	}); err != nil {
		t.Fatal(err)
	}
	resourceID := draftID
	path := "/v1/resources/email_draft/" + resourceID + "/attachments?company_id=" + url.QueryEscape(fixture.companyID)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.viewer, domain.RoleCompanyUser, http.StatusOK)
	fixture.expectStatus(t, http.MethodGet, path, nil, fixture.attacker, domain.RoleCompanyUser, http.StatusNotFound)

	server := NewServer(fixture.repo)
	viewerRequest := emailDraftAttachmentScopeRequest(fixture.viewer, fixture.companyID, domain.RoleCompanyUser)
	viewerRecorder := httptest.NewRecorder()
	if !server.requireAttachmentResourceEdit(viewerRecorder, viewerRequest, fixture.companyID, "email_draft", resourceID) {
		t.Fatalf("shared-inbox edit member denied status=%d body=%s", viewerRecorder.Code, viewerRecorder.Body.String())
	}
	editorRequest := emailDraftAttachmentScopeRequest(fixture.editor, fixture.companyID, domain.RoleCompanyUser)
	if recorder := httptest.NewRecorder(); !server.requireAttachmentResourceEdit(recorder, editorRequest, fixture.companyID, "email_draft", resourceID) {
		t.Fatalf("shared-inbox editor denied status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestSharedEmailDraftAttachmentReadRechecksPermissionAndLiveDraft(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	storage := newFakeAttachmentObjectStorage()
	handler := NewServerWithOptions(fixture.repo, ServerOptions{AttachmentStorage: storage}).Routes()
	const draftID = "shared-revocation-draft"
	resourceID := draftID
	if _, err := fixture.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, DraftID: draftID, SharedInboxID: fixture.sharedA.FolderID,
		CreatedByUserID: fixture.owner.UserID, UpdatedByUserID: fixture.owner.UserID, Kind: "compose",
	}); err != nil {
		t.Fatal(err)
	}
	attachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, storage, fixture.owner.UserID, fixture.companyID, resourceID, "shared.txt", "text/plain", []byte("shared"))

	viewer := serveEmailAttachmentScopeRequest(handler, fixture.viewer, fixture.companyID, domain.RoleCompanyUser, attachmentID)
	if viewer.Code != http.StatusOK {
		t.Fatalf("shared viewer active-draft status=%d body=%s", viewer.Code, viewer.Body.String())
	}
	manager := serveEmailAttachmentScopeRequest(handler, fixture.manager, fixture.companyID, domain.RoleCompanyManager, attachmentID)
	if manager.Code != http.StatusNotFound {
		t.Fatalf("shared manager without inbox permission status=%d body=%s", manager.Code, manager.Body.String())
	}
	admin := serveEmailAttachmentScopeRequest(handler, fixture.manager, fixture.companyID, domain.RoleCompanyAdmin, attachmentID)
	if admin.Code != http.StatusNotFound {
		t.Fatalf("shared admin without ordinary inbox permission status=%d body=%s", admin.Code, admin.Body.String())
	}
	if _, err := fixture.repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: fixture.companyID, EntityType: store.EntityTypeSharedInbox, EntityID: fixture.sharedA.FolderID,
		DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: fixture.owner.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: fixture.editor.UserID, AccessLevel: store.EntityPermissionEdit},
		},
	}); err != nil {
		t.Fatal(err)
	}
	revoked := serveEmailAttachmentScopeRequest(handler, fixture.viewer, fixture.companyID, domain.RoleCompanyUser, attachmentID)
	if revoked.Code != http.StatusNotFound {
		t.Fatalf("revoked shared viewer status=%d body=%s", revoked.Code, revoked.Body.String())
	}
	owner := serveEmailAttachmentScopeRequest(handler, fixture.owner, fixture.companyID, domain.RoleCompanyUser, attachmentID)
	if owner.Code != http.StatusOK {
		t.Fatalf("shared owner after viewer revocation status=%d body=%s", owner.Code, owner.Body.String())
	}
	fixture.expectStatus(t, http.MethodDelete, fixture.draftByIDPath(draftID, "", fixture.sharedA.FolderID), nil, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
	for name, actor := range map[string]struct {
		user domain.User
		role string
	}{
		"owner":   {fixture.owner, domain.RoleCompanyUser},
		"manager": {fixture.manager, domain.RoleCompanyManager},
		"admin":   {fixture.manager, domain.RoleCompanyAdmin},
	} {
		recorder := serveEmailAttachmentScopeRequest(handler, actor.user, fixture.companyID, actor.role, attachmentID)
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("%s deleted shared-draft status=%d body=%s", name, recorder.Code, recorder.Body.String())
		}
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
