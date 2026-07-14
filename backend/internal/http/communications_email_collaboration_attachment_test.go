package httpapi

import (
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmailCollaborationAttachmentUsesSourceMailboxForPermanentParticipant(t *testing.T) {
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000313"
	repo.EnsureCompany(companyID, "Collaboration attachment")
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
		GrantID: "attachment-owner-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	ensured, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "attachment-message", ThreadID: "attachment-thread", Subject: "Attachment",
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

	nylas := &fakeNylasClient{
		messagesByID: map[string]NylasMessage{
			"attachment-message": {
				ID: "attachment-message", ThreadID: "attachment-thread",
				Attachments: []NylasAttachment{{ID: "attachment-file", Filename: "note.txt", ContentType: "text/plain"}},
			},
			"wrong-thread-message": {
				ID: "wrong-thread-message", ThreadID: "other-thread",
				Attachments: []NylasAttachment{{ID: "wrong-file", Filename: "wrong.txt", ContentType: "text/plain"}},
			},
		},
		downloadContent: []byte("shared attachment"),
	}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: nylas,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
		DisableCommunicationsArchiveWorker: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	path := "/v1/communications/messages/attachment-message/attachments/attachment-file?company_id=" +
		companyID + "&collaboration_id=" + collaboration.CollaborationID

	request := httptest.NewRequest(http.MethodGet, path, nil)
	request = attachmentRequestWithActor(request, participant, companyID, domain.RoleCompanyUser)
	recorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || recorder.Body.String() != "shared attachment" {
		t.Fatalf("participant download status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if nylas.lastDownloadGrantID != "attachment-owner-grant" ||
		nylas.lastDownloadMessageID != "attachment-message" ||
		nylas.lastDownloadAttachmentID != "attachment-file" {
		t.Fatalf("participant download scope grant=%q message=%q attachment=%q",
			nylas.lastDownloadGrantID, nylas.lastDownloadMessageID, nylas.lastDownloadAttachmentID)
	}

	outsiderRequest := httptest.NewRequest(http.MethodGet, path, nil)
	outsiderRequest = attachmentRequestWithActor(outsiderRequest, outsider, companyID, domain.RoleCompanyUser)
	outsiderRecorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(outsiderRecorder, outsiderRequest)
	if outsiderRecorder.Code != http.StatusNotFound {
		t.Fatalf("outsider download status=%d body=%s", outsiderRecorder.Code, outsiderRecorder.Body.String())
	}

	wrongPath := "/v1/communications/messages/wrong-thread-message/attachments/wrong-file?company_id=" +
		companyID + "&collaboration_id=" + collaboration.CollaborationID
	wrongRequest := httptest.NewRequest(http.MethodGet, wrongPath, nil)
	wrongRequest = attachmentRequestWithActor(wrongRequest, participant, companyID, domain.RoleCompanyUser)
	wrongRecorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(wrongRecorder, wrongRequest)
	if wrongRecorder.Code != http.StatusNotFound {
		t.Fatalf("wrong-thread download status=%d body=%s", wrongRecorder.Code, wrongRecorder.Body.String())
	}
	if nylas.lastDownloadMessageID != "attachment-message" || nylas.lastDownloadAttachmentID != "attachment-file" {
		t.Fatalf("wrong-thread request reached attachment download: message=%q attachment=%q",
			nylas.lastDownloadMessageID, nylas.lastDownloadAttachmentID)
	}
}
