package httpapi

import (
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"testing"
)

func TestEmailRelationshipAttachmentRouteUsesInternalMessageIDAndStoredBytes(t *testing.T) {
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000313"
	repo.EnsureCompany(companyID, "V3 relationship attachment")
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
	creator := addUser("attachment-owner", "attachment-owner@example.com")
	participant := addUser("attachment-participant", "attachment-participant@example.com")
	outsider := addUser("attachment-outsider", "attachment-outsider@example.com")
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: creator.UserID, Provider: "google", AccountEmail: creator.Email,
		GrantID: "provider-must-not-be-used", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}

	body := []byte("stored relationship attachment")
	attachmentID := store.NewUUIDv7String()
	const providerAttachmentID = "provider-attachment-id"
	ensured, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "provider-message-id", ThreadID: "provider-thread-id", Subject: "Attachment",
			Attachments: []domain.EmailAttachmentSnapshot{{
				ID: providerAttachmentID, AttachmentID: attachmentID, Filename: "note.txt",
				ContentType: "text/plain", Size: int64(len(body)),
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	collaboration := ensured.Collaboration
	if _, err := repo.AddCommunicationsEmailCollaborationParticipants(store.CommunicationsEmailCollaborationParticipantInput{
		CompanyID: companyID, CollaborationID: collaboration.CollaborationID,
		ActorUserID: creator.UserID, MentionedUserIDs: []string{participant.UserID},
	}); err != nil {
		t.Fatal(err)
	}
	storage := newFakeAttachmentObjectStorage()
	seedFinalEmailMessageAttachment(t, repo, storage, companyID, collaboration.RootMessageID, attachmentID, creator.UserID, body)
	client := &fakeNylasClient{downloadContent: []byte("provider bytes must not be served")}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: client, AttachmentStorage: storage,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()

	path := emailCollaborationAttachmentAuthPath(companyID, collaboration.CollaborationID, collaboration.RootMessageID, providerAttachmentID)
	participantResponse := serveEmailCollaborationAttachmentAuthRequest(server, path, participant, companyID, domain.RoleCompanyUser)
	if participantResponse.Code != http.StatusOK || participantResponse.Body.String() != string(body) {
		t.Fatalf("relationship member status=%d body=%q", participantResponse.Code, participantResponse.Body.String())
	}
	outsiderResponse := serveEmailCollaborationAttachmentAuthRequest(server, path, outsider, companyID, domain.RoleCompanyUser)
	if outsiderResponse.Code != http.StatusNotFound {
		t.Fatalf("unrelated company user status=%d body=%s", outsiderResponse.Code, outsiderResponse.Body.String())
	}
	providerIDPath := emailCollaborationAttachmentAuthPath(companyID, collaboration.CollaborationID, collaboration.Message.ID, providerAttachmentID)
	providerIDResponse := serveEmailCollaborationAttachmentAuthRequest(server, providerIDPath, participant, companyID, domain.RoleCompanyUser)
	if providerIDResponse.Code != http.StatusNotFound {
		t.Fatalf("provider message ID status=%d, want 404 body=%s", providerIDResponse.Code, providerIDResponse.Body.String())
	}
	detailCalls, downloadGrantID, downloadMessageID, downloadAttachmentID := emailCollaborationAttachmentProviderCalls(client)
	if detailCalls != 0 || downloadGrantID != "" || downloadMessageID != "" || downloadAttachmentID != "" {
		t.Fatalf("relationship attachment read reached provider: detail=%d grant=%q message=%q attachment=%q",
			detailCalls, downloadGrantID, downloadMessageID, downloadAttachmentID)
	}
}
