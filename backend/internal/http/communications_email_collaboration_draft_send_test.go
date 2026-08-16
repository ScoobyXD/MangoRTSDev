package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestEmailCollaborationSharedDraftSendUsesExactDraftEnvelopeAndFinalizes(t *testing.T) {
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000311"
	repo.EnsureCompany(companyID, "Shared draft send")
	creator, err := repo.UpsertAuthUser("shared-send-creator", "owner@example.com", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(creator.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: creator.UserID, Provider: "google", AccountEmail: creator.Email,
		GrantID: "shared-send-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	ensured, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "shared-send-source", ThreadID: "shared-send-thread", Subject: "Snapshot subject", Date: 10,
			From: []domain.EmailAddressSnapshot{{Email: "stale-snapshot@example.com"}},
			To:   []domain.EmailAddressSnapshot{{Email: creator.Email}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	collaboration := ensured.Collaboration
	draft, err := repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "shared-send-draft", CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: creator.UserID, IsShared: true, ExpectedRevision: 0,
		CreatedByUserID: creator.UserID, UpdatedByUserID: creator.UserID,
		SourceMessageID: collaboration.RootMessageID, Subject: "Re: Snapshot subject",
		BodyEditorHTML: "<p>Collaborative answer</p>",
	})
	if err != nil {
		t.Fatal(err)
	}
	storage := newFakeAttachmentObjectStorage()
	attachmentID := seedEmailAttachmentForCommunicationsTest(
		t, repo, storage, creator.UserID, companyID, draft.DraftID, "shared-sent.txt", "text/plain", []byte("shared sent attachment"),
	)

	nylas := &fakeNylasClient{message: NylasMessage{
		ID: "shared-send-source", ThreadID: "shared-send-thread", Subject: "Provider subject", Date: 20,
		From: []NylasEmailAddress{{Name: "Provider sender", Email: "provider-sender@example.com"}},
		To:   []NylasEmailAddress{{Email: creator.Email}},
		Cc:   []NylasEmailAddress{{Email: "team@example.com"}},
	}, sendResponseAttachments: []NylasAttachment{
		{ID: "shared-provider-attachment", Filename: "shared-sent.txt"},
		{ID: "shared-provider-only", Filename: "provider-only.txt"},
	}}
	importedAttachmentID := store.ImportedEmailAttachmentID(
		companyID, collaboration.EmailThreadID, "sent-message", "shared-provider-attachment", "", "shared-sent.txt",
	)
	providerOnlyAttachmentID := store.ImportedEmailAttachmentID(
		companyID, collaboration.EmailThreadID, "sent-message", "shared-provider-only", "", "provider-only.txt",
	)
	nylas.onSend = func(NylasSendMessageRequest) {
		storage.objects["shared-worker-first-import"] = fakeAttachmentObject{contentType: "text/plain", body: []byte("worker")}
		storage.objects["shared-worker-first-provider-only"] = fakeAttachmentObject{contentType: "text/plain", body: []byte("provider only")}
		thread, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
			CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
			AccountEmail: creator.Email, Provider: "google", ProviderThreadID: "shared-send-thread", SelectedMessageID: "sent-message",
			Messages: []domain.EmailMessageSnapshot{{
				ID: "sent-message", ThreadID: "shared-send-thread", Subject: "Worker first", DownloadComplete: true,
				Attachments: []domain.EmailAttachmentSnapshot{
					{ID: "shared-provider-attachment", AttachmentID: importedAttachmentID, Filename: "shared-sent.txt"},
					{ID: "shared-provider-only", AttachmentID: providerOnlyAttachmentID, Filename: "provider-only.txt"},
				},
			}}, HistoryComplete: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		stored, ok := storedEmailMessageForProvider(thread, "sent-message")
		if !ok {
			t.Fatal("worker-completed shared sent message missing")
		}
		for _, imported := range []struct {
			attachmentID string
			filename     string
			storageKey   string
		}{
			{importedAttachmentID, "shared-sent.txt", "shared-worker-first-import"},
			{providerOnlyAttachmentID, "provider-only.txt", "shared-worker-first-provider-only"},
		} {
			if _, _, err := repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
				CompanyID: companyID, AttachmentID: imported.attachmentID, UploadedByUserID: creator.UserID,
				OriginalFilename: imported.filename, MimeType: "text/plain", ByteSize: 6,
				SHA256: strings.Repeat("1", 64), SHA256VerificationMethod: "server_stream",
				StorageBucket: storage.bucket, StorageKey: imported.storageKey, SourceKind: store.AttachmentSourceEmailIncoming,
				ResourceLink: store.ResourceAttachmentInput{
					CompanyID: companyID, ResourceType: "email_message", ResourceID: stored.EmailMessageID,
					RelationshipKind: store.AttachmentRelationshipEmailAttachment, CreatedByUserID: creator.UserID,
				},
			}); err != nil {
				t.Fatal(err)
			}
		}
	}
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: nylas, AttachmentStorage: storage,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	path := "/v1/communications/email-collaborations/" + collaboration.CollaborationID +
		"/drafts/" + draft.DraftID + "/send?company_id=" + companyID

	performSend := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{\"expected_revision\":1}"))
		req = attachmentRequestWithActor(req, creator, companyID, domain.RoleCompanyUser)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		return rec
	}
	staleRequest := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{\"expected_revision\":2}"))
	staleRequest = attachmentRequestWithActor(staleRequest, creator, companyID, domain.RoleCompanyUser)
	staleRecorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(staleRecorder, staleRequest)
	if staleRecorder.Code != http.StatusConflict {
		t.Fatalf("stale send status=%d body=%s", staleRecorder.Code, staleRecorder.Body.String())
	}
	var conflictPayload struct {
		Error           string                           `json:"error"`
		CurrentRevision int64                            `json:"current_revision"`
		Draft           communicationsEmailDraftResponse `json:"draft"`
	}
	if err := json.Unmarshal(staleRecorder.Body.Bytes(), &conflictPayload); err != nil {
		t.Fatal(err)
	}
	if conflictPayload.Error != "email_draft_revision_conflict" || conflictPayload.CurrentRevision != 1 ||
		conflictPayload.Draft.DraftID != draft.DraftID || conflictPayload.Draft.Revision != 1 {
		t.Fatalf("stale conflict payload=%+v", conflictPayload)
	}

	first := performSend()
	if first.Code != http.StatusCreated {
		t.Fatalf("send status=%d body=%s", first.Code, first.Body.String())
	}

	nylas.mu.Lock()
	sendCalls := nylas.sendCalls
	sent := nylas.sent
	grantID := nylas.lastSendGrantID
	nylas.mu.Unlock()
	if sendCalls != 1 || grantID != "shared-send-grant" {
		t.Fatalf("provider send calls=%d grant=%q", sendCalls, grantID)
	}
	if sent.ReplyToMessageID != "shared-send-source" || sent.IdempotencyKey == "" {
		t.Fatalf("provider send identity = %+v", sent)
	}
	if !nylasAddressesContain(sent.To, "stale-snapshot@example.com") ||
		nylasAddressesContain(sent.To, "provider-sender@example.com") ||
		nylasAddressesContain(sent.To, creator.Email) ||
		nylasAddressesContain(sent.Cc, "team@example.com") ||
		len(sent.Bcc) != 0 {
		t.Fatalf("exact shared-draft envelope to=%+v cc=%+v bcc=%+v", sent.To, sent.Cc, sent.Bcc)
	}
	if _, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: creator.UserID,
	}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("finalized draft error=%v, want ErrNotFound", err)
	}
	thread, err := repo.GetCommunicationsEmailThreadContext(context.Background(), companyID, collaboration.EmailThreadID)
	if err != nil {
		t.Fatal(err)
	}
	storedSent, ok := storedEmailMessageForProvider(thread, "sent-message")
	if !ok || !storedSent.Message.DownloadComplete || len(storedSent.Message.Attachments) != 2 {
		t.Fatalf("stored shared sent message=%+v present=%v", storedSent, ok)
	}
	storedAttachmentIDs := map[string]string{}
	for _, attachment := range storedSent.Message.Attachments {
		storedAttachmentIDs[attachment.ID] = attachment.AttachmentID
	}
	if storedAttachmentIDs["shared-provider-attachment"] != attachmentID ||
		storedAttachmentIDs["shared-provider-only"] != providerOnlyAttachmentID {
		t.Fatalf("stored shared sent attachment metadata=%v", storedAttachmentIDs)
	}
	sentLinks, err := repo.ListResourceAttachments(companyID, "email_message", storedSent.EmailMessageID)
	linkedAttachmentIDs := map[string]bool{}
	for _, link := range sentLinks {
		linkedAttachmentIDs[link.AttachmentID] = true
	}
	if err != nil || len(sentLinks) != 2 || !linkedAttachmentIDs[attachmentID] ||
		!linkedAttachmentIDs[providerOnlyAttachmentID] || linkedAttachmentIDs[importedAttachmentID] {
		t.Fatalf("stored shared sent attachment links=%+v err=%v", sentLinks, err)
	}
	if _, err := repo.GetAttachment(companyID, importedAttachmentID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("worker-imported shared attachment still live: %v", err)
	}
	if _, err := repo.GetAttachment(companyID, providerOnlyAttachmentID); err != nil {
		t.Fatalf("provider-only shared attachment was removed: %v", err)
	}

	retry := performSend()
	if retry.Code != http.StatusNotFound {
		t.Fatalf("completed send retry status=%d body=%s", retry.Code, retry.Body.String())
	}
	nylas.mu.Lock()
	sendCalls = nylas.sendCalls
	nylas.mu.Unlock()
	if sendCalls != 1 {
		t.Fatalf("completed send retry provider calls=%d, want 1", sendCalls)
	}
}

