package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
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

type failOnceWebhookMembershipRepo struct {
	store.Repository
	mu       sync.Mutex
	failures int
}

func (r *failOnceWebhookMembershipRepo) ListUserMemberships(userID string) ([]domain.CompanyMembership, error) {
	r.mu.Lock()
	if r.failures > 0 {
		r.failures--
		r.mu.Unlock()
		return nil, errors.New("temporary membership lookup failure")
	}
	r.mu.Unlock()
	return r.Repository.ListUserMemberships(userID)
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
	f.lastMessageGrantID = grantID
	if f.listErr != nil {
		return NylasMessagePage{}, f.listErr
	}
	if f.messagesByGrantID != nil {
		if messages, ok := f.messagesByGrantID[grantID]; ok {
			return NylasMessagePage{Messages: messages, NextPageToken: "next-token"}, nil
		}
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
				return NylasMessage{}, fmt.Errorf("%w: attachment %d: %w", errNylasOutboundAttachmentOpen, index+1, err)
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

func seedLiveEmailDraftAttachmentForCommunicationsTest(t *testing.T, repo *store.MemoryRepo, storage *fakeAttachmentObjectStorage, actorUserID, companyID, resourceID, filename, contentType string, content []byte) string {
	t.Helper()
	parsed, ok := parseEmailScopedAttachmentResourceID("email_draft", resourceID)
	if !ok || (parsed.scope == "personal" && parsed.accountEmail == "") {
		t.Fatalf("seed live email draft attachment: invalid exact draft resource %q", resourceID)
	}
	input := store.CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: parsed.itemID, CreatedByUserID: actorUserID, UpdatedByUserID: actorUserID, Kind: "compose",
	}
	if parsed.scope == "shared" {
		input.SharedInboxID = parsed.sharedInboxID
	} else {
		input.PersonalUserID = parsed.userID
		input.PersonalAccountEmail = parsed.accountEmail
		input.AccountEmail = parsed.accountEmail
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(input); err != nil {
		t.Fatalf("seed live email draft attachment draft: %v", err)
	}
	return seedEmailAttachmentForCommunicationsTest(t, repo, storage, actorUserID, companyID, resourceID, filename, contentType, content)
}

func personalEmailDraftResourceID(userID, accountEmail, draftID string) string {
	return "personal:" +
		url.QueryEscape(strings.TrimSpace(userID)) + ":" +
		url.QueryEscape(normalizeEmailForCompare(accountEmail)) + ":" +
		url.QueryEscape(strings.TrimSpace(draftID))
}

func sharedEmailDraftResourceID(sharedInboxID, draftID string) string {
	return "shared:" + url.QueryEscape(strings.TrimSpace(sharedInboxID)) + ":" + url.QueryEscape(strings.TrimSpace(draftID))
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
	return seedLiveEmailDraftAttachmentForCommunicationsTest(t, f.repo, f.storage, f.userID, f.companyID, resourceID, filename, "application/octet-stream", content)
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

func TestCommunicationsThreadReturnsAuthoritativeInboundAndSentMessageIDs(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "thread-history-user"
	user, err := repo.UpsertAuthUser(subject, "thread-user@example.com", "Thread User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "thread-history-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{thread: NylasThread{
		ID:         "thread-1",
		MessageIDs: []string{"external-original", "user-sent", "external-latest"},
	}}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/threads/thread-1", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Thread NylasThread `json:"thread"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(payload.Thread.MessageIDs, ","); got != "external-original,user-sent,external-latest" {
		t.Fatalf("thread message ids = %q", got)
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
	if _, err := repo.GetUserEmailConnectionByGrantID("shared-grant"); !errors.Is(err, store.ErrNotFound) {
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

func TestCommunicationsProxyHandlersUseStoredGrant(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	const companyID = "communications-proxy-company"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Communications Proxy Company")
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
	nylas := &fakeNylasClient{
		folders:         []NylasFolder{{ID: "inbox", Name: "Inbox", Attributes: []string{"\\Inbox"}}},
		messages:        []NylasMessage{{ID: "message-1", Subject: "Hello", Unread: true, Attachments: []NylasAttachment{{ID: "attachment-1", Filename: "photo.jpg", ContentType: "image/jpeg", Size: 12}}}},
		message:         NylasMessage{ID: "message-1", Subject: "Hello", Body: "Body", Unread: true, Attachments: []NylasAttachment{{ID: "attachment-1", Filename: "photo.jpg", ContentType: "image/jpeg", Size: 12}}},
		downloadContent: []byte("photo-bytes"),
	}
	storage := newFakeAttachmentObjectStorage()
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:     testValidator(t, "kid", key),
		NylasConfig:       testNylasConfig(),
		NylasClient:       nylas,
		AttachmentStorage: storage,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/status", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?limit=5&unread=true", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	attachmentReq := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1/attachments/attachment-1", nil)
	attachmentReq.Header.Set("Authorization", token)
	attachmentRec := httptest.NewRecorder()
	handler.ServeHTTP(attachmentRec, attachmentReq)
	if attachmentRec.Code != http.StatusOK {
		t.Fatalf("attachment status = %d body=%s", attachmentRec.Code, attachmentRec.Body.String())
	}
	if attachmentRec.Header().Get("Content-Type") != "image/jpeg" || attachmentRec.Body.String() != "photo-bytes" {
		t.Fatalf("attachment content-type=%q body=%q, want image/jpeg photo-bytes", attachmentRec.Header().Get("Content-Type"), attachmentRec.Body.String())
	}
	if nylas.lastDownloadGrantID != "grant-1" || nylas.lastDownloadMessageID != "message-1" || nylas.lastDownloadAttachmentID != "attachment-1" {
		t.Fatalf("download scope grant=%q message=%q attachment=%q", nylas.lastDownloadGrantID, nylas.lastDownloadMessageID, nylas.lastDownloadAttachmentID)
	}
	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/messages/message-1", `{"unread":false,"folders":["archive"]}`, token, http.StatusOK)
	if nylas.update.Unread == nil || *nylas.update.Unread || len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "archive" {
		t.Fatalf("update = %+v, want unread=false and archive folder", nylas.update)
	}
	attachmentID := seedLiveEmailDraftAttachmentForCommunicationsTest(t, repo, storage, user.UserID, companyID, personalEmailDraftResourceID(user.UserID, user.Email, "draft-proxy"), "note.txt", "text/plain", []byte("hello"))
	sendBody := `{"company_id":"` + companyID + `","to":[{"email":"friend@example.com"}],"subject":"Hi","body":"Body","attachments":[{"attachment_id":"` + attachmentID + `","filename":"note.txt","content_type":"text/plain","size":5}]}`
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send", sendBody, token, http.StatusCreated)
	if nylas.sent.To[0].Email != "friend@example.com" || nylas.sent.Subject != "Hi" {
		t.Fatalf("sent = %+v, want normalized send request", nylas.sent)
	}
	if nylas.sent.TrackingOptions == nil || !nylas.sent.TrackingOptions.Opens {
		t.Fatalf("tracking options = %+v, want opens enabled", nylas.sent.TrackingOptions)
	}
	if len(nylas.sent.Attachments) != 1 || nylas.sent.Attachments[0].AttachmentID != attachmentID || nylas.sent.Attachments[0].Filename != "note.txt" || nylas.sent.Attachments[0].ContentType != "text/plain" || nylas.sent.Attachments[0].Content != "" ||
		len(nylas.sent.OutboundAttachments) != 1 || len(nylas.sentAttachmentBodies) != 1 || string(nylas.sentAttachmentBodies[0]) != "hello" {
		t.Fatalf("metadata=%+v outbound=%+v bodies=%q, want metadata-only attachment and streamed hello", nylas.sent.Attachments, nylas.sent.OutboundAttachments, nylas.sentAttachmentBodies)
	}
	inlineAttachmentID := seedLiveEmailDraftAttachmentForCommunicationsTest(t, repo, storage, user.UserID, companyID, personalEmailDraftResourceID(user.UserID, user.Email, "draft-inline"), "screenshot.png", "image/png", []byte("png-bytes"))
	inlineBody := `<div>Screenshot</div><img src="mango-attachment:` + url.PathEscape(inlineAttachmentID) + `" alt="screenshot"><img src='mango-attachment:` + url.PathEscape(inlineAttachmentID) + `' alt="duplicate reference">`
	inlinePayload, err := json.Marshal(map[string]any{
		"company_id": companyID,
		"to":         []map[string]string{{"email": "friend@example.com"}},
		"subject":    "Inline screenshot",
		"body":       inlineBody,
	})
	if err != nil {
		t.Fatal(err)
	}
	inlineSendReq := httptest.NewRequest(http.MethodPost, "/v1/communications/messages/send", strings.NewReader(string(inlinePayload)))
	inlineSendReq.Header.Set("Authorization", token)
	inlineSendReq.Header.Set("Content-Type", "application/json")
	inlineSendRec := httptest.NewRecorder()
	handler.ServeHTTP(inlineSendRec, inlineSendReq)
	if inlineSendRec.Code != http.StatusCreated {
		t.Fatalf("inline send status = %d body=%s", inlineSendRec.Code, inlineSendRec.Body.String())
	}
	inlineContentID := communicationsInlineImageContentID(inlineAttachmentID)
	if strings.Contains(nylas.sent.Body, "mango-attachment:") || strings.Count(nylas.sent.Body, "cid:"+inlineContentID) != 2 {
		t.Fatalf("sent body = %q, want internal attachment source rewritten to cid", nylas.sent.Body)
	}
	if len(nylas.sent.Attachments) != 1 {
		t.Fatalf("inline attachments = %+v, want one resolved attachment", nylas.sent.Attachments)
	}
	inlineAttachment := nylas.sent.Attachments[0]
	if inlineAttachment.AttachmentID != inlineAttachmentID || inlineAttachment.ContentID != inlineContentID || !inlineAttachment.IsInline || inlineAttachment.ContentDisposition != "inline" || inlineAttachment.Content != "" ||
		len(nylas.sent.OutboundAttachments) != 1 || len(nylas.sentAttachmentBodies) != 1 || string(nylas.sentAttachmentBodies[0]) != "png-bytes" {
		t.Fatalf("inline metadata=%+v outbound=%+v bodies=%q, want CID-linked streamed screenshot", inlineAttachment, nylas.sent.OutboundAttachments, nylas.sentAttachmentBodies)
	}
	var inlineSendResponse struct {
		Message NylasMessage `json:"message"`
	}
	if err := json.Unmarshal(inlineSendRec.Body.Bytes(), &inlineSendResponse); err != nil {
		t.Fatal(err)
	}
	if inlineSendResponse.Message.Body != nylas.sent.Body || len(inlineSendResponse.Message.Attachments) != 1 {
		t.Fatalf("inline send response = %+v, want provider-ready body and attachment metadata", inlineSendResponse.Message)
	}
	responseAttachment := inlineSendResponse.Message.Attachments[0]
	if responseAttachment.Content != "" || responseAttachment.AttachmentID != inlineAttachmentID || responseAttachment.ContentID != inlineContentID || !responseAttachment.IsInline {
		t.Fatalf("response attachment = %+v, want metadata-only Mango inline attachment", responseAttachment)
	}
	sentResourceID := communicationsSentMessageResourceID(user.UserID, "", inlineSendResponse.Message.ID)
	sentLinks, err := repo.ListResourceAttachments(companyID, "email_message", sentResourceID)
	if err != nil {
		t.Fatal(err)
	}
	var sentInlineLink *domain.ResourceAttachment
	for index := range sentLinks {
		if sentLinks[index].AttachmentID == inlineAttachmentID {
			sentInlineLink = &sentLinks[index]
			break
		}
	}
	if sentInlineLink == nil || sentInlineLink.RelationshipKind != store.AttachmentRelationshipEmailInline {
		t.Fatalf("sent attachment links = %+v, want durable inline email_message link", sentLinks)
	}
	if err := repo.SoftDeleteCommunicationsEmailDraft(store.CommunicationsEmailDraftDeleteInput{
		CompanyID: companyID, DraftID: "draft-inline", PersonalUserID: user.UserID,
		PersonalAccountEmail: user.Email, UpdatedByUserID: user.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	sentInlineRequest := httptest.NewRequest(http.MethodGet, "/v1/attachments/"+url.PathEscape(inlineAttachmentID)+"/content?company_id="+url.QueryEscape(companyID)+"&variant=original", nil)
	sentInlineRequest.Header.Set("Authorization", token)
	sentInlineContent := httptest.NewRecorder()
	handler.ServeHTTP(sentInlineContent, sentInlineRequest)
	if sentInlineContent.Code != http.StatusOK || sentInlineContent.Body.String() != "png-bytes" {
		t.Fatalf("sent inline content after draft cleanup status=%d body=%q", sentInlineContent.Code, sentInlineContent.Body.String())
	}

	missingInlinePayload, err := json.Marshal(map[string]any{
		"company_id": companyID,
		"to":         []map[string]string{{"email": "friend@example.com"}},
		"subject":    "Broken inline reference",
		"body":       `<img src="mango-attachment:missing-attachment">`,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send", string(missingInlinePayload), token, http.StatusNotFound)
	if nylas.sent.Subject != "Inline screenshot" {
		t.Fatalf("send reached provider for missing inline attachment: %+v", nylas.sent)
	}
	assertJSONStatus(t, handler, http.MethodDelete, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/disconnect", "", token, http.StatusOK)
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("connection after disconnect error = %v, want ErrNotFound", err)
	}
}

func TestCommunicationsMessageSkipsRawMIMEWithoutCIDReferences(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	nylas := &fakeNylasClient{
		message: NylasMessage{ID: "message-1", Subject: "Photos", Body: "Body", Attachments: []NylasAttachment{{
			ID:          "provider-file-1",
			Filename:    "photo.png",
			ContentType: "image/png",
		}}},
		rawMIME: strings.Join([]string{
			"From: Sender <sender@example.com>",
			"To: User <user@example.com>",
			"Subject: Photos",
			"MIME-Version: 1.0",
			`Content-Type: multipart/mixed; boundary="mango-boundary"`,
			"",
			"--mango-boundary",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"Body",
			"--mango-boundary",
			`Content-Type: image/png; name="photo.png"`,
			`Content-Disposition: attachment; filename="photo.png"`,
			"Content-Transfer-Encoding: base64",
			"",
			"aW1hZ2UtYnl0ZXM=",
			"--mango-boundary--",
			"",
		}, "\r\n"),
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1", nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("message status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Message NylasMessage `json:"message"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if nylas.lastRawMIMEGrantID != "" || nylas.lastRawMIMEMessageID != "" {
		t.Fatalf("ordinary message fetched raw MIME grant=%q message=%q", nylas.lastRawMIMEGrantID, nylas.lastRawMIMEMessageID)
	}
	if len(payload.Message.Attachments) != 1 {
		t.Fatalf("attachments = %+v, want provider attachment only", payload.Message.Attachments)
	}
	attachment := payload.Message.Attachments[0]
	if attachment.ID != "provider-file-1" || attachment.Content != "" {
		t.Fatalf("attachment = %+v, want unchanged provider attachment", attachment)
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

func TestCommunicationsMessageUsesProviderDownloadForResolvableCIDAttachment(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	nylas := &fakeNylasClient{
		message: NylasMessage{
			ID:      "message-1",
			Subject: "Inline image",
			Body:    `<div>Here</div><img src="cid:image-1@local" alt="image.png">`,
			Attachments: []NylasAttachment{{
				ID:                 "provider-inline-1",
				Filename:           "image.png",
				ContentType:        "image/png",
				ContentID:          "image-1@local",
				ContentDisposition: "inline",
				IsInline:           true,
				Size:               86,
			}, {
				ID:          "provider-file-1",
				Filename:    "dashboard.png",
				ContentType: "image/png",
				Size:        197,
			}},
		},
		rawMIME: strings.Join([]string{
			"From: Sender <sender@example.com>",
			"To: User <user@example.com>",
			"Subject: Inline image",
			"MIME-Version: 1.0",
			`Content-Type: multipart/related; boundary="mango-related"`,
			"",
			"--mango-related",
			"Content-Type: text/html; charset=utf-8",
			"",
			`<div>Here</div><img src="cid:image-1@local" alt="image.png">`,
			"--mango-related",
			"Content-Type: image/png",
			"Content-Disposition: inline",
			"Content-ID: <image-1@local>",
			"Content-Transfer-Encoding: base64",
			"",
			"aW1hZ2UtYnl0ZXM=",
			"--mango-related",
			`Content-Type: image/png; name="dashboard.png"`,
			`Content-Disposition: attachment; filename="dashboard.png"`,
			"Content-Transfer-Encoding: base64",
			"",
			"ZGFzaGJvYXJk",
			"--mango-related--",
			"",
		}, "\r\n"),
		downloadContent: []byte("image-bytes"),
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1", nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("message status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Message NylasMessage `json:"message"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if nylas.lastRawMIMEGrantID != "" || nylas.lastRawMIMEMessageID != "" {
		t.Fatalf("downloadable CID metadata fetched raw MIME grant=%q message=%q", nylas.lastRawMIMEGrantID, nylas.lastRawMIMEMessageID)
	}
	if len(payload.Message.Attachments) != 2 {
		t.Fatalf("attachments = %+v, want existing inline attachment merged without duplicating regular attachments", payload.Message.Attachments)
	}
	var attachment NylasAttachment
	for _, item := range payload.Message.Attachments {
		if item.ID == "provider-inline-1" {
			attachment = item
		}
	}
	if attachment.ID != "provider-inline-1" || attachment.ContentID != "image-1@local" || attachment.Content != "" || !attachment.IsInline {
		t.Fatalf("attachment = %+v, want unchanged downloadable provider metadata", attachment)
	}

	attachmentReq := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1/attachments/provider-inline-1", nil)
	attachmentReq.Header.Set("Authorization", token)
	attachmentRec := httptest.NewRecorder()
	handler.ServeHTTP(attachmentRec, attachmentReq)
	if attachmentRec.Code != http.StatusOK {
		t.Fatalf("provider inline attachment status = %d body=%s", attachmentRec.Code, attachmentRec.Body.String())
	}
	if attachmentRec.Header().Get("Content-Type") != "image/png" || attachmentRec.Body.String() != "image-bytes" {
		t.Fatalf("provider inline attachment content-type=%q body=%q, want image/png image-bytes", attachmentRec.Header().Get("Content-Type"), attachmentRec.Body.String())
	}
	if nylas.lastDownloadAttachmentID != "provider-inline-1" {
		t.Fatalf("download attachment id = %q, want provider-inline-1", nylas.lastDownloadAttachmentID)
	}
}

func TestCommunicationsCachedMessageRecoversRawMIMEInlineAttachmentContent(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		rawMIME: strings.Join([]string{
			"From: Sender <sender@example.com>",
			"To: User <user@example.com>",
			"Subject: Cached inline image",
			"MIME-Version: 1.0",
			`Content-Type: multipart/related; boundary="mango-related"`,
			"",
			"--mango-related",
			"Content-Type: text/html; charset=utf-8",
			"",
			`<div>Here</div><img src="cid:image-1@local" alt="image.png">`,
			"--mango-related",
			"Content-Type: image/png",
			"Content-Disposition: inline",
			"Content-ID: <image-1@local>",
			"Content-Transfer-Encoding: base64",
			"",
			"aW1hZ2UtYnl0ZXM=",
			"--mango-related--",
			"",
		}, "\r\n"),
	}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	})
	server.commCache.setMessage(user.UserID, communicationsConnectionCacheScope(connection), NylasMessage{
		ID:      "message-1",
		Subject: "Cached inline image",
		Body:    `<div>Here</div><img src="cid:image-1@local" alt="image.png">`,
		Attachments: []NylasAttachment{{
			Filename:           "image.png",
			ContentType:        "image/png",
			ContentID:          "image-1@local",
			ContentDisposition: "inline",
			IsInline:           true,
			Size:               86,
		}},
	}, time.Now().UTC())
	handler := server.Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1", nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("cached message status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Message NylasMessage `json:"message"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want cached detail with raw MIME recovery", nylas.detailCalls)
	}
	if nylas.lastRawMIMEGrantID != "grant-1" || nylas.lastRawMIMEMessageID != "message-1" {
		t.Fatalf("raw mime scope grant=%q message=%q", nylas.lastRawMIMEGrantID, nylas.lastRawMIMEMessageID)
	}
	if len(payload.Message.Attachments) != 1 || payload.Message.Attachments[0].Content != "aW1hZ2UtYnl0ZXM=" {
		t.Fatalf("attachments = %+v, want cached inline attachment recovered from raw MIME", payload.Message.Attachments)
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
	attachmentID := seedLiveEmailDraftAttachmentForCommunicationsTest(t, repo, storage, user.UserID, companyID, personalEmailDraftResourceID(user.UserID, user.Email, "draft-large"), "large.txt", "text/plain", largeContent)
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
			AccessLevel: store.EntityPermissionView,
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
		NylasClient:                        client,
		DisableCommunicationsArchiveWorker: true,
		DisableNotificationCleanup:         true,
		DisableAttachmentUploadCleanup:     true,
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

	go func() {
		folders, err := server.communicationsFolders(context.Background(), connection, false)
		results <- folderResult{folders: folders, err: err}
	}()
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
		NylasClient:                        client,
		DisableCommunicationsArchiveWorker: true,
		DisableNotificationCleanup:         true,
		DisableAttachmentUploadCleanup:     true,
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

func TestCommunicationsCanceledColdReadsReleaseGenerationOwnershipWithoutProviderCalls(t *testing.T) {
	client := &fakeNylasClient{}
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{
		NylasClient:                        client,
		DisableCommunicationsArchiveWorker: true,
		DisableNotificationCleanup:         true,
		DisableAttachmentUploadCleanup:     true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	server.nylasGate.capacity = 1
	connection := domain.UserEmailConnection{UserID: "cancelled-cold-user", Provider: "google", AccountEmail: "cancelled@example.com", GrantID: "cancelled-cold-grant", Scope: "personal"}
	releaseGate, err := server.nylasGate.acquire(context.Background(), connection.GrantID)
	if err != nil {
		t.Fatal(err)
	}
	defer releaseGate()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := server.communicationsFolders(ctx, connection, true); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled cold folders error = %v, want context canceled", err)
	}
	if _, err := server.communicationsMessagePage(ctx, connection, NylasMessageQuery{Limit: 12, Refresh: true}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled cold page error = %v, want context canceled", err)
	}
	if _, err := server.communicationsMessage(ctx, connection, "cancelled-message"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled cold detail error = %v, want context canceled", err)
	}
	if client.folderCalls != 0 || client.messageCalls != 0 || client.detailCalls != 0 {
		t.Fatalf("canceled cold provider calls folders=%d pages=%d details=%d, want none", client.folderCalls, client.messageCalls, client.detailCalls)
	}
	server.commCache.mu.RLock()
	folderGenerations := len(server.commCache.folderGenerations)
	pageGenerations := len(server.commCache.pageGenerations)
	detailGenerations := len(server.commCache.messageGenerations)
	server.commCache.mu.RUnlock()
	if folderGenerations != 0 || pageGenerations != 0 || detailGenerations != 0 {
		t.Fatalf("canceled cold reads leaked generation ownership folders=%d pages=%d details=%d", folderGenerations, pageGenerations, detailGenerations)
	}
}

func TestSharedAccountScopeInvalidationFencesColdInFlightFolderPageAndDetailReads(t *testing.T) {
	folderStarted := make(chan struct{})
	folderRelease := make(chan struct{})
	pageStarted := make(chan struct{})
	pageRelease := make(chan struct{})
	detailStarted := make(chan struct{})
	detailRelease := make(chan struct{})
	client := &blockingCommunicationsNylasClient{
		fakeNylasClient: &fakeNylasClient{
			messages: []NylasMessage{{ID: "shared-cold-message", Subject: "Old page"}},
			message:  NylasMessage{ID: "shared-cold-message", Subject: "Old detail", Body: "Old body"},
		},
		folderStarted: folderStarted,
		folderRelease: folderRelease,
		folderResult:  []NylasFolder{{ID: "inbox", Name: "Old folders"}},
		pageStarted:   pageStarted,
		pageRelease:   pageRelease,
		detailStarted: detailStarted,
		detailRelease: detailRelease,
	}
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{
		NylasClient:                        client,
		DisableCommunicationsArchiveWorker: true,
		DisableNotificationCleanup:         true,
		DisableAttachmentUploadCleanup:     true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	server.nylasGate.capacity = 3
	connection := domain.UserEmailConnection{
		UserID:                   "revoked-shared-cold-user",
		Provider:                 "google",
		AccountEmail:             "shared@example.com",
		GrantID:                  "shared-cold-grant",
		Scope:                    "shared",
		CompanyID:                "shared-cold-company",
		CompanyEmailConnectionID: "shared-cold-connection",
	}
	query := NylasMessageQuery{Limit: communicationsNylasMaxMessageLimit, Mailbox: "primary", Refresh: true}
	errs := make(chan error, 3)
	go func() {
		_, err := server.communicationsFolders(context.Background(), connection, true)
		errs <- err
	}()
	go func() {
		_, err := server.communicationsMessagePage(context.Background(), connection, query)
		errs <- err
	}()
	go func() {
		_, err := server.communicationsMessage(context.Background(), connection, "shared-cold-message")
		errs <- err
	}()
	<-folderStarted
	<-pageStarted
	<-detailStarted

	cacheScope := communicationsConnectionCacheScope(connection)
	server.applyNylasWebhookCacheInvalidationForAccountScope(cacheScope, nylasWebhookChange{Trigger: "message.updated", MessageID: "shared-cold-message"})
	client.setFolderResult([]NylasFolder{{ID: "inbox", Name: "New folders"}})
	client.setPageResult([]NylasMessage{{ID: "shared-cold-message", Subject: "New page"}})
	client.setDetailResult(NylasMessage{ID: "shared-cold-message", Subject: "New detail", Body: "New body"})
	close(folderRelease)
	close(pageRelease)
	close(detailRelease)
	for i := 0; i < 3; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("cold shared in-flight read %d: %v", i+1, err)
		}
	}
	cacheQuery := query
	cacheQuery.Refresh = false
	if cached, ok := server.commCache.getFolders(connection.UserID, cacheScope, communicationsFoldersCacheTTL, time.Now().UTC()); ok {
		t.Fatalf("cold shared folder flight repopulated invalidated cache: %+v", cached)
	}
	if cached, ok := server.commCache.getMessagePage(connection.UserID, cacheScope, cacheQuery, communicationsMessagesCacheTTL, time.Now().UTC()); ok {
		t.Fatalf("cold shared page flight repopulated invalidated cache: %+v", cached)
	}
	if cached, ok := server.commCache.getMessage(connection.UserID, cacheScope, "shared-cold-message", communicationsMessageCacheTTL, time.Now().UTC()); ok {
		t.Fatalf("cold shared detail flight repopulated invalidated cache: %+v", cached)
	}

	newFolders, err := server.communicationsFolders(context.Background(), connection, true)
	if err != nil || len(newFolders) != 1 || newFolders[0].Name != "New folders" {
		t.Fatalf("canonical shared folders after invalidation = %+v err=%v", newFolders, err)
	}
	newPage, err := server.communicationsMessagePage(context.Background(), connection, query)
	if err != nil || len(newPage.Messages) != 1 || newPage.Messages[0].Subject != "New page" {
		t.Fatalf("canonical shared page after invalidation = %+v err=%v", newPage, err)
	}
	newDetail, err := server.communicationsMessage(context.Background(), connection, "shared-cold-message")
	if err != nil || newDetail.Subject != "New detail" || newDetail.Body != "New body" {
		t.Fatalf("canonical shared detail after invalidation = %+v err=%v", newDetail, err)
	}
	if client.folderReadCalls() != 2 || client.pageCalls() != 2 || client.detailCalls() != 2 {
		t.Fatalf("shared provider calls folders=%d pages=%d details=%d, want old plus canonical read for each", client.folderReadCalls(), client.pageCalls(), client.detailCalls())
	}
}

func TestCommunicationsMessageCoalescesSameKeyProviderReads(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	client := &blockingCommunicationsNylasClient{
		fakeNylasClient: &fakeNylasClient{message: NylasMessage{ID: "message-1", Body: "<p>Body</p>"}},
		detailStarted:   started,
		detailRelease:   release,
	}
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{NylasClient: client})
	server.nylasGate = newNylasRequestGate(0)
	connection := domain.UserEmailConnection{
		UserID:       "user-1",
		Provider:     "google",
		AccountEmail: "user@example.com",
		GrantID:      "grant-1",
		Scope:        "personal",
	}
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := server.communicationsMessage(context.Background(), connection, "message-1")
			errs <- err
		}()
		if i == 0 {
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				close(release)
				t.Fatal("first detail provider call did not start")
			}
		}
	}
	cacheScope := communicationsConnectionCacheScope(connection)
	waitForCommunicationsCacheGenerationOwners(t, server.commCache, "message", communicationsMessageCacheKey(connection.UserID, cacheScope, "message-1"), 2)
	close(release)
	for i := 0; i < 2; i++ {
		select {
		case err := <-errs:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("coalesced detail request did not complete")
		}
	}
	if client.detailCalls() != 1 {
		t.Fatalf("detail provider calls = %d, want one", client.detailCalls())
	}
}

func TestCommunicationsMessagePageCoalescesSameKeyForcedRefreshes(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	client := &blockingCommunicationsNylasClient{
		fakeNylasClient: &fakeNylasClient{messages: []NylasMessage{{ID: "message-1"}}},
		pageStarted:     started,
		pageRelease:     release,
	}
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{NylasClient: client})
	server.nylasGate = newNylasRequestGate(0)
	connection := domain.UserEmailConnection{
		UserID:       "user-1",
		Provider:     "google",
		AccountEmail: "user@example.com",
		GrantID:      "grant-1",
		Scope:        "personal",
	}
	query := NylasMessageQuery{Limit: communicationsNylasMaxMessageLimit, Mailbox: "primary", Refresh: true}
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := server.communicationsMessagePage(context.Background(), connection, query)
			errs <- err
		}()
		if i == 0 {
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				close(release)
				t.Fatal("first page provider call did not start")
			}
		}
	}
	cacheScope := communicationsConnectionCacheScope(connection)
	waitForCommunicationsCacheGenerationOwners(t, server.commCache, "page", communicationsAccountScopedCacheKey(connection.UserID, cacheScope), 2)
	close(release)
	for i := 0; i < 2; i++ {
		select {
		case err := <-errs:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("coalesced page request did not complete")
		}
	}
	if client.pageCalls() != 1 {
		t.Fatalf("page provider calls = %d, want one", client.pageCalls())
	}
}

func TestCommunicationsMessagePageInvalidationFencesOldFlightAndStartsCanonicalRead(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	secondCall := make(chan struct{})
	client := &blockingCommunicationsNylasClient{
		fakeNylasClient: &fakeNylasClient{messages: []NylasMessage{{ID: "message-old", Subject: "Before commit"}}},
		pageStarted:     started,
		pageRelease:     release,
		pageSecondCall:  secondCall,
	}
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{
		NylasClient:                        client,
		DisableCommunicationsArchiveWorker: true,
		DisableNotificationCleanup:         true,
		DisableAttachmentUploadCleanup:     true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	connection := domain.UserEmailConnection{UserID: "page-race-user", Provider: "google", AccountEmail: "page@example.com", GrantID: "page-race-grant", Scope: "personal"}
	query := NylasMessageQuery{Limit: communicationsNylasMaxMessageLimit, Mailbox: "primary", Refresh: true}
	oldResult := make(chan NylasMessagePage, 1)
	newResult := make(chan NylasMessagePage, 1)
	errs := make(chan error, 2)
	go func() {
		page, err := server.communicationsMessagePage(context.Background(), connection, query)
		oldResult <- page
		errs <- err
	}()
	<-started
	cacheScope := communicationsConnectionCacheScope(connection)
	server.applyNylasWebhookCacheInvalidation(connection.UserID, cacheScope, nylasWebhookChange{Trigger: "message.updated", MessageID: "message-old"})
	client.setPageResult([]NylasMessage{{ID: "message-new", Subject: "After commit"}})
	go func() {
		page, err := server.communicationsMessagePage(context.Background(), connection, query)
		newResult <- page
		errs <- err
	}()
	<-secondCall
	close(release)
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("generation-separated message page read: %v", err)
		}
	}
	oldPage := <-oldResult
	newPage := <-newResult
	if len(oldPage.Messages) != 1 || oldPage.Messages[0].Subject != "Before commit" {
		t.Fatalf("old page response = %+v, want pre-commit response only for its original caller", oldPage)
	}
	if len(newPage.Messages) != 1 || newPage.Messages[0].Subject != "After commit" {
		t.Fatalf("post-webhook page response = %+v, want independent canonical read", newPage)
	}
	if calls := client.pageCalls(); calls != 2 {
		t.Fatalf("generation-separated page provider calls = %d, want 2", calls)
	}
	cacheQuery := query
	cacheQuery.Refresh = false
	cached, ok := server.commCache.getMessagePage(connection.UserID, cacheScope, cacheQuery, communicationsMessagesCacheTTL, time.Now().UTC())
	if !ok || len(cached.Messages) != 1 || cached.Messages[0].Subject != "After commit" {
		t.Fatalf("message page cache after old-flight completion = %+v present=%t, want post-commit page", cached, ok)
	}
}

func TestCommunicationsMessageInvalidationFencesOldFlightAndStartsCanonicalRead(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	secondCall := make(chan struct{})
	client := &blockingCommunicationsNylasClient{
		fakeNylasClient:  &fakeNylasClient{message: NylasMessage{ID: "same-message", Subject: "Before commit", Body: "Old body"}},
		detailStarted:    started,
		detailRelease:    release,
		detailSecondCall: secondCall,
	}
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{
		NylasClient:                        client,
		DisableCommunicationsArchiveWorker: true,
		DisableNotificationCleanup:         true,
		DisableAttachmentUploadCleanup:     true,
	})
	defer server.Close()
	server.nylasGate = newNylasRequestGate(0)
	connection := domain.UserEmailConnection{UserID: "detail-race-user", Provider: "google", AccountEmail: "detail@example.com", GrantID: "detail-race-grant", Scope: "personal"}
	oldResult := make(chan NylasMessage, 1)
	newResult := make(chan NylasMessage, 1)
	errs := make(chan error, 2)
	go func() {
		message, err := server.communicationsMessage(context.Background(), connection, "same-message")
		oldResult <- message
		errs <- err
	}()
	<-started
	cacheScope := communicationsConnectionCacheScope(connection)
	server.applyNylasWebhookCacheInvalidation(connection.UserID, cacheScope, nylasWebhookChange{Trigger: "message.updated", MessageID: "same-message"})
	client.setDetailResult(NylasMessage{ID: "same-message", Subject: "After commit", Body: "New body"})
	go func() {
		message, err := server.communicationsMessage(context.Background(), connection, "same-message")
		newResult <- message
		errs <- err
	}()
	<-secondCall
	close(release)
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("generation-separated message detail read: %v", err)
		}
	}
	oldMessage := <-oldResult
	newMessage := <-newResult
	if oldMessage.Subject != "Before commit" || oldMessage.Body != "Old body" {
		t.Fatalf("old detail response = %+v, want pre-commit response only for its original caller", oldMessage)
	}
	if newMessage.Subject != "After commit" || newMessage.Body != "New body" {
		t.Fatalf("post-webhook detail response = %+v, want independent canonical read", newMessage)
	}
	if calls := client.detailCalls(); calls != 2 {
		t.Fatalf("generation-separated detail provider calls = %d, want 2", calls)
	}
	cached, ok := server.commCache.getMessage(connection.UserID, cacheScope, "same-message", communicationsMessageCacheTTL, time.Now().UTC())
	if !ok || cached.Subject != "After commit" || cached.Body != "New body" {
		t.Fatalf("message detail cache after old-flight completion = %+v present=%t, want post-commit detail", cached, ok)
	}
}

func TestCommunicationsMessagesCacheIsScopedPerSharedInboxAccount(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-message-cache"
	repo.EnsureCompany(companyID, "Shared Message Cache Company")
	actor, err := repo.UpsertAuthUser("cache-actor", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       actor.UserID,
		Provider:     "google",
		AccountEmail: actor.Email,
		GrantID:      "grant-personal",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       actor.UserID,
		Provider:     "google",
		AccountEmail: "support@example.com",
		Scope:        "shared",
		GrantID:      "grant-shared",
		Status:       "connected",
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
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		messagesByGrantID: map[string][]NylasMessage{
			"grant-personal": {{ID: "personal-message", Subject: "Personal inbox"}},
			"grant-shared":   {{ID: "shared-message", Subject: "Shared inbox"}},
		},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	if nylas.lastMessageGrantID != "grant-personal" {
		t.Fatalf("personal message grant = %q, want grant-personal", nylas.lastMessageGrantID)
	}
	if nylas.lastQuery.SearchQueryNative != "in:inbox -category:social -category:promotions" {
		t.Fatalf("personal Primary search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}

	sharedPath := "/v1/communications/messages?mailbox=primary&limit=5&company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	req := httptest.NewRequest(http.MethodGet, sharedPath, nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("shared inbox messages status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	if nylas.lastMessageGrantID != "grant-shared" {
		t.Fatalf("shared message grant = %q, want grant-shared", nylas.lastMessageGrantID)
	}
	if nylas.lastQuery.SearchQueryNative != "in:inbox -category:social -category:promotions" {
		t.Fatalf("shared Primary search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "shared-message") || strings.Contains(body, "personal-message") {
		t.Fatalf("shared inbox response = %s, want shared mailbox messages only", body)
	}
	if nylas.messageCalls != 2 {
		t.Fatalf("message calls = %d, want personal and shared Nylas reads", nylas.messageCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, sharedPath, "", token, http.StatusOK)
	if nylas.messageCalls != 2 {
		t.Fatalf("message calls after shared cache read = %d, want cached shared page", nylas.messageCalls)
	}
}

func TestCommunicationsPersonalReadsSelectExactOwnedAccount(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	actor, err := repo.UpsertAuthUser("exact-account-actor", "account-a@example.com", "Exact Account Actor")
	if err != nil {
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

	nylas := &fakeNylasClient{messagesByGrantID: map[string][]NylasMessage{
		"grant-account-a": {{ID: "message-a", Subject: "Account A"}},
		"grant-account-b": {{ID: "message-b", Subject: "Account B"}},
		"grant-other":     {{ID: "message-other", Subject: "Other user"}},
	}}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)

	path := "/v1/communications/messages?mailbox=primary&limit=5&account_email=ACCOUNT-B%40EXAMPLE.COM"
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("exact account messages status=%d body=%s", rec.Code, rec.Body.String())
	}
	if nylas.lastMessageGrantID != "grant-account-b" {
		t.Fatalf("exact account grant=%q, want grant-account-b", nylas.lastMessageGrantID)
	}
	if body := rec.Body.String(); !strings.Contains(body, "message-b") || strings.Contains(body, "message-a") || strings.Contains(body, "message-other") {
		t.Fatalf("exact account response=%s, want only account B", body)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders?account_email=ACCOUNT-B%40EXAMPLE.COM", "", token, http.StatusOK)
	if nylas.lastFolderGrantID != "grant-account-b" || nylas.folderCalls != 1 {
		t.Fatalf("exact account folder grant=%q calls=%d, want grant-account-b and one provider read", nylas.lastFolderGrantID, nylas.folderCalls)
	}

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&account_email=missing%40example.com", "", token, http.StatusForbidden)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&account_email=other%40example.com", "", token, http.StatusForbidden)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders?account_email=missing%40example.com&refresh=true", "", token, http.StatusForbidden)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders?account_email=other%40example.com&refresh=true", "", token, http.StatusForbidden)
	if nylas.messageCalls != 1 {
		t.Fatalf("provider calls=%d, want denied accounts rejected before provider reads", nylas.messageCalls)
	}
	if nylas.folderCalls != 1 {
		t.Fatalf("folder provider calls=%d, want denied accounts rejected before provider reads", nylas.folderCalls)
	}
}

func TestCommunicationsSendUsesSharedInboxConnectionAndRequiresEdit(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-send"
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
		t.Fatalf("send grant after view-only request = %q, want none", nylas.lastSendGrantID)
	}

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeSharedInbox,
		EntityID:         folder.FolderID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		OverrideUserIDs:  []string{actor.UserID},
	}); err != nil {
		t.Fatal(err)
	}
	sharedContent := []byte("shared attachment bytes")
	attachmentID := seedLiveEmailDraftAttachmentForCommunicationsTest(t, repo, storage, actor.UserID, companyID, sharedEmailDraftResourceID(folder.FolderID, "draft-shared-send"), "shared-large.txt", "text/plain", sharedContent)
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
	inlineAttachmentID := seedLiveEmailDraftAttachmentForCommunicationsTest(t, repo, storage, actor.UserID, companyID, sharedEmailDraftResourceID(folder.FolderID, "draft-shared-inline"), "shared-screenshot.png", "image/png", []byte("shared-png"))
	inlinePayload, err := json.Marshal(map[string]any{
		"to":      []map[string]string{{"email": "customer@example.com"}},
		"subject": "Shared inline screenshot",
		"body":    `<img src="mango-attachment:` + url.PathEscape(inlineAttachmentID) + `">`,
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
		len(nylas.sent.OutboundAttachments) != 1 || len(nylas.sentAttachmentBodies) != 1 || string(nylas.sentAttachmentBodies[0]) != "shared-png" {
		t.Fatalf("shared inline metadata=%+v outbound=%+v bodies=%q, want one CID-linked streamed screenshot", nylas.sent.Attachments, nylas.sent.OutboundAttachments, nylas.sentAttachmentBodies)
	}
}

func TestCommunicationsCacheAvoidsRepeatedNylasReads(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "microsoft",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders:  []NylasFolder{{ID: "inbox", Name: "Inbox", Attributes: []string{"\\Inbox"}}},
		messages: []NylasMessage{{ID: "message-1", Subject: "Hello", Unread: true}},
		message:  NylasMessage{ID: "message-1", Subject: "Hello", Body: "Body", Unread: true},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	if nylas.folderCalls != 1 {
		t.Fatalf("folder calls = %d, want 1", nylas.folderCalls)
	}

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	if nylas.folderCalls != 1 {
		t.Fatalf("folder calls after mailbox resolution = %d, want 1", nylas.folderCalls)
	}
	if nylas.messageCalls != 1 {
		t.Fatalf("message list calls = %d, want 1", nylas.messageCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5&refresh=true", "", token, http.StatusOK)
	if nylas.messageCalls != 2 {
		t.Fatalf("message list calls after refresh = %d, want 2", nylas.messageCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	if nylas.messageCalls != 2 {
		t.Fatalf("message list calls after refreshed cache read = %d, want 2", nylas.messageCalls)
	}

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	if nylas.detailCalls != 1 {
		t.Fatalf("message detail calls = %d, want 1", nylas.detailCalls)
	}

	nylas.mu.Lock()
	nylas.folders = []NylasFolder{{ID: "inbox", Name: "Inbox after commit", Attributes: []string{"\\Inbox"}}}
	nylas.mu.Unlock()
	refreshReq := httptest.NewRequest(http.MethodGet, "/v1/communications/folders?refresh=true", nil)
	refreshReq.Header.Set("Authorization", token)
	refreshRec := httptest.NewRecorder()
	handler.ServeHTTP(refreshRec, refreshReq)
	if refreshRec.Code != http.StatusOK || !strings.Contains(refreshRec.Body.String(), "Inbox after commit") {
		t.Fatalf("folder refresh status=%d body=%s, want canonical post-commit folders", refreshRec.Code, refreshRec.Body.String())
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	if nylas.folderCalls != 2 {
		t.Fatalf("folder calls after explicit refresh and cache read = %d, want 2", nylas.folderCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders?refresh=not-a-boolean", "", token, http.StatusBadRequest)
	if nylas.folderCalls != 2 {
		t.Fatalf("folder calls after invalid refresh = %d, want validation before provider read", nylas.folderCalls)
	}
}

func TestCommunicationsCacheEvictsBoundedEntries(t *testing.T) {
	t.Parallel()

	cache := newCommunicationsCache()
	now := time.Unix(1000, 0).UTC()

	for i := 0; i < communicationsMaxMessagePagesPerUser+2; i++ {
		query := NylasMessageQuery{Limit: 5, PageToken: fmt.Sprintf("page-%d", i)}
		page := NylasMessagePage{Messages: []NylasMessage{{ID: fmt.Sprintf("message-%d", i)}}}
		cache.setMessagePage("user-1", "account:user@example.com", query, page, now.Add(time.Duration(i)*time.Second))
	}
	if len(cache.messagePages) != communicationsMaxMessagePagesPerUser {
		t.Fatalf("message page cache size = %d, want %d", len(cache.messagePages), communicationsMaxMessagePagesPerUser)
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", NylasMessageQuery{Limit: 5, PageToken: "page-0"}, communicationsMaxStaleTTL, now.Add(time.Minute)); ok {
		t.Fatal("oldest message page was not evicted")
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", NylasMessageQuery{Limit: 5, PageToken: fmt.Sprintf("page-%d", communicationsMaxMessagePagesPerUser+1)}, communicationsMaxStaleTTL, now.Add(time.Minute)); !ok {
		t.Fatal("newest message page was evicted")
	}

	for i := 0; i < communicationsMaxMessageEntries+4; i++ {
		cache.setMessage(fmt.Sprintf("global-user-%d", i), "account:user@example.com", NylasMessage{ID: "message-1", Body: "body"}, now.Add(time.Duration(i)*time.Second))
	}
	if len(cache.messages) != communicationsMaxMessageEntries {
		t.Fatalf("message detail cache size = %d, want %d", len(cache.messages), communicationsMaxMessageEntries)
	}
	if _, ok := cache.getMessage("global-user-0", "account:user@example.com", "message-1", communicationsMaxStaleTTL, now.Add(time.Minute)); ok {
		t.Fatal("oldest message detail was not globally evicted")
	}

	for i := 0; i < communicationsMaxMessageDetailsPerUser+2; i++ {
		cache.setMessage("detail-user", "account:user@example.com", NylasMessage{ID: fmt.Sprintf("detail-%d", i), Body: "body"}, now.Add(time.Duration(i)*time.Second))
	}
	if _, ok := cache.getMessage("detail-user", "account:user@example.com", "detail-0", communicationsMaxStaleTTL, now.Add(time.Minute)); ok {
		t.Fatal("oldest per-user message detail was not evicted")
	}
	if _, ok := cache.getMessage("detail-user", "account:user@example.com", fmt.Sprintf("detail-%d", communicationsMaxMessageDetailsPerUser+1), communicationsMaxStaleTTL, now.Add(time.Minute)); !ok {
		t.Fatal("newest per-user message detail was evicted")
	}
}

func TestCommunicationsCacheGenerationBookkeepingStaysBoundedToLiveOwners(t *testing.T) {
	cache := newCommunicationsCache()
	now := time.Unix(2000, 0).UTC()
	folderUsers := make([]string, 0, communicationsMaxCachedFolderUsers+16)
	for i := 0; i < communicationsMaxCachedFolderUsers+16; i++ {
		userID := fmt.Sprintf("folder-owner-%d", i)
		folderUsers = append(folderUsers, userID)
		generation, release := cache.beginFolderGeneration(userID, "grant:folder")
		if !cache.setFoldersIfGeneration(userID, "grant:folder", []NylasFolder{{ID: "inbox"}}, now.Add(time.Duration(i)*time.Second), generation) {
			t.Fatalf("set generation-owned folders %d", i)
		}
		release()
	}
	if len(cache.folders) != communicationsMaxCachedFolderUsers || len(cache.folderGenerations) != len(cache.folders) {
		t.Fatalf("folder cache=%d generations=%d, want exactly %d live owners", len(cache.folders), len(cache.folderGenerations), communicationsMaxCachedFolderUsers)
	}

	detailUsers := make([]string, 0, communicationsMaxMessageEntries+16)
	for i := 0; i < communicationsMaxMessageEntries+16; i++ {
		userID := fmt.Sprintf("detail-owner-%d", i)
		detailUsers = append(detailUsers, userID)
		generation, release := cache.beginMessageGeneration(userID, "grant:detail", "message")
		if !cache.setMessageIfGeneration(userID, "grant:detail", NylasMessage{ID: "message"}, now.Add(time.Duration(i)*time.Second), generation) {
			t.Fatalf("set generation-owned detail %d", i)
		}
		release()
	}
	if len(cache.messages) != communicationsMaxMessageEntries || len(cache.messageGenerations) != len(cache.messages) {
		t.Fatalf("detail cache=%d generations=%d, want exactly %d live owners", len(cache.messages), len(cache.messageGenerations), communicationsMaxMessageEntries)
	}

	pageOwners := map[string]struct{}{}
	for i := 0; i < 128; i++ {
		userID := fmt.Sprintf("page-owner-%d", i)
		generation, release := cache.beginMessagePageGeneration(userID, "grant:page")
		query := NylasMessageQuery{Limit: 12, PageToken: fmt.Sprintf("page-%d", i)}
		if !cache.setMessagePageIfGeneration(userID, "grant:page", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message"}}}, now.Add(time.Duration(i)*time.Second), generation) {
			t.Fatalf("set generation-owned page %d", i)
		}
		release()
		pageOwners[communicationsAccountScopedCacheKey(userID, "grant:page")] = struct{}{}
	}
	if len(cache.pageGenerations) != len(pageOwners) {
		t.Fatalf("page generations=%d, want %d live user/account owners", len(cache.pageGenerations), len(pageOwners))
	}

	folderGenerationCount := len(cache.folderGenerations)
	pageGenerationCount := len(cache.pageGenerations)
	detailGenerationCount := len(cache.messageGenerations)
	for i := 0; i < 1000; i++ {
		userID := fmt.Sprintf("uncached-user-%d", i)
		cache.invalidateFolders(userID, "grant:missing")
		cache.invalidateMessagePages(userID, "grant:missing")
		cache.invalidateMessage(userID, "grant:missing", fmt.Sprintf("missing-%d", i))
	}
	if len(cache.folderGenerations) != folderGenerationCount || len(cache.pageGenerations) != pageGenerationCount || len(cache.messageGenerations) != detailGenerationCount {
		t.Fatalf("uncached invalidations created tombstones folders=%d/%d pages=%d/%d details=%d/%d", len(cache.folderGenerations), folderGenerationCount, len(cache.pageGenerations), pageGenerationCount, len(cache.messageGenerations), detailGenerationCount)
	}

	for _, userID := range folderUsers {
		cache.invalidateUser(userID)
	}
	for _, userID := range detailUsers {
		cache.invalidateUser(userID)
	}
	for i := 0; i < 128; i++ {
		cache.invalidateUser(fmt.Sprintf("page-owner-%d", i))
	}
	if len(cache.folders) != 0 || len(cache.messagePages) != 0 || len(cache.messages) != 0 || len(cache.folderGenerations) != 0 || len(cache.pageGenerations) != 0 || len(cache.messageGenerations) != 0 {
		t.Fatalf("cache cleanup left live entries or generations folders=%d/%d pages=%d/%d details=%d/%d", len(cache.folders), len(cache.folderGenerations), len(cache.messagePages), len(cache.pageGenerations), len(cache.messages), len(cache.messageGenerations))
	}
}

func TestCommunicationsCommittedLocalPatchesFenceOlderPageAndDetailWriters(t *testing.T) {
	cache := newCommunicationsCache()
	now := time.Unix(3000, 0).UTC()
	const userID = "mutation-fence-user"
	const cacheScope = "grant:mutation-fence"
	query := NylasMessageQuery{Limit: 12, Mailbox: "primary"}
	cache.setMessagePage(userID, cacheScope, query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1", Subject: "Before", Unread: true, Folders: []string{"INBOX"}}}}, now)
	cache.setMessage(userID, cacheScope, NylasMessage{ID: "message-1", Subject: "Before", Unread: true, Folders: []string{"INBOX"}}, now)
	pageGeneration, releasePage := cache.beginMessagePageGeneration(userID, cacheScope)
	detailGeneration, releaseDetail := cache.beginMessageGeneration(userID, cacheScope, "message-1")

	unread := false
	starred := true
	committed := NylasMessage{ID: "message-1", Subject: "Committed", Unread: false, Starred: true, Folders: []string{"INBOX"}}
	cache.patchMessagePages(userID, cacheScope, committed, now.Add(time.Second))
	cache.patchMessageMetadata(userID, cacheScope, "message-1", NylasMessageUpdate{Unread: &unread, Starred: &starred}, committed)
	if cache.setMessagePageIfGeneration(userID, cacheScope, query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1", Subject: "Stale page"}}}, now.Add(2*time.Second), pageGeneration) {
		t.Fatal("pre-mutation page writer was accepted after committed cache patch")
	}
	if cache.setMessageIfGeneration(userID, cacheScope, NylasMessage{ID: "message-1", Subject: "Stale detail", Unread: true}, now.Add(2*time.Second), detailGeneration) {
		t.Fatal("pre-mutation detail writer was accepted after committed cache patch")
	}
	page, ok := cache.getMessagePage(userID, cacheScope, query, communicationsMessagesCacheTTL, now.Add(3*time.Second))
	if !ok || len(page.Messages) != 1 || page.Messages[0].Subject != "Committed" || page.Messages[0].Unread || !page.Messages[0].Starred {
		t.Fatalf("committed page patch was overwritten: %+v present=%t", page, ok)
	}
	detail, ok := cache.getMessage(userID, cacheScope, "message-1", communicationsMessageCacheTTL, now.Add(3*time.Second))
	if !ok || detail.Subject != "Before" || detail.Unread || !detail.Starred {
		t.Fatalf("committed detail metadata patch was overwritten: %+v present=%t", detail, ok)
	}
	releasePage()
	releaseDetail()

	cache.setMessagePage(userID, cacheScope, query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1", Subject: "Committed"}}}, now.Add(4*time.Second))
	removeGeneration, releaseRemove := cache.beginMessagePageGeneration(userID, cacheScope)
	cache.removeMessagesFromPages(userID, cacheScope, []string{"message-1"}, "primary", now.Add(5*time.Second))
	if cache.setMessagePageIfGeneration(userID, cacheScope, query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1", Subject: "Resurrected stale page"}}}, now.Add(6*time.Second), removeGeneration) {
		t.Fatal("pre-delete page writer resurrected a locally removed message")
	}
	page, ok = cache.getMessagePage(userID, cacheScope, query, communicationsMessagesCacheTTL, now.Add(7*time.Second))
	if !ok || len(page.Messages) != 0 {
		t.Fatalf("committed page removal was overwritten: %+v present=%t", page, ok)
	}
	releaseRemove()
}

func TestParseNylasWebhookChangesCanonicalizesMailboxTriggers(t *testing.T) {
	t.Parallel()

	changes, err := parseNylasWebhookChanges([]byte(`{
		"deltas": [
			{"type": " Message.Created.Truncated ", "data": {"object": {"id": "message-1", "grant_id": "grant-1"}}},
			{"trigger_type": "FOLDER.UPDATED.extra", "data": {"object": {"id": "folder-1", "grant_id": "grant-1"}}},
			{"event": "thread.replied", "data": {"object": {"id": "thread-1", "grant_id": "grant-1"}}}
		]
	}`))
	if err != nil {
		t.Fatalf("parseNylasWebhookChanges: %v", err)
	}
	if len(changes) != 3 {
		t.Fatalf("changes = %d, want 3", len(changes))
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

func TestNylasWebhookCacheInvalidationIsGranular(t *testing.T) {
	t.Parallel()

	now := time.Unix(1000, 0).UTC()
	query := NylasMessageQuery{Limit: 5, Mailbox: "primary"}

	cache := newCommunicationsCache()
	server := &Server{commCache: cache}
	cache.setFolders("user-1", "account:user@example.com", []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
	cache.setMessagePage("user-1", "account:user@example.com", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	cache.setMessage("user-1", "account:user@example.com", NylasMessage{ID: "message-1", Subject: "Cached"}, now)

	server.applyNylasWebhookCacheInvalidation("user-1", "account:user@example.com", nylasWebhookChange{Trigger: "message.opened", MessageID: "message-1"})

	if _, ok := cache.getFolders("user-1", "account:user@example.com", communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message webhook invalidated folders; want folder cache preserved")
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", query, communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message.opened invalidated message page; want list cache preserved")
	}
	if message, ok := cache.getMessage("user-1", "account:user@example.com", "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); !ok || message.Subject != "Cached" {
		t.Fatal("message.opened invalidated provider detail; want read status enriched without discarding the body")
	}

	cache.setMessagePage("user-1", "account:user@example.com", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	cache.setMessage("user-1", "account:user@example.com", NylasMessage{ID: "message-1", Subject: "Cached"}, now)
	cache.setMessagePage("user-1", "account:other@example.com", query, NylasMessagePage{Messages: []NylasMessage{{ID: "other-message"}}}, now)
	cache.setMessage("user-1", "account:other@example.com", NylasMessage{ID: "other-message", Subject: "Other cached body"}, now)
	server.applyNylasWebhookCacheInvalidation("user-1", "account:user@example.com", nylasWebhookChange{Trigger: "message.created", MessageID: "message-1"})
	if _, ok := cache.getFolders("user-1", "account:user@example.com", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.created preserved folders; want unread and mailbox counts invalidated")
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", query, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.created preserved message page; want list cache invalidated")
	}
	if _, ok := cache.getMessage("user-1", "account:user@example.com", "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.created preserved detail; want changed message detail invalidated")
	}
	if _, ok := cache.getMessagePage("user-1", "account:other@example.com", query, communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message.created invalidated an unrelated account page")
	}
	if _, ok := cache.getMessage("user-1", "account:other@example.com", "other-message", communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message.created invalidated an unrelated account detail")
	}

	cache.setFolders("user-1", "account:user@example.com", []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
	cache.setMessagePage("user-1", "account:user@example.com", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	cache.setMessage("user-1", "account:user@example.com", NylasMessage{ID: "message-1", Subject: "Cached"}, now)
	server.applyNylasWebhookCacheInvalidation("user-1", "account:user@example.com", nylasWebhookChange{Trigger: "message.updated", MessageID: "message-1"})
	if _, ok := cache.getFolders("user-1", "account:user@example.com", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.updated preserved folders; want unread and mailbox counts invalidated")
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", query, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.updated preserved message page; want list cache invalidated")
	}
	if _, ok := cache.getMessage("user-1", "account:user@example.com", "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.updated preserved detail; want changed message detail invalidated")
	}

	cache = newCommunicationsCache()
	server.commCache = cache
	cache.setFolders("user-1", "account:user@example.com", []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
	cache.setMessagePage("user-1", "account:user@example.com", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	cache.setMessage("user-1", "account:user@example.com", NylasMessage{ID: "message-1", Subject: "Cached"}, now)

	server.applyNylasWebhookCacheInvalidation("user-1", "account:user@example.com", nylasWebhookChange{Trigger: "folder.updated"})

	if _, ok := cache.getFolders("user-1", "account:user@example.com", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("folder webhook preserved folders; want folder cache invalidated")
	}
	if _, ok := cache.getMessagePage("user-1", "account:user@example.com", query, communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("folder webhook invalidated message page; want list cache preserved")
	}
	if _, ok := cache.getMessage("user-1", "account:user@example.com", "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("folder webhook invalidated message detail; want detail cache preserved")
	}
}

func TestCommunicationsPrimaryMailboxUsesGmailNativeSearch(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	nylas := &fakeNylasClient{messages: []NylasMessage{
		{ID: "primary-message", Unread: true, Folders: []string{"INBOX", "CATEGORY_PERSONAL"}},
		{ID: "social-message", Unread: true, Folders: []string{"INBOX", "CATEGORY_SOCIAL"}},
		{ID: "promotions-message", Unread: true, FolderIDs: []string{"INBOX", "CATEGORY_PROMOTIONS"}},
		{ID: "sent-message", Unread: true, Folders: []string{"SENT"}},
	}}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	})
	handler := server.Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	requestPage := func(requestPath string) NylasMessagePage {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, requestPath, nil)
		req.Header.Set("Authorization", token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, want 200 body=%s", requestPath, rec.Code, rec.Body.String())
		}
		var page NylasMessagePage
		if err := json.NewDecoder(rec.Body).Decode(&page); err != nil {
			t.Fatal(err)
		}
		return page
	}
	assertPrimaryOnly := func(label string, page NylasMessagePage) {
		t.Helper()
		if len(page.Messages) != 1 || page.Messages[0].ID != "primary-message" {
			t.Fatalf("%s Primary messages = %+v, want only primary-message", label, page.Messages)
		}
		if page.NextPageToken != "next-token" {
			t.Fatalf("%s Primary next page token = %q, want next-token", label, page.NextPageToken)
		}
	}

	path := "/v1/communications/messages?mailbox=primary&q=" + url.QueryEscape("from:ops@example.com OR category:social") + "&unread=true"
	assertPrimaryOnly("fresh", requestPage(path))
	if nylas.lastQuery.SearchQueryNative != "in:inbox -category:social -category:promotions (from:ops@example.com OR category:social) is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil || nylas.lastQuery.FolderID != "" {
		t.Fatalf("query = %+v, want Gmail-native inbox search only", nylas.lastQuery)
	}
	if cached, ok := server.commCache.getMessagePage(
		user.UserID,
		"grant:grant-1",
		nylas.lastQuery,
		communicationsMessagesCacheTTL,
		time.Now().UTC(),
	); !ok || len(cached.Messages) != 1 || cached.Messages[0].ID != "primary-message" {
		t.Fatalf("cached Primary page = %+v present=%v, want only primary-message", cached.Messages, ok)
	}
	assertPrimaryOnly("cached", requestPage(path))
	if nylas.messageCalls != 1 {
		t.Fatalf("message calls after cached Primary read = %d, want 1", nylas.messageCalls)
	}
	assertPrimaryOnly("refreshed", requestPage(path+"&refresh=true"))
	if nylas.messageCalls != 2 {
		t.Fatalf("message calls after refreshed Primary read = %d, want 2", nylas.messageCalls)
	}

	allPath := "/v1/communications/messages?mailbox=all&q=" + url.QueryEscape("from:ops@example.com OR category:social") + "&unread=true"
	allPage := requestPage(allPath)
	if len(allPage.Messages) != 4 {
		t.Fatalf("All messages = %+v, want Primary, Social, Promotions, and Sent", allPage.Messages)
	}
	if nylas.messageCalls != 3 {
		t.Fatalf("message calls after All read = %d, want 3", nylas.messageCalls)
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

func TestCommunicationsArchiveMailboxUsesGmailNativeSearch(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=archive&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "in:anywhere -in:inbox -in:trash -in:spam -in:sent -in:drafts (invoice) is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil || nylas.lastQuery.FolderID != "" {
		t.Fatalf("query = %+v, want Gmail-native archive search only", nylas.lastQuery)
	}
}

func TestCommunicationsSpamMailboxUsesGmailNativeSearch(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=spam&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "in:spam (invoice) is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil || nylas.lastQuery.FolderID != "" {
		t.Fatalf("query = %+v, want Gmail-native spam search only", nylas.lastQuery)
	}
}

func TestCommunicationsAllMailboxUsesGmailNativeSearch(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=all&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "in:anywhere (invoice) is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil {
		t.Fatalf("query = %+v, want Gmail-native all-mail search only", nylas.lastQuery)
	}
}

func TestCommunicationsStarredMailboxAppliesStarredFilter(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=starred&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "is:starred (invoice) is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil || nylas.lastQuery.Starred != nil {
		t.Fatalf("query = %+v, want Gmail-native starred search only", nylas.lastQuery)
	}
}

func TestCommunicationsStarMessagePreservesGmailInboxLabel(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	nylas := &fakeNylasClient{
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"INBOX", "UNREAD", "CATEGORY_PERSONAL", "SNOOZED", "CHAT", "Label_123"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/messages/message-1", `{"starred":true}`, token, http.StatusOK)
	if nylas.update.Starred == nil || !*nylas.update.Starred {
		t.Fatalf("starred update = %v, want true", nylas.update.Starred)
	}
	if nylas.update.Folders != nil {
		t.Fatalf("folders update = %v, want nil so starring preserves mailbox folders", nylas.update.Folders)
	}
}

func TestCommunicationsUnreadAndStarUpdatesPreserveHydratedDetailCache(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-cache-user"
	user, err := repo.UpsertAuthUser(subject, "cache@example.com", "Cache User")
	if err != nil {
		t.Fatal(err)
	}
	connection, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-cache",
		Status:       "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{message: NylasMessage{ID: "message-1", Unread: true}}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	})
	server.commCache.setMessage(user.UserID, communicationsConnectionCacheScope(connection), NylasMessage{
		ID:      "message-1",
		Subject: "Hydrated subject",
		Body:    "<p>Hydrated body</p>",
		Unread:  true,
	}, time.Now().UTC())
	handler := server.Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/messages/message-1", "{\"unread\":false,\"starred\":true}", token, http.StatusOK)

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages/message-1", nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("message status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Message NylasMessage
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want hydrated body cache preserved", nylas.detailCalls)
	}
	if payload.Message.Body != "<p>Hydrated body</p>" || payload.Message.Unread || !payload.Message.Starred {
		t.Fatalf("message = %+v, want cached body with patched unread/starred metadata", payload.Message)
	}
}
func TestCommunicationsCacheIncludesStarredMessagesInSourceMailboxes(t *testing.T) {
	t.Parallel()

	message := NylasMessage{ID: "message-1", Starred: true, Folders: []string{"INBOX", "CATEGORY_PERSONAL"}}
	if !nylasMessageMatchesCachedPageQuery(message, NylasMessageQuery{Mailbox: "primary"}) {
		t.Fatal("primary cache matcher excluded a starred inbox message")
	}
	if !nylasMessageMatchesCachedPageQuery(message, NylasMessageQuery{Mailbox: "starred"}) {
		t.Fatal("starred cache matcher excluded a starred inbox message")
	}
	if !nylasMessageMatchesCachedPageQuery(NylasMessage{ID: "message-2", Starred: true, Folders: []string{"CATEGORY_PERSONAL"}}, NylasMessageQuery{Mailbox: "archive"}) {
		t.Fatal("archive cache matcher excluded a starred archived message")
	}
	if !nylasMessageMatchesCachedPageQuery(NylasMessage{ID: "message-3", Folders: []string{"SPAM"}}, NylasMessageQuery{Mailbox: "spam"}) {
		t.Fatal("spam cache matcher excluded a spam message")
	}
	for _, category := range []string{"CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS"} {
		categorized := NylasMessage{ID: "categorized", Starred: true, Folders: []string{"INBOX", category}}
		if nylasMessageMatchesCachedPageQuery(categorized, NylasMessageQuery{Mailbox: "primary"}) {
			t.Fatalf("primary cache matcher included %s message", category)
		}
		if !nylasMessageMatchesCachedPageQuery(categorized, NylasMessageQuery{Mailbox: "starred"}) {
			t.Fatalf("starred cache matcher excluded %s message", category)
		}
	}
}

func TestCommunicationsArchiveMessageRemovesGmailInboxLabel(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	nylas := &fakeNylasClient{
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"INBOX", "UNREAD", "CATEGORY_PERSONAL", "SNOOZED", "CHAT", "STARRED", "Label_123"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/archive", "", token, http.StatusOK)
	if got, want := strings.Join(nylas.update.Folders, ","), "STARRED,Label_123"; got != want {
		t.Fatalf("folders = %q, want %q", got, want)
	}
	raw, err := json.Marshal(NylasMessageUpdate{Folders: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"folders":[]}` {
		t.Fatalf("empty folder update JSON = %s, want explicit folders array", raw)
	}
}

func TestCommunicationsArchiveMessageMovesFolderProvidersToArchiveFolder(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "microsoft",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders: []NylasFolder{
			{ID: "inbox-id", Name: "Inbox"},
			{ID: "archive-id", Name: "Archive"},
		},
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"inbox-id"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/archive", "", token, http.StatusOK)
	if len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "archive-id" {
		t.Fatalf("folders = %+v, want archive-id", nylas.update.Folders)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want archive without message body fetch", nylas.detailCalls)
	}
}

func TestCommunicationsArchiveBatchUsesCachedListFoldersAndReturnsCompactResult(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	nylas := &fakeNylasClient{
		messages: []NylasMessage{
			{ID: "message-1", Subject: "One", Folders: []string{"INBOX", "CATEGORY_PERSONAL", "Label_123"}},
			{ID: "message-2", Subject: "Two", Folders: []string{"INBOX", "Label_456"}},
		},
		updateErrByID: map[string]error{
			"message-2": NylasAPIError{StatusCode: http.StatusTooManyRequests, Code: "rate_limited", RetryAfter: "4"},
		},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)

	body := `{"message_ids":["message-1","message-2","message-1"," "]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/messages/archive-batch", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Retry-After"); got != "4" {
		t.Fatalf("Retry-After = %q, want 4", got)
	}
	if strings.Contains(rec.Body.String(), `"message"`) || strings.Contains(rec.Body.String(), "CATEGORY_PERSONAL") {
		t.Fatalf("batch response should be compact, got %s", rec.Body.String())
	}
	var payload struct {
		ArchivedIDs []string `json:"archived_ids"`
		Failed      []struct {
			MessageID string `json:"message_id"`
			Error     string `json:"error"`
		} `json:"failed"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.ArchivedIDs) != 1 || payload.ArchivedIDs[0] != "message-1" {
		t.Fatalf("archived ids = %+v, want message-1", payload.ArchivedIDs)
	}
	if len(payload.Failed) != 1 || payload.Failed[0].MessageID != "message-2" || payload.Failed[0].Error != "nylas_rate_limited" {
		t.Fatalf("failed = %+v, want message-2 rate limit", payload.Failed)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want cached list folder data", nylas.detailCalls)
	}
	if len(nylas.updateCalls) != 1 || nylas.updateCalls[0].MessageID != "message-1" || strings.Join(nylas.updateCalls[0].Update.Folders, ",") != "Label_123" {
		t.Fatalf("update calls = %+v, want compact Gmail archive update", nylas.updateCalls)
	}
}

func TestCommunicationsArchiveBatchBackgroundReturnsAcceptedAndArchivesAsync(t *testing.T) {
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	nylas := &fakeNylasClient{
		messages: []NylasMessage{
			{ID: "message-1", Subject: "One", Folders: []string{"INBOX", "CATEGORY_PERSONAL", "Label_123"}},
			{ID: "message-2", Subject: "Two", Folders: []string{"INBOX", "Label_456"}},
		},
	}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:                      testValidator(t, "kid", key),
		NylasConfig:                        testNylasConfig(),
		NylasClient:                        nylas,
		DisableCommunicationsArchiveWorker: true,
	})
	defer server.Close()
	handler := server.Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)

	body := `{"message_ids":["message-1","message-2"]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/messages/archive-batch?background=true", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		JobID       string   `json:"job_id"`
		AcceptedIDs []string `json:"accepted_ids"`
		ArchivedIDs []string `json:"archived_ids"`
		Failed      []struct {
			MessageID string `json:"message_id"`
			Error     string `json:"error"`
		} `json:"failed"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if strings.Join(payload.AcceptedIDs, ",") != "message-1,message-2" {
		t.Fatalf("accepted ids = %+v, want both messages", payload.AcceptedIDs)
	}
	if strings.TrimSpace(payload.JobID) == "" {
		t.Fatalf("job_id = %q, want durable job id", payload.JobID)
	}
	if len(payload.ArchivedIDs) != 0 || len(payload.Failed) != 0 {
		t.Fatalf("background response = archived %+v failed %+v, want compact accepted response", payload.ArchivedIDs, payload.Failed)
	}
	if len(nylas.updateCalls) != 0 {
		t.Fatalf("update calls before worker = %+v, want durable enqueue only", nylas.updateCalls)
	}
	items, err := repo.ListCommunicationsArchiveJobItems(payload.JobID)
	if err != nil {
		t.Fatalf("ListCommunicationsArchiveJobItems: %v", err)
	}
	if len(items) != 2 || items[0].Status != store.CommunicationsArchiveJobItemStatusPending || items[1].Status != store.CommunicationsArchiveJobItemStatusPending {
		t.Fatalf("job items after accept = %+v, want two pending items", items)
	}

	processed, err := server.processAvailableCommunicationsArchiveJobItems(context.Background(), 10)
	if err != nil {
		t.Fatalf("processAvailableCommunicationsArchiveJobItems: %v", err)
	}
	if processed != 2 {
		t.Fatalf("processed = %d, want 2", processed)
	}
	updateCalls := append([]fakeNylasUpdateCall(nil), nylas.updateCalls...)
	if len(updateCalls) != 2 {
		t.Fatalf("update calls = %+v, want 2 background archive updates", updateCalls)
	}
	if updateCalls[0].MessageID == "" || updateCalls[1].MessageID == "" {
		t.Fatalf("update calls = %+v, want message IDs", updateCalls)
	}
	items, err = repo.ListCommunicationsArchiveJobItems(payload.JobID)
	if err != nil {
		t.Fatalf("ListCommunicationsArchiveJobItems after process: %v", err)
	}
	for _, item := range items {
		if item.Status != store.CommunicationsArchiveJobItemStatusArchived || item.ArchivedTimestamp == nil {
			t.Fatalf("processed item = %+v, want archived timestamp", item)
		}
	}
}

func TestCommunicationsArchiveBatchBackgroundUsesSharedInboxJobScope(t *testing.T) {
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-archive-job"
	repo.EnsureCompany(companyID, "Shared Archive Job Company")
	actor, err := repo.UpsertAuthUser("shared-archive-actor", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID:         companyID,
		Provider:          "google",
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
	nylas := &fakeNylasClient{
		messagesByID: map[string]NylasMessage{
			"shared-message-1": {ID: "shared-message-1", Subject: "Shared", Folders: []string{"INBOX", "Label_shared"}},
		},
	}
	server := NewServerWithOptions(repo, ServerOptions{
		AuthValidator:                      testValidator(t, "kid", key),
		NylasConfig:                        testNylasConfig(),
		NylasClient:                        nylas,
		DisableCommunicationsArchiveWorker: true,
	})
	defer server.Close()
	handler := server.Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)

	body := `{"message_ids":["shared-message-1"]}`
	path := "/v1/communications/messages/archive-batch?background=true&company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		JobID string `json:"job_id"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListCommunicationsArchiveJobItems(payload.JobID)
	if err != nil {
		t.Fatalf("ListCommunicationsArchiveJobItems: %v", err)
	}
	if len(items) != 1 || items[0].CompanyID != companyID || items[0].SharedInboxID != folder.FolderID || items[0].ConnectionScope != "shared" {
		t.Fatalf("shared archive job item = %+v, want shared scope", items)
	}
	if processed, err := server.processAvailableCommunicationsArchiveJobItems(context.Background(), 10); err != nil || processed != 1 {
		t.Fatalf("process shared archive job = %d err=%v, want one", processed, err)
	}
	if len(nylas.updateCalls) != 1 || nylas.updateCalls[0].GrantID != "grant-shared" || nylas.updateCalls[0].MessageID != "shared-message-1" {
		t.Fatalf("shared archive update calls = %+v, want shared grant/message", nylas.updateCalls)
	}
}

func TestCommunicationsArchiveMutationTrackerClassifiesRecentArchiveEchoOnce(t *testing.T) {
	t.Parallel()

	tracker := newCommunicationsArchiveMutationTracker()
	now := time.Date(2026, 6, 29, 12, 0, 0, 0, time.UTC)
	tracker.remember("grant:grant-1", []string{" message-1 ", "message-2", "message-1"}, now)

	if !tracker.consume("grant:grant-1", "message-1", now.Add(time.Second)) {
		t.Fatal("first recent archive echo was not classified")
	}
	if tracker.consume("grant:grant-1", "message-1", now.Add(2*time.Second)) {
		t.Fatal("archive echo was classified more than once")
	}
	if tracker.consume("grant:other", "message-2", now.Add(time.Second)) {
		t.Fatal("archive echo matched a different cache scope")
	}
	if tracker.consume("grant:grant-1", "message-2", now.Add(communicationsArchiveMutationTTL+time.Second)) {
		t.Fatal("expired archive echo was classified")
	}
}

func TestCommunicationsUnarchiveMessageAddsGmailInboxLabel(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	nylas := &fakeNylasClient{
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"UNREAD", "CATEGORY_PERSONAL", "Label_123"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/unarchive", "", token, http.StatusOK)
	if got, want := strings.Join(nylas.update.Folders, ","), "Label_123,INBOX"; got != want {
		t.Fatalf("folders = %q, want %q", got, want)
	}
}

func TestCommunicationsUnarchiveMessageMovesFolderProvidersToInboxFolder(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "microsoft",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders: []NylasFolder{
			{ID: "inbox-id", Name: "Inbox"},
			{ID: "archive-id", Name: "Archive"},
		},
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"archive-id"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/unarchive", "", token, http.StatusOK)
	if len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "inbox-id" {
		t.Fatalf("folders = %+v, want inbox-id", nylas.update.Folders)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want unarchive without message body fetch", nylas.detailCalls)
	}
}

func TestNylasWebhookDeliveryFailureForgetsReceiptSoProviderRetryCanRecover(t *testing.T) {
	baseRepo := store.NewMemoryRepo()
	companyID := "70707070-7070-4070-8070-707070707099"
	user := mustRealtimeAuthUser(t, baseRepo, companyID, "communications-webhook-retry", domain.RoleCompanyUser)
	if _, err := baseRepo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "retry-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	repo := &failOnceWebhookMembershipRepo{Repository: baseRepo, failures: 1}
	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	server := NewServerWithOptions(repo, ServerOptions{NylasConfig: config, NylasClient: &fakeNylasClient{}})
	defer server.Close()
	handler := server.Routes()
	body := `{"type":"message.created","data":{"object":{"id":"retry-message","thread_id":"retry-thread","grant_id":"retry-grant"}}}`

	send := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
		req.Header.Set("X-Nylas-Signature", signWebhookBody(config.WebhookSecret, body))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	first := send()
	if first.Code != http.StatusInternalServerError || !strings.Contains(first.Body.String(), "failed_to_deliver_email_change") {
		t.Fatalf("first retryable delivery status=%d body=%s", first.Code, first.Body.String())
	}
	second := send()
	if second.Code != http.StatusOK {
		t.Fatalf("retried delivery status=%d body=%s", second.Code, second.Body.String())
	}
}

func TestSharedNylasWebhookAudienceFailureRetriesOpenedWithoutInflatingSignalCount(t *testing.T) {
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
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	repo := &failOnceWebhookAudienceRepo{Repository: baseRepo, failures: 1}
	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	server := NewServerWithOptions(repo, ServerOptions{NylasConfig: config, NylasClient: &fakeNylasClient{}})
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
	if first.Code != http.StatusInternalServerError || !strings.Contains(first.Body.String(), "failed_to_deliver_email_change") {
		t.Fatalf("first shared retryable delivery status=%d body=%s", first.Code, first.Body.String())
	}
	if messages := networkConn.messages(t); len(messages) != 0 {
		t.Fatalf("failed shared audience lookup delivered messages: %+v", messages)
	}
	second := send()
	if second.Code != http.StatusOK {
		t.Fatalf("retried shared delivery status=%d body=%s", second.Code, second.Body.String())
	}
	if repo.callCount() != 2 {
		t.Fatalf("shared audience calls = %d, want failed lookup plus retry", repo.callCount())
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
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			token: {Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
		}},
	})
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

	body := `{"type":"message.created","time":"2026-06-09T20:00:00Z","data":{"object":{"id":"message-1","thread_id":"thread-1","grant_id":"grant-1"}}}`
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("webhook status = %d body=%s", rec.Code, rec.Body.String())
	}
	created := client.readJSON(t)
	if created["type"] != realtimeMessageMailboxMessageChanged || created["company_id"] != companyID || created["scope"] != mailboxScope ||
		created["trigger"] != "message.created" || created["message_id"] != "message-1" || created["thread_id"] != "thread-1" ||
		created["occurred_at"] != "2026-06-09T20:00:00Z" {
		t.Fatalf("personal mailbox created event = %+v", created)
	}
	if _, ok := server.commCache.getFolders(user.UserID, cacheScope, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.created webhook preserved folder counts")
	}
	if _, ok := server.commCache.getMessagePage(user.UserID, cacheScope, query, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.created webhook preserved message page")
	}
	if _, ok := server.commCache.getMessage(user.UserID, cacheScope, "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message.created webhook preserved message detail")
	}
	if nylas.folderCalls != 0 || nylas.messageCalls != 0 || nylas.detailCalls != 0 {
		t.Fatalf("webhook provider calls folders=%d messages=%d details=%d, want event hint without provider polling", nylas.folderCalls, nylas.messageCalls, nylas.detailCalls)
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

func TestNylasWebhookAdvancesPersonalEmailCollaborationForPermanentParticipants(t *testing.T) {
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
	created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: creator.UserID, PersonalAccountEmail: creator.Email,
		AccountEmail: creator.Email, CreatedByUserID: creator.UserID,
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
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			participantToken: {Subject: participant.CognitoSubject, Email: participant.Email, Name: participant.DisplayName},
		}},
	})
	defer server.Close()
	handler := server.Routes()
	client := openRealtimeWebSocketForTest(t, handler, "/v1/realtime/ws?company_id="+companyID, participantToken)
	defer client.close()
	client.readJSON(t)
	participantScope := realtimePersonalMailboxScope(participant.UserID, participant.Email)
	client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": participantScope})
	if subscribed := client.readJSON(t); subscribed["type"] != realtimeMessageSubscriptionAccepted || subscribed["scope"] != participantScope {
		t.Fatalf("participant mailbox subscription = %+v", subscribed)
	}

	body := "{\"type\":\"message.created\",\"time\":\"2026-07-13T20:30:00Z\",\"data\":{\"object\":{\"id\":\"collaboration-future-message\",\"thread_id\":\"collaboration-thread\",\"grant_id\":\"collaboration-webhook-grant\"}}}"
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody(config.WebhookSecret, body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("webhook status = %d body=%s", rec.Code, rec.Body.String())
	}
	changed := client.readJSON(t)
	if changed["type"] != realtimeMessageMailboxMessageChanged || changed["scope"] != participantScope ||
		changed["trigger"] != "message.created" || changed["message_id"] != "collaboration-future-message" ||
		changed["thread_id"] != "collaboration-thread" {
		t.Fatalf("participant collaboration event = %+v", changed)
	}
	if nylas.detailCalls != 1 || nylas.lastDetailGrantID != "collaboration-webhook-grant" {
		t.Fatalf("provider hydration calls=%d grant=%q, want one matched-thread detail read", nylas.detailCalls, nylas.lastDetailGrantID)
	}
	collaboration, err := repo.GetCommunicationsEmailCollaboration(companyID, created.Collaboration.CollaborationID, participant.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if collaboration.LatestMessageID != "collaboration-future-message" ||
		collaboration.Message.Subject != "Future thread reply" ||
		collaboration.Message.Body != "<p>New reply body</p>" {
		t.Fatalf("advanced collaboration = %+v", collaboration)
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
			AccessLevel: store.EntityPermissionView,
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
		if _, err := repo.UpsertCommunicationsMessageReadStatus(input); err != nil {
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

func TestNylasWebhookAdvancesSharedEmailCollaborationThroughPersonalFallback(t *testing.T) {
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
			SubjectType: store.EntityPermissionSubjectUser, SubjectID: creator.UserID, AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	created, err := repo.EnsureCommunicationsEmailCollaboration(store.CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, SharedInboxID: folder.FolderID, AccountEmail: "support@example.com",
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
		NylasClient: nylas,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			participantToken: {Subject: participant.CognitoSubject, Email: participant.Email, Name: participant.DisplayName},
		}},
	})
	defer server.Close()
	handler := server.Routes()
	client := openRealtimeWebSocketForTest(t, handler, "/v1/realtime/ws?company_id="+companyID, participantToken)
	defer client.close()
	client.readJSON(t)
	participantScope := realtimePersonalMailboxScope(participant.UserID, participant.Email)
	client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": participantScope})
	if subscribed := client.readJSON(t); subscribed["type"] != realtimeMessageSubscriptionAccepted {
		t.Fatalf("participant personal mailbox subscription = %+v", subscribed)
	}

	body := "{\"type\":\"message.created\",\"time\":\"2026-07-13T20:40:00Z\",\"data\":{\"object\":{\"id\":\"shared-collaboration-future\",\"thread_id\":\"shared-collaboration-thread\",\"grant_id\":\"shared-collaboration-grant\"}}}"
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody(config.WebhookSecret, body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("shared collaboration webhook status=%d body=%s", rec.Code, rec.Body.String())
	}
	changed := client.readJSON(t)
	if changed["type"] != realtimeMessageMailboxMessageChanged || changed["scope"] != participantScope ||
		changed["trigger"] != "message.created" || changed["message_id"] != "shared-collaboration-future" {
		t.Fatalf("shared collaboration personal fallback event = %+v", changed)
	}
	if _, present := changed["shared_inbox_id"]; present {
		t.Fatalf("personal fallback leaked source shared inbox routing: %+v", changed)
	}
	collaboration, err := repo.GetCommunicationsEmailCollaboration(companyID, created.Collaboration.CollaborationID, participant.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if collaboration.LatestMessageID != "shared-collaboration-future" ||
		collaboration.Message.Subject != "Shared future reply" ||
		collaboration.Message.Body != "<p>Customer answer</p>" {
		t.Fatalf("advanced shared collaboration = %+v", collaboration)
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
				AccessLevel: store.EntityPermissionView,
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
	server := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
		AuthValidator: &tokenClaimsValidator{claims: map[string]auth.Claims{
			visibleToken: {Subject: visible.CognitoSubject, Email: visible.Email, Name: visible.DisplayName},
			revokedToken: {Subject: revoked.CognitoSubject, Email: revoked.Email, Name: revoked.DisplayName},
		}},
	})
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

	body := `{"type":"message.created","time":"2026-06-10T15:00:00Z","data":{"object":{"id":"shared-message-live","thread_id":"shared-thread-live","grant_id":"shared-live-grant"}}}`
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("shared created webhook status = %d body=%s", rec.Code, rec.Body.String())
	}
	created := visibleClient.readJSON(t)
	if created["type"] != realtimeMessageMailboxMessageChanged || created["company_id"] != companyID || created["scope"] != scope ||
		created["shared_inbox_id"] != folder.FolderID || created["trigger"] != "message.created" ||
		created["message_id"] != "shared-message-live" || created["thread_id"] != "shared-thread-live" {
		t.Fatalf("shared mailbox created event = %+v", created)
	}
	revokedClient.assertNoMessage(t)
	if _, ok := server.commCache.getFolders(visible.UserID, cacheScope, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("shared message.created preserved current viewer folder counts")
	}
	if _, ok := server.commCache.getMessagePage(visible.UserID, cacheScope, query, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("shared message.created preserved current viewer message page")
	}
	if _, ok := server.commCache.getMessage(visible.UserID, cacheScope, "shared-message-live", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("shared message.created preserved current viewer message detail")
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
	if nylas.folderCalls != 0 || nylas.messageCalls != 0 || nylas.detailCalls != 0 {
		t.Fatalf("shared webhook provider calls folders=%d messages=%d details=%d, want event hint without provider polling", nylas.folderCalls, nylas.messageCalls, nylas.detailCalls)
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
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{listErr: NylasAPIError{StatusCode: http.StatusUnauthorized, Code: "unauthorized"}},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 body=%s", rec.Code, rec.Body.String())
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.Status != "reauth_required" {
		t.Fatalf("connection status = %q, want reauth_required", connection.Status)
	}
}

func TestCommunicationsStoredReauthRequiredReturnsConflict(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "reauth_required",
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 body=%s", rec.Code, rec.Body.String())
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
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{listErr: NylasAPIError{StatusCode: http.StatusUnauthorized, Code: "unauthorized"}},
	}).Routes()

	path := "/v1/communications/messages?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
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
			AccessLevel: store.EntityPermissionView,
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
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
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
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient: &fakeNylasClient{listErr: NylasAPIError{
			StatusCode: http.StatusTooManyRequests,
			Code:       "rate_limited",
			RetryAfter: "3",
		}},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Retry-After"); got != "3" {
		t.Fatalf("Retry-After = %q, want 3", got)
	}
	if !strings.Contains(rec.Body.String(), "nylas_rate_limited") {
		t.Fatalf("body = %s, want nylas_rate_limited", rec.Body.String())
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
