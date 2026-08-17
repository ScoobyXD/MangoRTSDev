package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/emailqueue"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeNylasClient struct {
	mu                          sync.Mutex
	grant                       NylasGrant
	deletedGrants               []string
	folders                     []NylasFolder
	messages                    []NylasMessage
	messagesByGrantID           map[string][]NylasMessage
	messagePagesByToken         map[string]NylasMessagePage
	messageQueries              []NylasMessageQuery
	messagesByID                map[string]NylasMessage
	thread                      NylasThread
	message                     NylasMessage
	sent                        NylasSendMessageRequest
	sentAttachmentBodies        [][]byte
	sendCalls                   int
	skipOutboundAttachmentReads bool
	onSend                      func(NylasSendMessageRequest)
	update                      NylasMessageUpdate
	updateCalls                 []fakeNylasUpdateCall
	updateErrByID               map[string]error
	downloadContent             []byte
	downloadErr                 error
	rawMIME                     string
	rawMIMEErr                  error
	lastQuery                   NylasMessageQuery
	lastMessageGrantID          string
	lastDetailGrantID           string
	lastRawMIMEGrantID          string
	lastRawMIMEMessageID        string
	lastDownloadGrantID         string
	lastDownloadMessageID       string
	lastDownloadAttachmentID    string
	lastFolderGrantID           string
	lastSendGrantID             string
	folderCalls                 int
	messageCalls                int
	detailCalls                 int
	listErr                     error
	exchangeErr                 error
}

type fakeNylasUpdateCall struct {
	GrantID   string
	MessageID string
	Update    NylasMessageUpdate
}

func TestWriteNylasErrorIgnoresCanceledClientRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1/attachments/attachment-1", nil).WithContext(ctx)
	cancel()
	recorder := httptest.NewRecorder()

	(&Server{}).writeNylasError(recorder, req, domain.UserEmailConnection{
		UserID: "user-1", Provider: "google",
	}, context.Canceled)

	if recorder.Body.Len() != 0 {
		t.Fatalf("canceled request response body = %q, want no proxy error response", recorder.Body.String())
	}
	if contentType := recorder.Header().Get("Content-Type"); contentType != "" {
		t.Fatalf("canceled request content type = %q, want no response write", contentType)
	}
}

type blockingWebhookGrantRepo struct {
	store.Repository
	started  chan struct{}
	canceled chan struct{}
}

func (r *blockingWebhookGrantRepo) GetUserEmailConnectionByGrantIDContext(ctx context.Context, _ string) (domain.UserEmailConnection, error) {
	close(r.started)
	<-ctx.Done()
	close(r.canceled)
	return domain.UserEmailConnection{}, ctx.Err()
}

type failOnceWebhookAudienceRepo struct {
	store.Repository
	mu       sync.Mutex
	failures int
	calls    int
}

func (r *failOnceWebhookAudienceRepo) ResolveEffectiveUsersForResource(
	ctx context.Context,
	companyID, resourceType, resourceID, accessLevel string,
	candidateUserIDs []string,
) (bool, []string, error) {
	r.mu.Lock()
	r.calls++
	if r.failures > 0 {
		r.failures--
		r.mu.Unlock()
		return false, nil, errors.New("temporary shared audience lookup failure")
	}
	r.mu.Unlock()
	return r.Repository.ResolveEffectiveUsersForResource(ctx, companyID, resourceType, resourceID, accessLevel, candidateUserIDs)
}

func (r *failOnceWebhookAudienceRepo) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls
}

type blockingCommunicationsNylasClient struct {
	*fakeNylasClient
	blockingMu       sync.Mutex
	folderStarted    chan struct{}
	folderRelease    chan struct{}
	folderSecondCall chan struct{}
	folderCallCount  int
	folderResult     []NylasFolder
	detailStarted    chan struct{}
	detailRelease    chan struct{}
	detailSecondCall chan struct{}
	detailCallCount  int
	pageStarted      chan struct{}
	pageRelease      chan struct{}
	pageSecondCall   chan struct{}
	pageCallCount    int
}

type doneObservingContext struct {
	context.Context
	once     sync.Once
	observed chan struct{}
}

func (c *doneObservingContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.observed) })
	return c.Context.Done()
}

func waitForCommunicationsCacheGenerationOwners(t *testing.T, cache *communicationsCache, kind, key string, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		cache.mu.RLock()
		inFlight := 0
		switch kind {
		case "folder":
			inFlight = cache.folderGenerations[key].inFlight
		case "page":
			inFlight = cache.pageGenerations[key].inFlight
		case "message":
			inFlight = cache.messageGenerations[key].inFlight
		default:
			cache.mu.RUnlock()
			t.Fatalf("unknown cache generation kind %q", kind)
		}
		cache.mu.RUnlock()
		if inFlight >= want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s generation %q owners = %d, want at least %d", kind, key, inFlight, want)
		}
		runtime.Gosched()
	}
}

func (f *blockingCommunicationsNylasClient) ListFolders(_ context.Context, grantID string) ([]NylasFolder, error) {
	f.blockingMu.Lock()
	f.folderCallCount++
	callCount := f.folderCallCount
	result := cloneNylasFolders(f.folderResult)
	if callCount == 1 && f.folderStarted != nil {
		close(f.folderStarted)
	}
	if callCount == 2 && f.folderSecondCall != nil {
		close(f.folderSecondCall)
	}
	f.blockingMu.Unlock()
	if callCount == 1 && f.folderRelease != nil {
		<-f.folderRelease
	}
	f.mu.Lock()
	f.folderCalls++
	f.lastFolderGrantID = grantID
	f.mu.Unlock()
	return result, nil
}

func (f *blockingCommunicationsNylasClient) setFolderResult(folders []NylasFolder) {
	f.blockingMu.Lock()
	f.folderResult = cloneNylasFolders(folders)
	f.blockingMu.Unlock()
}

func (f *blockingCommunicationsNylasClient) folderReadCalls() int {
	f.blockingMu.Lock()
	defer f.blockingMu.Unlock()
	return f.folderCallCount
}

func (f *blockingCommunicationsNylasClient) setDetailResult(message NylasMessage) {
	f.blockingMu.Lock()
	f.message = message
	f.blockingMu.Unlock()
}

func (f *blockingCommunicationsNylasClient) setPageResult(messages []NylasMessage) {
	f.blockingMu.Lock()
	f.messages = append([]NylasMessage(nil), messages...)
	f.blockingMu.Unlock()
}

func (f *blockingCommunicationsNylasClient) GetMessage(_ context.Context, _, messageID string) (NylasMessage, error) {
	f.blockingMu.Lock()
	f.detailCallCount++
	callCount := f.detailCallCount
	message := f.message
	if message.ID == "" {
		message.ID = messageID
	}
	if callCount == 1 && f.detailStarted != nil {
		close(f.detailStarted)
	}
	if callCount == 2 && f.detailSecondCall != nil {
		close(f.detailSecondCall)
	}
	f.blockingMu.Unlock()
	if f.detailRelease != nil {
		<-f.detailRelease
	}
	return message, nil
}

func (f *blockingCommunicationsNylasClient) ListMessages(_ context.Context, _ string, _ NylasMessageQuery) (NylasMessagePage, error) {
	f.blockingMu.Lock()
	f.pageCallCount++
	callCount := f.pageCallCount
	page := NylasMessagePage{Messages: append([]NylasMessage(nil), f.messages...), NextPageToken: "next-token"}
	if callCount == 1 && f.pageStarted != nil {
		close(f.pageStarted)
	}
	if callCount == 2 && f.pageSecondCall != nil {
		close(f.pageSecondCall)
	}
	f.blockingMu.Unlock()
	if f.pageRelease != nil {
		<-f.pageRelease
	}
	return page, nil
}

func (f *blockingCommunicationsNylasClient) detailCalls() int {
	f.blockingMu.Lock()
	defer f.blockingMu.Unlock()
	return f.detailCallCount
}

func (f *blockingCommunicationsNylasClient) pageCalls() int {
	f.blockingMu.Lock()
	defer f.blockingMu.Unlock()
	return f.pageCallCount
}

func (f *fakeNylasClient) ExchangeCode(_ context.Context, _, _ string) (NylasGrant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.exchangeErr != nil {
		return NylasGrant{}, f.exchangeErr
	}
	return f.grant, nil
}

func (f *fakeNylasClient) DeleteGrant(_ context.Context, grantID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deletedGrants = append(f.deletedGrants, grantID)
	return nil
}

func (f *fakeNylasClient) ListFolders(_ context.Context, grantID string) ([]NylasFolder, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.folderCalls++
	f.lastFolderGrantID = grantID
	return f.folders, nil
}

func (f *fakeNylasClient) ListMessages(_ context.Context, grantID string, query NylasMessageQuery) (NylasMessagePage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.messageCalls++
	f.lastQuery = query
	f.messageQueries = append(f.messageQueries, query)
	f.lastMessageGrantID = grantID
	if f.listErr != nil {
		return NylasMessagePage{}, f.listErr
	}
	if f.messagesByGrantID != nil {
		if messages, ok := f.messagesByGrantID[grantID]; ok {
			return NylasMessagePage{Messages: messages, NextPageToken: "next-token"}, nil
		}
	}
	if f.messagePagesByToken != nil {
		return f.messagePagesByToken[query.PageToken], nil
	}
	return NylasMessagePage{Messages: f.messages, NextPageToken: "next-token"}, nil
}

func (f *fakeNylasClient) GetThread(_ context.Context, _, threadID string) (NylasThread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	thread := f.thread
	if thread.ID == "" {
		thread.ID = threadID
	}
	return thread, nil
}

func (f *fakeNylasClient) GetMessage(_ context.Context, grantID, messageID string) (NylasMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.detailCalls++
	f.lastDetailGrantID = grantID
	if f.messagesByID != nil {
		if message, ok := f.messagesByID[messageID]; ok {
			return message, nil
		}
	}
	return f.message, nil
}

func (f *fakeNylasClient) GetMessageRawMIME(_ context.Context, grantID, messageID string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastRawMIMEGrantID = grantID
	f.lastRawMIMEMessageID = messageID
	if f.rawMIMEErr != nil {
		return "", f.rawMIMEErr
	}
	return f.rawMIME, nil
}

func (f *fakeNylasClient) DownloadAttachment(_ context.Context, grantID, messageID, attachmentID string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastDownloadGrantID = grantID
	f.lastDownloadMessageID = messageID
	f.lastDownloadAttachmentID = attachmentID
	if f.downloadErr != nil {
		return nil, f.downloadErr
	}
	return append([]byte(nil), f.downloadContent...), nil
}

func (f *fakeNylasClient) UpdateMessage(_ context.Context, grantID, messageID string, update NylasMessageUpdate) (NylasMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.updateErrByID != nil && f.updateErrByID[messageID] != nil {
		return NylasMessage{}, f.updateErrByID[messageID]
	}
	f.update = update
	f.updateCalls = append(f.updateCalls, fakeNylasUpdateCall{GrantID: grantID, MessageID: messageID, Update: update})
	message := f.message
	if f.messagesByID != nil {
		if stored, ok := f.messagesByID[messageID]; ok {
			message = stored
		}
	}
	if message.ID == "" {
		message.ID = messageID
	}
	if update.Unread != nil {
		message.Unread = *update.Unread
	}
	if update.Starred != nil {
		message.Starred = *update.Starred
	}
	if update.Folders != nil {
		message.Folders = update.Folders
	}
	return message, nil
}

func (f *fakeNylasClient) DeleteMessage(_ context.Context, _, _ string) error {
	return nil
}

func (f *fakeNylasClient) SendMessage(ctx context.Context, grantID string, request NylasSendMessageRequest) (NylasMessage, error) {
	f.mu.Lock()
	f.sendCalls++
	f.lastSendGrantID = grantID
	f.sent = request
	skipOutboundAttachmentReads := f.skipOutboundAttachmentReads
	onSend := f.onSend
	f.mu.Unlock()

	if onSend != nil {
		onSend(request)
	}
	bodies := make([][]byte, 0, len(request.OutboundAttachments))
	if !skipOutboundAttachmentReads {
		for index, attachment := range request.OutboundAttachments {
			content, err := attachment.Open(ctx)
			if err != nil {
				return NylasMessage{}, wrapNylasOutboundAttachmentFailure(index+1, "open_failed", fmt.Errorf("%w: attachment %d: %w", errNylasOutboundAttachmentOpen, index+1, err))
			}
			raw, readErr := io.ReadAll(content.Body)
			closeErr := content.Body.Close()
			if readErr != nil {
				return NylasMessage{}, readErr
			}
			if closeErr != nil {
				return NylasMessage{}, closeErr
			}
			bodies = append(bodies, raw)
		}
	}
	f.mu.Lock()
	f.sentAttachmentBodies = bodies
	f.mu.Unlock()
	return NylasMessage{ID: "sent-message", Subject: request.Subject, To: request.To}, nil
}

func seedEmailAttachmentForCommunicationsTest(t *testing.T, repo *store.MemoryRepo, storage *fakeAttachmentObjectStorage, actorUserID, companyID, resourceID, filename, contentType string, content []byte) string {
	t.Helper()
	filename = strings.TrimSpace(filename)
	if filename == "" {
		filename = "attachment"
	}
	contentType = strings.TrimSpace(contentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	attachmentID := store.NewUUIDv7String()
	storageKey := attachmentOriginalObjectKey(companyID, attachmentID)
	storage.objects[storageKey] = fakeAttachmentObject{contentType: contentType, body: append([]byte(nil), content...)}
	sum := sha256.Sum256(content)
	if _, _, err := repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
		CompanyID: companyID, AttachmentID: attachmentID, UploadedByUserID: actorUserID,
		OriginalFilename: filename, MimeType: contentType, ByteSize: int64(len(content)),
		SHA256: fmt.Sprintf("%x", sum[:]), SHA256VerificationMethod: "server_stream",
		StorageBucket: storage.bucket, StorageKey: storageKey, SourceKind: store.AttachmentSourceEmailOutgoing,
		ResourceLink: store.ResourceAttachmentInput{
			CompanyID: companyID, ResourceType: "email_draft", ResourceID: resourceID,
			RelationshipKind: store.AttachmentRelationshipEmailAttachment, CreatedByUserID: actorUserID,
		},
	}); err != nil {
		t.Fatalf("seed email attachment: %v", err)
	}
	return attachmentID
}

func seedEmailSignatureAttachmentForCommunicationsTest(t *testing.T, repo *store.MemoryRepo, storage *fakeAttachmentObjectStorage, actorUserID, companyID, resourceID string, original, display []byte) string {
	t.Helper()
	attachmentID := store.NewUUIDv7String()
	originalKey := attachmentOriginalObjectKey(companyID, attachmentID)
	storage.objects[originalKey] = fakeAttachmentObject{contentType: "image/png", body: append([]byte(nil), original...)}
	originalSum := sha256.Sum256(original)
	if _, _, err := repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
		CompanyID: companyID, AttachmentID: attachmentID, UploadedByUserID: actorUserID,
		OriginalFilename: "signature.png", MimeType: "image/png", ByteSize: int64(len(original)),
		SHA256: fmt.Sprintf("%x", originalSum[:]), SHA256VerificationMethod: "s3_full",
		StorageBucket: storage.bucket, StorageKey: originalKey, SourceKind: store.AttachmentSourceEditorPaste,
		ResourceLink: store.ResourceAttachmentInput{
			CompanyID: companyID, ResourceType: "email_signature", ResourceID: resourceID,
			RelationshipKind: store.AttachmentRelationshipInlineImage, CreatedByUserID: actorUserID,
		},
	}); err != nil {
		t.Fatalf("seed email signature attachment: %v", err)
	}

	displayKey := "companies/" + companyID + "/attachments/" + attachmentID + "/display/v1"
	storage.objects[displayKey] = fakeAttachmentObject{contentType: "image/png", body: append([]byte(nil), display...)}
	displaySum := sha256.Sum256(display)
	displaySHA := fmt.Sprintf("%x", displaySum[:])
	generation := 1
	width, height := 320, 80
	if _, err := repo.UpsertAttachmentVariants(context.Background(), companyID, []store.AttachmentVariantInput{{
		AttachmentID: attachmentID, VariantType: store.AttachmentVariantDisplay, MimeType: "image/png",
		ByteSize: int64(len(display)), SHA256: &displaySHA, GenerationVersion: &generation, Width: &width, Height: &height,
		StorageBucket: storage.bucket, StorageKey: displayKey,
	}}); err != nil {
		t.Fatalf("seed email signature display variant: %v", err)
	}
	return attachmentID
}

func seedLiveEmailDraftAttachmentForCommunicationsTest(t *testing.T, repo *store.MemoryRepo, storage *fakeAttachmentObjectStorage, actorUserID, companyID, accountEmail, resourceID, filename, contentType string, content []byte) string {
	t.Helper()
	draftID := strings.TrimSpace(resourceID)
	if draftID == "" {
		t.Fatal("seed live email draft attachment: draft ID required")
	}
	accountEmail = strings.TrimSpace(accountEmail)
	if accountEmail == "" {
		t.Fatal("seed live email draft attachment: account email required")
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, CreatedByUserID: actorUserID, UpdatedByUserID: actorUserID,
		Kind: "compose", PersonalUserID: actorUserID, PersonalAccountEmail: accountEmail, AccountEmail: accountEmail,
	}); err != nil {
		t.Fatalf("seed live email draft attachment draft: %v", err)
	}
	return seedEmailAttachmentForCommunicationsTest(t, repo, storage, actorUserID, companyID, draftID, filename, contentType, content)
}
func personalEmailDraftResourceID(_, _, draftID string) string { return strings.TrimSpace(draftID) }

func seedPersonalV3EmailMessageForCommunicationsTest(t *testing.T, repo *store.MemoryRepo, companyID, userID, accountEmail, provider string, message NylasMessage) domain.CommunicationsEmailThread {
	t.Helper()
	if strings.TrimSpace(message.ThreadID) == "" {
		message.ThreadID = "thread-" + message.ID
	}
	thread, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: accountEmail,
		AccountEmail: accountEmail, Provider: provider, ProviderThreadID: message.ThreadID,
		SelectedMessageID: message.ID, Messages: []domain.EmailMessageSnapshot{emailMessageSnapshotFromNylas(message)}, HistoryComplete: true,
	})
	if err != nil {
		t.Fatalf("seed personal V3 email message: %v", err)
	}
	return thread
}

