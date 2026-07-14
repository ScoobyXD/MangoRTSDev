package httpapi

import (
	"context"
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
	repo.EnsureCompany(companyID, "Collaboration attachment authorization")
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

	// Give the participant a connected but unrelated personal mailbox. A
	// successful request must still use the collaboration's immutable source
	// grant, not whichever mailbox belongs to the requesting actor.
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: participant.UserID, Provider: "google", AccountEmail: participant.Email,
		GrantID: "participant-trap-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}

	sourceGrantID := "personal-source-grant"
	ensureInput := store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, CreatedByUserID: owner.UserID,
	}
	if scope == "shared" {
		sourceGrantID = "shared-source-grant"
		ensureInput.PersonalUserID = ""
		ensureInput.PersonalAccountEmail = ""
		ensureInput.SharedInboxID = "22222222-2222-4222-8222-701300000314"
		ensureInput.AccountEmail = "support-attachment@example.com"
		if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
			CompanyID: companyID, Provider: "microsoft", AccountEmail: ensureInput.AccountEmail,
			GrantID: sourceGrantID, Status: "connected", ConnectedByUserID: owner.UserID,
		}); err != nil {
			t.Fatal(err)
		}
	} else if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		GrantID: sourceGrantID, Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}

	allowedMessageID := scope + "-allowed-message"
	allowedAttachmentID := scope + "-allowed-attachment"
	providerThreadID := scope + "-provider-thread"
	ensureInput.Message = domain.EmailMessageSnapshot{
		ID: allowedMessageID, ThreadID: providerThreadID, Subject: "Private attachment",
	}
	ensured, err := repo.EnsureCommunicationsEmailCollaboration(ensureInput)
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

	wrongThreadMessageID := scope + "-wrong-thread-message"
	client := &fakeNylasClient{
		messagesByID: map[string]NylasMessage{
			allowedMessageID: {
				ID: allowedMessageID, ThreadID: providerThreadID,
				Attachments: []NylasAttachment{{
					ID: allowedAttachmentID, Filename: "allowed.txt", ContentType: "text/plain",
				}},
			},
			wrongThreadMessageID: {
				ID: wrongThreadMessageID, ThreadID: scope + "-other-thread",
				Attachments: []NylasAttachment{{
					ID: scope + "-wrong-thread-attachment", Filename: "secret.txt", ContentType: "text/plain",
				}},
			},
		},
		downloadContent: []byte("participant-visible attachment"),
	}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: client,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
		DisableCommunicationsArchiveWorker: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)

	allowedPath := emailCollaborationAttachmentAuthPath(
		companyID, collaboration.CollaborationID, allowedMessageID, allowedAttachmentID,
	)
	participantResponse := serveEmailCollaborationAttachmentAuthRequest(
		server, allowedPath, participant, companyID, domain.RoleCompanyUser,
	)
	if participantResponse.Code != http.StatusOK || participantResponse.Body.String() != "participant-visible attachment" {
		t.Fatalf("participant download status=%d body=%q", participantResponse.Code, participantResponse.Body.String())
	}
	detailCalls, downloadGrantID, downloadMessageID, downloadAttachmentID := emailCollaborationAttachmentProviderCalls(client)
	if detailCalls != 1 || downloadGrantID != sourceGrantID ||
		downloadMessageID != allowedMessageID || downloadAttachmentID != allowedAttachmentID {
		t.Fatalf("participant provider calls detail=%d grant=%q message=%q attachment=%q",
			detailCalls, downloadGrantID, downloadMessageID, downloadAttachmentID)
	}

	// Company role elevation is not participation. The request must fail before
	// either a provider message read or an attachment download.
	outsiderResponse := serveEmailCollaborationAttachmentAuthRequest(
		server, allowedPath, outsider, companyID, domain.RoleCompanyAdmin,
	)
	if outsiderResponse.Code != http.StatusNotFound {
		t.Fatalf("nonparticipant admin status=%d, want 404 body=%s", outsiderResponse.Code, outsiderResponse.Body.String())
	}
	afterOutsiderDetailCalls, afterOutsiderGrantID, afterOutsiderMessageID, afterOutsiderAttachmentID := emailCollaborationAttachmentProviderCalls(client)
	if afterOutsiderDetailCalls != detailCalls || afterOutsiderGrantID != downloadGrantID ||
		afterOutsiderMessageID != downloadMessageID || afterOutsiderAttachmentID != downloadAttachmentID {
		t.Fatalf("nonparticipant reached provider: detail=%d grant=%q message=%q attachment=%q",
			afterOutsiderDetailCalls, afterOutsiderGrantID, afterOutsiderMessageID, afterOutsiderAttachmentID)
	}

	wrongThreadPath := emailCollaborationAttachmentAuthPath(
		companyID, collaboration.CollaborationID, wrongThreadMessageID, scope+"-wrong-thread-attachment",
	)
	wrongThreadResponse := serveEmailCollaborationAttachmentAuthRequest(
		server, wrongThreadPath, participant, companyID, domain.RoleCompanyUser,
	)
	if wrongThreadResponse.Code != http.StatusNotFound {
		t.Fatalf("wrong-thread status=%d, want 404 body=%s", wrongThreadResponse.Code, wrongThreadResponse.Body.String())
	}
	afterWrongThreadDetailCalls, _, afterWrongThreadMessageID, afterWrongThreadAttachmentID := emailCollaborationAttachmentProviderCalls(client)
	if afterWrongThreadDetailCalls != detailCalls+1 ||
		afterWrongThreadMessageID != allowedMessageID || afterWrongThreadAttachmentID != allowedAttachmentID {
		t.Fatalf("wrong-thread attachment reached provider download: detail=%d message=%q attachment=%q",
			afterWrongThreadDetailCalls, afterWrongThreadMessageID, afterWrongThreadAttachmentID)
	}

	wrongAttachmentPath := emailCollaborationAttachmentAuthPath(
		companyID, collaboration.CollaborationID, allowedMessageID, scope+"-missing-attachment",
	)
	wrongAttachmentResponse := serveEmailCollaborationAttachmentAuthRequest(
		server, wrongAttachmentPath, participant, companyID, domain.RoleCompanyUser,
	)
	if wrongAttachmentResponse.Code != http.StatusNotFound {
		t.Fatalf("wrong-attachment status=%d, want 404 body=%s", wrongAttachmentResponse.Code, wrongAttachmentResponse.Body.String())
	}
	finalDetailCalls, _, finalDownloadMessageID, finalDownloadAttachmentID := emailCollaborationAttachmentProviderCalls(client)
	// Message detail reads may be served by the short-lived provider cache; the
	// security boundary is that a missing attachment never reaches download.
	if (finalDetailCalls != afterWrongThreadDetailCalls && finalDetailCalls != afterWrongThreadDetailCalls+1) ||
		finalDownloadMessageID != allowedMessageID || finalDownloadAttachmentID != allowedAttachmentID {
		t.Fatalf("wrong attachment reached provider download: detail=%d message=%q attachment=%q",
			finalDetailCalls, finalDownloadMessageID, finalDownloadAttachmentID)
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