func TestSharedDraftWithoutNodeIsRejected(t *testing.T) {
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000399"
	repo.EnsureCompany(companyID, "Universal draft without Node")
	owner, err := repo.UpsertAuthUser("universal-no-node-owner", "no-node@example.com", "No Node Owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(owner.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		GrantID: "universal-no-node-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	source := domain.EmailMessageSnapshot{
		ID: "universal-no-node-source", ThreadID: "universal-no-node-thread", Subject: "Question", DownloadComplete: true,
		From: []domain.EmailAddressSnapshot{{Email: "customer@example.com"}}, To: []domain.EmailAddressSnapshot{{Email: owner.Email}},
	}
	thread, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", ProviderThreadID: source.ThreadID,
		SelectedMessageID: source.ID, Messages: []domain.EmailMessageSnapshot{source}, HistoryComplete: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	storedSource := thread.Messages[0].Message
	storedSource.EmailMessageID = thread.Messages[0].EmailMessageID
	replyJSON, err := json.Marshal(storedSource)
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "universal-no-node-draft",
		PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email, ParticipantUserID: owner.UserID,
		IsShared: true, CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID,
		Kind: "reply", SourceMessageID: thread.Messages[0].EmailMessageID, AccountEmail: owner.Email,
		ToRecipients: "customer@example.com", Subject: "Re: Question", BodyEditorHTML: "<p>Answer</p>",
		ReplyToMessageJSON: string(replyJSON),
	})
	if !errors.Is(err, store.ErrInvalid) {
		t.Fatalf("shared draft without Node error=%v, want ErrInvalid", err)
	}
	if nodes, err := repo.ListNodes(companyID); err != nil || len(nodes) != 0 {
		t.Fatalf("rejected shared draft invented Nodes=%+v err=%v", nodes, err)
	}
}