func seedSharedV3EmailMessageForCommunicationsTest(t *testing.T, repo *store.MemoryRepo, companyID, sharedInboxID, accountEmail, provider string, message NylasMessage) domain.CommunicationsEmailThread {
	t.Helper()
	if strings.TrimSpace(message.ThreadID) == "" {
		message.ThreadID = "thread-" + message.ID
	}
	thread, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, SharedInboxID: sharedInboxID, AccountEmail: accountEmail, Provider: provider,
		ProviderThreadID: message.ThreadID, SelectedMessageID: message.ID,
		Messages: []domain.EmailMessageSnapshot{emailMessageSnapshotFromNylas(message)}, HistoryComplete: true,
	})
	if err != nil {
		t.Fatalf("seed shared V3 email message: %v", err)
	}
	return thread
}

func personalEmailSignatureResourceID(userID, accountEmail string) string {
	return "personal:" + strings.TrimSpace(userID) + ":" + normalizeEmailForCompare(accountEmail)
}

func sharedEmailSignatureResourceID(sharedInboxID string) string {
	return "shared:" + strings.TrimSpace(sharedInboxID)
}

type countingCommunicationsAttachmentRepo struct {
	store.Repository
	mu                              sync.Mutex
	readAttachmentContentCalls      int
	getAttachmentCalls              int
	getAttachmentVariantCalls       int
	listAttachmentResourceLinkCalls int
	sizeOverrides                   map[string]int64
}

func (r *countingCommunicationsAttachmentRepo) ReadAttachmentContent(ctx context.Context, companyID, attachmentID, variantType string) (store.AttachmentContentRead, error) {
	r.mu.Lock()
	r.readAttachmentContentCalls++
	size, overrideSize := r.sizeOverrides[attachmentID]
	r.mu.Unlock()
	content, err := r.Repository.ReadAttachmentContent(ctx, companyID, attachmentID, variantType)
	if err == nil && overrideSize {
		content.ByteSize = size
		content.OriginalByteSize = size
	}
	return content, err
}

func (r *countingCommunicationsAttachmentRepo) GetAttachment(companyID, attachmentID string) (domain.Attachment, error) {
	r.mu.Lock()
	r.getAttachmentCalls++
	r.mu.Unlock()
	return r.Repository.GetAttachment(companyID, attachmentID)
}

func (r *countingCommunicationsAttachmentRepo) GetAttachmentVariant(ctx context.Context, companyID, attachmentID, variantType string) (domain.AttachmentVariant, error) {
	r.mu.Lock()
	r.getAttachmentVariantCalls++
	r.mu.Unlock()
	return r.Repository.GetAttachmentVariant(ctx, companyID, attachmentID, variantType)
}

func (r *countingCommunicationsAttachmentRepo) ListAttachmentResourceLinks(companyID, attachmentID string) ([]domain.ResourceAttachment, error) {
	r.mu.Lock()
	r.listAttachmentResourceLinkCalls++
	r.mu.Unlock()
	return r.Repository.ListAttachmentResourceLinks(companyID, attachmentID)
}

func (r *countingCommunicationsAttachmentRepo) attachmentReadCounts() (readContent, getAttachment, getVariant, listLinks int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.readAttachmentContentCalls, r.getAttachmentCalls, r.getAttachmentVariantCalls, r.listAttachmentResourceLinkCalls
}

type communicationsSendTestFixture struct {
	repo         *store.MemoryRepo
	countingRepo *countingCommunicationsAttachmentRepo
	server       *Server
	handler      http.Handler
	storage      *fakeAttachmentObjectStorage
	nylas        *fakeNylasClient
	token        string
	companyID    string
	userID       string
	accountEmail string
}

func newCommunicationsSendTestFixture(t *testing.T) *communicationsSendTestFixture {
	t.Helper()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "communications-send-test-user"
	const companyID = "22222222-2222-2222-2222-222222222222"
	user, err := repo.UpsertAuthUser(subject, "sender@example.com", "Sender")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Communications Send Test Company")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-send-test",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	storage := newFakeAttachmentObjectStorage()
	countingRepo := &countingCommunicationsAttachmentRepo{
		Repository:    repo,
		sizeOverrides: map[string]int64{},
	}
	nylas := &fakeNylasClient{}
	server := NewServerWithOptions(countingRepo, ServerOptions{
		AuthValidator:     testValidator(t, "kid", key),
		NylasConfig:       testNylasConfig(),
		NylasClient:       nylas,
		AttachmentStorage: storage,
	})
	return &communicationsSendTestFixture{
		repo:         repo,
		countingRepo: countingRepo,
		server:       server,
		handler:      server.Routes(),
		storage:      storage,
		nylas:        nylas,
		token:        "Bearer " + testJWT(t, key, "kid", subject, user.Email),
		companyID:    companyID,
		userID:       user.UserID,
		accountEmail: user.Email,
	}
}

func (f *communicationsSendTestFixture) seedAttachment(t *testing.T, resourceID, filename string, content []byte) string {
	t.Helper()
	return seedLiveEmailDraftAttachmentForCommunicationsTest(t, f.repo, f.storage, f.userID, f.companyID, f.accountEmail, resourceID, filename, "application/octet-stream", content)
}

