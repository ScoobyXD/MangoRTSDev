package httpapi

import (
	"context"
	"crypto/sha256"
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmailCollaborationAttachmentAuthorizationBoundaries(t *testing.T) {
	for _, scope := range []string{"personal", "shared"} {
		t.Run(scope, func(t *testing.T) {
			runEmailCollaborationAttachmentAuthorizationBoundary(t, scope)
		})
	}
}

func runEmailCollaborationAttachmentAuthorizationBoundary(t *testing.T, scope string) {
	t.Helper()
	const companyID = "11111111-1111-4111-8111-701300000314"
	repo := store.NewMemoryRepo()
	repo.EnsureCompany(companyID, "V3 email attachment authorization")
	addUser := func(subject, email string) domain.User {
		t.Helper()
		user, err := repo.UpsertAuthUser(subject, email, subject)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
		return user
	}
	owner := addUser(scope+"-attachment-owner", scope+"-attachment-owner@example.com")
	participant := addUser(scope+"-attachment-participant", scope+"-attachment-participant@example.com")
	outsider := addUser(scope+"-attachment-outsider", scope+"-attachment-outsider@example.com")

	ensureInput := store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
	}
	if scope == "shared" {
		ensureInput.PersonalUserID = ""
		ensureInput.PersonalAccountEmail = ""
		ensureInput.SharedInboxID = "22222222-2222-4222-8222-701300000314"
		ensureInput.AccountEmail = "support-attachment@example.com"
		ensureInput.Provider = "microsoft"
	} else if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		GrantID: "personal-source-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}

	body := []byte("normalized email attachment")
	attachmentID := store.NewUUIDv7String()
	providerAttachmentID := scope + "-provider-attachment"
	ensureInput.Message = domain.EmailMessageSnapshot{
		ID: scope + "-provider-message", ThreadID: scope + "-provider-thread", Subject: "Private attachment",
		Attachments: []domain.EmailAttachmentSnapshot{{
			ID: providerAttachmentID, AttachmentID: attachmentID, Filename: "allowed.txt",
			ContentType: "text/plain", Size: int64(len(body)),
		}},
	}
	ensured, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), ensureInput)
	if err != nil {
		t.Fatal(err)
	}
	collaboration := ensured.Collaboration
	if _, err := repo.AddCommunicationsEmailCollaborationParticipants(store.CommunicationsEmailCollaborationParticipantInput{
		CompanyID: companyID, CollaborationID: collaboration.CollaborationID,
		ActorUserID: owner.UserID, MentionedUserIDs: []string{participant.UserID},
	}); err != nil {
		t.Fatal(err)
	}

	storage := newFakeAttachmentObjectStorage()
	seedFinalEmailMessageAttachment(t, repo, storage, companyID, collaboration.RootMessageID, attachmentID, owner.UserID, body)
	client := &fakeNylasClient{}
	server := newLegacyMailboxTestServer(repo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: client, AttachmentStorage: storage,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()

	path := "/v1/attachments/" + attachmentID + "/content?company_id=" + companyID
	participantResponse := serveEmailCollaborationAttachmentAuthRequest(server, path, participant, companyID, domain.RoleCompanyUser)
	if participantResponse.Code != http.StatusOK || participantResponse.Body.String() != string(body) {
		t.Fatalf("participant download status=%d body=%q", participantResponse.Code, participantResponse.Body.String())
	}
	outsiderResponse := serveEmailCollaborationAttachmentAuthRequest(server, path, outsider, companyID, domain.RoleCompanyUser)
	if outsiderResponse.Code != http.StatusNotFound {
		t.Fatalf("unrelated company user status=%d, want 404 body=%s", outsiderResponse.Code, outsiderResponse.Body.String())
	}
	if scope == "personal" {
		ownerResponse := serveEmailCollaborationAttachmentAuthRequest(server, path, owner, companyID, domain.RoleCompanyUser)
		if ownerResponse.Code != http.StatusOK || ownerResponse.Body.String() != string(body) {
			t.Fatalf("exact mailbox owner status=%d body=%q", ownerResponse.Code, ownerResponse.Body.String())
		}
	}
	detailCalls, downloadGrantID, downloadMessageID, downloadAttachmentID := emailCollaborationAttachmentProviderCalls(client)
	if detailCalls != 0 || downloadGrantID != "" || downloadMessageID != "" || downloadAttachmentID != "" {
		t.Fatalf("normalized attachment read reached provider: detail=%d grant=%q message=%q attachment=%q",
			detailCalls, downloadGrantID, downloadMessageID, downloadAttachmentID)
	}
}

func seedFinalEmailMessageAttachment(
	t *testing.T,
	repo *store.MemoryRepo,
	storage *fakeAttachmentObjectStorage,
	companyID, emailMessageID, attachmentID, actorUserID string,
	body []byte,
) {
	t.Helper()
	sum := sha256.Sum256(body)
	storageKey := attachmentOriginalObjectKey(companyID, attachmentID)
	storage.objects[storageKey] = fakeAttachmentObject{contentType: "text/plain", body: append([]byte(nil), body...)}
	if _, _, err := repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
		CompanyID: companyID, AttachmentID: attachmentID, UploadedByUserID: actorUserID,
		OriginalFilename: "allowed.txt", MimeType: "text/plain", ByteSize: int64(len(body)),
		SHA256: fmt.Sprintf("%x", sum[:]), SHA256VerificationMethod: "server_stream",
		StorageBucket: storage.bucket, StorageKey: storageKey, SourceKind: store.AttachmentSourceEmailIncoming,
		SourceProvider: "google",
		ResourceLink: store.ResourceAttachmentInput{
			CompanyID: companyID, ResourceType: "email_message", ResourceID: emailMessageID,
			RelationshipKind: store.AttachmentRelationshipEmailAttachment, CreatedByUserID: actorUserID,
		},
	}); err != nil {
		t.Fatalf("seed final email attachment: %v", err)
	}
}

func emailCollaborationAttachmentAuthPath(companyID, collaborationID, messageID, attachmentID string) string {
	return "/v1/communications/messages/" + messageID + "/attachments/" + attachmentID +
		"?company_id=" + companyID + "&collaboration_id=" + collaborationID
}

func serveEmailCollaborationAttachmentAuthRequest(
	server *Server,
	path string,
	user domain.User,
	companyID string,
	role string,
) *httptest.ResponseRecorder {
	user.MailboxEnabled = true
	request := httptest.NewRequest(http.MethodGet, path, nil)
	actor := ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID, UserID: user.UserID, Role: role,
		}},
		CompanyID: companyID, CompanyRole: role,
	}
	request = request.WithContext(context.WithValue(request.Context(), actorContextKey{}, actor))
	recorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(recorder, request)
	return recorder
}

func emailCollaborationAttachmentProviderCalls(client *fakeNylasClient) (int, string, string, string) {
	client.mu.Lock()
	defer client.mu.Unlock()
	return client.detailCalls, client.lastDownloadGrantID, client.lastDownloadMessageID, client.lastDownloadAttachmentID
}