func nylasAddressesContain(items []NylasEmailAddress, email string) bool {
	for _, item := range items {
		if normalizeEmailForCompare(item.Email) == normalizeEmailForCompare(email) {
			return true
		}
	}
	return false
}

type recoveryClockEmailDraftRepository struct {
	store.Repository
	mu               sync.Mutex
	now              time.Time
	completeFailures int
}

func (r *recoveryClockEmailDraftRepository) ClaimCommunicationsEmailDraftSend(input store.CommunicationsEmailDraftSendClaimInput) (store.CommunicationsEmailDraftSendClaim, error) {
	r.mu.Lock()
	input.Now = r.now
	r.mu.Unlock()
	return r.Repository.ClaimCommunicationsEmailDraftSend(input)
}

func (r *recoveryClockEmailDraftRepository) SoftDeleteCommunicationsEmailDraft(input store.CommunicationsEmailDraftDeleteInput) error {
	r.mu.Lock()
	input.Now = r.now
	r.mu.Unlock()
	return r.Repository.SoftDeleteCommunicationsEmailDraft(input)
}

func (r *recoveryClockEmailDraftRepository) CompleteCommunicationsEmailDraftSend(input store.CommunicationsEmailDraftSendCompleteInput) error {
	r.mu.Lock()
	if r.completeFailures > 0 {
		r.completeFailures--
		r.mu.Unlock()
		return errors.New("forced finalize failure")
	}
	r.mu.Unlock()
	return r.Repository.CompleteCommunicationsEmailDraftSend(input)
}

func (r *recoveryClockEmailDraftRepository) setNow(now time.Time) {
	r.mu.Lock()
	r.now = now
	r.mu.Unlock()
}