func (f *communicationsSendTestFixture) send(t *testing.T, payload any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/messages/send?company_id="+url.QueryEscape(f.companyID), strings.NewReader(string(raw)))
	req.Header.Set("Authorization", f.token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

func assertCommunicationsAttachmentReadShape(t *testing.T, repo *countingCommunicationsAttachmentRepo, wantReadContent int) {
	t.Helper()
	readContent, getAttachment, getVariant, listLinks := repo.attachmentReadCounts()
	if readContent != wantReadContent || getAttachment != 0 || getVariant != 0 || listLinks != 0 {
		t.Fatalf("attachment repository reads = content:%d get:%d variant:%d links:%d, want content:%d and no expanded/duplicate reads", readContent, getAttachment, getVariant, listLinks, wantReadContent)
	}
}

func TestCommunicationsSendValidatesBeforeAttachmentWork(t *testing.T) {
	t.Run("missing recipients", func(t *testing.T) {
		fixture := newCommunicationsSendTestFixture(t)
		attachmentID := fixture.seedAttachment(t, personalEmailDraftResourceID(fixture.userID, fixture.accountEmail, "draft-no-recipients"), "note.txt", []byte("hello"))
		rec := fixture.send(t, map[string]any{
			"subject": "No recipients",
			"body":    "Body",
			"attachments": []map[string]any{{
				"attachment_id": attachmentID,
				"filename":      "note.txt",
			}},
		})
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "email_recipients_required") {
			t.Fatalf("status=%d body=%s, want email_recipients_required", rec.Code, rec.Body.String())
		}
		assertCommunicationsAttachmentReadShape(t, fixture.countingRepo, 0)
		if len(fixture.storage.getKeys) != 0 || fixture.nylas.sendCalls != 0 {
			t.Fatalf("early rejection storage reads=%v send calls=%d, want zero", fixture.storage.getKeys, fixture.nylas.sendCalls)
		}
	})

	for _, test := range []struct {
		name        string
		attachments []map[string]any
	}{
		{name: "empty attachment entries", attachments: []map[string]any{{}}},
		{name: "invalid id is not an attachment reference", attachments: []map[string]any{{"attachment_id": "not-a-valid-reference", "filename": "invalid.txt"}}},
		{name: "raw bytes are not an attachment reference", attachments: []map[string]any{{"attachment_id": "11111111-1111-1111-1111-111111111111", "filename": "raw.txt", "content": "QUJD"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newCommunicationsSendTestFixture(t)
			fixture.server.attachmentStorage = nil
			rec := fixture.send(t, map[string]any{
				"to":          []map[string]string{{"email": "friend@example.com"}},
				"subject":     " ",
				"body":        " ",
				"attachments": test.attachments,
			})
			if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "email_content_required") {
				t.Fatalf("status=%d body=%s, want email_content_required", rec.Code, rec.Body.String())
			}
			assertCommunicationsAttachmentReadShape(t, fixture.countingRepo, 0)
			if fixture.nylas.sendCalls != 0 {
				t.Fatalf("send calls = %d, want zero", fixture.nylas.sendCalls)
			}
		})
	}
}

func TestCommunicationsSendUsesLeanPreflightAndLazyProviderOpen(t *testing.T) {
	fixture := newCommunicationsSendTestFixture(t)
	attachmentID := fixture.seedAttachment(t, personalEmailDraftResourceID(fixture.userID, fixture.accountEmail, "draft-lazy"), "note.txt", []byte("hello"))
	s3ReadsAtSendStart := -1
	fixture.nylas.onSend = func(NylasSendMessageRequest) {
		s3ReadsAtSendStart = len(fixture.storage.getKeys)
	}

	rec := fixture.send(t, map[string]any{
		"to":      []map[string]string{{"email": "friend@example.com"}},
		"subject": "Lazy attachment",
		"body":    "Body",
		"attachments": []map[string]any{{
			"attachment_id": strings.ToUpper(attachmentID),
			"filename":      "note.txt",
		}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s, want created", rec.Code, rec.Body.String())
	}
	assertCommunicationsAttachmentReadShape(t, fixture.countingRepo, 1)
	if s3ReadsAtSendStart != 0 || len(fixture.storage.getKeys) != 1 {
		t.Fatalf("S3 reads at provider start=%d final=%v, want 0 then one lazy read", s3ReadsAtSendStart, fixture.storage.getKeys)
	}
	if fixture.nylas.sendCalls != 1 || len(fixture.nylas.sentAttachmentBodies) != 1 || string(fixture.nylas.sentAttachmentBodies[0]) != "hello" {
		t.Fatalf("provider send calls=%d bodies=%q, want one consumed hello body", fixture.nylas.sendCalls, fixture.nylas.sentAttachmentBodies)
	}
	if len(fixture.nylas.sent.Attachments) != 1 || fixture.nylas.sent.Attachments[0].Content != "" ||
		len(fixture.nylas.sent.OutboundAttachments) != 1 || fixture.nylas.sent.OutboundAttachments[0].Open == nil {
		t.Fatalf("sent request metadata=%+v outbound=%+v, want metadata-only attachment and one lazy opener", fixture.nylas.sent.Attachments, fixture.nylas.sent.OutboundAttachments)
	}
	var response struct {
		Message NylasMessage
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Message.Attachments) != 1 || response.Message.Attachments[0].Content != "" {
		t.Fatalf("response attachments = %+v, want metadata only", response.Message.Attachments)
	}
}

func TestValidCommunicationsSendAttachmentContentRequiresCoherentOriginal(t *testing.T) {
	fixture := newCommunicationsSendTestFixture(t)
	attachmentID := fixture.seedAttachment(t, personalEmailDraftResourceID(fixture.userID, fixture.accountEmail, "draft-original-contract"), "original.bin", []byte("original"))
	content, err := fixture.repo.ReadAttachmentContent(context.Background(), fixture.companyID, attachmentID, store.AttachmentVariantOriginal)
	if err != nil {
		t.Fatal(err)
	}
	if !validCommunicationsSendAttachmentContent(content, fixture.companyID, attachmentID, fixture.storage.bucket) {
		t.Fatalf("healthy original content rejected: %+v", content)
	}

	mutations := []struct {
		name   string
		mutate func(*store.AttachmentContentRead)
	}{
		{name: "served display", mutate: func(item *store.AttachmentContentRead) { item.ServedVariant = store.AttachmentVariantDisplay }},
		{name: "size disagreement", mutate: func(item *store.AttachmentContentRead) { item.ByteSize++ }},
		{name: "key disagreement", mutate: func(item *store.AttachmentContentRead) { item.StorageKey += "-stale" }},
		{name: "bucket disagreement", mutate: func(item *store.AttachmentContentRead) { item.StorageBucket = "other-bucket" }},
		{name: "checksum disagreement", mutate: func(item *store.AttachmentContentRead) { item.SHA256 = strings.Repeat("0", sha256.Size*2) }},
		{name: "invalid checksum", mutate: func(item *store.AttachmentContentRead) { item.SHA256 = "not-a-checksum" }},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			candidate := content
			mutation.mutate(&candidate)
			if validCommunicationsSendAttachmentContent(candidate, fixture.companyID, attachmentID, fixture.storage.bucket) {
				t.Fatalf("incoherent original content accepted: %+v", candidate)
			}
		})
	}
}

func TestCommunicationsSendPersonalSignatureImageUsesHealthyOriginalAndPromotesSentLink(t *testing.T) {
	fixture := newCommunicationsSendTestFixture(t)
	storedSignature, err := fixture.repo.UpsertCommunicationsEmailSignature(store.CommunicationsEmailSignatureInput{
		CompanyID: fixture.companyID, PersonalUserID: fixture.userID, PersonalAccountEmail: fixture.accountEmail,
		Name: "Default", IsDefault: true, CreatedByUserID: fixture.userID, UpdatedByUserID: fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	original := []byte("personal-signature-original")
	display := []byte("personal-signature-display")
	attachmentID := seedEmailSignatureAttachmentForCommunicationsTest(t, fixture.repo, fixture.storage, fixture.userID, fixture.companyID, storedSignature.SignatureID, original, display)
	signatureBody := "<p>Regards</p><img src=\"mango-attachment:" + url.PathEscape(attachmentID) + "\">"
	if _, err := fixture.repo.UpsertCommunicationsEmailSignature(store.CommunicationsEmailSignatureInput{
		CompanyID: fixture.companyID, SignatureID: storedSignature.SignatureID,
		PersonalUserID: fixture.userID, PersonalAccountEmail: fixture.accountEmail,
		Name: "Default", BodyEditorHTML: signatureBody, IsDefault: true,
		CreatedByUserID: fixture.userID, UpdatedByUserID: fixture.userID,
	}); err != nil {
		t.Fatal(err)
	}

	rec := fixture.send(t, map[string]any{
		"to":      []map[string]string{{"email": "friend@example.com"}},
		"subject": "Personal signature",
		"body":    "<p>Hello</p>" + signatureBody,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s, want created", rec.Code, rec.Body.String())
	}

	contentID := communicationsInlineImageContentID(attachmentID)
	if !strings.Contains(fixture.nylas.sent.Body, "src=\"cid:"+contentID+"\"") {
		t.Fatalf("provider body=%q, want durable signature image rewritten to CID", fixture.nylas.sent.Body)
	}
	if len(fixture.nylas.sent.Attachments) != 1 || fixture.nylas.sent.Attachments[0].AttachmentID != attachmentID ||
		fixture.nylas.sent.Attachments[0].ContentID != contentID || !fixture.nylas.sent.Attachments[0].IsInline ||
		len(fixture.nylas.sent.OutboundAttachments) != 1 || !validAttachmentSHA256Hex(fixture.nylas.sent.OutboundAttachments[0].SHA256) ||
		len(fixture.nylas.sentAttachmentBodies) != 1 || !bytes.Equal(fixture.nylas.sentAttachmentBodies[0], original) {
		t.Fatalf("metadata=%+v outbound=%+v bodies=%q, want one checksum-validated original CID attachment", fixture.nylas.sent.Attachments, fixture.nylas.sent.OutboundAttachments, fixture.nylas.sentAttachmentBodies)
	}
	if len(fixture.storage.getKeys) != 1 || fixture.storage.getKeys[0] != attachmentOriginalObjectKey(fixture.companyID, attachmentID) {
		t.Fatalf("storage reads=%v, want only the original object (not display)", fixture.storage.getKeys)
	}

	var response struct {
		Message NylasMessage
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(response.Message.Body, "cid:"+contentID) || len(response.Message.Attachments) != 1 ||
		response.Message.Attachments[0].AttachmentID != attachmentID || response.Message.Attachments[0].ContentID != contentID {
		t.Fatalf("sent response=%+v, want local CID body and durable attachment metadata", response.Message)
	}
	links, err := fixture.repo.ListAttachmentResourceLinks(fixture.companyID, attachmentID)
	if err != nil {
		t.Fatal(err)
	}
	foundSentLink := false
	for _, link := range links {
		if link.ResourceType == "email_message" && strings.TrimSpace(link.ResourceID) != "" && link.RelationshipKind == store.AttachmentRelationshipEmailInline {
			foundSentLink = true
		}
	}
	if !foundSentLink {
		t.Fatalf("resource links=%+v, want promoted internal email_message inline image link", links)
	}
}

func TestCommunicationsSendUnauthorizedAttachmentDoesNotOpenStorage(t *testing.T) {
	fixture := newCommunicationsSendTestFixture(t)
	attachmentID := seedEmailAttachmentForCommunicationsTest(t, fixture.repo, fixture.storage, fixture.userID, fixture.companyID, personalEmailDraftResourceID("another-user", fixture.accountEmail, "draft-private"), "private.txt", "application/octet-stream", []byte("private"))
	rec := fixture.send(t, map[string]any{
		"to":      []map[string]string{{"email": "friend@example.com"}},
		"subject": "Unauthorized attachment",
		"body":    "Body",
		"attachments": []map[string]any{{
			"attachment_id": attachmentID,
			"filename":      "private.txt",
		}},
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s, want concealed not found", rec.Code, rec.Body.String())
	}
	assertCommunicationsAttachmentReadShape(t, fixture.countingRepo, 1)
	if len(fixture.storage.getKeys) != 0 || fixture.nylas.sendCalls != 0 {
		t.Fatalf("unauthorized storage reads=%v send calls=%d, want zero", fixture.storage.getKeys, fixture.nylas.sendCalls)
	}
}

func TestCommunicationsSendPreservesLazyStorageErrorResponse(t *testing.T) {
	fixture := newCommunicationsSendTestFixture(t)
	attachmentID := fixture.seedAttachment(t, personalEmailDraftResourceID(fixture.userID, fixture.accountEmail, "draft-missing-object"), "missing.txt", []byte("gone"))
	delete(fixture.storage.objects, attachmentOriginalObjectKey(fixture.companyID, attachmentID))
	rec := fixture.send(t, map[string]any{
		"to":      []map[string]string{{"email": "friend@example.com"}},
		"subject": "Missing attachment object",
		"attachments": []map[string]any{{
			"attachment_id": attachmentID,
			"filename":      "missing.txt",
		}},
	})
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "attachment_content_not_found") {
		t.Fatalf("status=%d body=%s, want attachment_content_not_found", rec.Code, rec.Body.String())
	}
	assertCommunicationsAttachmentReadShape(t, fixture.countingRepo, 1)
	if len(fixture.storage.getKeys) != 1 || fixture.nylas.sendCalls != 1 {
		t.Fatalf("lazy storage reads=%v send calls=%d, want one of each", fixture.storage.getKeys, fixture.nylas.sendCalls)
	}
}

func TestCommunicationsSendAttachmentFailureClassificationIsActionableAndSanitized(t *testing.T) {
	oldWriter := log.Writer()
	oldFlags := log.Flags()
	oldPrefix := log.Prefix()
	var logs bytes.Buffer
	log.SetOutput(&logs)
	log.SetFlags(0)
	log.SetPrefix("")
	defer func() {
		log.SetOutput(oldWriter)
		log.SetFlags(oldFlags)
		log.SetPrefix(oldPrefix)
	}()

	const attachmentID = "11111111-1111-1111-1111-111111111111"
	const secretMarker = "SECRET_STORAGE_DETAIL"
	attachments := []NylasAttachment{{AttachmentID: attachmentID, Filename: "SECRET_FILENAME.png"}}
	connection := domain.UserEmailConnection{UserID: "safe-user-id"}
	testCases := []struct {
		name       string
		err        error
		statusCode int
		publicCode string
		class      string
	}{
		{
			name: "object not found",
			err: wrapNylasOutboundAttachmentFailure(1, "open_failed",
				fmt.Errorf("%w: %w", errNylasOutboundAttachmentOpen, ErrAttachmentObjectNotFound)),
			statusCode: http.StatusNotFound, publicCode: "attachment_content_not_found", class: "object_not_found",
		},
		{
			name: "storage unavailable",
			err: wrapNylasOutboundAttachmentFailure(1, "open_failed",
				fmt.Errorf("%w: %w", errNylasOutboundAttachmentOpen, ErrAttachmentStorageUnavailable)),
			statusCode: http.StatusServiceUnavailable, publicCode: "attachment_storage_unavailable", class: "storage_unavailable",
		},
		{
			name: "reported length mismatch",
			err: wrapNylasOutboundAttachmentFailure(1, "content_length_mismatch",
				fmt.Errorf("%w: %s", errNylasOutboundAttachmentContentLengthMismatch, secretMarker)),
			statusCode: http.StatusBadGateway, publicCode: "attachment_content_length_mismatch", class: "content_length_mismatch",
		},
		{
			name: "short stream",
			err: wrapNylasOutboundAttachmentFailure(1, "short_stream",
				fmt.Errorf("%w: %s", errNylasOutboundAttachmentShort, secretMarker)),
			statusCode: http.StatusBadGateway, publicCode: "attachment_content_length_mismatch", class: "short_stream",
		},
		{
			name: "long stream",
			err: wrapNylasOutboundAttachmentFailure(1, "long_stream",
				fmt.Errorf("%w: %s", errNylasOutboundAttachmentLong, secretMarker)),
			statusCode: http.StatusBadGateway, publicCode: "attachment_content_length_mismatch", class: "long_stream",
		},
		{
			name: "read failure",
			err: wrapNylasOutboundAttachmentFailure(1, "read_failed",
				fmt.Errorf("%w: %s", errNylasOutboundAttachmentRead, secretMarker)),
			statusCode: http.StatusBadGateway, publicCode: "attachment_storage_failed", class: "read_failed",
		},
		{
			name: "checksum mismatch",
			err: wrapNylasOutboundAttachmentFailure(1, "checksum_mismatch",
				fmt.Errorf("%w: %s", errNylasOutboundAttachmentChecksumMismatch, secretMarker)),
			statusCode: http.StatusBadGateway, publicCode: "attachment_storage_failed", class: "checksum_mismatch",
		},
		{
			name: "opaque open failure",
			err: wrapNylasOutboundAttachmentFailure(1, "open_failed",
				fmt.Errorf("%w: %s", errNylasOutboundAttachmentOpen, secretMarker)),
			statusCode: http.StatusBadGateway, publicCode: "attachment_storage_failed", class: "open_failed",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			logs.Reset()
			req := httptest.NewRequest(http.MethodPost, "/v1/communications/messages/send?shared_inbox_id=safe-shared-id", strings.NewReader("{\"body\":\"SECRET_RAW_BODY\"}"))
			req.Header.Set("X-Request-ID", "safe-request-id")
			rec := httptest.NewRecorder()
			writeCommunicationsSendAttachmentError(rec, req, connection, "safe-company-id", attachments, testCase.err)
			if rec.Code != testCase.statusCode || !strings.Contains(rec.Body.String(), testCase.publicCode) {
				t.Fatalf("status=%d body=%s, want %d %s", rec.Code, rec.Body.String(), testCase.statusCode, testCase.publicCode)
			}
			logged := logs.String()
			for _, want := range []string{
				"request_id=\"safe-request-id\"",
				"method=\"POST\"",
				"path=\"/v1/communications/messages/send\"",
				"scope=\"shared\"",
				"attachment_id=\"" + attachmentID + "\"",
				"attachment_index=1",
				"failure_class=\"" + testCase.class + "\"",
				"public_code=\"" + testCase.publicCode + "\"",
			} {
				if !strings.Contains(logged, want) {
					t.Fatalf("log=%q, want %q", logged, want)
				}
			}
			for _, forbidden := range []string{secretMarker, "SECRET_FILENAME", "SECRET_RAW_BODY"} {
				if strings.Contains(logged, forbidden) {
					t.Fatalf("log=%q leaked %q", logged, forbidden)
				}
			}
		})
	}

	logs.Reset()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/messages/send", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	writeCommunicationsSendAttachmentError(rec, req, connection, "safe-company-id", attachments,
		wrapNylasOutboundAttachmentFailure(1, "read_failed", errNylasOutboundAttachmentRead))
	if rec.Body.Len() != 0 || logs.Len() != 0 {
		t.Fatalf("canceled request response=%q log=%q, want silent exit", rec.Body.String(), logs.String())
	}
}

func TestCommunicationsSendRejectsInvalidOrOversizedMetadataBeforeStorage(t *testing.T) {
	tests := []struct {
		name  string
		sizes []int64
	}{
		{name: "one byte over", sizes: []int64{communicationsAttachmentMaxTotalBytes + 1}},
		{name: "later item exceeds aggregate", sizes: []int64{12_000_000, 12_000_001}},
		{name: "negative metadata", sizes: []int64{-1}},
		{name: "overflow sized metadata", sizes: []int64{1, int64(1<<63 - 1)}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newCommunicationsSendTestFixture(t)
			attachments := make([]map[string]any, 0, len(test.sizes))
			for index, size := range test.sizes {
				attachmentID := fixture.seedAttachment(t, personalEmailDraftResourceID(fixture.userID, fixture.accountEmail, fmt.Sprintf("draft-limit-%d", index)), fmt.Sprintf("file-%d.bin", index), []byte{byte(index + 1)})
				fixture.countingRepo.sizeOverrides[attachmentID] = size
				attachments = append(attachments, map[string]any{
					"attachment_id": attachmentID,
					"filename":      fmt.Sprintf("file-%d.bin", index),
				})
			}
			rec := fixture.send(t, map[string]any{
				"to":          []map[string]string{{"email": "friend@example.com"}},
				"subject":     "Metadata limit",
				"body":        "Body",
				"attachments": attachments,
			})
			if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_email_attachment") {
				t.Fatalf("status=%d body=%s, want invalid_email_attachment", rec.Code, rec.Body.String())
			}
			assertCommunicationsAttachmentReadShape(t, fixture.countingRepo, len(test.sizes))
			if len(fixture.storage.getKeys) != 0 || fixture.nylas.sendCalls != 0 {
				t.Fatalf("rejected metadata storage reads=%v send calls=%d, want zero", fixture.storage.getKeys, fixture.nylas.sendCalls)
			}
		})
	}
}

func TestCommunicationsSendAcceptsExactAggregateAndDeduplicatesMetadataReads(t *testing.T) {
	t.Run("exact 24 million bytes", func(t *testing.T) {
		fixture := newCommunicationsSendTestFixture(t)
		fixture.nylas.skipOutboundAttachmentReads = true
		attachments := make([]map[string]any, 0, 2)
		for index := 0; index < 2; index++ {
			attachmentID := fixture.seedAttachment(t, personalEmailDraftResourceID(fixture.userID, fixture.accountEmail, fmt.Sprintf("draft-exact-%d", index)), fmt.Sprintf("exact-%d.bin", index), []byte{byte(index + 1)})
			fixture.countingRepo.sizeOverrides[attachmentID] = 12_000_000
			attachments = append(attachments, map[string]any{"attachment_id": attachmentID, "filename": fmt.Sprintf("exact-%d.bin", index)})
		}
		rec := fixture.send(t, map[string]any{
			"to":          []map[string]string{{"email": "friend@example.com"}},
			"attachments": attachments,
		})
		if rec.Code != http.StatusCreated {
			t.Fatalf("status=%d body=%s, want exact boundary accepted", rec.Code, rec.Body.String())
		}
		assertCommunicationsAttachmentReadShape(t, fixture.countingRepo, 2)
		if len(fixture.storage.getKeys) != 0 || fixture.nylas.sendCalls != 1 || len(fixture.nylas.sent.OutboundAttachments) != 2 {
			t.Fatalf("exact boundary storage reads=%v send calls=%d outbound=%d", fixture.storage.getKeys, fixture.nylas.sendCalls, len(fixture.nylas.sent.OutboundAttachments))
		}
		for _, attachment := range fixture.nylas.sent.OutboundAttachments {
			if attachment.Size != 12_000_000 {
				t.Fatalf("outbound size=%d, want 12000000", attachment.Size)
			}
		}
	})

	t.Run("duplicate id reuses metadata", func(t *testing.T) {
		fixture := newCommunicationsSendTestFixture(t)
		fixture.nylas.skipOutboundAttachmentReads = true
		attachmentID := fixture.seedAttachment(t, personalEmailDraftResourceID(fixture.userID, fixture.accountEmail, "draft-duplicate"), "duplicate.bin", []byte("x"))
		rec := fixture.send(t, map[string]any{
			"to": []map[string]string{{"email": "friend@example.com"}},
			"attachments": []map[string]any{
				{"attachment_id": attachmentID, "filename": "first.bin"},
				{"attachment_id": strings.ToUpper(attachmentID), "filename": "second.bin"},
			},
		})
		if rec.Code != http.StatusCreated {
			t.Fatalf("status=%d body=%s, want duplicate metadata accepted", rec.Code, rec.Body.String())
		}
		assertCommunicationsAttachmentReadShape(t, fixture.countingRepo, 1)
		if len(fixture.nylas.sent.OutboundAttachments) != 2 {
			t.Fatalf("outbound attachments=%d, want two ordered parts", len(fixture.nylas.sent.OutboundAttachments))
		}
	})
}

func TestCommunicationsSendAcceptsZeroByteAttachmentOnlyMessage(t *testing.T) {
	fixture := newCommunicationsSendTestFixture(t)
	attachmentID := fixture.seedAttachment(t, personalEmailDraftResourceID(fixture.userID, fixture.accountEmail, "draft-empty-file"), "empty.txt", nil)
	rec := fixture.send(t, map[string]any{
		"to": []map[string]string{{"email": "friend@example.com"}},
		"attachments": []map[string]any{{
			"attachment_id": attachmentID,
			"filename":      "empty.txt",
		}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s, want zero-byte attachment-only send accepted", rec.Code, rec.Body.String())
	}
	assertCommunicationsAttachmentReadShape(t, fixture.countingRepo, 1)
	if len(fixture.storage.getKeys) != 1 || fixture.nylas.sendCalls != 1 || len(fixture.nylas.sentAttachmentBodies) != 1 || len(fixture.nylas.sentAttachmentBodies[0]) != 0 {
		t.Fatalf("zero-byte send storage=%v calls=%d bodies=%v", fixture.storage.getKeys, fixture.nylas.sendCalls, fixture.nylas.sentAttachmentBodies)
	}
	if len(fixture.nylas.sent.Attachments) != 1 || fixture.nylas.sent.Attachments[0].Size != 0 {
		t.Fatalf("zero-byte metadata = %+v", fixture.nylas.sent.Attachments)
	}
}

func TestNylasOAuthStateRoundTripAndExpiry(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 8, 12, 0, 0, 0, time.UTC)
	state, err := signNylasOAuthState("secret", nylasOAuthStatePayload{
		UserID:   "user-1",
		Email:    "USER@example.COM",
		Provider: "gmail",
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := parseNylasOAuthState("secret", state, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if payload.UserID != "user-1" || payload.Email != "user@example.com" || payload.Provider != "google" {
		t.Fatalf("payload = %+v, want normalized user/email/provider", payload)
	}
	if _, err := parseNylasOAuthState("secret", state, now.Add(nylasOAuthStateTTL+time.Second)); !errors.Is(err, errExpiredNylasState) {
		t.Fatalf("expired state error = %v, want %v", err, errExpiredNylasState)
	}
	if _, err := parseNylasOAuthState("wrong-secret", state, now); !errors.Is(err, errInvalidNylasState) {
		t.Fatalf("wrong secret error = %v, want %v", err, errInvalidNylasState)
	}
}

func TestCommunicationsAuthURLIncludesSignedState(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/auth-url?provider=google", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "user@example.com"))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		AuthURL string `json:"auth_url"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(payload.AuthURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("client_id") != "client-id" || parsed.Query().Get("provider") != "google" {
		t.Fatalf("auth url query = %s", parsed.RawQuery)
	}
	if parsed.Query().Get("login_hint") != "user@example.com" {
		t.Fatalf("login_hint = %q, want user@example.com", parsed.Query().Get("login_hint"))
	}
	if scope := parsed.Query().Get("scope"); !strings.Contains(scope, "https://www.googleapis.com/auth/userinfo.email") || strings.Contains(scope, " userinfo.email ") {
		t.Fatalf("scope = %q, want fully-qualified Google scopes", scope)
	}
	state, err := parseNylasOAuthState("state-secret", parsed.Query().Get("state"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if state.UserID != user.UserID || state.Email != "user@example.com" || state.Provider != "google" {
		t.Fatalf("state = %+v, want user-bound google state", state)
	}
	if state.UserEmail != "user@example.com" {
		t.Fatalf("state.UserEmail = %q, want user@example.com", state.UserEmail)
	}
	if !state.StrictEmail {
		t.Fatalf("state.StrictEmail = false, want true for personal auth URL")
	}
}

func TestCommunicationsAuthURLSharedInboxIntentRequiresManagerOrAdmin(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-auth-url-manager-required"
	repo.EnsureCompany(companyID, "Shared Auth URL Manager Required")
	member, err := repo.UpsertAuthUser("subject-shared-auth-url-member", "member@example.com", "Member")
	if err != nil {
		t.Fatal(err)
	}
	manager, err := repo.UpsertAuthUser("subject-shared-auth-url-manager", "manager@example.com", "Manager")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(manager.CognitoSubject, companyID, domain.RoleCompanyManager); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{},
	}).Routes()
	path := "/v1/communications/auth-url?provider=google&account_email=support%40example.com&shared_inbox_company_id=" + url.QueryEscape(companyID) + "&shared_inbox_name=Support"

	memberReq := httptest.NewRequest(http.MethodGet, path, nil)
	memberReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", member.CognitoSubject, member.Email))
	memberRec := httptest.NewRecorder()
	handler.ServeHTTP(memberRec, memberReq)
	if memberRec.Code != http.StatusForbidden {
		t.Fatalf("shared auth URL as member status = %d, want %d body=%s", memberRec.Code, http.StatusForbidden, memberRec.Body.String())
	}

	managerReq := httptest.NewRequest(http.MethodGet, path, nil)
	managerReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", manager.CognitoSubject, manager.Email))
	managerRec := httptest.NewRecorder()
	handler.ServeHTTP(managerRec, managerReq)
	if managerRec.Code != http.StatusOK {
		t.Fatalf("shared auth URL as manager status = %d, want %d body=%s", managerRec.Code, http.StatusOK, managerRec.Body.String())
	}
}

func TestNylasGoogleScopesNormalizeShorthandEnvValues(t *testing.T) {
	t.Parallel()

	config := NylasConfig{
		GoogleScopes: []string{"openid", "userinfo.email", "gmail.modify", "gmail.send", "gmail.labels", "calendar", "gmail.send"},
	}
	scopes := strings.Join(config.ScopesForProvider("google"), " ")
	if strings.Contains(scopes, "openid") || strings.Contains(scopes, " userinfo.email ") {
		t.Fatalf("scopes = %q, want unsupported shorthand scopes removed or normalized", scopes)
	}
	for _, want := range []string{
		"https://www.googleapis.com/auth/userinfo.email",
		"https://www.googleapis.com/auth/gmail.modify",
		"https://www.googleapis.com/auth/gmail.send",
		"https://www.googleapis.com/auth/gmail.labels",
		"https://www.googleapis.com/auth/calendar",
	} {
		if !strings.Contains(scopes, want) {
			t.Fatalf("scopes = %q, missing %q", scopes, want)
		}
	}
	if strings.Count(scopes, "https://www.googleapis.com/auth/gmail.send") != 1 {
		t.Fatalf("scopes = %q, want duplicate scopes removed", scopes)
	}
}

func TestNylasFolderUnmarshalAcceptsBooleanSystemFolder(t *testing.T) {
	t.Parallel()

	var payload struct {
		Data []NylasFolder `json:"data"`
	}
	err := json.Unmarshal([]byte(`{"data":[{"id":"inbox","name":"Inbox","system_folder":"inbox"},{"id":"label-1","name":"Label","system_folder":false}]}`), &payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 2 {
		t.Fatalf("folders = %d, want 2", len(payload.Data))
	}
	if payload.Data[0].SystemFolder != "inbox" {
		t.Fatalf("string system_folder = %q, want inbox", payload.Data[0].SystemFolder)
	}
	if payload.Data[1].SystemFolder != "" {
		t.Fatalf("boolean system_folder = %q, want empty", payload.Data[1].SystemFolder)
	}
}

func TestNylasCallbackStoresGrantAndRejectsEmailMismatch(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      user.UserID,
		Email:       user.Email,
		UserEmail:   user.Email,
		Provider:    "microsoft",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-1", Email: user.Email, Provider: "microsoft"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("success callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.GrantID != "grant-1" || connection.Provider != "microsoft" || connection.AccountEmail != user.Email {
		t.Fatalf("connection = %+v, want stored grant metadata", connection)
	}

	mismatchRepo := store.NewMemoryRepo()
	mismatchUser, err := mismatchRepo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	mismatchState, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      mismatchUser.UserID,
		Email:       mismatchUser.Email,
		Provider:    "google",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	mismatchNylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-2", Email: "other@example.com", Provider: "google"}}
	mismatchHandler := NewServerWithOptions(mismatchRepo, ServerOptions{
		NylasConfig: config,
		NylasClient: mismatchNylas,
	}).Routes()
	mismatchReq := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(mismatchState), nil)
	mismatchRec := httptest.NewRecorder()
	mismatchHandler.ServeHTTP(mismatchRec, mismatchReq)
	if mismatchRec.Code != http.StatusFound {
		t.Fatalf("mismatch callback status = %d", mismatchRec.Code)
	}
	if !strings.Contains(mismatchRec.Header().Get("Location"), "nylas_error=nylas_email_mismatch") {
		t.Fatalf("mismatch redirect = %s", mismatchRec.Header().Get("Location"))
	}
	if _, err := mismatchRepo.GetUserEmailConnection(mismatchUser.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("mismatch connection error = %v, want ErrNotFound", err)
	}
	if len(mismatchNylas.deletedGrants) != 1 || mismatchNylas.deletedGrants[0] != "grant-2" {
		t.Fatalf("deleted grants = %v, want grant cleanup", mismatchNylas.deletedGrants)
	}
}

func TestNylasCallbackRejectsPersonalAccountEmailMismatch(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "profile@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:    user.UserID,
		Email:     user.Email,
		UserEmail: user.Email,
		Provider:  "google",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-1", Email: "mailbox@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Location"), "nylas_error=nylas_email_mismatch") {
		t.Fatalf("callback redirect = %s, want email mismatch", rec.Header().Get("Location"))
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("connection error = %v, want ErrNotFound", err)
	}
	if len(nylas.deletedGrants) != 1 || nylas.deletedGrants[0] != "grant-1" {
		t.Fatalf("deleted grants = %v, want mismatched grant cleanup", nylas.deletedGrants)
	}
}

func TestNylasCallbackRecoversPersonalUserByEmailWhenStateUserIDIsStale(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("new-subject", "profile@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      "deleted-user-id",
		Email:       user.Email,
		UserEmail:   user.Email,
		Provider:    "google",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-1", Email: user.Email, Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Header().Get("Location"), "nylas_error=") {
		t.Fatalf("callback redirect = %s, want success", rec.Header().Get("Location"))
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.UserID != user.UserID || connection.AccountEmail != user.Email || connection.GrantID != "grant-1" {
		t.Fatalf("connection = %+v, want recovered user connection", connection)
	}
	if len(nylas.deletedGrants) != 0 {
		t.Fatalf("deleted grants = %v, want none", nylas.deletedGrants)
	}
}

func TestNylasCallbackDeletesGrantWhenConnectionStoreFails(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      "missing-user-id",
		Email:       "missing@example.com",
		UserEmail:   "missing@example.com",
		Provider:    "google",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "orphan-grant", Email: "missing@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Location"), "nylas_error=mango_user_not_found") {
		t.Fatalf("callback redirect = %s, want mango_user_not_found", rec.Header().Get("Location"))
	}
	if len(nylas.deletedGrants) != 1 || nylas.deletedGrants[0] != "orphan-grant" {
		t.Fatalf("deleted grants = %v, want orphan grant cleanup", nylas.deletedGrants)
	}
}

func TestNylasCallbackStoresSharedAccountWithoutOverwritingPersonalConnection(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      user.UserID,
		Email:       "shared@example.com",
		UserEmail:   user.Email,
		Provider:    "google",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "shared-grant", Email: "shared@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	redirect, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if redirect.Query().Get("nylas_scope") != "shared" || redirect.Query().Get("nylas_account_email") != "shared@example.com" {
		t.Fatalf("callback redirect = %s, want shared scope and account email", redirect.String())
	}
	personal, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if personal.AccountEmail != user.Email || personal.GrantID != "personal-grant" {
		t.Fatalf("personal connection = %+v, want unchanged personal grant", personal)
	}
	if _, err := repo.GetUserEmailConnectionByGrantIDContext(context.Background(), "shared-grant"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("shared user connection lookup error = %v, want ErrNotFound", err)
	}
}

func TestNylasCallbackCreatesSharedInboxFromOAuthIntent(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	const companyID = "company-shared-oauth-create"
	repo.EnsureCompany(companyID, "Shared OAuth Create")
	user, err := repo.UpsertAuthUser("subject-shared-oauth-create", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyManager); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		Scope:        "personal",
		GrantID:      "personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support Group", "")
	if err != nil {
		t.Fatal(err)
	}

	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:                    user.UserID,
		Email:                     "support@example.com",
		UserEmail:                 user.Email,
		Provider:                  "google",
		StrictEmail:               true,
		SharedInboxCompanyID:      companyID,
		SharedInboxParentFolderID: parent.FolderID,
		SharedInboxName:           "Support",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "shared-oauth-grant", Email: "support@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	redirect, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	sharedInboxID := redirect.Query().Get("nylas_shared_inbox_id")
	if redirect.Query().Get("nylas_scope") != "shared" || redirect.Query().Get("nylas_account_email") != "support@example.com" || sharedInboxID == "" {
		t.Fatalf("callback redirect = %s, want shared scope, account email, and shared inbox id", redirect.String())
	}
	created, err := repo.GetCommunicationsSharedInboxFolder(companyID, sharedInboxID)
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != "Support" || created.ParentFolderID == nil || *created.ParentFolderID != parent.FolderID || created.AccountEmail == nil || *created.AccountEmail != "support@example.com" || created.EntryType != "shared_inbox" {
		t.Fatalf("created shared inbox = %+v, want Support mailbox under parent with support account", created)
	}
	personal, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if personal.AccountEmail != user.Email || personal.GrantID != "personal-grant" || personal.Scope != "personal" {
		t.Fatalf("personal connection = %+v, want unchanged personal grant", personal)
	}
	shared, err := repo.GetCompanyEmailConnectionByAccountEmail(companyID, "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if shared.AccountEmail != "support@example.com" || shared.GrantID != "shared-oauth-grant" || shared.ConnectedByUserID != user.UserID {
		t.Fatalf("shared company connection = %+v, want company-owned support grant", shared)
	}
}