func TestEmailCollaborationSharedDraftSendRecoversDurableCompletionFailureWithSameKey(t *testing.T) {
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000312"
	repo.EnsureCompany(companyID, "Shared draft finalize failure")
	creator, err := repo.UpsertAuthUser("shared-send-finalize-owner", "owner-finalize@example.com", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(creator.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: creator.UserID, Provider: "google", AccountEmail: creator.Email,
		GrantID: "shared-send-finalize-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	ensured, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "shared-send-finalize-source", ThreadID: "shared-send-finalize-thread", Date: 10,
			From: []domain.EmailAddressSnapshot{{Email: "customer@example.com"}},
			To:   []domain.EmailAddressSnapshot{{Email: creator.Email}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	collaboration := ensured.Collaboration
	draft, err := repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "shared-send-finalize-draft", CollaborationID: collaboration.CollaborationID,
		ParticipantUserID: creator.UserID, IsShared: true, ExpectedRevision: 0,
		CreatedByUserID: creator.UserID, UpdatedByUserID: creator.UserID,
		SourceMessageID: collaboration.RootMessageID, Subject: "Reply", BodyEditorHTML: "<p>Sent once</p>",
	})
	if err != nil {
		t.Fatal(err)
	}
	var idempotencyKeys []string
	nylas := &fakeNylasClient{message: NylasMessage{
		ID: "shared-send-finalize-source", ThreadID: "shared-send-finalize-thread", Date: 20,
		From: []NylasEmailAddress{{Email: "customer@example.com"}},
		To:   []NylasEmailAddress{{Email: creator.Email}},
	}}
	nylas.onSend = func(request NylasSendMessageRequest) {
		idempotencyKeys = append(idempotencyKeys, request.IdempotencyKey)
	}
	baseNow := time.Date(2026, 7, 13, 22, 0, 0, 0, time.UTC)
	recoveryRepo := &recoveryClockEmailDraftRepository{Repository: repo, now: baseNow, completeFailures: 1}
	server := NewServerWithOptions(recoveryRepo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: nylas,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	path := "/v1/communications/email-collaborations/" + collaboration.CollaborationID +
		"/drafts/" + draft.DraftID + "/send?company_id=" + companyID
	performSend := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{\"expected_revision\":1}"))
		req = attachmentRequestWithActor(req, creator, companyID, domain.RoleCompanyUser)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		return rec
	}

	first := performSend()
	if first.Code != http.StatusInternalServerError {
		t.Fatalf("forced finalize failure status=%d body=%s", first.Code, first.Body.String())
	}
	stuck, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: creator.UserID,
	})
	if err != nil || stuck.SendState != "sending" {
		t.Fatalf("draft after provider success and finalize failure = %+v err=%v", stuck, err)
	}
	second := performSend()
	if second.Code != http.StatusConflict {
		t.Fatalf("retry after provider success status=%d body=%s", second.Code, second.Body.String())
	}
	nylas.mu.Lock()
	sendCalls := nylas.sendCalls
	nylas.mu.Unlock()
	if sendCalls != 1 {
		t.Fatalf("retry after provider success calls=%d, want 1", sendCalls)
	}
	recoveryRepo.setNow(baseNow.Add(store.CommunicationsEmailDraftSendClaimLease))
	recovered := performSend()
	if recovered.Code != http.StatusCreated {
		t.Fatalf("recovered completion status=%d body=%s", recovered.Code, recovered.Body.String())
	}
	nylas.mu.Lock()
	sendCalls = nylas.sendCalls
	nylas.mu.Unlock()
	if sendCalls != 2 || len(idempotencyKeys) != 2 || idempotencyKeys[0] == "" || idempotencyKeys[1] != idempotencyKeys[0] {
		t.Fatalf("recovered provider replay calls=%d keys=%v", sendCalls, idempotencyKeys)
	}
	if _, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: creator.UserID,
	}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("recovered completion draft error=%v, want ErrNotFound", err)
	}
}

type sequencedSendNylasClient struct {
	NylasClient
	mu       sync.Mutex
	results  []NylasMessage
	errors   []error
	requests []NylasSendMessageRequest
}

func (c *sequencedSendNylasClient) SendMessage(_ context.Context, _ string, request NylasSendMessageRequest) (NylasMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.requests = append(c.requests, request)
	index := len(c.requests) - 1
	if index < len(c.errors) && c.errors[index] != nil {
		return NylasMessage{}, c.errors[index]
	}
	if len(c.results) == 0 {
		return NylasMessage{}, nil
	}
	if index >= len(c.results) {
		index = len(c.results) - 1
	}
	return c.results[index], nil
}

func TestEmailCollaborationSharedDraftSendErrorRecoveryChoosesKeyByProviderCertainty(t *testing.T) {
	tests := []struct {
		name        string
		companyID   string
		firstError  error
		firstStatus int
		advance     time.Duration
		wantSameKey bool
	}{
		{
			name: "ambiguous transport keeps claim and key", companyID: "11111111-1111-4111-8111-701300000315",
			firstError: errors.New("connection reset after request write"), firstStatus: http.StatusBadGateway,
			advance: store.CommunicationsEmailDraftSendClaimLease, wantSameKey: true,
		},
		{
			name: "definitive provider rejection releases and replaces key", companyID: "11111111-1111-4111-8111-701300000316",
			firstError: NylasAPIError{StatusCode: http.StatusBadRequest, Code: "invalid_request"}, firstStatus: http.StatusBadGateway,
			advance: 0, wantSameKey: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo, owner, collaboration, draft, baseNylas := seedEmailCollaborationSharedDraftRecoveryHTTPTest(t, tt.companyID, strings.ReplaceAll(tt.name, " ", "-"))
			nylas := &sequencedSendNylasClient{
				NylasClient: baseNylas,
				errors:      []error{tt.firstError, nil},
				results: []NylasMessage{
					{},
					{ID: "shared-send-error-recovered", ThreadID: collaboration.ProviderThreadID},
				},
			}
			baseNow := time.Date(2026, 7, 14, 1, 0, 0, 0, time.UTC)
			recoveryRepo := &recoveryClockEmailDraftRepository{Repository: repo, now: baseNow}
			server := NewServerWithOptions(recoveryRepo, ServerOptions{
				NylasConfig: testNylasConfig(), NylasClient: nylas,
				DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
			})
			defer server.Close()
			server.nylasGate = newNylasRequestGate(0)
			path := "/v1/communications/email-collaborations/" + collaboration.CollaborationID +
				"/drafts/" + draft.DraftID + "/send?company_id=" + tt.companyID
			performSend := func() *httptest.ResponseRecorder {
				req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{\"expected_revision\":1}"))
				req = attachmentRequestWithActor(req, owner, tt.companyID, domain.RoleCompanyUser)
				rec := httptest.NewRecorder()
				server.Routes().ServeHTTP(rec, req)
				return rec
			}
			first := performSend()
			if first.Code != tt.firstStatus {
				t.Fatalf("first status=%d body=%s", first.Code, first.Body.String())
			}
			if tt.wantSameKey {
				active := performSend()
				if active.Code != http.StatusConflict {
					t.Fatalf("active ambiguous retry status=%d body=%s", active.Code, active.Body.String())
				}
			}
			recoveryRepo.setNow(baseNow.Add(tt.advance))
			recovered := performSend()
			if recovered.Code != http.StatusCreated {
				t.Fatalf("recovered status=%d body=%s", recovered.Code, recovered.Body.String())
			}
			nylas.mu.Lock()
			requests := append([]NylasSendMessageRequest(nil), nylas.requests...)
			nylas.mu.Unlock()
			if len(requests) != 2 || requests[0].IdempotencyKey == "" {
				t.Fatalf("provider requests=%+v", requests)
			}
			if gotSame := requests[1].IdempotencyKey == requests[0].IdempotencyKey; gotSame != tt.wantSameKey {
				t.Fatalf("provider keys=%q/%q same=%t, want same=%t", requests[0].IdempotencyKey, requests[1].IdempotencyKey, gotSame, tt.wantSameKey)
			}
		})
	}
}

func seedEmailCollaborationSharedDraftRecoveryHTTPTest(t *testing.T, companyID, suffix string) (*store.MemoryRepo, domain.User, domain.CommunicationsEmailCollaboration, domain.CommunicationsEmailDraft, *fakeNylasClient) {
	t.Helper()
	repo := store.NewMemoryRepo()
	repo.EnsureCompany(companyID, "Shared draft recovery "+suffix)
	owner, err := repo.UpsertAuthUser("shared-send-recovery-"+suffix, "owner-"+suffix+"@example.com", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(owner.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		GrantID: "shared-send-recovery-grant-" + suffix, Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	sourceID := "shared-send-recovery-source-" + suffix
	threadID := "shared-send-recovery-thread-" + suffix
	ensured, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: sourceID, ThreadID: threadID, Date: 10,
			From: []domain.EmailAddressSnapshot{{Email: "customer@example.com"}},
			To:   []domain.EmailAddressSnapshot{{Email: owner.Email}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "shared-send-recovery-draft-" + suffix,
		CollaborationID: ensured.Collaboration.CollaborationID, ParticipantUserID: owner.UserID,
		IsShared: true, CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID,
		SourceMessageID: ensured.Collaboration.RootMessageID, Subject: "Reply once", BodyEditorHTML: "<p>Recover me</p>",
	})
	if err != nil {
		t.Fatal(err)
	}
	baseNylas := &fakeNylasClient{message: NylasMessage{
		ID: sourceID, ThreadID: threadID, Date: 20,
		From: []NylasEmailAddress{{Email: "customer@example.com"}},
		To:   []NylasEmailAddress{{Email: owner.Email}},
	}}
	return repo, owner, ensured.Collaboration, draft, baseNylas
}

func TestEmailCollaborationSharedDraftSendRecoversMissingProviderMessageIDWithSameKey(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-701300000313"
	repo, owner, collaboration, draft, baseNylas := seedEmailCollaborationSharedDraftRecoveryHTTPTest(t, companyID, "missing-id")
	nylas := &sequencedSendNylasClient{
		NylasClient: baseNylas,
		results: []NylasMessage{
			{},
			{ID: "shared-send-recovered-message", ThreadID: collaboration.ProviderThreadID},
		},
	}
	baseNow := time.Date(2026, 7, 13, 23, 0, 0, 0, time.UTC)
	recoveryRepo := &recoveryClockEmailDraftRepository{Repository: repo, now: baseNow}
	server := NewServerWithOptions(recoveryRepo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: nylas,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	path := "/v1/communications/email-collaborations/" + collaboration.CollaborationID +
		"/drafts/" + draft.DraftID + "/send?company_id=" + companyID
	performSend := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{\"expected_revision\":1}"))
		req = attachmentRequestWithActor(req, owner, companyID, domain.RoleCompanyUser)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		return rec
	}

	first := performSend()
	if first.Code != http.StatusBadGateway {
		t.Fatalf("missing-id send status=%d body=%s", first.Code, first.Body.String())
	}
	active := performSend()
	if active.Code != http.StatusConflict {
		t.Fatalf("active recovery status=%d body=%s", active.Code, active.Body.String())
	}
	recoveryRepo.setNow(baseNow.Add(store.CommunicationsEmailDraftSendClaimLease))
	recovered := performSend()
	if recovered.Code != http.StatusCreated {
		t.Fatalf("missing-id recovery status=%d body=%s", recovered.Code, recovered.Body.String())
	}
	nylas.mu.Lock()
	requests := append([]NylasSendMessageRequest(nil), nylas.requests...)
	nylas.mu.Unlock()
	if len(requests) != 2 || requests[0].IdempotencyKey == "" || requests[1].IdempotencyKey != requests[0].IdempotencyKey {
		t.Fatalf("missing-id recovery requests=%+v", requests)
	}
	if _, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("recovered missing-id draft error=%v, want ErrNotFound", err)
	}
}