func TestNylasCallbackLinksExistingSharedInboxFromOAuthIntent(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	const companyID = "company-shared-oauth-link-existing"
	repo.EnsureCompany(companyID, "Shared OAuth Link Existing")
	user, err := repo.UpsertAuthUser("subject-shared-oauth-link-existing", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyManager); err != nil {
		t.Fatal(err)
	}
	oldConnection, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "google",
		AccountEmail:      "old-support@example.com",
		GrantID:           "old-support-grant",
		Status:            "connected",
		ConnectedByUserID: user.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", oldConnection.AccountEmail)
	if err != nil {
		t.Fatal(err)
	}

	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:               user.UserID,
		Email:                "support@example.com",
		UserEmail:            user.Email,
		Provider:             "google",
		StrictEmail:          true,
		SharedInboxCompanyID: companyID,
		SharedInboxID:        folder.FolderID,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "shared-link-grant", Email: "support@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	redirect, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if redirect.Query().Get("nylas_scope") != "shared" || redirect.Query().Get("nylas_shared_inbox_id") != folder.FolderID {
		t.Fatalf("callback redirect = %s, want shared scope and existing shared inbox id", redirect.String())
	}
	updated, err := repo.GetCommunicationsSharedInboxFolder(companyID, folder.FolderID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.AccountEmail == nil || *updated.AccountEmail != "support@example.com" {
		t.Fatalf("updated shared inbox account email = %+v, want support@example.com", updated.AccountEmail)
	}
	if updated.CompanyEmailConnectionID == "" || updated.CompanyEmailConnectionID == oldConnection.CompanyEmailConnectionID {
		t.Fatalf("updated shared inbox company connection = %q, want new connection", updated.CompanyEmailConnectionID)
	}
	shared, err := repo.GetCompanyEmailConnectionByAccountEmail(companyID, "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if shared.CompanyEmailConnectionID != updated.CompanyEmailConnectionID || shared.GrantID != "shared-link-grant" {
		t.Fatalf("shared company connection = %+v, want linked grant %s", shared, updated.CompanyEmailConnectionID)
	}
}

func TestNylasCallbackRejectsSharedInboxOAuthIntentForCompanyUser(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	const companyID = "company-shared-oauth-create-member-denied"
	repo.EnsureCompany(companyID, "Shared OAuth Create Member Denied")
	user, err := repo.UpsertAuthUser("subject-shared-oauth-create-member", "member@example.com", "Member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support Group", "")
	if err != nil {
		t.Fatal(err)
	}

	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:                    user.UserID,
		Email:                     "support@example.com",
		UserEmail:                 user.Email,
		Provider:                  "google",
		StrictEmail:               true,
		SharedInboxCompanyID:      companyID,
		SharedInboxParentFolderID: parent.FolderID,
		SharedInboxName:           "Support",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "regular-shared-grant", Email: "support@example.com", Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	redirect, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if redirect.Query().Get("nylas_error") != "company_manager_required" {
		t.Fatalf("callback redirect = %s, want company_manager_required", redirect.String())
	}
	folders, err := repo.ListCommunicationsSharedInboxFolders(companyID)
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != 1 || folders[0].FolderID != parent.FolderID {
		t.Fatalf("shared inbox folders = %+v, want only original parent", folders)
	}
	if _, err := repo.GetCompanyEmailConnectionByAccountEmail(companyID, "support@example.com"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("shared company connection error = %v, want ErrNotFound", err)
	}
	nylas.mu.Lock()
	deletedGrants := append([]string(nil), nylas.deletedGrants...)
	nylas.mu.Unlock()
	if len(deletedGrants) != 1 || deletedGrants[0] != "regular-shared-grant" {
		t.Fatalf("deleted grants = %+v, want regular-shared-grant cleanup", deletedGrants)
	}
}

func TestNylasCallbackTreatsStrictUserMailboxAsPersonalConnection(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		Scope:        "personal",
		GrantID:      "old-personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:      user.UserID,
		Email:       user.Email,
		UserEmail:   user.Email,
		Provider:    "google",
		StrictEmail: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "new-grant", Email: user.Email, Provider: "google"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.Scope != "personal" || connection.AccountEmail != user.Email || connection.GrantID != "new-grant" {
		t.Fatalf("connection = %+v, want updated personal user mailbox grant", connection)
	}
	redirect, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if redirect.Query().Get("nylas_scope") != "personal" || redirect.Query().Get("nylas_account_email") != user.Email {
		t.Fatalf("callback redirect = %s, want personal scope and account email", redirect.String())
	}
}