func TestEmailCollaborationSharedDraftFreshPreflightFailureReleasesClaim(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-701300000319"
	repo, owner, collaboration, draft, nylas := seedEmailCollaborationSharedDraftRecoveryHTTPTest(t, companyID, "fresh-preflight")
	nylas.message.ID = "provider-returned-a-different-message"
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: nylas,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	path := "/v1/communications/email-collaborations/" + collaboration.CollaborationID +
		"/drafts/" + draft.DraftID + "/send?company_id=" + companyID
	req := attachmentRequestWithActor(
		httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{\"expected_revision\":1}")),
		owner, companyID, domain.RoleCompanyUser,
	)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("fresh preflight mismatch status=%d body=%s", rec.Code, rec.Body.String())
	}
	current, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	})
	if err != nil || current.SendState != "draft" || current.SendClaimToken != "" ||
		current.SendIdempotencyKey != "" || current.SendIdempotencyGrantID != "" ||
		current.SendIdempotencyTimestamp != nil || current.SendClaimedTimestamp != nil {
		t.Fatalf("fresh preflight failure did not release claim: draft=%+v err=%v", current, err)
	}
	nylas.mu.Lock()
	sendCalls := nylas.sendCalls
	nylas.mu.Unlock()
	if sendCalls != 0 {
		t.Fatalf("fresh preflight mismatch provider send calls=%d, want 0", sendCalls)
	}
}

func TestEmailCollaborationSharedDraftRecoveredPreflightFailurePreservesUncertainClaim(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-701300000320"
	repo, owner, collaboration, draft, baseNylas := seedEmailCollaborationSharedDraftRecoveryHTTPTest(t, companyID, "recovered-preflight")
	nylas := &sequencedSendNylasClient{NylasClient: baseNylas, results: []NylasMessage{{}}}
	baseNow := time.Date(2026, 7, 14, 4, 0, 0, 0, time.UTC)
	recoveryRepo := &recoveryClockEmailDraftRepository{Repository: repo, now: baseNow}
	server := NewServerWithOptions(recoveryRepo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: nylas,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	path := "/v1/communications/email-collaborations/" + collaboration.CollaborationID +
		"/drafts/" + draft.DraftID + "/send?company_id=" + companyID
	performSend := func() *httptest.ResponseRecorder {
		req := attachmentRequestWithActor(
			httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{\"expected_revision\":1}")),
			owner, companyID, domain.RoleCompanyUser,
		)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		return rec
	}
	if first := performSend(); first.Code != http.StatusBadGateway {
		t.Fatalf("initial uncertain send status=%d body=%s", first.Code, first.Body.String())
	}
	uncertain, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	})
	if err != nil || uncertain.SendState != "sending" || uncertain.SendIdempotencyKey == "" ||
		uncertain.SendIdempotencyGrantID == "" || uncertain.SendIdempotencyTimestamp == nil {
		t.Fatalf("initial uncertain claim=%+v err=%v", uncertain, err)
	}
	baseNylas.mu.Lock()
	baseNylas.message.ID = "provider-returned-a-different-message"
	baseNylas.mu.Unlock()
	recoveryRepo.setNow(baseNow.Add(store.CommunicationsEmailDraftSendClaimLease))
	if recovered := performSend(); recovered.Code != http.StatusConflict {
		t.Fatalf("recovered preflight mismatch status=%d body=%s", recovered.Code, recovered.Body.String())
	}
	preserved, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	})
	if err != nil || preserved.SendState != "sending" ||
		preserved.SendIdempotencyKey != uncertain.SendIdempotencyKey ||
		preserved.SendIdempotencyGrantID != uncertain.SendIdempotencyGrantID ||
		preserved.SendIdempotencyTimestamp == nil ||
		!preserved.SendIdempotencyTimestamp.Equal(*uncertain.SendIdempotencyTimestamp) {
		t.Fatalf("recovered preflight failure changed uncertain identity: before=%+v after=%+v err=%v", uncertain, preserved, err)
	}
	nylas.mu.Lock()
	providerRequests := len(nylas.requests)
	nylas.mu.Unlock()
	if providerRequests != 1 {
		t.Fatalf("recovered preflight mismatch provider sends=%d, want original 1 only", providerRequests)
	}
}

func TestCommunicationsEmailDraftRecoveredSendWindowExhausted(t *testing.T) {
	origin := time.Date(2026, 7, 14, 5, 0, 0, 0, time.UTC)
	fresh := store.CommunicationsEmailDraftSendClaim{
		Draft: domain.CommunicationsEmailDraft{SendIdempotencyTimestamp: &origin},
	}
	if communicationsEmailDraftRecoveredSendWindowExhausted(
		fresh, origin.Add(store.CommunicationsEmailDraftSendRecoveryWindow),
	) {
		t.Fatal("fresh claim must not be constrained by a recovered-send deadline")
	}
	recovered := fresh
	recovered.Recovered = true
	justBeforeMargin := origin.Add(store.CommunicationsEmailDraftSendRecoveryWindow - communicationsEmailDraftRecoveredSendSafetyMargin - time.Nanosecond)
	if communicationsEmailDraftRecoveredSendWindowExhausted(recovered, justBeforeMargin) {
		t.Fatal("recovered claim was blocked before the outbound safety margin")
	}
	atMargin := justBeforeMargin.Add(time.Nanosecond)
	if !communicationsEmailDraftRecoveredSendWindowExhausted(recovered, atMargin) {
		t.Fatal("recovered claim was not blocked at the outbound safety margin")
	}
	recovered.Draft.SendIdempotencyTimestamp = nil
	recovered.Draft.SendClaimedTimestamp = nil
	if !communicationsEmailDraftRecoveredSendWindowExhausted(recovered, origin) {
		t.Fatal("recovered claim without a durable origin must be blocked")
	}
}