func TestCommunicationsHandlersReadProviderAndQueueVisibleIngestion(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-4111-8111-701300000401"
	repo.EnsureCompany(companyID, "Communications Proxy Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	providerMessage := NylasMessage{ID: "message-1", ThreadID: "thread-1", Subject: "Hello", Body: "Provider body", Unread: true, Folders: []string{"INBOX"}}
	nylas := &fakeNylasClient{
		folders:  []NylasFolder{{ID: "inbox", Name: "Inbox", Attributes: []string{"\\Inbox"}}},
		messages: []NylasMessage{providerMessage}, message: providerMessage,
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas,
		EmailQueue: &recordingEmailQueueSender{},
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	companyQuery := "company_id=" + url.QueryEscape(companyID)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/status", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders?"+companyQuery, "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?"+companyQuery+"&limit=5&unread=true", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1?"+companyQuery, "", token, http.StatusOK)
	if nylas.messageCalls != 1 || nylas.detailCalls < 1 || nylas.lastMessageGrantID != "grant-1" || nylas.lastDetailGrantID != "grant-1" {
		t.Fatalf("provider reads list=%d detail=%d list_grant=%q detail_grant=%q", nylas.messageCalls, nylas.detailCalls, nylas.lastMessageGrantID, nylas.lastDetailGrantID)
	}
	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/messages/message-1?"+companyQuery, `{"unread":false}`, token, http.StatusOK)
	if len(nylas.updateCalls) != 1 || nylas.updateCalls[0].GrantID != "grant-1" || nylas.updateCalls[0].MessageID != "message-1" {
		t.Fatalf("provider update calls = %+v, want exact personal grant and message", nylas.updateCalls)
	}
	threads, err := repo.ListCommunicationsEmailThreadsForAccount(store.CommunicationsEmailAccountReadInput{
		CompanyID: companyID, PersonalUserID: user.UserID, PersonalAccountEmail: user.Email, AccountEmail: user.Email, Provider: "google",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(threads) != 0 {
		t.Fatalf("the pre-activation visible message stored %d V3 threads, want 0", len(threads))
	}
	sendBody := `{"company_id":"` + companyID + `","to":[{"email":"friend@example.com"}],"subject":"Hi","body":"Body"}`
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send", sendBody, token, http.StatusCreated)
	if nylas.lastSendGrantID != "grant-1" || nylas.sent.Subject != "Hi" {
		t.Fatalf("provider send grant=%q payload=%+v", nylas.lastSendGrantID, nylas.sent)
	}
}

func TestCommunicationsStoredSearchAndSelectedMessageIngestion(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "stored-email-user"
	const companyID = "11111111-1111-4111-8111-701300000499"
	repo.EnsureCompany(companyID, "Stored Email Search Company")
	user, err := repo.UpsertAuthUser(subject, "stored@example.com", "Stored User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "stored-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: user.UserID, PersonalAccountEmail: user.Email,
		AccountEmail: user.Email, Provider: "google", ProviderThreadID: "stored-thread",
		SelectedMessageID: "stored-message", HistoryComplete: true,
		Messages: []domain.EmailMessageSnapshot{{
			ID: "stored-message", ThreadID: "stored-thread", Subject: "Already stored", Date: 100,
			Unread: true, Folders: []string{"INBOX"},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	providerMessage := NylasMessage{
		ID: "provider-only", ThreadID: "provider-thread", Subject: "Provider only", Date: 200,
		Unread: true, Folders: []string{"INBOX"},
	}
	nylas := &fakeNylasClient{message: providerMessage, messagesByID: map[string]NylasMessage{"provider-only": providerMessage}}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas,
		EmailQueue: &recordingEmailQueueSender{},
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	base := "company_id=" + url.QueryEscape(companyID) + "&account_email=" + url.QueryEscape(user.Email)

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/stored-messages?"+base+"&mailbox=primary&q=Already&limit=12", nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("stored search status=%d body=%s", rec.Code, rec.Body.String())
	}
	var storedPage NylasMessagePage
	if err := json.NewDecoder(rec.Body).Decode(&storedPage); err != nil {
		t.Fatal(err)
	}
	if len(storedPage.Messages) != 1 || storedPage.Messages[0].ID != "stored-message" ||
		storedPage.Messages[0].EmailMessageID != stored.Messages[0].EmailMessageID {
		t.Fatalf("stored search page=%+v", storedPage)
	}
	if nylas.messageCalls != 0 || nylas.detailCalls != 0 {
		t.Fatalf("stored search called provider list=%d detail=%d", nylas.messageCalls, nylas.detailCalls)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/communications/messages/provider-only/ingest?"+base, nil)
	req.Header.Set("Authorization", token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("selected ingestion status=%d body=%s", rec.Code, rec.Body.String())
	}
	var ingested struct {
		Message NylasMessage `json:"message"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&ingested); err != nil {
		t.Fatal(err)
	}
	if ingested.Message.ID != "provider-only" || strings.TrimSpace(ingested.Message.EmailMessageID) == "" {
		t.Fatalf("ingested message=%+v", ingested.Message)
	}
	threads, err := repo.ListCommunicationsEmailThreadsForAccount(store.CommunicationsEmailAccountReadInput{
		CompanyID: companyID, PersonalUserID: user.UserID, PersonalAccountEmail: user.Email,
		AccountEmail: user.Email, Provider: "google",
	})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, thread := range threads {
		for _, message := range thread.Messages {
			if message.ProviderMessageID == "provider-only" && message.EmailMessageID == ingested.Message.EmailMessageID {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("selected provider message was not durably ingested with the returned Mango message ID")
	}
}

func TestMessageNeedsRawMIMEAttachmentRecoveryOnlyForUnresolvedCID(t *testing.T) {
	t.Parallel()

	resolvedInline := NylasAttachment{ID: "inline-1", ContentID: "image-1", Content: "aW1hZ2U="}
	tests := []struct {
		name    string
		message NylasMessage
		want    bool
	}{
		{name: "body only", message: NylasMessage{Body: "<p>Hello</p>"}},
		{name: "ordinary attachment", message: NylasMessage{Body: "<p>Hello</p>", Attachments: []NylasAttachment{{ID: "file-1", Filename: "report.pdf"}}}},
		{name: "unresolved cid", message: NylasMessage{Body: "<img src=\"cid:image-1\">"}, want: true},
		{name: "cid metadata with provider download id", message: NylasMessage{Body: "<img src=\"cid:image-1\">", Attachments: []NylasAttachment{{ID: "inline-1", ContentID: "image-1"}}}},
		{name: "cid metadata without usable content", message: NylasMessage{Body: "<img src=\"cid:image-1\">", Attachments: []NylasAttachment{{ContentID: "image-1"}}}, want: true},
		{name: "resolved cid", message: NylasMessage{Body: "<img src=\"cid:image-1\">", Attachments: []NylasAttachment{resolvedInline}}},
		{name: "already recovered", message: NylasMessage{Body: "<img src=\"cid:image-1\">", RawMIMEAttachmentsRecovered: true}},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := messageNeedsRawMIMEAttachmentRecovery(test.message); got != test.want {
				t.Fatalf("messageNeedsRawMIMEAttachmentRecovery() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestCommunicationsSendResolvesLargeMangoAttachmentWithQueryCompanyID(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-1111-1111-111111111111"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Company")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{}
	storage := newFakeAttachmentObjectStorage()
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:     testValidator(t, "kid", key),
		NylasConfig:       testNylasConfig(),
		NylasClient:       nylas,
		AttachmentStorage: storage,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	largeContent := []byte(strings.Repeat("ABC", 280000))
	attachmentID := seedLiveEmailDraftAttachmentForCommunicationsTest(t, repo, storage, user.UserID, companyID, user.Email, personalEmailDraftResourceID(user.UserID, user.Email, "draft-large"), "large.txt", "text/plain", largeContent)
	body := `{"to":[{"email":"friend@example.com"}],"subject":"Hi","body":"Body","attachments":[{"attachment_id":"` + attachmentID + `","filename":"large.txt","content_type":"text/plain","size":` + fmt.Sprint(len(largeContent)) + `}]}`

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send?company_id="+companyID, body, token, http.StatusCreated)
	if len(nylas.sent.Attachments) != 1 || nylas.sent.Attachments[0].Filename != "large.txt" || nylas.sent.Attachments[0].Content != "" ||
		len(nylas.sent.OutboundAttachments) != 1 || len(nylas.sentAttachmentBodies) != 1 || string(nylas.sentAttachmentBodies[0]) != string(largeContent) {
		t.Fatalf("metadata=%+v outbound=%+v body count=%d, want streamed large Mango attachment", nylas.sent.Attachments, nylas.sent.OutboundAttachments, len(nylas.sentAttachmentBodies))
	}
}

func TestCommunicationsSendRejectsRawAttachmentContent(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "communications-raw-content-company"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Communications Raw Content Company")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{}
	storage := newFakeAttachmentObjectStorage()
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:     testValidator(t, "kid", key),
		NylasConfig:       testNylasConfig(),
		NylasClient:       nylas,
		AttachmentStorage: storage,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	body := `{"company_id":"` + companyID + `","to":[{"email":"friend@example.com"}],"subject":"Hi","body":"Body","attachments":[{"filename":"large.txt","content":"QUJD"}]}`

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send", body, token, http.StatusBadRequest)
	if nylas.lastSendGrantID != "" {
		t.Fatalf("send grant after raw attachment request = %q, want none", nylas.lastSendGrantID)
	}
}

func TestCommunicationsSendRejectsInlineDataURLBody(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "communications-inline-body-company"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Communications Inline Body Company")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	body := `{"company_id":"` + companyID + `","to":[{"email":"friend@example.com"}],"subject":"Hi","body":"<img src=\"data:image/png;base64,aGVsbG8=\">"}`

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send", body, token, http.StatusBadRequest)
	if nylas.lastSendGrantID != "" {
		t.Fatalf("send grant after inline data URL body = %q, want none", nylas.lastSendGrantID)
	}
}

func TestCommunicationsFoldersUseSharedInboxConnection(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-folders"
	repo.EnsureCompany(companyID, "Shared Folders Company")
	actor, err := repo.UpsertAuthUser("actor-subject", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("actor-subject", companyID, "company_user"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "microsoft",
		AccountEmail:      "support@example.com",
		GrantID:           "grant-shared",
		Status:            "connected",
		ConnectedByUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedInbox,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   actor.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	totalCount := 42
	nylas := &fakeNylasClient{
		folders: []NylasFolder{{ID: "archive", Name: "Archive", Attributes: []string{"\\Archive"}, TotalCount: &totalCount}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)

	path := "/v1/communications/folders?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	assertJSONStatus(t, handler, http.MethodGet, path, "", token, http.StatusOK)
	if nylas.lastFolderGrantID != "grant-shared" {
		t.Fatalf("folder grant = %q, want shared inbox grant", nylas.lastFolderGrantID)
	}
	assertJSONStatus(t, handler, http.MethodGet, path+"&refresh=true", "", token, http.StatusOK)
	if nylas.lastFolderGrantID != "grant-shared" || nylas.folderCalls != 2 {
		t.Fatalf("refreshed shared folders grant=%q calls=%d, want exact grant-shared and 2 calls", nylas.lastFolderGrantID, nylas.folderCalls)
	}
}

func TestCommunicationsFoldersWebhookInvalidationFencesInFlightProviderResult(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	client := &blockingCommunicationsNylasClient{
		fakeNylasClient: &fakeNylasClient{},
		folderStarted:   started,
		folderRelease:   release,
		folderResult:    []NylasFolder{{ID: "inbox", Name: "Inbox before commit"}},
	}
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{
		NylasClient:                    client,
		DisableNotificationCleanup:     true,
		DisableAttachmentUploadCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	connection := domain.UserEmailConnection{
		UserID:       "folder-race-user",
		Provider:     "google",
		AccountEmail: "account-a@example.com",
		GrantID:      "folder-race-grant-a",
		Scope:        "personal",
	}
	cacheScope := communicationsConnectionCacheScope(connection)
	otherScope := "grant:folder-race-grant-b"
	server.commCache.setFolders(connection.UserID, otherScope, []NylasFolder{{ID: "other-inbox", Name: "Other account inbox"}}, time.Now().UTC())

	type folderResult struct {
		folders []NylasFolder
		err     error
	}
	results := make(chan folderResult, 2)
	go func() {
		folders, err := server.communicationsFolders(context.Background(), connection, false)
		results <- folderResult{folders: folders, err: err}
	}()
	<-started

	joinedFlight := make(chan struct{})
	joinedContext := &doneObservingContext{Context: context.Background(), observed: joinedFlight}
	go func() {
		folders, err := server.communicationsFolders(joinedContext, connection, false)
		results <- folderResult{folders: folders, err: err}
	}()
	<-joinedFlight
	generationKey := communicationsAccountScopedCacheKey(connection.UserID, cacheScope)
	waitForCommunicationsCacheGenerationOwners(t, server.commCache, "folder", generationKey, 2)

	server.applyNylasWebhookCacheInvalidation(connection.UserID, cacheScope, nylasWebhookChange{Trigger: "folder.updated"})
	client.setFolderResult([]NylasFolder{{ID: "inbox", Name: "Inbox after commit"}})
	close(release)
	for i := 0; i < 2; i++ {
		result := <-results
		if result.err != nil {
			t.Fatalf("initial coalesced folder read %d: %v", i+1, result.err)
		}
		if len(result.folders) != 1 || result.folders[0].Name != "Inbox before commit" {
			t.Fatalf("initial coalesced folder read %d = %+v, want pre-commit provider response", i+1, result.folders)
		}
	}
	if calls := client.folderReadCalls(); calls != 1 {
		t.Fatalf("coalesced initial folder provider calls = %d, want 1", calls)
	}
	if cached, ok := server.commCache.getFolders(connection.UserID, cacheScope, communicationsMaxStaleTTL, time.Now().UTC()); ok {
		t.Fatalf("in-flight pre-commit provider result repopulated invalidated cache: %+v", cached)
	}
	if cached, ok := server.commCache.getFolders(connection.UserID, otherScope, communicationsMaxStaleTTL, time.Now().UTC()); !ok || len(cached) != 1 || cached[0].ID != "other-inbox" {
		t.Fatalf("exact account A invalidation evicted account B folders: %+v present=%t", cached, ok)
	}

	refreshed, err := server.communicationsFolders(context.Background(), connection, true)
	if err != nil {
		t.Fatalf("post-commit folder refresh: %v", err)
	}
	if len(refreshed) != 1 || refreshed[0].Name != "Inbox after commit" {
		t.Fatalf("post-commit folder refresh = %+v, want canonical post-commit folders", refreshed)
	}
	if calls := client.folderReadCalls(); calls != 2 {
		t.Fatalf("folder provider calls after post-commit refresh = %d, want 2", calls)
	}
	cached, ok := server.commCache.getFolders(connection.UserID, cacheScope, communicationsFoldersCacheTTL, time.Now().UTC())
	if !ok || len(cached) != 1 || cached[0].Name != "Inbox after commit" {
		t.Fatalf("post-commit folder cache = %+v present=%t, want refreshed canonical folders", cached, ok)
	}
	if _, err := server.communicationsFolders(context.Background(), connection, false); err != nil {
		t.Fatalf("read refreshed folder cache: %v", err)
	}
	if calls := client.folderReadCalls(); calls != 2 {
		t.Fatalf("provider calls after reading refreshed cache = %d, want 2", calls)
	}
}

func TestCommunicationsFoldersInvalidationFencesRequestQueuedBeforeProviderStart(t *testing.T) {
	providerStarted := make(chan struct{})
	client := &blockingCommunicationsNylasClient{
		fakeNylasClient: &fakeNylasClient{},
		folderStarted:   providerStarted,
		folderResult:    []NylasFolder{{ID: "inbox", Name: "Post-commit provider result"}},
	}
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{
		NylasClient:                    client,
		DisableNotificationCleanup:     true,
		DisableAttachmentUploadCleanup: true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	server.nylasGate.capacity = 1
	connection := domain.UserEmailConnection{UserID: "queued-folder-user", Provider: "google", AccountEmail: "queued@example.com", GrantID: "queued-folder-grant", Scope: "personal"}
	releaseGate, err := server.nylasGate.acquire(context.Background(), connection.GrantID)
	if err != nil {
		t.Fatal(err)
	}
	defer releaseGate()

	queuedAtGate := make(chan struct{})
	requestContext := &doneObservingContext{Context: context.Background(), observed: queuedAtGate}
	result := make(chan error, 1)
	go func() {
		_, err := server.communicationsFolders(requestContext, connection, false)
		result <- err
	}()
	<-queuedAtGate
	cacheScope := communicationsConnectionCacheScope(connection)
	server.applyNylasWebhookCacheInvalidation(connection.UserID, cacheScope, nylasWebhookChange{Trigger: "folder.updated"})
	releaseGate()
	<-providerStarted
	if err := <-result; err != nil {
		t.Fatalf("queued pre-invalidation folder request: %v", err)
	}
	if cached, ok := server.commCache.getFolders(connection.UserID, cacheScope, communicationsFoldersCacheTTL, time.Now().UTC()); ok {
		t.Fatalf("request admitted before invalidation cached a later provider result under the new generation: %+v", cached)
	}

	refreshed, err := server.communicationsFolders(context.Background(), connection, true)
	if err != nil {
		t.Fatalf("post-invalidation canonical folder refresh: %v", err)
	}
	if len(refreshed) != 1 || refreshed[0].Name != "Post-commit provider result" {
		t.Fatalf("post-invalidation canonical folders = %+v", refreshed)
	}
	if calls := client.folderReadCalls(); calls != 2 {
		t.Fatalf("queued request plus post-invalidation refresh provider calls = %d, want 2", calls)
	}
}

func TestCommunicationsPersonalReadsSelectExactOwnedAccount(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000402"
	repo.EnsureCompany(companyID, "Exact Account Read Company")
	actor, err := repo.UpsertAuthUser("exact-account-actor", "account-a@example.com", "Exact Account Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	for _, connection := range []store.UserEmailConnectionInput{
		{UserID: actor.UserID, Provider: "google", AccountEmail: "account-a@example.com", GrantID: "grant-account-a", Status: "connected"},
		{UserID: actor.UserID, Provider: "microsoft", AccountEmail: "account-b@example.com", GrantID: "grant-account-b", Status: "connected"},
	} {
		if _, err := repo.UpsertUserEmailConnection(connection); err != nil {
			t.Fatal(err)
		}
	}
	other, err := repo.UpsertAuthUser("exact-account-other", "other@example.com", "Other Account Owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: other.UserID, Provider: "google", AccountEmail: other.Email, GrantID: "grant-other", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders: []NylasFolder{{ID: "inbox", Name: "Inbox", Attributes: []string{"\\Inbox"}}},
		messagesByGrantID: map[string][]NylasMessage{
			"grant-account-a": []NylasMessage{{ID: "message-a", Subject: "Account A", Folders: []string{"INBOX"}}},
			"grant-account-b": []NylasMessage{{ID: "message-b", Subject: "Account B", Folders: []string{"Inbox"}}},
			"grant-other":     []NylasMessage{{ID: "message-other", Subject: "Other user", Folders: []string{"INBOX"}}},
		},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)
	base := "company_id=" + url.QueryEscape(companyID)
	path := "/v1/communications/messages?" + base + "&mailbox=primary&limit=5&account_email=ACCOUNT-B%40EXAMPLE.COM"
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("exact account messages status=%d body=%s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); !strings.Contains(body, "message-b") || strings.Contains(body, "message-a") || strings.Contains(body, "message-other") {
		t.Fatalf("exact account response=%s, want only account B", body)
	}
	if nylas.messageCalls != 1 || nylas.lastMessageGrantID != "grant-account-b" {
		t.Fatalf("exact-account provider reads=%d grant=%q, want one grant-account-b call", nylas.messageCalls, nylas.lastMessageGrantID)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders?"+base+"&account_email=ACCOUNT-B%40EXAMPLE.COM", "", token, http.StatusOK)
	if nylas.lastFolderGrantID != "grant-account-b" || nylas.folderCalls != 1 {
		t.Fatalf("exact account folder grant=%q calls=%d", nylas.lastFolderGrantID, nylas.folderCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?"+base+"&account_email=missing%40example.com", "", token, http.StatusForbidden)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?"+base+"&account_email=other%40example.com", "", token, http.StatusForbidden)
}

func TestCommunicationsSendUsesSharedInboxConnectionAndRequiresEdit(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000411"
	repo.EnsureCompany(companyID, "Shared Send Company")
	actor, err := repo.UpsertAuthUser("shared-send-actor", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	sharedUser, err := repo.UpsertAuthUser("shared-send-account", "support@example.com", "Support")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(sharedUser.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       sharedUser.UserID,
		Provider:     "google",
		AccountEmail: sharedUser.Email,
		Scope:        "shared",
		GrantID:      "grant-support",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", sharedUser.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInbox,
		EntityID:         folder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{}
	storage := newFakeAttachmentObjectStorage()
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:     testValidator(t, "kid", key),
		NylasConfig:       testNylasConfig(),
		NylasClient:       nylas,
		AttachmentStorage: storage,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)
	path := "/v1/communications/messages/send?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	body := `{"to":[{"email":"customer@example.com"}],"subject":"Shared hello","body":"Body"}`
	assertJSONStatus(t, handler, http.MethodPost, path, body, token, http.StatusNotFound)
	if nylas.lastSendGrantID != "" {
		t.Fatalf("send grant after denied request = %q, want none", nylas.lastSendGrantID)
	}

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInbox,
		EntityID:         folder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	sharedContent := []byte("shared attachment bytes")
	if _, err := repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "draft-shared-send", SharedInboxID: folder.FolderID,
		AccountEmail: sharedUser.Email, CreatedByUserID: actor.UserID, UpdatedByUserID: actor.UserID, Kind: "compose",
	}); err != nil {
		t.Fatalf("seed shared V3 email draft: %v", err)
	}
	attachmentID := seedEmailAttachmentForCommunicationsTest(t, repo, storage, actor.UserID, companyID, "draft-shared-send", "shared-large.txt", "text/plain", sharedContent)
	largeBody := `{"to":[{"email":"customer@example.com"}],"subject":"Shared hello","body":"Body","attachments":[{"attachment_id":"` + attachmentID + `","filename":"shared-large.txt","content_type":"text/plain","size":` + fmt.Sprint(len(sharedContent)) + `}]}`
	assertJSONStatus(t, handler, http.MethodPost, path, largeBody, token, http.StatusCreated)
	if nylas.lastSendGrantID != "grant-support" {
		t.Fatalf("send grant = %q, want shared inbox grant", nylas.lastSendGrantID)
	}
	if nylas.sent.To[0].Email != "customer@example.com" || nylas.sent.Subject != "Shared hello" {
		t.Fatalf("sent = %+v, want shared inbox send payload", nylas.sent)
	}
	if len(nylas.sent.Attachments) != 1 || nylas.sent.Attachments[0].AttachmentID != attachmentID || nylas.sent.Attachments[0].Filename != "shared-large.txt" || nylas.sent.Attachments[0].Content != "" ||
		len(nylas.sent.OutboundAttachments) != 1 || len(nylas.sentAttachmentBodies) != 1 || string(nylas.sentAttachmentBodies[0]) != string(sharedContent) {
		t.Fatalf("metadata=%+v outbound=%+v bodies=%q, want streamed shared inbox attachment", nylas.sent.Attachments, nylas.sent.OutboundAttachments, nylas.sentAttachmentBodies)
	}
	storedSignature, err := repo.UpsertCommunicationsEmailSignature(store.CommunicationsEmailSignatureInput{
		CompanyID: companyID, SharedInboxID: folder.FolderID, Name: "Shared default",
		IsDefault: true, CreatedByUserID: actor.UserID, UpdatedByUserID: actor.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	inlineOriginal := []byte("shared-signature-original")
	inlineAttachmentID := seedEmailSignatureAttachmentForCommunicationsTest(t, repo, storage, actor.UserID, companyID, storedSignature.SignatureID, inlineOriginal, []byte("shared-signature-display"))
	signatureBody := "<p>Shared regards</p><img src=\"mango-attachment:" + url.PathEscape(inlineAttachmentID) + "\">"
	if _, err := repo.UpsertCommunicationsEmailSignature(store.CommunicationsEmailSignatureInput{
		CompanyID: companyID, SignatureID: storedSignature.SignatureID, SharedInboxID: folder.FolderID, Name: "Shared default",
		BodyEditorHTML: signatureBody, IsDefault: true, CreatedByUserID: actor.UserID, UpdatedByUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	inlinePayload, err := json.Marshal(map[string]any{
		"to":      []map[string]string{{"email": "customer@example.com"}},
		"subject": "Shared signature image",
		"body":    "<p>Hello</p>" + signatureBody,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertJSONStatus(t, handler, http.MethodPost, path, string(inlinePayload), token, http.StatusCreated)
	inlineContentID := communicationsInlineImageContentID(inlineAttachmentID)
	if nylas.lastSendGrantID != "grant-support" || !strings.Contains(nylas.sent.Body, `src="cid:`+inlineContentID+`"`) {
		t.Fatalf("shared inline send grant=%q body=%q", nylas.lastSendGrantID, nylas.sent.Body)
	}
	if len(nylas.sent.Attachments) != 1 || nylas.sent.Attachments[0].AttachmentID != inlineAttachmentID || nylas.sent.Attachments[0].ContentID != inlineContentID || !nylas.sent.Attachments[0].IsInline || nylas.sent.Attachments[0].Content != "" ||
		len(nylas.sent.OutboundAttachments) != 1 || !validAttachmentSHA256Hex(nylas.sent.OutboundAttachments[0].SHA256) ||
		len(nylas.sentAttachmentBodies) != 1 || !bytes.Equal(nylas.sentAttachmentBodies[0], inlineOriginal) {
		t.Fatalf("shared inline metadata=%+v outbound=%+v bodies=%q, want one checksum-validated original CID signature image", nylas.sent.Attachments, nylas.sent.OutboundAttachments, nylas.sentAttachmentBodies)
	}
}

func TestParseNylasWebhookChangesCanonicalizesMailboxTriggers(t *testing.T) {
	t.Parallel()

	changes, err := parseNylasWebhookChanges([]byte(`{
		"deltas": [
			{"type": " Message.Created.Truncated ", "data": {"object": {"id": "message-1", "grant_id": "grant-1"}}},
			{"trigger_type": "FOLDER.UPDATED.extra", "data": {"object": {"id": "folder-1", "grant_id": "grant-1"}}},
			{"event": "thread.replied", "data": {"object": {"id": "thread-1", "grant_id": "grant-1"}}},
			{"type": "GRANT.EXPIRED", "data": {"object": {"grant_id": "grant-1"}}},
			{"type": "grant.updated.extra", "data": {"object": {"grant_id": "grant-1"}}}
		]
	}`))
	if err != nil {
		t.Fatalf("parseNylasWebhookChanges: %v", err)
	}
	if len(changes) != 5 {
		t.Fatalf("changes = %d, want 5", len(changes))
	}
	if changes[0].Trigger != "message.created" {
		t.Fatalf("created trigger = %q, want canonical message.created", changes[0].Trigger)
	}
	if changes[1].Trigger != "folder.updated" {
		t.Fatalf("folder trigger = %q, want canonical folder.updated", changes[1].Trigger)
	}
	if changes[2].Trigger != "" {
		t.Fatalf("unsupported trigger = %q, want empty", changes[2].Trigger)
	}
	if changes[3].Trigger != "grant.expired" || changes[4].Trigger != "grant.updated" {
		t.Fatalf("grant triggers = %q, %q", changes[3].Trigger, changes[4].Trigger)
	}
}

func TestNylasGrantWebhooksPauseAndResumePermanentConnection(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "71717171-7171-4171-8171-717171717170"
	repo.EnsureCompany(companyID, "Grant lifecycle")
	user := mustRealtimeAuthUser(t, repo, companyID, "grant-lifecycle-user", domain.RoleCompanyUser)
	original, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: companyID, UserID: user.UserID, Provider: "google",
		AccountEmail: user.Email, GrantID: "grant-lifecycle", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config, NylasClient: &fakeNylasClient{},
	})
	defer server.Close()
	handler := server.Routes()

	send := func(body string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
		req.Header.Set("X-Nylas-Signature", signWebhookBody(config.WebhookSecret, body))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("webhook status=%d body=%s", rec.Code, rec.Body.String())
		}
	}
	send("{\"type\":\"grant.expired\",\"data\":{\"object\":{\"grant_id\":\"grant-lifecycle\"}}}")
	expired, err := repo.GetEmailConnectionByIDContext(context.Background(), companyID, original.EmailConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if expired.Status != "reauth_required" {
		t.Fatalf("expired status=%q, want reauth_required", expired.Status)
	}
	send("{\"type\":\"grant.updated\",\"data\":{\"object\":{\"grant_id\":\"grant-lifecycle\"}}}")
	resumed, err := repo.GetEmailConnectionByIDContext(context.Background(), companyID, original.EmailConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if resumed.Status != "connected" || resumed.EmailConnectionID != original.EmailConnectionID ||
		!resumed.IngestionStartedAt.Equal(original.IngestionStartedAt) ||
		!resumed.LastSuccessfulScanAt.Equal(original.LastSuccessfulScanAt) {
		t.Fatalf("resumed connection=%+v, want stable identity and checkpoints from %+v", resumed, original)
	}
}

func TestParseNylasWebhookChangesCapturesRenderableMessageSnapshot(t *testing.T) {
	t.Parallel()

	changes, err := parseNylasWebhookChanges([]byte("{\"type\":\"message.created\",\"data\":{\"object\":{\"id\":\"message-renderable\",\"thread_id\":\"thread-renderable\",\"grant_id\":\"grant-renderable\",\"subject\":\"Renderable update\",\"snippet\":\"A complete webhook snapshot\",\"body\":\"<p>Complete body</p>\",\"date\":1783989000,\"from\":[{\"name\":\"Sender\",\"email\":\"sender@example.com\"}],\"to\":[{\"email\":\"recipient@example.com\"}],\"unread\":true}}}"))
	if err != nil {
		t.Fatalf("parseNylasWebhookChanges: %v", err)
	}
	if len(changes) != 1 || !changes[0].MessageHydrated {
		t.Fatalf("changes = %+v, want one hydrated message", changes)
	}
	message := changes[0].Message
	if message.ID != "message-renderable" || message.ThreadID != "thread-renderable" ||
		message.Subject != "Renderable update" || message.Body != "<p>Complete body</p>" ||
		len(message.From) != 1 || message.From[0].Email != "sender@example.com" {
		t.Fatalf("message snapshot = %+v", message)
	}
}

func TestCommunicationsDefaultMailboxOrdinaryLoadAlwaysExcludesSocialAndPromotions(t *testing.T) {
	t.Parallel()

	query, err := new(Server).applyCommunicationsMailboxQuery(
		context.Background(),
		domain.UserEmailConnection{Provider: "google"},
		NylasMessageQuery{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if query.SearchQueryNative != "in:inbox -category:social -category:promotions" {
		t.Fatalf("ordinary Primary search_query_native = %q", query.SearchQueryNative)
	}
	if query.Mailbox != "primary" || query.Query != "" || query.Unread != nil || query.FolderID != "" || query.ThreadID != "" || query.Starred != nil {
		t.Fatalf("ordinary Primary query = %+v, want one Gmail-native bucket expression", query)
	}
}

func TestCommunicationsGoogleThreadListBypassesMailboxNativeSearch(t *testing.T) {
	t.Parallel()

	unread := true
	starred := true
	query, err := new(Server).applyCommunicationsMailboxQuery(
		context.Background(),
		domain.UserEmailConnection{Provider: "google"},
		NylasMessageQuery{
			Limit:             12,
			PageToken:         "thread-page",
			FolderID:          "INBOX",
			ThreadID:          "thread-1",
			Query:             "invoice",
			SearchQueryNative: "in:anywhere",
			Mailbox:           "primary",
			CompanyID:         "company-1",
			SharedInboxID:     "shared-inbox-1",
			Unread:            &unread,
			Starred:           &starred,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if query.ThreadID != "thread-1" || query.Mailbox != "all" || query.Limit != 12 || query.PageToken != "thread-page" ||
		query.CompanyID != "company-1" || query.SharedInboxID != "shared-inbox-1" {
		t.Fatalf("thread query lost paging or mailbox scope: %+v", query)
	}
	if query.SearchQueryNative != "" || query.Query != "" || query.Unread != nil || query.Starred != nil || query.FolderID != "" {
		t.Fatalf("thread query = %+v, want structured thread_id mode only", query)
	}
	threadPage := filterGooglePrimaryMessagePage(
		domain.UserEmailConnection{Provider: "google"},
		query,
		NylasMessagePage{Messages: []NylasMessage{
			{ID: "received", Folders: []string{"INBOX", "CATEGORY_SOCIAL"}},
			{ID: "sent", Folders: []string{"SENT"}},
		}},
	)
	if len(threadPage.Messages) != 2 {
		t.Fatalf("thread page = %+v, want complete received and sent history", threadPage.Messages)
	}
}

func TestCommunicationsStarMessagePreservesGmailInboxLabel(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-4111-8111-701300000403"
	repo.EnsureCompany(companyID, "Star Message Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{CompanyID: companyID, UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected"}); err != nil {
		t.Fatal(err)
	}
	message := NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"INBOX", "UNREAD", "CATEGORY_PERSONAL", "SNOOZED", "CHAT", "Label_123"}}
	seedPersonalV3EmailMessageForCommunicationsTest(t, repo, companyID, user.UserID, user.Email, "google", message)
	nylas := &fakeNylasClient{message: message}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/messages/message-1?company_id="+url.QueryEscape(companyID), `{"starred":true}`, token, http.StatusOK)
	if nylas.update.Starred == nil || !*nylas.update.Starred || nylas.update.Folders != nil {
		t.Fatalf("star update = %+v, want starred=true without folder replacement", nylas.update)
	}
}

func TestCommunicationsArchiveMessageEndpointIsRemovedForGmail(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-4111-8111-701300000404"
	repo.EnsureCompany(companyID, "Archive Google Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected"}); err != nil {
		t.Fatal(err)
	}
	message := NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"INBOX", "UNREAD", "CATEGORY_PERSONAL", "SNOOZED", "CHAT", "STARRED", "Label_123"}}
	seedPersonalV3EmailMessageForCommunicationsTest(t, repo, companyID, user.UserID, user.Email, "google", message)
	nylas := &fakeNylasClient{message: message}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/archive?company_id="+url.QueryEscape(companyID), "", token, http.StatusNotFound)
	if len(nylas.updateCalls) != 0 {
		t.Fatalf("removed single-message endpoint performed provider mutations: %+v", nylas.updateCalls)
	}
}

func TestCommunicationsArchiveMessageEndpointIsRemovedForMicrosoft(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-4111-8111-701300000405"
	repo.EnsureCompany(companyID, "Archive Microsoft Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "microsoft", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected"}); err != nil {
		t.Fatal(err)
	}
	message := NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"inbox-id"}}
	seedPersonalV3EmailMessageForCommunicationsTest(t, repo, companyID, user.UserID, user.Email, "microsoft", message)
	nylas := &fakeNylasClient{folders: []NylasFolder{{ID: "inbox-id", Name: "Inbox"}, {ID: "archive-id", Name: "Archive"}}, message: message}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/archive?company_id="+url.QueryEscape(companyID), "", token, http.StatusNotFound)
	if len(nylas.updateCalls) != 0 || nylas.detailCalls != 0 {
		t.Fatalf("removed single-message endpoint performed provider work: updates=%+v detail_calls=%d", nylas.updateCalls, nylas.detailCalls)
	}
}

func TestCommunicationsArchiveBatchOnlyCreatesCompactSQSItems(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-4111-8111-701300000406"
	repo.EnsureCompany(companyID, "Archive Batch Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected"}); err != nil {
		t.Fatal(err)
	}
	message1 := NylasMessage{ID: "message-1", Subject: "One", Folders: []string{"INBOX", "CATEGORY_PERSONAL", "Label_123"}}
	message2 := NylasMessage{ID: "message-2", Subject: "Two", Folders: []string{"INBOX", "Label_456"}}
	seedPersonalV3EmailMessageForCommunicationsTest(t, repo, companyID, user.UserID, user.Email, "google", message1)
	seedPersonalV3EmailMessageForCommunicationsTest(t, repo, companyID, user.UserID, user.Email, "google", message2)
	nylas := &fakeNylasClient{messagesByID: map[string]NylasMessage{"message-1": message1, "message-2": message2}}
	queue := &recordingEmailQueueSender{}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas, EmailQueue: queue}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	body := `{"message_ids":["message-1","message-2","message-1"," "]}`
	path := "/v1/communications/messages/archive-batch?company_id=" + url.QueryEscape(companyID)
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("archive batch status=%d body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"message"`) || strings.Contains(rec.Body.String(), "CATEGORY_PERSONAL") {
		t.Fatalf("batch response should be compact, got %s", rec.Body.String())
	}
	var payload struct {
		ArchiveJob store.CommunicationsArchiveJob `json:"archive_job"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.ArchiveJob.JobID == "" || len(payload.ArchiveJob.Items) != 2 {
		t.Fatalf("archive batch payload = %+v", payload)
	}
	statusReq := httptest.NewRequest(http.MethodGet, "/v1/communications/archive-jobs/"+url.PathEscape(payload.ArchiveJob.JobID), nil)
	statusReq.Header.Set("Authorization", token)
	statusRec := httptest.NewRecorder()
	handler.ServeHTTP(statusRec, statusReq)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("archive job read status=%d body=%s", statusRec.Code, statusRec.Body.String())
	}
	var statusPayload struct {
		ArchiveJob store.CommunicationsArchiveJob `json:"archive_job"`
	}
	if err := json.NewDecoder(statusRec.Body).Decode(&statusPayload); err != nil {
		t.Fatal(err)
	}
	if statusPayload.ArchiveJob.JobID != payload.ArchiveJob.JobID || len(statusPayload.ArchiveJob.Items) != 2 {
		t.Fatalf("archive job read = %+v, want returned job identity %s", statusPayload, payload.ArchiveJob.JobID)
	}
	if nylas.detailCalls != 0 || len(nylas.updateCalls) != 0 || len(queue.messages) != 2 {
		t.Fatalf("API process provider work detail=%d updates=%+v queue=%+v", nylas.detailCalls, nylas.updateCalls, queue.messages)
	}
}

func TestCommunicationsArchiveBatchRejectsObsoleteBackgroundSwitch(t *testing.T) {
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-4111-8111-701300000407"
	repo.EnsureCompany(companyID, "Background Archive Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected"}); err != nil {
		t.Fatal(err)
	}
	messages := []NylasMessage{
		{ID: "message-1", Subject: "One", Folders: []string{"INBOX", "CATEGORY_PERSONAL", "Label_123"}},
		{ID: "message-2", Subject: "Two", Folders: []string{"INBOX", "Label_456"}},
	}
	messagesByID := map[string]NylasMessage{}
	for _, message := range messages {
		seedPersonalV3EmailMessageForCommunicationsTest(t, repo, companyID, user.UserID, user.Email, "google", message)
		messagesByID[message.ID] = message
	}
	nylas := &fakeNylasClient{messagesByID: messagesByID}
	queue := &recordingEmailQueueSender{}
	workerRepo := &emailOutboxBoundaryRepo{Repository: repo}
	server := NewServerWithOptions(workerRepo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas, EmailQueue: queue})
	defer server.Close()
	handler := server.Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	body := `{"message_ids":["message-1","message-2"]}`
	path := "/v1/communications/messages/archive-batch?background=true&company_id=" + url.QueryEscape(companyID)
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(queue.messages) != 0 || len(nylas.updateCalls) != 0 || workerRepo.enqueueCount() != 0 {
		t.Fatalf("obsolete background switch caused work: queue=%+v updates=%+v outbox=%d", queue.messages, nylas.updateCalls, workerRepo.enqueueCount())
	}
}

func TestCommunicationsArchiveBatchRequestRetryResendsExistingUnsentItem(t *testing.T) {
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "archive-queue-retry-user"
	const companyID = "11111111-1111-4111-8111-701300000409"
	repo.EnsureCompany(companyID, "Archive Queue Retry Company")
	user, err := repo.UpsertAuthUser(subject, "archive-retry@example.com", "Archive Retry User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "archive-retry-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	seedPersonalV3EmailMessageForCommunicationsTest(t, repo, companyID, user.UserID, user.Email, "google", NylasMessage{
		ID: "archive-retry-message", Subject: "Retry archive queue send", Folders: []string{"INBOX"},
	})
	queue := &recordingEmailQueueSender{err: errors.New("temporary SQS send failure")}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: &fakeNylasClient{}, EmailQueue: queue,
	})
	defer server.Close()
	handler := server.Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	path := "/v1/communications/messages/archive-batch?company_id=" + url.QueryEscape(companyID)
	request := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"message_ids":["archive-retry-message"]}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	if rec := request(); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("failed send status=%d body=%s", rec.Code, rec.Body.String())
	}
	queue.err = nil
	if rec := request(); rec.Code != http.StatusAccepted {
		t.Fatalf("retry status=%d body=%s", rec.Code, rec.Body.String())
	}
	if queue.attempts != 2 || len(queue.messages) != 1 || queue.messages[0].Kind != emailqueue.KindArchiveItem {
		t.Fatalf("queue attempts=%d messages=%+v", queue.attempts, queue.messages)
	}
}

func TestCommunicationsArchiveBatchUsesSharedInboxJobScope(t *testing.T) {
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-701300000410"
	repo.EnsureCompany(companyID, "Shared Archive Job Company")
	actor, err := repo.UpsertAuthUser("shared-archive-actor", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{CompanyID: companyID, Provider: "google", AccountEmail: "support@example.com", GrantID: "grant-shared", Status: "connected", ConnectedByUserID: actor.UserID}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: companyID, EntityType: store.EntityTypeSharedInbox, EntityID: folder.FolderID, Permissions: []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionEdit}}}); err != nil {
		t.Fatal(err)
	}
	message := NylasMessage{ID: "shared-message-1", Subject: "Shared", Folders: []string{"INBOX", "Label_shared"}}
	seedSharedV3EmailMessageForCommunicationsTest(t, repo, companyID, folder.FolderID, "support@example.com", "google", message)
	nylas := &fakeNylasClient{messagesByID: map[string]NylasMessage{message.ID: message}}
	queue := &recordingEmailQueueSender{}
	server := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas, EmailQueue: queue})
	defer server.Close()
	handler := server.Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)
	body := `{"message_ids":["shared-message-1"]}`
	path := "/v1/communications/messages/archive-batch?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		ArchiveJob store.CommunicationsArchiveJob `json:"archive_job"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListCommunicationsArchiveJobItemsContext(context.Background(), payload.ArchiveJob.JobID)
	if err != nil || len(items) != 1 || items[0].CompanyID != companyID || items[0].SharedInboxID != folder.FolderID || items[0].ConnectionScope != "shared" {
		t.Fatalf("shared job items=%+v err=%v", items, err)
	}
	if len(queue.messages) != 1 {
		t.Fatalf("queued archive messages=%+v", queue.messages)
	}
	if acknowledged, err := server.processEmailArchiveDelivery(context.Background(), queue.messages[0]); err != nil || !acknowledged {
		t.Fatalf("acknowledged=%v err=%v", acknowledged, err)
	}
	if len(nylas.updateCalls) != 1 || nylas.updateCalls[0].GrantID != "grant-shared" || nylas.updateCalls[0].MessageID != message.ID {
		t.Fatalf("shared archive calls=%+v", nylas.updateCalls)
	}
}

func TestCommunicationsUnarchiveMessageAddsGmailInboxLabel(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-4111-8111-701300000408"
	repo.EnsureCompany(companyID, "Unarchive Google Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected"}); err != nil {
		t.Fatal(err)
	}
	message := NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"UNREAD", "CATEGORY_PERSONAL", "Label_123"}}
	seedPersonalV3EmailMessageForCommunicationsTest(t, repo, companyID, user.UserID, user.Email, "google", message)
	nylas := &fakeNylasClient{message: message}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/unarchive?company_id="+url.QueryEscape(companyID), "", token, http.StatusOK)
	if got, want := strings.Join(nylas.update.Folders, ","), "Label_123,INBOX"; got != want {
		t.Fatalf("folders = %q, want %q", got, want)
	}
}

func TestCommunicationsUnarchiveMessageMovesFolderProvidersToInboxFolder(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "11111111-1111-4111-8111-701300000409"
	repo.EnsureCompany(companyID, "Unarchive Microsoft Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "microsoft", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected"}); err != nil {
		t.Fatal(err)
	}
	message := NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"archive-id"}}
	seedPersonalV3EmailMessageForCommunicationsTest(t, repo, companyID, user.UserID, user.Email, "microsoft", message)
	nylas := &fakeNylasClient{folders: []NylasFolder{{ID: "inbox-id", Name: "Inbox"}, {ID: "archive-id", Name: "Archive"}}, message: message}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: nylas}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/unarchive?company_id="+url.QueryEscape(companyID), "", token, http.StatusOK)
	if len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "inbox-id" || nylas.detailCalls != 0 {
		t.Fatalf("unarchive update=%+v detail calls=%d", nylas.update, nylas.detailCalls)
	}
}

func TestNylasWebhookRequestCancellationStopsBlockedGrantLookup(t *testing.T) {
	baseRepo := store.NewMemoryRepo()
	repo := &blockingWebhookGrantRepo{Repository: baseRepo, started: make(chan struct{}), canceled: make(chan struct{})}
	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	queue := &recordingEmailQueueSender{}
	server := NewServerWithOptions(repo, ServerOptions{NylasConfig: config, NylasClient: &fakeNylasClient{}, EmailQueue: queue})
	defer server.Close()
	handler := server.Routes()
	body := `{"type":"message.created","data":{"object":{"id":"cancel-message","thread_id":"cancel-thread","grant_id":"cancel-grant"}}}`
	requestCtx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body)).WithContext(requestCtx)
	req.Header.Set("X-Nylas-Signature", signWebhookBody(config.WebhookSecret, body))
	rec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(rec, req)
		close(done)
	}()
	select {
	case <-repo.started:
	case <-time.After(time.Second):
		t.Fatal("webhook grant lookup did not start")
	}
	cancel()
	select {
	case <-repo.canceled:
	case <-time.After(time.Second):
		t.Fatal("webhook grant lookup ignored request cancellation")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("webhook handler did not return after request cancellation")
	}
	if len(queue.messages) != 0 {
		t.Fatalf("canceled webhook queued work: %+v", queue.messages)
	}
}