func TestEmailCollaborationSharedDraftRecoveredDispatchMarginBlocksProviderReplay(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-701300000321"
	repo, owner, collaboration, draft, baseNylas := seedEmailCollaborationSharedDraftRecoveryHTTPTest(t, companyID, "dispatch-margin")
	nylas := &sequencedSendNylasClient{NylasClient: baseNylas, results: []NylasMessage{{}}}
	firstNow := time.Date(2026, 7, 14, 6, 0, 0, 0, time.UTC)
	recoveryRepo := &recoveryClockEmailDraftRepository{Repository: repo, now: firstNow}
	server := NewServerWithOptions(recoveryRepo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: nylas,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	path := "/v1/communications/email-collaborations/" + collaboration.CollaborationID +
		"/drafts/" + draft.DraftID + "/send?company_id=" + companyID
	performSend := func() *httptest.ResponseRecorder {
		req := attachmentRequestWithActor(
			httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{\"expected_revision\":1}")),
			owner, companyID, domain.RoleCompanyUser,
		)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		return rec
	}
	if first := performSend(); first.Code != http.StatusBadGateway {
		t.Fatalf("first claim near old clock status=%d body=%s", first.Code, first.Body.String())
	}
	before, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	recoveryRepo.setNow(firstNow.Add(store.CommunicationsEmailDraftSendRecoveryWindow - communicationsEmailDraftRecoveredSendSafetyMargin))
	blocked := performSend()
	if blocked.Code != http.StatusConflict || !strings.Contains(blocked.Body.String(), "email_draft_send_recovery_window_expired") {
		t.Fatalf("dispatch-margin recovery status=%d body=%s", blocked.Code, blocked.Body.String())
	}
	var blockedPayload struct {
		CanDiscard bool `json:"can_discard"`
	}
	if err := json.Unmarshal(blocked.Body.Bytes(), &blockedPayload); err != nil {
		t.Fatal(err)
	}
	if blockedPayload.CanDiscard {
		t.Fatalf("dispatch-margin response allowed discard during renewed lease: %s", blocked.Body.String())
	}
	after, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	})
	if err != nil || after.SendState != "sending" || after.SendIdempotencyKey != before.SendIdempotencyKey ||
		after.SendIdempotencyGrantID != before.SendIdempotencyGrantID || after.SendIdempotencyTimestamp == nil ||
		before.SendIdempotencyTimestamp == nil || !after.SendIdempotencyTimestamp.Equal(*before.SendIdempotencyTimestamp) {
		t.Fatalf("dispatch-margin block changed uncertain identity: before=%+v after=%+v err=%v", before, after, err)
	}
	nylas.mu.Lock()
	providerRequests := len(nylas.requests)
	nylas.mu.Unlock()
	if providerRequests != 1 {
		t.Fatalf("dispatch-margin provider sends=%d, want original 1 only", providerRequests)
	}
}