func TestSharedNylasWebhookAudienceFailureRetriesFromDurableOutboxWithoutInflatingSignalCount(t *testing.T) {
	baseRepo := store.NewMemoryRepo()
	companyID := "70707070-7070-4070-8070-707070707199"
	baseRepo.EnsureCompany(companyID, "Shared webhook retry company")
	user := mustRealtimeAuthUser(t, baseRepo, companyID, "shared-webhook-retry", domain.RoleCompanyUser)
	companyConnection, err := baseRepo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "google",
		AccountEmail:      "retry-shared@example.com",
		GrantID:           "retry-shared-grant",
		Status:            "connected",
		ConnectedByUserID: user.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	folder, err := baseRepo.CreateCommunicationsSharedInboxFolder(companyID, "", "Retry shared", "retry-shared@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := baseRepo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInbox,
		EntityID:         folder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	repo := &failOnceWebhookAudienceRepo{Repository: baseRepo, failures: 1}
	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	server := NewServerWithOptions(repo, explicitLocalRealtimeTestOptions(ServerOptions{NylasConfig: config, NylasClient: &fakeNylasClient{}}))
	defer server.Close()
	networkConn := subscribeRecordingRealtimeConnection(t, server, "shared-webhook-retry-connection", companyID, user.UserID, realtimeSharedMailboxScope(folder.FolderID))
	handler := server.Routes()
	body := `{"type":"message.opened","data":{"object":{"message_id":"retry-shared-message","thread_id":"retry-shared-thread","grant_id":"retry-shared-grant"}}}`

	send := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
		req.Header.Set("X-Nylas-Signature", signWebhookBody(config.WebhookSecret, body))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	first := send()
	if first.Code != http.StatusOK {
		t.Fatalf("durably queued shared delivery status=%d body=%s", first.Code, first.Body.String())
	}
	waitForBackplaneCondition(t, func() bool { return repo.callCount() == 1 }, "first asynchronous shared audience lookup")
	if messages := networkConn.messages(t); len(messages) != 0 {
		t.Fatalf("failed shared audience lookup delivered messages: %+v", messages)
	}
	waitForBackplaneCondition(t, func() bool { return repo.callCount() == 2 && len(networkConn.messages(t)) == 1 }, "lifecycle-owned durable audience retry")
	if repo.callCount() != 2 {
		t.Fatalf("shared audience calls = %d, want failed lookup plus outbox retry", repo.callCount())
	}
	messages := networkConn.messages(t)
	if len(messages) != 1 || messages[0]["message_id"] != "retry-shared-message" {
		t.Fatalf("retried shared webhook messages = %+v, want one recovered hint", messages)
	}
	statuses, err := baseRepo.ListCommunicationsMessageReadStatuses(store.CommunicationsMessageReadStatusListInput{
		ScopeType:                "shared",
		CompanyID:                companyID,
		CompanyEmailConnectionID: companyConnection.CompanyEmailConnectionID,
		MessageIDs:               []string{"retry-shared-message"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(statuses) != 1 || statuses[0].SignalCount != 1 {
		t.Fatalf("retried opened receipt = %+v, want one idempotent signal", statuses)
	}
}

func TestNylasWebhookVerifiesSignatureDeduplicatesAndStoresReadStatus(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "70707070-7070-4070-8070-707070707001"
	token := "communications-webhook-ws-token"
	user := mustRealtimeAuthUser(t, repo, companyID, "communications-webhook-ws", domain.RoleCompanyUser)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	nylas := &fakeNylasClient{}
	server := NewServerWithOptions(repo, explicitLocalRealtimeTestOptions(ServerOptions{
		NylasConfig: config,
		EmailQueue:  &recordingEmailQueueSender{},
		NylasClient: nylas,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
		}},
	}))
	defer server.Close()
	handler := server.Routes()
	client := openRealtimeWebSocketForTest(t, handler, "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	mailboxScope := realtimePersonalMailboxScope(user.UserID, user.Email)
	client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": mailboxScope})
	if subscribed := client.readJSON(t); subscribed["type"] != realtimeMessageSubscriptionAccepted || subscribed["scope"] != mailboxScope {
		t.Fatalf("personal mailbox subscription = %+v", subscribed)
	}

	challengeReq := httptest.NewRequest(http.MethodGet, "/nylas/webhook?challenge=abc123", nil)
	challengeRec := httptest.NewRecorder()
	handler.ServeHTTP(challengeRec, challengeReq)
	if challengeRec.Code != http.StatusOK || challengeRec.Body.String() != "abc123" {
		t.Fatalf("challenge status=%d body=%q", challengeRec.Code, challengeRec.Body.String())
	}

	cacheScope := "grant:grant-1"
	query := NylasMessageQuery{Limit: 12, Mailbox: "primary"}
	now := time.Now().UTC()
	server.commCache.setFolders(user.UserID, cacheScope, []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
	server.commCache.setMessagePage(user.UserID, cacheScope, query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	server.commCache.setMessage(user.UserID, cacheScope, NylasMessage{ID: "message-1", Subject: "Stale"}, now)

	body := `{"type":"message.created","time":"2026-06-09T20:00:00Z","data":{"object":{"id":"message-1","thread_id":"thread-1","grant_id":"grant-1","subject":"Created","snippet":"Created","body":"<p>Created</p>","date":1783988000,"from":[{"email":"sender@example.com"}]}}}`
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("webhook status = %d body=%s", rec.Code, rec.Body.String())
	}
	client.assertNoMessage(t)
	if _, ok := server.commCache.getFolders(user.UserID, cacheScope, communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message.created webhook invalidated folders before ingestion completed")
	}
	if _, ok := server.commCache.getMessagePage(user.UserID, cacheScope, query, communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message.created webhook invalidated the message page before ingestion completed")
	}
	if message, ok := server.commCache.getMessage(user.UserID, cacheScope, "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); !ok || message.Subject != "Stale" {
		t.Fatalf("message.created webhook changed detail before ingestion completed: %+v ok=%v", message, ok)
	}
	if nylas.folderCalls != 0 || nylas.messageCalls != 0 || nylas.detailCalls != 0 {
		t.Fatalf("webhook provider calls folders=%d messages=%d details=%d, want zero", nylas.folderCalls, nylas.messageCalls, nylas.detailCalls)
	}
	duplicateReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	duplicateReq.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	duplicateRec := httptest.NewRecorder()
	handler.ServeHTTP(duplicateRec, duplicateReq)
	if duplicateRec.Code != http.StatusOK {
		t.Fatalf("duplicate webhook status = %d body=%s", duplicateRec.Code, duplicateRec.Body.String())
	}
	client.assertNoMessage(t)

	openedBody := `{"type":"message.opened","time":"2026-06-09T21:14:00Z","data":{"object":{"message_id":"message-1","thread_id":"thread-1","grant_id":"grant-1","count":2}}}`
	openedReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(openedBody))
	openedReq.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", openedBody))
	openedRec := httptest.NewRecorder()
	handler.ServeHTTP(openedRec, openedReq)
	if openedRec.Code != http.StatusOK {
		t.Fatalf("opened webhook status = %d body=%s", openedRec.Code, openedRec.Body.String())
	}
	opened := client.readJSON(t)
	if opened["type"] != realtimeMessageMailboxMessageChanged || opened["trigger"] != "message.opened" ||
		opened["message_id"] != "message-1" || opened["thread_id"] != "thread-1" {
		t.Fatalf("personal mailbox opened event = %+v", opened)
	}
	statuses, err := repo.ListCommunicationsMessageReadStatuses(store.CommunicationsMessageReadStatusListInput{
		UserID:               user.UserID,
		PersonalAccountEmail: user.Email,
		MessageIDs:           []string{"message-1"},
	})
	if err != nil {
		t.Fatalf("ListCommunicationsMessageReadStatuses: %v", err)
	}
	if len(statuses) != 1 || statuses[0].PersonalAccountEmail != normalizeEmailForCompare(user.Email) || statuses[0].Status != "likely_read" || statuses[0].MessageID != "message-1" || statuses[0].ThreadID != "thread-1" || statuses[0].SignalCount != 2 {
		t.Fatalf("read statuses = %+v, want likely_read count 2", statuses)
	}
	if got := statuses[0].LastSignalTimestamp.Format(time.RFC3339); got != "2026-06-09T21:14:00Z" {
		t.Fatalf("last signal timestamp = %s", got)
	}
	badReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	badReq.Header.Set("X-Nylas-Signature", "bad")
	badRec := httptest.NewRecorder()
	handler.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature status = %d", badRec.Code)
	}
}

func TestNylasWebhookQueuesLiveIngestionWithoutSynchronousCollaborationAdvance(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "71717171-7171-4171-8171-717171717171"
	repo.EnsureCompany(companyID, "Personal collaboration live arrival")
	creator := mustRealtimeAuthUser(t, repo, companyID, "collaboration-webhook-creator", domain.RoleCompanyUser)
	participant := mustRealtimeAuthUser(t, repo, companyID, "collaboration-webhook-participant", domain.RoleCompanyUser)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: participant.UserID, Provider: "google", AccountEmail: participant.Email,
		GrantID: "collaboration-participant-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: creator.UserID, Provider: "google", AccountEmail: creator.Email,
		GrantID: "collaboration-webhook-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	created, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, Provider: "google", CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "collaboration-root-message", ThreadID: "collaboration-thread",
			Subject: "Original subject", Snippet: "Original snippet", Body: "<p>Original body</p>",
			Date: 1783988000, From: []domain.EmailAddressSnapshot{{Email: "sender@example.com"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCommunicationsEmailCollaborationParticipants(store.CommunicationsEmailCollaborationParticipantInput{
		CompanyID: companyID, CollaborationID: created.Collaboration.CollaborationID,
		ActorUserID: creator.UserID, MentionedUserIDs: []string{participant.UserID},
	}); err != nil {
		t.Fatal(err)
	}

	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	nylas := &fakeNylasClient{message: NylasMessage{
		ID: "collaboration-future-message", ThreadID: "collaboration-thread",
		Subject: "Future thread reply", Snippet: "New reply preview", Body: "<p>New reply body</p>",
		Date: 1783989000, Unread: true,
		From: []NylasEmailAddress{{Name: "Sender", Email: "sender@example.com"}},
		To:   []NylasEmailAddress{{Email: creator.Email}},
	}}
	participantToken := "collaboration-webhook-participant-token"
	queue := &recordingEmailQueueSender{}
	server := NewServerWithOptions(repo, explicitLocalRealtimeTestOptions(ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			participantToken: {Subject: participant.CognitoSubject, Email: participant.Email, Name: participant.DisplayName},
		}},
		EmailQueue: queue,
	}))
	defer server.Close()
	handler := server.Routes()

	body := "{\"type\":\"message.created\",\"time\":\"2026-07-13T20:30:00Z\",\"data\":{\"object\":{\"id\":\"collaboration-future-message\",\"thread_id\":\"collaboration-thread\",\"grant_id\":\"collaboration-webhook-grant\",\"subject\":\"Future thread reply\",\"snippet\":\"New reply preview\",\"body\":\"<p>New reply body</p>\",\"date\":1783989000,\"from\":[{\"email\":\"sender@example.com\"}]}}}"
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody(config.WebhookSecret, body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("webhook status = %d body=%s", rec.Code, rec.Body.String())
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("webhook triggered provider detail reads=%d, want zero", nylas.detailCalls)
	}
	if len(queue.messages) != 1 || queue.messages[0].Kind != emailqueue.KindIngestion {
		t.Fatalf("live ingestion messages=%+v", queue.messages)
	}
	queuedJob, err := repo.GetCommunicationsEmailIngestionJobContext(context.Background(), queue.messages[0].JobID)
	if err != nil || queuedJob.ProviderMessageID != "collaboration-future-message" || queuedJob.Priority != store.CommunicationsEmailIngestionPriorityLive {
		t.Fatalf("live ingestion job=%+v err=%v", queuedJob, err)
	}
	collaboration, err := repo.GetCommunicationsEmailCollaboration(companyID, created.Collaboration.CollaborationID, participant.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if collaboration.LatestMessageID != created.Collaboration.RootMessageID ||
		collaboration.Message.Subject != "Original subject" ||
		collaboration.Message.Body != "<p>Original body</p>" {
		t.Fatalf("webhook changed stored collaboration = %+v", collaboration)
	}
}

func TestNylasWebhookStoresSharedReadStatusForSharedInbox(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "80808080-8080-4080-8080-808080808001"
	repo.EnsureCompany(companyID, "Communications Shared Webhook")
	visible := mustRealtimeAuthUser(t, repo, companyID, "communications-shared-webhook-visible", domain.RoleCompanyUser)
	companyConnection, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "google",
		AccountEmail:      "support@example.com",
		GrantID:           "shared-grant-1",
		Status:            "connected",
		ConnectedByUserID: visible.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInbox,
		EntityID:         folder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   visible.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	server := NewServerWithOptions(repo, ServerOptions{NylasConfig: config})
	defer server.Close()
	handler := server.Routes()

	body := `{"type":"message.opened","data":{"object":{"message_id":"shared-message-1","thread_id":"shared-thread-1","grant_id":"shared-grant-1","message_data":{"count":3,"timestamp":"2026-06-10T12:30:00Z"}}}}`
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("shared opened webhook status = %d body=%s", rec.Code, rec.Body.String())
	}

	statuses, err := repo.ListCommunicationsMessageReadStatuses(store.CommunicationsMessageReadStatusListInput{
		ScopeType:                "shared",
		CompanyID:                companyID,
		CompanyEmailConnectionID: companyConnection.CompanyEmailConnectionID,
		MessageIDs:               []string{"shared-message-1"},
	})
	if err != nil {
		t.Fatalf("ListCommunicationsMessageReadStatuses shared: %v", err)
	}
	if len(statuses) != 1 || statuses[0].ScopeType != "shared" || statuses[0].SharedInboxID != folder.FolderID || statuses[0].MessageID != "shared-message-1" || statuses[0].ThreadID != "shared-thread-1" || statuses[0].SignalCount != 3 {
		t.Fatalf("shared read statuses = %+v, want scoped shared receipt count 3", statuses)
	}
	if got := statuses[0].LastSignalTimestamp.Format(time.RFC3339); got != "2026-06-10T12:30:00Z" {
		t.Fatalf("shared last signal timestamp = %s", got)
	}
	personalStatuses, err := repo.ListCommunicationsMessageReadStatuses(store.CommunicationsMessageReadStatusListInput{
		UserID:               visible.UserID,
		PersonalAccountEmail: visible.Email,
		MessageIDs:           []string{"shared-message-1"},
	})
	if err != nil {
		t.Fatalf("ListCommunicationsMessageReadStatuses personal: %v", err)
	}
	if len(personalStatuses) != 0 {
		t.Fatalf("personal read statuses = %+v, want shared webhook not stored in viewer personal scope", personalStatuses)
	}

}

func TestCommunicationsReadStatusEnrichmentUsesExactPersonalAccount(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("receipt-enrichment-account", "owner@example.com", "Receipt Owner")
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []store.CommunicationsMessageReadStatusInput{
		{
			UserID:               user.UserID,
			PersonalAccountEmail: "account-a@example.com",
			MessageID:            "same-provider-message-id",
			ThreadID:             "thread-a",
			Status:               "likely_read",
			SignalCount:          2,
		},
		{
			UserID:               user.UserID,
			PersonalAccountEmail: "account-b@example.com",
			MessageID:            "same-provider-message-id",
			ThreadID:             "thread-b",
			Status:               "read",
			SignalCount:          9,
		},
	} {
		if _, err := repo.UpsertCommunicationsMessageReadStatusContext(context.Background(), input); err != nil {
			t.Fatalf("seed exact receipt scope: %v", err)
		}
	}

	server := NewServer(repo)
	defer server.Close()
	enrich := func(accountEmail string) *domain.CommunicationsMessageReadStatus {
		t.Helper()
		messages := server.enrichCommunicationsMessagesReadStatuses(domain.UserEmailConnection{
			UserID:       user.UserID,
			AccountEmail: accountEmail,
			Scope:        "personal",
		}, []NylasMessage{{ID: "same-provider-message-id"}})
		if len(messages) != 1 || messages[0].ReadStatus == nil {
			t.Fatalf("account %q enriched messages = %+v", accountEmail, messages)
		}
		return messages[0].ReadStatus
	}
	if got := enrich(" ACCOUNT-A@EXAMPLE.COM "); got.ThreadID != "thread-a" || got.Status != "likely_read" || got.SignalCount != 2 {
		t.Fatalf("account A read status = %+v", got)
	}
	if got := enrich("account-b@example.com"); got.ThreadID != "thread-b" || got.Status != "read" || got.SignalCount != 9 {
		t.Fatalf("account B read status = %+v", got)
	}
}

func TestNylasWebhookDoesNotAdvanceSharedEmailCollaboration(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "82828282-8282-4282-8282-828282828282"
	repo.EnsureCompany(companyID, "Shared collaboration live arrival")
	creator := mustRealtimeAuthUser(t, repo, companyID, "shared-collaboration-creator", domain.RoleCompanyUser)
	participant := mustRealtimeAuthUser(t, repo, companyID, "shared-collaboration-participant", domain.RoleCompanyUser)
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: participant.UserID, Provider: "google", AccountEmail: participant.Email,
		GrantID: "shared-collaboration-participant-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID: companyID, Provider: "google", AccountEmail: "support@example.com",
		GrantID: "shared-collaboration-grant", Status: "connected", ConnectedByUserID: creator.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: store.EntityTypeSharedInbox, EntityID: folder.FolderID,
		DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser, SubjectID: creator.UserID, AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	created, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: folder.FolderID, AccountEmail: "support@example.com", Provider: "google",
		CreatedByUserID: creator.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "shared-collaboration-root", ThreadID: "shared-collaboration-thread",
			Subject: "Shared original", Snippet: "Original", Body: "<p>Original</p>", Date: 1783987000,
			From: []domain.EmailAddressSnapshot{{Email: "customer@example.com"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCommunicationsEmailCollaborationParticipants(store.CommunicationsEmailCollaborationParticipantInput{
		CompanyID: companyID, CollaborationID: created.Collaboration.CollaborationID,
		ActorUserID: creator.UserID, MentionedUserIDs: []string{participant.UserID},
	}); err != nil {
		t.Fatal(err)
	}

	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	nylas := &fakeNylasClient{message: NylasMessage{
		ID: "shared-collaboration-future", ThreadID: "shared-collaboration-thread",
		Subject: "Shared future reply", Snippet: "Customer answered", Body: "<p>Customer answer</p>",
		Date: 1783989500, Unread: true,
		From: []NylasEmailAddress{{Email: "customer@example.com"}},
		To:   []NylasEmailAddress{{Email: "support@example.com"}},
	}}
	participantToken := "shared-collaboration-participant-token"
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		EmailQueue:  &recordingEmailQueueSender{},
		NylasClient: nylas,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			participantToken: {Subject: participant.CognitoSubject, Email: participant.Email, Name: participant.DisplayName},
		}},
	})
	defer server.Close()
	handler := server.Routes()

	body := "{\"type\":\"message.created\",\"time\":\"2026-07-13T20:40:00Z\",\"data\":{\"object\":{\"id\":\"shared-collaboration-future\",\"thread_id\":\"shared-collaboration-thread\",\"grant_id\":\"shared-collaboration-grant\",\"subject\":\"Shared future reply\",\"snippet\":\"Customer answered\",\"body\":\"<p>Customer answer</p>\",\"date\":1783989500,\"from\":[{\"email\":\"customer@example.com\"}]}}}"
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody(config.WebhookSecret, body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("shared collaboration webhook status=%d body=%s", rec.Code, rec.Body.String())
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("shared webhook triggered provider detail reads=%d, want zero", nylas.detailCalls)
	}
	collaboration, err := repo.GetCommunicationsEmailCollaboration(companyID, created.Collaboration.CollaborationID, participant.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if collaboration.LatestMessageID != created.Collaboration.RootMessageID ||
		collaboration.Message.Subject != "Shared original" ||
		collaboration.Message.Body != "<p>Original</p>" {
		t.Fatalf("shared webhook changed stored collaboration = %+v", collaboration)
	}
}

func TestNylasWebhookPublishesSharedMailboxHintOnlyToCurrentAudience(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "81818181-8181-4181-8181-818181818181"
	repo.EnsureCompany(companyID, "Shared mailbox live arrival")
	visibleToken := "shared-mailbox-visible-token"
	revokedToken := "shared-mailbox-revoked-token"
	visible := mustRealtimeAuthUser(t, repo, companyID, "shared-mailbox-visible", domain.RoleCompanyUser)
	revoked := mustRealtimeAuthUser(t, repo, companyID, "shared-mailbox-revoked", domain.RoleCompanyUser)
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID: companyID, Provider: "google", AccountEmail: "support@example.com",
		GrantID: "shared-live-grant", Status: "connected", ConnectedByUserID: visible.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	setAudience := func(userIDs ...string) {
		t.Helper()
		permissions := make([]store.EntityPermissionInput, 0, len(userIDs))
		for _, userID := range userIDs {
			permissions = append(permissions, store.EntityPermissionInput{
				SubjectType: store.EntityPermissionSubjectUser,
				SubjectID:   userID,
				AccessLevel: store.EntityPermissionEdit,
			})
		}
		if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID: companyID, EntityType: store.EntityTypeSharedInbox, EntityID: folder.FolderID,
			DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, Permissions: permissions,
		}); err != nil {
			t.Fatal(err)
		}
	}
	setAudience(visible.UserID, revoked.UserID)

	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	nylas := &fakeNylasClient{}
	server := NewServerWithOptions(repo, explicitLocalRealtimeTestOptions(ServerOptions{
		NylasConfig: config,
		EmailQueue:  &recordingEmailQueueSender{},
		NylasClient: nylas,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			visibleToken: {Subject: visible.CognitoSubject, Email: visible.Email, Name: visible.DisplayName},
			revokedToken: {Subject: revoked.CognitoSubject, Email: revoked.Email, Name: revoked.DisplayName},
		}},
	}))
	defer server.Close()
	handler := server.Routes()
	scope := realtimeSharedMailboxScope(folder.FolderID)
	visibleClient := openRealtimeWebSocketForTest(t, handler, "/v1/realtime/ws?company_id="+companyID, visibleToken)
	defer visibleClient.close()
	visibleClient.readJSON(t)
	visibleClient.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": scope})
	if subscribed := visibleClient.readJSON(t); subscribed["type"] != realtimeMessageSubscriptionAccepted {
		t.Fatalf("visible shared mailbox subscription = %+v", subscribed)
	}
	revokedClient := openRealtimeWebSocketForTest(t, handler, "/v1/realtime/ws?company_id="+companyID, revokedToken)
	defer revokedClient.close()
	revokedClient.readJSON(t)
	revokedClient.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": scope})
	if subscribed := revokedClient.readJSON(t); subscribed["type"] != realtimeMessageSubscriptionAccepted {
		t.Fatalf("pre-revocation shared mailbox subscription = %+v", subscribed)
	}

	// The publisher re-resolves the current effective audience. An already-open
	// socket must not keep receiving mailbox identifiers after access is revoked.
	setAudience(visible.UserID)
	cacheScope := "grant:shared-live-grant"
	query := NylasMessageQuery{Limit: 12, Mailbox: "primary"}
	now := time.Now().UTC()
	for _, userID := range []string{visible.UserID, revoked.UserID} {
		server.commCache.setFolders(userID, cacheScope, []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
		server.commCache.setMessagePage(userID, cacheScope, query, NylasMessagePage{Messages: []NylasMessage{{ID: "shared-message-live"}}}, now)
		server.commCache.setMessage(userID, cacheScope, NylasMessage{ID: "shared-message-live", Subject: "Stale"}, now)
	}
	unrelatedScope := "grant:unrelated-shared-grant"
	server.commCache.setFolders(revoked.UserID, unrelatedScope, []NylasFolder{{ID: "other-inbox", Name: "Unrelated inbox"}}, now)
	server.commCache.setMessagePage(revoked.UserID, unrelatedScope, query, NylasMessagePage{Messages: []NylasMessage{{ID: "unrelated-message"}}}, now)
	server.commCache.setMessage(revoked.UserID, unrelatedScope, NylasMessage{ID: "unrelated-message", Subject: "Unrelated"}, now)

	body := `{"type":"message.updated","time":"2026-06-10T15:00:00Z","data":{"object":{"id":"shared-message-live","thread_id":"shared-thread-live","grant_id":"shared-live-grant","subject":"Shared live","snippet":"Shared live","body":"<p>Shared live</p>","date":1783989500,"from":[{"email":"customer@example.com"}]}}}`
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("shared updated webhook status = %d body=%s", rec.Code, rec.Body.String())
	}
	updated := visibleClient.readJSON(t)
	if updated["type"] != realtimeMessageMailboxMessageChanged || updated["company_id"] != companyID || updated["scope"] != scope ||
		updated["shared_inbox_id"] != folder.FolderID || updated["trigger"] != "message.updated" ||
		updated["message_id"] != "shared-message-live" || updated["thread_id"] != "shared-thread-live" {
		t.Fatalf("shared mailbox updated event = %+v", updated)
	}
	revokedClient.assertNoMessage(t)
	if _, ok := server.commCache.getFolders(visible.UserID, cacheScope, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("shared message.updated preserved current viewer folder counts")
	}
	if _, ok := server.commCache.getMessagePage(visible.UserID, cacheScope, query, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("shared message.updated preserved current viewer message page")
	}
	if _, ok := server.commCache.getMessage(visible.UserID, cacheScope, "shared-message-live", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("shared message.updated preserved current viewer message detail")
	}
	if _, ok := server.commCache.getFolders(revoked.UserID, cacheScope, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("shared webhook preserved a revoked user's stale folder cache for the exact grant")
	}
	if _, ok := server.commCache.getMessagePage(revoked.UserID, cacheScope, query, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("shared webhook preserved a revoked user's stale message page for the exact grant")
	}
	if _, ok := server.commCache.getMessage(revoked.UserID, cacheScope, "shared-message-live", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("shared webhook preserved a revoked user's stale detail for the exact grant")
	}
	if folders, ok := server.commCache.getFolders(revoked.UserID, unrelatedScope, communicationsMaxStaleTTL, now.Add(time.Second)); !ok || len(folders) != 1 || folders[0].ID != "other-inbox" {
		t.Fatalf("shared webhook evicted unrelated grant folders: %+v present=%t", folders, ok)
	}
	if page, ok := server.commCache.getMessagePage(revoked.UserID, unrelatedScope, query, communicationsMaxStaleTTL, now.Add(time.Second)); !ok || len(page.Messages) != 1 || page.Messages[0].ID != "unrelated-message" {
		t.Fatalf("shared webhook evicted unrelated grant page: %+v present=%t", page, ok)
	}
	if message, ok := server.commCache.getMessage(revoked.UserID, unrelatedScope, "unrelated-message", communicationsMaxStaleTTL, now.Add(time.Second)); !ok || message.Subject != "Unrelated" {
		t.Fatalf("shared webhook evicted unrelated grant detail: %+v present=%t", message, ok)
	}
	if nylas.folderCalls != 0 || nylas.messageCalls != 0 || nylas.detailCalls > 1 {
		t.Fatalf("shared webhook provider calls folders=%d messages=%d details=%d, want at most one asynchronous ingestion validation", nylas.folderCalls, nylas.messageCalls, nylas.detailCalls)
	}

	// Regranting access must not expose the pre-revocation cache entry. The
	// first canonical read starts at the provider and stores only post-commit data.
	setAudience(visible.UserID, revoked.UserID)
	nylas.mu.Lock()
	nylas.messages = []NylasMessage{{ID: "shared-message-live", Subject: "Post-commit canonical"}}
	nylas.mu.Unlock()
	regrantPath := "/v1/communications/messages?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID) + "&limit=12&refresh=true"
	regrantReq := httptest.NewRequest(http.MethodGet, regrantPath, nil)
	regrantReq.Header.Set("Authorization", "Bearer "+revokedToken)
	regrantRec := httptest.NewRecorder()
	handler.ServeHTTP(regrantRec, regrantReq)
	if regrantRec.Code != http.StatusOK || !strings.Contains(regrantRec.Body.String(), "Post-commit canonical") || strings.Contains(regrantRec.Body.String(), `"subject":"Stale"`) {
		t.Fatalf("regranted canonical read status=%d body=%s", regrantRec.Code, regrantRec.Body.String())
	}
	if nylas.messageCalls != 1 {
		t.Fatalf("regranted canonical provider reads=%d, want 1 after stale exact-grant cache invalidation", nylas.messageCalls)
	}
	setAudience(visible.UserID)

	duplicateReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	duplicateReq.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	duplicateRec := httptest.NewRecorder()
	handler.ServeHTTP(duplicateRec, duplicateReq)
	if duplicateRec.Code != http.StatusOK {
		t.Fatalf("duplicate shared webhook status = %d body=%s", duplicateRec.Code, duplicateRec.Body.String())
	}
	visibleClient.assertNoMessage(t)
	revokedClient.assertNoMessage(t)

	server.commCache.setFolders(visible.UserID, cacheScope, []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
	server.commCache.setMessagePage(visible.UserID, cacheScope, query, NylasMessagePage{Messages: []NylasMessage{{ID: "shared-message-live"}}}, now)
	server.commCache.setMessage(visible.UserID, cacheScope, NylasMessage{ID: "shared-message-live", Subject: "Fresh"}, now)
	folderBody := `{"type":"folder.updated","time":"2026-06-10T15:01:00Z","data":{"object":{"id":"inbox","grant_id":"shared-live-grant"}}}`
	folderReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(folderBody))
	folderReq.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", folderBody))
	folderRec := httptest.NewRecorder()
	handler.ServeHTTP(folderRec, folderReq)
	if folderRec.Code != http.StatusOK {
		t.Fatalf("shared folder webhook status = %d body=%s", folderRec.Code, folderRec.Body.String())
	}
	folderChanged := visibleClient.readJSON(t)
	if folderChanged["type"] != realtimeMessageMailboxFolderChanged || folderChanged["trigger"] != "folder.updated" ||
		folderChanged["scope"] != scope || folderChanged["shared_inbox_id"] != folder.FolderID {
		t.Fatalf("shared mailbox folder event = %+v", folderChanged)
	}
	if _, present := folderChanged["message_id"]; present {
		t.Fatalf("folder event mislabeled provider folder id as message id: %+v", folderChanged)
	}
	revokedClient.assertNoMessage(t)
	if _, ok := server.commCache.getFolders(visible.UserID, cacheScope, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("folder.updated webhook preserved folder cache")
	}
	if _, ok := server.commCache.getMessagePage(visible.UserID, cacheScope, query, communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("folder.updated webhook invalidated message page")
	}
	if _, ok := server.commCache.getMessage(visible.UserID, cacheScope, "shared-message-live", communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("folder.updated webhook invalidated message detail")
	}
}