func TestEmailCollaborationSharedDraftExpiredRecoveryReturnsCanonicalDiscardGuidance(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-701300000314"
	repo, owner, collaboration, draft, baseNylas := seedEmailCollaborationSharedDraftRecoveryHTTPTest(t, companyID, "expired")
	nylas := &sequencedSendNylasClient{NylasClient: baseNylas, results: []NylasMessage{{}}}
	baseNow := time.Date(2026, 7, 14, 0, 0, 0, 0, time.UTC)
	recoveryRepo := &recoveryClockEmailDraftRepository{Repository: repo, now: baseNow}
	server := NewServerWithOptions(recoveryRepo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: nylas,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	sendPath := "/v1/communications/email-collaborations/" + collaboration.CollaborationID +
		"/drafts/" + draft.DraftID + "/send?company_id=" + companyID
	performSend := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, sendPath, bytes.NewBufferString("{\"expected_revision\":1}"))
		req = attachmentRequestWithActor(req, owner, companyID, domain.RoleCompanyUser)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		return rec
	}
	if first := performSend(); first.Code != http.StatusBadGateway {
		t.Fatalf("initial missing-id status=%d body=%s", first.Code, first.Body.String())
	}
	recoveryRepo.setNow(baseNow.Add(store.CommunicationsEmailDraftSendRecoveryWindow))
	expired := performSend()
	if expired.Code != http.StatusConflict {
		t.Fatalf("expired recovery status=%d body=%s", expired.Code, expired.Body.String())
	}
	var payload struct {
		Error           string                           `json:"error"`
		CurrentRevision int64                            `json:"current_revision"`
		CanDiscard      bool                             `json:"can_discard"`
		RecoveryAction  string                           `json:"recovery_action"`
		Draft           communicationsEmailDraftResponse `json:"draft"`
	}
	if err := json.Unmarshal(expired.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error != "email_draft_send_recovery_window_expired" || payload.CurrentRevision != draft.Revision ||
		!payload.CanDiscard || payload.RecoveryAction != "inspect_thread_then_discard" || payload.Draft.DraftID != draft.DraftID {
		t.Fatalf("expired recovery payload=%+v", payload)
	}
	nylas.mu.Lock()
	providerCalls := len(nylas.requests)
	nylas.mu.Unlock()
	if providerCalls != 1 {
		t.Fatalf("expired recovery provider calls=%d, want 1", providerCalls)
	}

	discardPath := "/v1/communications/drafts/" + draft.DraftID + "?company_id=" + companyID + "&revision=1"
	discardRequest := httptest.NewRequest(http.MethodDelete, discardPath, nil)
	discardRequest = attachmentRequestWithActor(discardRequest, owner, companyID, domain.RoleCompanyUser)
	discardRecorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(discardRecorder, discardRequest)
	if discardRecorder.Code != http.StatusOK {
		t.Fatalf("expired recovery discard status=%d body=%s", discardRecorder.Code, discardRecorder.Body.String())
	}
	if _, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draft.DraftID, ParticipantUserID: owner.UserID,
	}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("expired discarded draft error=%v, want ErrNotFound", err)
	}
}

func TestEmailCollaborationSharedDraftRecoveryRejectsChangedGrantWithoutProviderRetry(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-701300000318"
	repo, owner, collaboration, draft, baseNylas := seedEmailCollaborationSharedDraftRecoveryHTTPTest(t, companyID, "changed-grant")
	nylas := &sequencedSendNylasClient{NylasClient: baseNylas, results: []NylasMessage{{}}}
	baseNow := time.Date(2026, 7, 14, 3, 0, 0, 0, time.UTC)
	recoveryRepo := &recoveryClockEmailDraftRepository{Repository: repo, now: baseNow}
	server := NewServerWithOptions(recoveryRepo, ServerOptions{
		NylasConfig: testNylasConfig(), NylasClient: nylas,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	sendPath := "/v1/communications/email-collaborations/" + collaboration.CollaborationID +
		"/drafts/" + draft.DraftID + "/send?company_id=" + companyID
	performSend := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, sendPath, bytes.NewBufferString("{\"expected_revision\":1}"))
		req = attachmentRequestWithActor(req, owner, companyID, domain.RoleCompanyUser)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		return rec
	}
	if first := performSend(); first.Code != http.StatusBadGateway {
		t.Fatalf("initial changed-grant setup status=%d body=%s", first.Code, first.Body.String())
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		GrantID: "replacement-grant", Status: "connected",
	}); err != nil {
		t.Fatalf("replace source grant: %v", err)
	}
	recoveryRepo.setNow(baseNow.Add(store.CommunicationsEmailDraftSendClaimLease))
	changed := performSend()
	if changed.Code != http.StatusConflict {
		t.Fatalf("changed-grant recovery status=%d body=%s", changed.Code, changed.Body.String())
	}
	var payload struct {
		Error          string                           `json:"error"`
		CanDiscard     bool                             `json:"can_discard"`
		RecoveryAction string                           `json:"recovery_action"`
		Draft          communicationsEmailDraftResponse `json:"draft"`
	}
	if err := json.Unmarshal(changed.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error != "email_draft_send_recovery_source_changed" || !payload.CanDiscard ||
		payload.RecoveryAction != "inspect_thread_then_discard" || payload.Draft.DraftID != draft.DraftID {
		t.Fatalf("changed-grant recovery payload=%+v", payload)
	}
	nylas.mu.Lock()
	providerCalls := len(nylas.requests)
	nylas.mu.Unlock()
	if providerCalls != 1 {
		t.Fatalf("changed-grant provider calls=%d, want 1", providerCalls)
	}

	// Discard is a local, revision-checked operation. Losing the source
	// connection after the conflict must not make the inactive claim permanent.
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: owner.UserID, Provider: "google", AccountEmail: owner.Email,
		GrantID: "replacement-grant", Status: "reauth_required",
	}); err != nil {
		t.Fatalf("disconnect replacement grant: %v", err)
	}
	discardPath := "/v1/communications/drafts/" + draft.DraftID + "?company_id=" + companyID + "&revision=1"
	discardRequest := attachmentRequestWithActor(httptest.NewRequest(http.MethodDelete, discardPath, nil), owner, companyID, domain.RoleCompanyUser)
	discardRecorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(discardRecorder, discardRequest)
	if discardRecorder.Code != http.StatusOK {
		t.Fatalf("disconnected-source discard status=%d body=%s", discardRecorder.Code, discardRecorder.Body.String())
	}
}