func TestCommunicationsNylasAuthErrorMarksReauthRequired(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "company-personal-reauth"
	repo.EnsureCompany(companyID, "Personal Reauth Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected"}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: &fakeNylasClient{listErr: NylasAPIError{StatusCode: http.StatusUnauthorized, Code: "unauthorized"}}}).Routes()
	path := "/v1/communications/messages?refresh=true&company_id=" + url.QueryEscape(companyID)
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil || connection.Status != "reauth_required" {
		t.Fatalf("connection=%+v err=%v", connection, err)
	}
}

func TestCommunicationsStoredReauthRequiredReturnsConflict(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "company-stored-personal-reauth"
	repo.EnsureCompany(companyID, "Stored Personal Reauth Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-1", Status: "reauth_required"}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: &fakeNylasClient{}}).Routes()
	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages?company_id="+url.QueryEscape(companyID), nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestCommunicationsSharedNylasAuthErrorMarksCompanyConnectionReauthRequired(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-reauth"
	repo.EnsureCompany(companyID, "Shared Reauth Company")
	const subject = "shared-reauth-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	companyConnection, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "google",
		AccountEmail:      "support@example.com",
		GrantID:           "shared-grant",
		Status:            "connected",
		ConnectedByUserID: user.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedInbox,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{listErr: NylasAPIError{StatusCode: http.StatusUnauthorized, Code: "unauthorized"}},
	}).Routes()

	path := "/v1/communications/messages?refresh=true&company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 body=%s", rec.Code, rec.Body.String())
	}
	updatedCompanyConnection, err := repo.GetCompanyEmailConnectionByID(companyID, companyConnection.CompanyEmailConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	if updatedCompanyConnection.Status != "reauth_required" {
		t.Fatalf("company connection status = %q, want reauth_required", updatedCompanyConnection.Status)
	}
	personal, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if personal.Status != "connected" {
		t.Fatalf("personal status = %q, want connected", personal.Status)
	}
}

func TestCommunicationsStoredSharedReauthRequiredReturnsConflict(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-stored-reauth"
	repo.EnsureCompany(companyID, "Shared Stored Reauth Company")
	const subject = "shared-stored-reauth-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	companyConnection, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "google",
		AccountEmail:      "support@example.com",
		GrantID:           "shared-grant",
		Status:            "connected",
		ConnectedByUserID: user.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", companyConnection.AccountEmail)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateCompanyEmailConnectionStatus(companyID, companyConnection.CompanyEmailConnectionID, "reauth_required"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedInbox,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   user.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{},
	}).Routes()

	path := "/v1/communications/messages?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 body=%s", rec.Code, rec.Body.String())
	}
}

func TestCommunicationsNylasRateLimitPreservesRetryAfter(t *testing.T) {
	t.Parallel()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "company-personal-rate-limit"
	repo.EnsureCompany(companyID, "Personal Rate Limit Company")
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "grant-1", Status: "connected"}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key), NylasConfig: testNylasConfig(), NylasClient: &fakeNylasClient{listErr: NylasAPIError{StatusCode: http.StatusTooManyRequests, Code: "rate_limited", RetryAfter: "3"}}}).Routes()
	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages?refresh=true&company_id="+url.QueryEscape(companyID), nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "3" || !strings.Contains(rec.Body.String(), "nylas_rate_limited") {
		t.Fatalf("status=%d retry=%q body=%s", rec.Code, rec.Header().Get("Retry-After"), rec.Body.String())
	}
}

func TestParseNylasMessageQueryCapsLimitAtProviderFriendlySize(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages?limit=100", nil)
	rec := httptest.NewRecorder()

	query, ok := parseNylasMessageQuery(rec, req)
	if !ok {
		t.Fatalf("parseNylasMessageQuery rejected request: status=%d body=%s", rec.Code, rec.Body.String())
	}
	if query.Limit != communicationsNylasMaxMessageLimit {
		t.Fatalf("limit = %d, want %d", query.Limit, communicationsNylasMaxMessageLimit)
	}
}

func signWebhookBody(secret, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(body))
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func assertJSONStatus(t *testing.T, handler http.Handler, method, path, body, authHeader string, want int) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s %s status = %d, want %d body=%s", method, path, rec.Code, want, rec.Body.String())
	}
}

func testNylasConfig() NylasConfig {
	return NylasConfig{
		ClientID:            "client-id",
		APIKey:              "api-key",
		APIBaseURL:          "https://api.us.nylas.com",
		RedirectURI:         "http://api.test/nylas/oauth/callback",
		FrontendRedirectURL: "http://ui.test/home",
		StateSecret:         "state-secret",
	}
}
