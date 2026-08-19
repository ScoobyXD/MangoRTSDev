package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type fakeAttachmentDirectUploadStorage struct {
	mu sync.Mutex

	bucket string

	legacyPutCalls int

	presignPutInputs       []AttachmentPresignPutInput
	createMultipartInputs  []AttachmentCreateMultipartInput
	presignPartInputs      []AttachmentPresignPartInput
	listMultipartInputs    []AttachmentMultipartInput
	completeMultipartCalls []AttachmentCompleteMultipartInput
	completeMultipartErrs  []error
	abortMultipartInputs   []AttachmentMultipartInput
	headInputs             []AttachmentHeadObjectInput
	deleteKeys             []string

	listParts    []AttachmentS3Part
	listPartsErr error
	heads        map[string]AttachmentHeadObjectOutput
	headErr      error
	operations   []string
}

type fakeAttachmentImageVariantEnsurer struct {
	calls int
	err   error
}

func (f *fakeAttachmentImageVariantEnsurer) EnsureImageVariants(_ context.Context, _ domain.Attachment) ([]domain.AttachmentVariant, error) {
	f.calls++
	return nil, f.err
}

func newFakeAttachmentDirectUploadStorage() *fakeAttachmentDirectUploadStorage {
	return &fakeAttachmentDirectUploadStorage{
		bucket: "direct-upload-test-bucket",
		heads:  make(map[string]AttachmentHeadObjectOutput),
	}
}

func (f *fakeAttachmentDirectUploadStorage) Bucket() string {
	return f.bucket
}

func (f *fakeAttachmentDirectUploadStorage) PutObject(_ context.Context, _ AttachmentPutObjectInput) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.legacyPutCalls++
	return nil
}

func (f *fakeAttachmentDirectUploadStorage) GetObject(_ context.Context, _ AttachmentGetObjectInput) (AttachmentGetObjectOutput, error) {
	return AttachmentGetObjectOutput{}, ErrAttachmentObjectNotFound
}

func (f *fakeAttachmentDirectUploadStorage) PresignPutObject(_ context.Context, input AttachmentPresignPutInput) (AttachmentPresignedRequest, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.presignPutInputs = append(f.presignPutInputs, input)
	return AttachmentPresignedRequest{
		Method: http.MethodPut,
		URL:    fmt.Sprintf("https://upload.invalid/single/%d", len(f.presignPutInputs)),
		RequiredHeaders: map[string]string{
			"Content-Type":          input.ContentType,
			"x-amz-checksum-sha256": input.ChecksumSHA256,
		},
		ExpiresAt: time.Now().UTC().Add(input.Expires),
	}, nil
}

func (f *fakeAttachmentDirectUploadStorage) CreateMultipartUpload(_ context.Context, input AttachmentCreateMultipartInput) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.createMultipartInputs = append(f.createMultipartInputs, input)
	return fmt.Sprintf("provider-upload-%d", len(f.createMultipartInputs)), nil
}

func (f *fakeAttachmentDirectUploadStorage) PresignUploadPart(_ context.Context, input AttachmentPresignPartInput) (AttachmentPresignedRequest, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.presignPartInputs = append(f.presignPartInputs, input)
	return AttachmentPresignedRequest{
		Method: http.MethodPut,
		URL:    fmt.Sprintf("https://upload.invalid/multipart/%s/%d", input.UploadID, input.PartNumber),
		RequiredHeaders: map[string]string{
			"x-amz-checksum-sha256": input.ChecksumSHA256,
		},
		ExpiresAt: time.Now().UTC().Add(input.Expires),
	}, nil
}

func (f *fakeAttachmentDirectUploadStorage) ListMultipartParts(_ context.Context, input AttachmentMultipartInput) ([]AttachmentS3Part, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.operations = append(f.operations, "list")
	f.listMultipartInputs = append(f.listMultipartInputs, input)
	return append([]AttachmentS3Part(nil), f.listParts...), f.listPartsErr
}

func (f *fakeAttachmentDirectUploadStorage) CompleteMultipartUpload(_ context.Context, input AttachmentCompleteMultipartInput) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.operations = append(f.operations, "complete")
	input.Parts = append([]AttachmentS3Part(nil), input.Parts...)
	f.completeMultipartCalls = append(f.completeMultipartCalls, input)
	callIndex := len(f.completeMultipartCalls) - 1
	if callIndex < len(f.completeMultipartErrs) {
		return f.completeMultipartErrs[callIndex]
	}
	return nil
}

func (f *fakeAttachmentDirectUploadStorage) AbortMultipartUpload(_ context.Context, input AttachmentMultipartInput) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.abortMultipartInputs = append(f.abortMultipartInputs, input)
	return nil
}

func (f *fakeAttachmentDirectUploadStorage) HeadObject(_ context.Context, input AttachmentHeadObjectInput) (AttachmentHeadObjectOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.operations = append(f.operations, "head")
	f.headInputs = append(f.headInputs, input)
	if f.headErr != nil {
		return AttachmentHeadObjectOutput{}, f.headErr
	}
	head, ok := f.heads[input.Key]
	if !ok {
		return AttachmentHeadObjectOutput{}, ErrAttachmentObjectNotFound
	}
	return head, nil
}

func (f *fakeAttachmentDirectUploadStorage) DeleteObject(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deleteKeys = append(f.deleteKeys, key)
	return nil
}

func (f *fakeAttachmentDirectUploadStorage) setListParts(parts []AttachmentS3Part) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.listParts = append([]AttachmentS3Part(nil), parts...)
	f.listPartsErr = nil
}

func (f *fakeAttachmentDirectUploadStorage) setHead(key string, head AttachmentHeadObjectOutput) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.heads[key] = head
}

type attachmentDirectUploadTestFixture struct {
	repo      *store.MemoryRepo
	server    *Server
	storage   *fakeAttachmentDirectUploadStorage
	companyID string
	allowed   domain.User
	denied    domain.User
	node      domain.Node
}

func newAttachmentDirectUploadTestFixture(t *testing.T) attachmentDirectUploadTestFixture {
	t.Helper()
	repo, server, _, companyID, allowed, denied, node := newAttachmentRouteTestFixture(t)
	storage := newFakeAttachmentDirectUploadStorage()
	server.attachmentStorage = storage
	server.attachmentDirectUpload = attachmentDirectUploadConfig{
		Enabled:           true,
		MaxFileBytes:      defaultAttachmentMaxBrowserUploadBytes,
		IntentLifetime:    24 * time.Hour,
		SingleURLLifetime: time.Hour,
		PartURLLifetime:   15 * time.Minute,
		CleanupInterval:   15 * time.Minute,
	}
	t.Cleanup(server.Close)
	return attachmentDirectUploadTestFixture{
		repo: repo, server: server, storage: storage, companyID: companyID,
		allowed: allowed, denied: denied, node: node,
	}
}

func performAttachmentDirectUploadRequest(t *testing.T, fixture attachmentDirectUploadTestFixture, method, path string, payload any, actor *domain.User) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("encode request payload: %v", err)
		}
		body = strings.NewReader(string(encoded))
	}
	req := httptest.NewRequest(method, path, body)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if actor != nil {
		req = attachmentRequestWithActor(req, *actor, fixture.companyID, domain.RoleCompanyUser)
	}
	recorder := httptest.NewRecorder()
	fixture.server.Routes().ServeHTTP(recorder, req)
	return recorder
}

func performAttachmentDirectUploadRequestWithActorContext(t *testing.T, fixture attachmentDirectUploadTestFixture, method, path string, payload any, actor ActorContext, companyHint string) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode request payload: %v", err)
	}
	req := httptest.NewRequest(method, path, strings.NewReader(string(encoded)))
	req.Header.Set("Content-Type", "application/json")
	if companyHint != "" {
		req.Header.Set("X-Mango-Company-ID", companyHint)
	}
	req = req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
	recorder := httptest.NewRecorder()
	fixture.server.Routes().ServeHTTP(recorder, req)
	return recorder
}

func attachmentDirectUploadIntentPayload(nodeID, clientRequestID string, sizeBytes int64, sha256Hex string) map[string]any {
	return map[string]any{
		"clientRequestId":  clientRequestID,
		"filename":         "report.txt",
		"sizeBytes":        sizeBytes,
		"sha256":           sha256Hex,
		"contentType":      "text/plain",
		"resourceType":     "node",
		"resourceId":       nodeID,
		"relationshipKind": "file_attachment",
		"sourceKind":       "user_upload",
	}
}

func createAttachmentDirectUploadIntent(t *testing.T, fixture attachmentDirectUploadTestFixture, payload map[string]any) attachmentUploadIntentResponse {
	t.Helper()
	recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents", payload, &fixture.allowed)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create upload intent status = %d, want %d; body=%s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
	var response attachmentUploadIntentResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode upload intent response: %v", err)
	}
	if response.UploadIntentID == "" || response.AttachmentID == "" {
		t.Fatalf("upload intent response did not include server-generated IDs: %+v", response)
	}
	return response
}

func directUploadTestSHA256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func directUploadTestChecksumBase64(value string) string {
	sum := sha256.Sum256([]byte(value))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func TestAttachmentDirectUploadPolicyAndIntentBoundaries(t *testing.T) {
	t.Run("policy advertises the authoritative limits", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodGet, "/v1/attachments/upload-policy", nil, nil)
		if recorder.Code != http.StatusOK {
			t.Fatalf("policy status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
		}
		var response struct {
			DirectUploadEnabled   bool  `json:"directUploadEnabled"`
			MaxFileBytes          int64 `json:"maxFileBytes"`
			SinglePutMaxBytes     int64 `json:"singlePutMaxBytes"`
			MultipartPartBytes    int64 `json:"multipartPartBytes"`
			MaxConcurrentParts    int   `json:"maxConcurrentParts"`
			IntentLifetimeSeconds int64 `json:"intentLifetimeSeconds"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("decode policy response: %v", err)
		}
		if !response.DirectUploadEnabled {
			t.Fatal("direct upload policy unexpectedly disabled")
		}
		if response.MaxFileBytes != 1024*1024*1024 {
			t.Fatalf("maxFileBytes = %d, want 1 GiB", response.MaxFileBytes)
		}
		if response.SinglePutMaxBytes != 64*1024*1024 {
			t.Fatalf("singlePutMaxBytes = %d, want 64 MiB", response.SinglePutMaxBytes)
		}
		if response.MultipartPartBytes != attachmentMultipartPartBytes || response.MaxConcurrentParts != attachmentMaxConcurrentParts {
			t.Fatalf("unexpected multipart policy: %+v", response)
		}
		if response.IntentLifetimeSeconds != int64((24*time.Hour)/time.Second) {
			t.Fatalf("intentLifetimeSeconds = %d, want %d", response.IntentLifetimeSeconds, int64((24*time.Hour)/time.Second))
		}
	})

	t.Run("zero bytes and exactly 64 MiB use a single PUT", func(t *testing.T) {
		for _, testCase := range []struct {
			name string
			size int64
		}{
			{name: "zero", size: 0},
			{name: "boundary", size: attachmentSinglePutMaxBytes},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				fixture := newAttachmentDirectUploadTestFixture(t)
				shaHex := directUploadTestSHA256Hex(testCase.name)
				payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "single-"+testCase.name, testCase.size, shaHex)
				response := createAttachmentDirectUploadIntent(t, fixture, payload)
				if response.Upload.Strategy != domain.AttachmentUploadStrategySingle {
					t.Fatalf("strategy = %q, want single", response.Upload.Strategy)
				}
				if response.Upload.Method != http.MethodPut || response.Upload.URL == "" {
					t.Fatalf("single upload descriptor = %+v", response.Upload)
				}
				if len(fixture.storage.presignPutInputs) != 1 || len(fixture.storage.createMultipartInputs) != 0 {
					t.Fatalf("single create storage calls: presign=%d multipart=%d", len(fixture.storage.presignPutInputs), len(fixture.storage.createMultipartInputs))
				}
				expectedHeaders := map[string]string{
					"Content-Type":          "text/plain",
					"x-amz-checksum-sha256": rawSHA256Base64(shaHex),
				}
				if !reflect.DeepEqual(response.Upload.RequiredHeaders, expectedHeaders) {
					t.Fatalf("requiredHeaders = %#v, want %#v", response.Upload.RequiredHeaders, expectedHeaders)
				}
				input := fixture.storage.presignPutInputs[0]
				if input.ContentType != "text/plain" || input.ChecksumSHA256 != expectedHeaders["x-amz-checksum-sha256"] {
					t.Fatalf("presign input = %+v", input)
				}
			})
		}
	})

	t.Run("one byte above 64 MiB uses multipart", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "multipart-boundary", attachmentSinglePutMaxBytes+1, directUploadTestSHA256Hex("multipart-boundary"))
		response := createAttachmentDirectUploadIntent(t, fixture, payload)
		if response.Upload.Strategy != domain.AttachmentUploadStrategyMultipart {
			t.Fatalf("strategy = %q, want multipart", response.Upload.Strategy)
		}
		if response.Upload.PartSizeBytes != attachmentMultipartPartBytes || response.Upload.PartCount != 5 {
			t.Fatalf("multipart descriptor = %+v, want 16 MiB x 5", response.Upload)
		}
		if len(fixture.storage.createMultipartInputs) != 1 || len(fixture.storage.presignPutInputs) != 0 {
			t.Fatalf("multipart create storage calls: multipart=%d presign=%d", len(fixture.storage.createMultipartInputs), len(fixture.storage.presignPutInputs))
		}
	})

	t.Run("exactly 1 GiB is accepted", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "max-accepted", defaultAttachmentMaxBrowserUploadBytes, directUploadTestSHA256Hex("max-accepted"))
		response := createAttachmentDirectUploadIntent(t, fixture, payload)
		if response.Upload.Strategy != domain.AttachmentUploadStrategyMultipart || response.Upload.PartCount != 64 {
			t.Fatalf("max-size upload descriptor = %+v", response.Upload)
		}
	})

	t.Run("one byte above 1 GiB is rejected before S3", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "too-large", defaultAttachmentMaxBrowserUploadBytes+1, directUploadTestSHA256Hex("too-large"))
		recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents", payload, &fixture.allowed)
		if recorder.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("oversize create status = %d, want %d; body=%s", recorder.Code, http.StatusRequestEntityTooLarge, recorder.Body.String())
		}
		if len(fixture.storage.presignPutInputs) != 0 || len(fixture.storage.createMultipartInputs) != 0 || fixture.storage.legacyPutCalls != 0 {
			t.Fatalf("oversize request reached storage: presign=%d multipart=%d legacyPut=%d", len(fixture.storage.presignPutInputs), len(fixture.storage.createMultipartInputs), fixture.storage.legacyPutCalls)
		}
	})

	t.Run("JSON rejects server-owned ID company bucket and key fields", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "injection-attempt", 7, directUploadTestSHA256Hex("injection-attempt"))
		payload["uploadIntentId"] = "attacker-intent"
		payload["attachmentId"] = "attacker-attachment"
		payload["companyId"] = "attacker-company"
		payload["storageBucket"] = "attacker-bucket"
		payload["storageKey"] = "attacker-key"
		payload["multipartUploadId"] = "attacker-provider-upload"
		recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents", payload, &fixture.allowed)
		if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "invalid_json") {
			t.Fatalf("injected server-owned fields status = %d, want %d invalid_json; body=%s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
		}
		if len(fixture.storage.presignPutInputs) != 0 || len(fixture.storage.createMultipartInputs) != 0 || fixture.storage.legacyPutCalls != 0 {
			t.Fatalf("rejected injection reached storage: presign=%d multipart=%d legacyPut=%d", len(fixture.storage.presignPutInputs), len(fixture.storage.createMultipartInputs), fixture.storage.legacyPutCalls)
		}
	})

	t.Run("idempotency treats changed image dimensions as a payload conflict", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "dimension-conflict", 7, directUploadTestSHA256Hex("dimension-conflict"))
		payload["originalWidth"] = 100
		payload["originalHeight"] = 80
		first := createAttachmentDirectUploadIntent(t, fixture, payload)
		payload["originalWidth"] = 101
		recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents", payload, &fixture.allowed)
		if recorder.Code != http.StatusConflict {
			t.Fatalf("dimension-conflict retry status = %d, want %d; first=%+v body=%s", recorder.Code, http.StatusConflict, first, recorder.Body.String())
		}
	})
}

func TestAttachmentDirectUploadSingleCompletionIsVerifiedAndIdempotent(t *testing.T) {
	fixture := newAttachmentDirectUploadTestFixture(t)
	variantEnsurer := &fakeAttachmentImageVariantEnsurer{err: errors.New("bounded derivative failure")}
	fixture.server.attachmentVariantEnsurer = variantEnsurer
	shaHex := directUploadTestSHA256Hex("single-completion")
	payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "single-completion", 19, shaHex)
	created := createAttachmentDirectUploadIntent(t, fixture, payload)
	intent, err := fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, created.UploadIntentID)
	if err != nil {
		t.Fatalf("load created upload intent: %v", err)
	}
	providerChecksum := rawSHA256Base64(shaHex)
	fixture.storage.setHead(intent.StorageKey, AttachmentHeadObjectOutput{
		ContentLength:        intent.SizeBytes,
		ChecksumAlgorithm:    "SHA256",
		ChecksumValue:        providerChecksum,
		ChecksumType:         "FULL_OBJECT",
		ServerSideEncryption: attachmentSSEValue(),
	})

	first := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents/"+created.UploadIntentID+"/complete", nil, &fixture.allowed)
	if first.Code != http.StatusCreated {
		t.Fatalf("first completion status = %d, want %d; body=%s", first.Code, http.StatusCreated, first.Body.String())
	}
	if len(fixture.storage.headInputs) != 1 {
		t.Fatalf("HeadObject calls = %d, want 1", len(fixture.storage.headInputs))
	}
	if fixture.storage.legacyPutCalls != 0 {
		t.Fatalf("browser bytes traversed legacy API storage path: PutObject calls=%d", fixture.storage.legacyPutCalls)
	}

	var completed struct {
		Attachment         map[string]any `json:"attachment"`
		ResourceAttachment map[string]any `json:"resource_attachment"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &completed); err != nil {
		t.Fatalf("decode completion response: %v", err)
	}
	if got := completed.Attachment["sha256"]; got != shaHex {
		t.Fatalf("attachment sha256 = %#v, want browser full-file hex %q", got, shaHex)
	}
	if got := completed.Attachment["storage_checksum_value"]; got != providerChecksum {
		t.Fatalf("storage checksum = %#v, want provider HEAD checksum %q", got, providerChecksum)
	}
	if got := completed.Attachment["storage_checksum_algorithm"]; got != "SHA256" {
		t.Fatalf("storage checksum algorithm = %#v, want SHA256", got)
	}
	if got := completed.Attachment["storage_checksum_type"]; got != "FULL_OBJECT" {
		t.Fatalf("storage checksum type = %#v, want FULL_OBJECT", got)
	}
	if completed.ResourceAttachment["resource_id"] != fixture.node.NodeID {
		t.Fatalf("resource link = %#v, want node %q", completed.ResourceAttachment, fixture.node.NodeID)
	}

	second := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents/"+created.UploadIntentID+"/complete", nil, &fixture.allowed)
	if second.Code != http.StatusCreated {
		t.Fatalf("replayed completion status = %d, want %d; body=%s", second.Code, http.StatusCreated, second.Body.String())
	}
	if len(fixture.storage.headInputs) != 1 {
		t.Fatalf("idempotent replay repeated HeadObject: calls=%d", len(fixture.storage.headInputs))
	}
	var replayed struct {
		Attachment map[string]any `json:"attachment"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &replayed); err != nil {
		t.Fatalf("decode replayed completion response: %v", err)
	}
	if replayed.Attachment["attachment_id"] != completed.Attachment["attachment_id"] {
		t.Fatalf("replayed completion created another attachment: first=%#v second=%#v", completed.Attachment, replayed.Attachment)
	}
	if variantEnsurer.calls != 2 {
		t.Fatalf("best-effort variant attempts = %d, want first completion plus completed replay", variantEnsurer.calls)
	}
}

func TestAttachmentDirectUploadSharedDraftStaleCompletionBecomesFailed(t *testing.T) {
	fixture := newAttachmentDirectUploadTestFixture(t)
	if _, err := fixture.repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: fixture.allowed.UserID, Provider: "google", AccountEmail: fixture.allowed.Email,
		GrantID: "grant-shared-draft-upload", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	imported, err := fixture.repo.ImportCommunicationsEmailIntoNode(store.CommunicationsNodeEmailImportInput{
		CompanyID: fixture.companyID, NodeID: fixture.node.NodeID, CreatedByUserID: fixture.allowed.UserID,
		Thread: store.CommunicationsEmailThreadUpsertInput{
			CompanyID: fixture.companyID, PersonalUserID: fixture.allowed.UserID, PersonalAccountEmail: fixture.allowed.Email,
			AccountEmail: fixture.allowed.Email, Provider: "google", ProviderThreadID: "upload-source-thread",
			SelectedMessageID: "upload-source-message",
			Messages:          []domain.EmailMessageSnapshot{{ID: "upload-source-message", ThreadID: "upload-source-thread", Subject: "Source"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	draft, created, err := fixture.repo.EnsureCommunicationsEmailReplyDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, SharedNodeID: fixture.node.NodeID, CreatedByUserID: fixture.allowed.UserID,
		SourceMessageID: imported.EmailThread.Messages[0].EmailMessageID,
	})
	if err != nil || !created || draft.Revision != 1 {
		t.Fatalf("ensure shared upload draft=%+v created=%v err=%v", draft, created, err)
	}
	shaHex := directUploadTestSHA256Hex("shared-stale-upload")
	payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "shared-stale-upload", 19, shaHex)
	payload["resourceType"], payload["resourceId"] = "email_draft", draft.DraftID
	payload["relationshipKind"], payload["sourceKind"], payload["expectedRevision"] = "email_attachment", "email_outgoing", 1
	upload := createAttachmentDirectUploadIntent(t, fixture, payload)
	intent, err := fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, upload.UploadIntentID)
	if err != nil {
		t.Fatal(err)
	}
	fixture.storage.setHead(intent.StorageKey, AttachmentHeadObjectOutput{
		ContentLength: 19, ChecksumAlgorithm: "SHA256", ChecksumValue: rawSHA256Base64(shaHex),
		ChecksumType: "FULL_OBJECT", ServerSideEncryption: attachmentSSEValue(),
	})
	if _, err := fixture.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, DraftID: draft.DraftID, SharedNodeID: fixture.node.NodeID,
		UpdatedByUserID: fixture.allowed.UserID, Kind: "reply", ExpectedRevision: 1, BodyEditorHTML: "<p>other edit</p>",
	}); err != nil {
		t.Fatal(err)
	}
	completed := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents/"+upload.UploadIntentID+"/complete", nil, &fixture.allowed)
	if completed.Code != http.StatusConflict || !strings.Contains(completed.Body.String(), "email_draft_revision_conflict") {
		t.Fatalf("stale completion status=%d body=%s", completed.Code, completed.Body.String())
	}
	intent, err = fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, upload.UploadIntentID)
	if err != nil || intent.Status != domain.AttachmentUploadStatusFailed || intent.FailureCode != "revision_conflict" {
		t.Fatalf("stale completion intent=%+v err=%v", intent, err)
	}
	if _, err := fixture.repo.GetAttachment(fixture.companyID, upload.AttachmentID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stale completion attachment error=%v, want not found", err)
	}
}

func TestAttachmentDirectUploadMultipartSigningAndAuthoritativeCompletion(t *testing.T) {
	fixture := newAttachmentDirectUploadTestFixture(t)
	sizeBytes := attachmentSinglePutMaxBytes + 1
	shaHex := directUploadTestSHA256Hex("multipart-full-file")
	payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "multipart-authoritative", sizeBytes, shaHex)
	created := createAttachmentDirectUploadIntent(t, fixture, payload)
	if created.Upload.Strategy != domain.AttachmentUploadStrategyMultipart || created.Upload.PartCount != 5 {
		t.Fatalf("created multipart descriptor = %+v", created.Upload)
	}

	invalidPart := map[string]any{"parts": []map[string]any{{
		"partNumber": 0, "checksumAlgorithm": "SHA256", "checksum": directUploadTestChecksumBase64("invalid-part"),
	}}}
	invalid := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents/"+created.UploadIntentID+"/parts", invalidPart, &fixture.allowed)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("out-of-range part status = %d, want %d; body=%s", invalid.Code, http.StatusBadRequest, invalid.Body.String())
	}
	if len(fixture.storage.presignPartInputs) != 0 {
		t.Fatalf("invalid part reached presigner: calls=%d", len(fixture.storage.presignPartInputs))
	}

	checksums := make([]string, created.Upload.PartCount)
	partsRequest := make([]map[string]any, 0, created.Upload.PartCount)
	for partNumber := 1; partNumber <= created.Upload.PartCount; partNumber++ {
		checksum := directUploadTestChecksumBase64(fmt.Sprintf("multipart-part-%d", partNumber))
		checksums[partNumber-1] = checksum
		partsRequest = append(partsRequest, map[string]any{
			"partNumber": partNumber, "checksumAlgorithm": "sha256", "checksum": checksum,
		})
	}
	signed := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents/"+created.UploadIntentID+"/parts", map[string]any{"parts": partsRequest}, &fixture.allowed)
	if signed.Code != http.StatusOK {
		t.Fatalf("part signing status = %d, want %d; body=%s", signed.Code, http.StatusOK, signed.Body.String())
	}
	var signedResponse struct {
		Parts []struct {
			PartNumber      int               `json:"partNumber"`
			Method          string            `json:"method"`
			RequiredHeaders map[string]string `json:"requiredHeaders"`
		} `json:"parts"`
	}
	if err := json.Unmarshal(signed.Body.Bytes(), &signedResponse); err != nil {
		t.Fatalf("decode signed parts response: %v", err)
	}
	if len(signedResponse.Parts) != created.Upload.PartCount || len(fixture.storage.presignPartInputs) != created.Upload.PartCount {
		t.Fatalf("signed parts response=%d storage calls=%d want=%d", len(signedResponse.Parts), len(fixture.storage.presignPartInputs), created.Upload.PartCount)
	}
	for index, part := range signedResponse.Parts {
		expectedHeaders := map[string]string{"x-amz-checksum-sha256": checksums[index]}
		if part.PartNumber != index+1 || part.Method != http.MethodPut || !reflect.DeepEqual(part.RequiredHeaders, expectedHeaders) {
			t.Fatalf("signed part %d = %+v, want exact checksum header %#v", index+1, part, expectedHeaders)
		}
		captured := fixture.storage.presignPartInputs[index]
		if captured.PartNumber != index+1 || captured.ChecksumSHA256 != checksums[index] {
			t.Fatalf("presign input %d = %+v", index+1, captured)
		}
	}
	durableParts, err := fixture.repo.ListAttachmentUploadParts(fixture.companyID, fixture.allowed.UserID, created.UploadIntentID)
	if err != nil {
		t.Fatalf("load durable upload parts: %v", err)
	}
	if len(durableParts) != created.Upload.PartCount {
		t.Fatalf("durable part count = %d, want %d", len(durableParts), created.Upload.PartCount)
	}
	for index, part := range durableParts {
		if part.PartNumber != index+1 || part.ExpectedChecksum != checksums[index] || part.ChecksumAlgorithm != "SHA256" {
			t.Fatalf("durable part %d = %+v", index+1, part)
		}
	}

	providerParts := make([]AttachmentS3Part, 0, created.Upload.PartCount)
	for partNumber := 1; partNumber <= created.Upload.PartCount; partNumber++ {
		partSize := attachmentMultipartPartBytes
		if partNumber == created.Upload.PartCount {
			partSize = sizeBytes - int64(partNumber-1)*attachmentMultipartPartBytes
		}
		providerParts = append(providerParts, AttachmentS3Part{
			PartNumber: partNumber, SizeBytes: partSize,
			ETag: fmt.Sprintf("etag-%d", partNumber), ChecksumSHA256: checksums[partNumber-1],
		})
	}
	completePath := "/v1/attachments/upload-intents/" + created.UploadIntentID + "/complete"

	fixture.storage.setListParts(providerParts[:len(providerParts)-1])
	missing := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, completePath, nil, &fixture.allowed)
	if missing.Code < 400 {
		t.Fatalf("missing provider part unexpectedly completed: status=%d body=%s", missing.Code, missing.Body.String())
	}
	if len(fixture.storage.completeMultipartCalls) != 0 {
		t.Fatal("provider completion was called with a non-consecutive part list")
	}

	wrongSize := append([]AttachmentS3Part(nil), providerParts...)
	wrongSize[0].SizeBytes--
	fixture.storage.setListParts(wrongSize)
	badSize := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, completePath, nil, &fixture.allowed)
	if badSize.Code < 400 {
		t.Fatalf("wrong provider part size unexpectedly completed: status=%d body=%s", badSize.Code, badSize.Body.String())
	}
	if len(fixture.storage.completeMultipartCalls) != 0 {
		t.Fatal("provider completion was called with a wrong-sized part")
	}

	wrongChecksum := append([]AttachmentS3Part(nil), providerParts...)
	wrongChecksum[1].ChecksumSHA256 = directUploadTestChecksumBase64("provider-corruption")
	fixture.storage.setListParts(wrongChecksum)
	badChecksum := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, completePath, nil, &fixture.allowed)
	if badChecksum.Code < 400 {
		t.Fatalf("wrong provider checksum unexpectedly completed: status=%d body=%s", badChecksum.Code, badChecksum.Body.String())
	}
	if len(fixture.storage.completeMultipartCalls) != 0 {
		t.Fatal("provider completion was called with a mismatched checksum")
	}

	intent, err := fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, created.UploadIntentID)
	if err != nil {
		t.Fatalf("load multipart intent: %v", err)
	}
	fixture.storage.setListParts(providerParts)
	fixture.storage.setHead(intent.StorageKey, AttachmentHeadObjectOutput{
		ContentLength:        sizeBytes,
		ChecksumAlgorithm:    "SHA256",
		ChecksumValue:        multipartChecksumFromS3Parts(providerParts),
		ChecksumType:         "COMPOSITE",
		ServerSideEncryption: attachmentSSEValue(),
	})
	completed := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, completePath, nil, &fixture.allowed)
	if completed.Code != http.StatusCreated {
		t.Fatalf("multipart completion status = %d, want %d; body=%s", completed.Code, http.StatusCreated, completed.Body.String())
	}
	if len(fixture.storage.completeMultipartCalls) != 1 {
		t.Fatalf("CompleteMultipartUpload calls = %d, want 1", len(fixture.storage.completeMultipartCalls))
	}
	if !reflect.DeepEqual(fixture.storage.completeMultipartCalls[0].Parts, providerParts) {
		t.Fatalf("provider completion parts = %#v, want authoritative ListParts %#v", fixture.storage.completeMultipartCalls[0].Parts, providerParts)
	}
	if len(fixture.storage.headInputs) != 1 {
		t.Fatalf("HeadObject calls = %d, want 1", len(fixture.storage.headInputs))
	}
	var completedResponse struct {
		Attachment map[string]any `json:"attachment"`
	}
	if err := json.Unmarshal(completed.Body.Bytes(), &completedResponse); err != nil {
		t.Fatalf("decode multipart completion: %v", err)
	}
	if completedResponse.Attachment["sha256"] != shaHex {
		t.Fatalf("full-file sha256 = %#v, want %q", completedResponse.Attachment["sha256"], shaHex)
	}
	if completedResponse.Attachment["storage_checksum_value"] != multipartChecksumFromS3Parts(providerParts) || completedResponse.Attachment["storage_checksum_type"] != "COMPOSITE" {
		t.Fatalf("provider checksum provenance not preserved separately: %#v", completedResponse.Attachment)
	}
}

func TestAttachmentDirectUploadAuthorizationExpiryOriginAndAbort(t *testing.T) {
	t.Run("a different actor cannot discover or clean up the upload", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "wrong-actor", 9, directUploadTestSHA256Hex("wrong-actor"))
		created := createAttachmentDirectUploadIntent(t, fixture, payload)
		recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents/"+created.UploadIntentID+"/complete", nil, &fixture.denied)
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("wrong actor completion status = %d, want %d; body=%s", recorder.Code, http.StatusNotFound, recorder.Body.String())
		}
		if len(fixture.storage.deleteKeys) != 0 || len(fixture.storage.headInputs) != 0 {
			t.Fatalf("wrong actor touched provider state: deletes=%d heads=%d", len(fixture.storage.deleteKeys), len(fixture.storage.headInputs))
		}
	})

	t.Run("revoked node edit permission cleans up pending object", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "permission-revoked", 9, directUploadTestSHA256Hex("permission-revoked"))
		created := createAttachmentDirectUploadIntent(t, fixture, payload)
		_, err := fixture.repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID: fixture.companyID, EntityType: store.EntityTypeNode, EntityID: fixture.node.NodeID,
			DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
			Permissions: nil,
		})
		if err != nil {
			t.Fatalf("revoke node permission: %v", err)
		}
		recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents/"+created.UploadIntentID+"/complete", nil, &fixture.allowed)
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("revoked permission completion status = %d, want %d; body=%s", recorder.Code, http.StatusNotFound, recorder.Body.String())
		}
		if len(fixture.storage.deleteKeys) != 1 || len(fixture.storage.headInputs) != 0 {
			t.Fatalf("revoked permission cleanup: deletes=%d heads=%d", len(fixture.storage.deleteKeys), len(fixture.storage.headInputs))
		}
		intent, err := fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, created.UploadIntentID)
		if err != nil {
			t.Fatalf("load cleaned upload intent: %v", err)
		}
		if intent.Status != domain.AttachmentUploadStatusAborted {
			t.Fatalf("cleaned intent status = %q, want aborted", intent.Status)
		}
	})

	t.Run("a missing text-box origin does not block node-authorized completion", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		shaHex := directUploadTestSHA256Hex("deleted-text-box-origin")
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "deleted-text-box-origin", 13, shaHex)
		payload["contentType"] = "image/png"
		payload["relationshipKind"] = "inline_image"
		payload["sourceKind"] = "editor_paste"
		payload["informationId"] = "99999999-9999-4999-8999-999999999999"
		created := createAttachmentDirectUploadIntent(t, fixture, payload)
		intent, err := fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, created.UploadIntentID)
		if err != nil {
			t.Fatalf("load upload intent: %v", err)
		}
		fixture.storage.setHead(intent.StorageKey, AttachmentHeadObjectOutput{
			ContentLength: intent.SizeBytes, ChecksumAlgorithm: "SHA256",
			ChecksumValue: rawSHA256Base64(shaHex), ChecksumType: "FULL_OBJECT",
			ServerSideEncryption: attachmentSSEValue(),
		})
		recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents/"+created.UploadIntentID+"/complete", nil, &fixture.allowed)
		if recorder.Code != http.StatusCreated {
			t.Fatalf("completion after text-box deletion status = %d, want %d; body=%s", recorder.Code, http.StatusCreated, recorder.Body.String())
		}
	})

	t.Run("expired multipart intents are aborted deleted and marked expired", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		fixture.server.attachmentDirectUpload.IntentLifetime = 5 * time.Millisecond
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "expired-upload", attachmentSinglePutMaxBytes+1, directUploadTestSHA256Hex("expired-upload"))
		created := createAttachmentDirectUploadIntent(t, fixture, payload)
		time.Sleep(20 * time.Millisecond)
		fixture.server.cleanupExpiredAttachmentUploads(context.Background())
		if len(fixture.storage.abortMultipartInputs) != 1 || len(fixture.storage.deleteKeys) != 1 {
			t.Fatalf("expired cleanup calls: abort=%d delete=%d", len(fixture.storage.abortMultipartInputs), len(fixture.storage.deleteKeys))
		}
		intent, err := fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, created.UploadIntentID)
		if err != nil {
			t.Fatalf("load expired upload intent: %v", err)
		}
		if intent.Status != domain.AttachmentUploadStatusExpired {
			t.Fatalf("expired intent status = %q, want expired", intent.Status)
		}
	})

	t.Run("abort is idempotent", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "abort-idempotent", attachmentSinglePutMaxBytes+1, directUploadTestSHA256Hex("abort-idempotent"))
		created := createAttachmentDirectUploadIntent(t, fixture, payload)
		path := "/v1/attachments/upload-intents/" + created.UploadIntentID
		first := performAttachmentDirectUploadRequest(t, fixture, http.MethodDelete, path, nil, &fixture.allowed)
		second := performAttachmentDirectUploadRequest(t, fixture, http.MethodDelete, path, nil, &fixture.allowed)
		if first.Code != http.StatusOK || second.Code != http.StatusOK {
			t.Fatalf("abort statuses = %d, %d; bodies=%s / %s", first.Code, second.Code, first.Body.String(), second.Body.String())
		}
		if len(fixture.storage.abortMultipartInputs) != 1 || len(fixture.storage.deleteKeys) != 1 {
			t.Fatalf("idempotent abort provider calls: abort=%d delete=%d", len(fixture.storage.abortMultipartInputs), len(fixture.storage.deleteKeys))
		}
		var response struct {
			Status string `json:"status"`
		}
		if err := json.Unmarshal(second.Body.Bytes(), &response); err != nil {
			t.Fatalf("decode replayed abort: %v", err)
		}
		if response.Status != domain.AttachmentUploadStatusAborted {
			t.Fatalf("replayed abort status = %q, want aborted", response.Status)
		}
	})
}

func TestLegacyBrowserAttachmentUploadRouteIsGone(t *testing.T) {
	fixture := newAttachmentDirectUploadTestFixture(t)
	req := httptest.NewRequest(http.MethodPost, "/v1/attachments", strings.NewReader("browser-file-bytes-must-not-cross-the-api"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=obsolete")
	req = attachmentRequestWithActor(req, fixture.allowed, fixture.companyID, domain.RoleCompanyUser)
	recorder := httptest.NewRecorder()
	fixture.server.Routes().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusGone {
		t.Fatalf("legacy browser upload status = %d, want %d; body=%s", recorder.Code, http.StatusGone, recorder.Body.String())
	}
	if fixture.storage.legacyPutCalls != 0 || len(fixture.storage.presignPutInputs) != 0 || len(fixture.storage.createMultipartInputs) != 0 {
		t.Fatalf("legacy browser route reached storage: legacy=%d presign=%d multipart=%d", fixture.storage.legacyPutCalls, len(fixture.storage.presignPutInputs), len(fixture.storage.createMultipartInputs))
	}
}

func TestAttachmentDirectUploadCompanyHintAndRequestValidation(t *testing.T) {
	t.Run("unauthenticated create is rejected before storage", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "unauthenticated", 4, directUploadTestSHA256Hex("unauthenticated"))
		recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents", payload, nil)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated create status = %d, want %d; body=%s", recorder.Code, http.StatusUnauthorized, recorder.Body.String())
		}
		if len(fixture.storage.presignPutInputs) != 0 || len(fixture.storage.createMultipartInputs) != 0 {
			t.Fatalf("unauthenticated create reached storage: presign=%d multipart=%d", len(fixture.storage.presignPutInputs), len(fixture.storage.createMultipartInputs))
		}
	})

	t.Run("missing or header-injecting content type is rejected before storage", func(t *testing.T) {
		for _, testCase := range []struct {
			name        string
			contentType any
			remove      bool
		}{
			{name: "missing", remove: true},
			{name: "carriage-return", contentType: "text/plain\rX-Evil: yes"},
			{name: "line-feed", contentType: "text/plain\nX-Evil: yes"},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				fixture := newAttachmentDirectUploadTestFixture(t)
				payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "content-type-"+testCase.name, 4, directUploadTestSHA256Hex(testCase.name))
				if testCase.remove {
					delete(payload, "contentType")
				} else {
					payload["contentType"] = testCase.contentType
				}
				recorder := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents", payload, &fixture.allowed)
				if recorder.Code != http.StatusBadRequest {
					t.Fatalf("invalid content type status = %d, want %d; body=%s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
				}
				if len(fixture.storage.presignPutInputs) != 0 || len(fixture.storage.createMultipartInputs) != 0 {
					t.Fatalf("invalid content type reached storage: presign=%d multipart=%d", len(fixture.storage.presignPutInputs), len(fixture.storage.createMultipartInputs))
				}
			})
		}
	})

	t.Run("a nonmember company hint is rejected before storage", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		nonmemberCompanyID := "33333333-3333-4333-8333-333333333333"
		actor := ActorContext{
			User: fixture.allowed,
			Memberships: []domain.CompanyMembership{{
				CompanyID: fixture.companyID, UserID: fixture.allowed.UserID, Role: domain.RoleCompanyUser,
			}},
		}
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "nonmember-company-hint", 4, directUploadTestSHA256Hex("nonmember-company-hint"))
		recorder := performAttachmentDirectUploadRequestWithActorContext(t, fixture, http.MethodPost, "/v1/attachments/upload-intents", payload, actor, nonmemberCompanyID)
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("nonmember company hint status = %d, want %d; body=%s", recorder.Code, http.StatusForbidden, recorder.Body.String())
		}
		if len(fixture.storage.presignPutInputs) != 0 || len(fixture.storage.createMultipartInputs) != 0 {
			t.Fatalf("nonmember company hint reached storage: presign=%d multipart=%d", len(fixture.storage.presignPutInputs), len(fixture.storage.createMultipartInputs))
		}
	})

	t.Run("a company hint conflicting with the actor context is rejected", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		secondCompanyID := "22222222-2222-4222-8222-222222222222"
		fixture.repo.EnsureCompany(secondCompanyID, "Second company")
		secondMembership, err := fixture.repo.AddCompanyMembership(fixture.allowed.CognitoSubject, secondCompanyID, domain.RoleCompanyUser)
		if err != nil {
			t.Fatalf("add second company membership: %v", err)
		}
		actor := ActorContext{
			User: fixture.allowed,
			Memberships: []domain.CompanyMembership{
				{CompanyID: fixture.companyID, UserID: fixture.allowed.UserID, Role: domain.RoleCompanyUser},
				secondMembership,
			},
			CompanyID: fixture.companyID, CompanyRole: domain.RoleCompanyUser,
		}
		payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "conflicting-company-hint", 4, directUploadTestSHA256Hex("conflicting-company-hint"))
		recorder := performAttachmentDirectUploadRequestWithActorContext(t, fixture, http.MethodPost, "/v1/attachments/upload-intents", payload, actor, secondCompanyID)
		if recorder.Code < 400 {
			t.Fatalf("conflicting company hint unexpectedly succeeded: status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		if len(fixture.storage.presignPutInputs) != 0 || len(fixture.storage.createMultipartInputs) != 0 {
			t.Fatalf("conflicting company hint reached storage: presign=%d multipart=%d", len(fixture.storage.presignPutInputs), len(fixture.storage.createMultipartInputs))
		}
	})

	t.Run("multi-company resources use only the authorized hinted company", func(t *testing.T) {
		fixture := newAttachmentDirectUploadTestFixture(t)
		secondCompanyID := "22222222-2222-4222-8222-222222222222"
		fixture.repo.EnsureCompany(secondCompanyID, "Second company")
		secondMembership, err := fixture.repo.AddCompanyMembership(fixture.allowed.CognitoSubject, secondCompanyID, domain.RoleCompanyUser)
		if err != nil {
			t.Fatalf("add second company membership: %v", err)
		}
		secondNode, err := fixture.repo.CreateNode(secondCompanyID, "Second-company attachment node")
		if err != nil {
			t.Fatalf("create second-company node: %v", err)
		}
		grantAttachmentTestAccess(t, fixture.repo, secondCompanyID, secondNode.NodeID, fixture.allowed.UserID)
		actor := ActorContext{User: fixture.allowed, Memberships: []domain.CompanyMembership{
			{CompanyID: fixture.companyID, UserID: fixture.allowed.UserID, Role: domain.RoleCompanyUser}, secondMembership,
		}}
		payload := attachmentDirectUploadIntentPayload(secondNode.NodeID, "multi-company-node", 4, directUploadTestSHA256Hex("node"))
		recorder := performAttachmentDirectUploadRequestWithActorContext(t, fixture, http.MethodPost, "/v1/attachments/upload-intents", payload, actor, secondCompanyID)
		if recorder.Code != http.StatusCreated {
			t.Fatalf("hinted Node create status = %d, want %d; body=%s", recorder.Code, http.StatusCreated, recorder.Body.String())
		}
		var created attachmentUploadIntentResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
			t.Fatalf("decode hinted upload response: %v", err)
		}
		intent, err := fixture.repo.GetAttachmentUploadIntent(secondCompanyID, fixture.allowed.UserID, created.UploadIntentID)
		if err != nil || intent.CompanyID != secondCompanyID || intent.ResourceType != "node" {
			t.Fatalf("hinted upload = %+v err=%v", intent, err)
		}
	})
}
func TestAttachmentDirectUploadMultipartAmbiguousCompletionRecovery(t *testing.T) {
	fixture := newAttachmentDirectUploadTestFixture(t)
	sizeBytes := attachmentSinglePutMaxBytes + 1
	shaHex := directUploadTestSHA256Hex("ambiguous-multipart-full-file")
	payload := attachmentDirectUploadIntentPayload(fixture.node.NodeID, "ambiguous-multipart-completion", sizeBytes, shaHex)
	created := createAttachmentDirectUploadIntent(t, fixture, payload)
	if created.Upload.Strategy != domain.AttachmentUploadStrategyMultipart || created.Upload.PartCount != 5 {
		t.Fatalf("created multipart descriptor = %+v", created.Upload)
	}

	partsRequest := make([]map[string]any, 0, created.Upload.PartCount)
	providerParts := make([]AttachmentS3Part, 0, created.Upload.PartCount)
	for partNumber := 1; partNumber <= created.Upload.PartCount; partNumber++ {
		checksum := directUploadTestChecksumBase64(fmt.Sprintf("ambiguous-part-%d", partNumber))
		partsRequest = append(partsRequest, map[string]any{
			"partNumber": partNumber, "checksumAlgorithm": "SHA256", "checksum": checksum,
		})
		partSize := attachmentMultipartPartBytes
		if partNumber == created.Upload.PartCount {
			partSize = sizeBytes - int64(partNumber-1)*attachmentMultipartPartBytes
		}
		providerParts = append(providerParts, AttachmentS3Part{
			PartNumber: partNumber, SizeBytes: partSize,
			ETag: fmt.Sprintf("ambiguous-etag-%d", partNumber), ChecksumSHA256: checksum,
		})
	}
	signed := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, "/v1/attachments/upload-intents/"+created.UploadIntentID+"/parts", map[string]any{"parts": partsRequest}, &fixture.allowed)
	if signed.Code != http.StatusOK {
		t.Fatalf("part signing status = %d, want %d; body=%s", signed.Code, http.StatusOK, signed.Body.String())
	}
	fixture.storage.setListParts(providerParts)
	fixture.storage.completeMultipartErrs = []error{errors.New("ambiguous provider timeout after request write")}
	completePath := "/v1/attachments/upload-intents/" + created.UploadIntentID + "/complete"

	first := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, completePath, nil, &fixture.allowed)
	if first.Code < 500 {
		t.Fatalf("ambiguous provider completion status = %d, want retryable server error; body=%s", first.Code, first.Body.String())
	}
	if len(fixture.storage.completeMultipartCalls) != 1 {
		t.Fatalf("CompleteMultipartUpload calls after ambiguous error = %d, want 1", len(fixture.storage.completeMultipartCalls))
	}
	intent, err := fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, created.UploadIntentID)
	if err != nil {
		t.Fatalf("load completing intent: %v", err)
	}
	if intent.Status != domain.AttachmentUploadStatusCompleting {
		t.Fatalf("intent status after ambiguous completion = %q, want completing", intent.Status)
	}

	immediate := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, completePath, nil, &fixture.allowed)
	if immediate.Code != http.StatusConflict {
		t.Fatalf("immediate unclaimed retry status = %d, want %d; body=%s", immediate.Code, http.StatusConflict, immediate.Body.String())
	}
	if len(fixture.storage.completeMultipartCalls) != 1 {
		t.Fatalf("recent completion lease allowed duplicate CompleteMultipartUpload: calls=%d", len(fixture.storage.completeMultipartCalls))
	}
	if len(fixture.storage.headInputs) != 0 {
		t.Fatalf("recent completion lease attempted recovery HEAD: calls=%d", len(fixture.storage.headInputs))
	}

	originalRecoveryGrace := attachmentCompletionRecoveryGrace
	attachmentCompletionRecoveryGrace = 0
	t.Cleanup(func() { attachmentCompletionRecoveryGrace = originalRecoveryGrace })
	operationStart := len(fixture.storage.operations)
	recovery := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, completePath, nil, &fixture.allowed)
	if recovery.Code != http.StatusConflict {
		t.Fatalf("stale-lease reconciliation status = %d, want %d; body=%s", recovery.Code, http.StatusConflict, recovery.Body.String())
	}
	if len(fixture.storage.completeMultipartCalls) != 1 {
		t.Fatalf("reconciliation repeated CompleteMultipartUpload: calls=%d", len(fixture.storage.completeMultipartCalls))
	}
	recoveryOperations := fixture.storage.operations[operationStart:]
	if len(recoveryOperations) < 2 || recoveryOperations[0] != "head" || recoveryOperations[1] != "list" {
		t.Fatalf("recovery provider order = %#v, want HEAD then ListParts", recoveryOperations)
	}
	intent, err = fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, created.UploadIntentID)
	if err != nil {
		t.Fatalf("load reconciled intent: %v", err)
	}
	if intent.Status == domain.AttachmentUploadStatusCompleting || intent.Status == domain.AttachmentUploadStatusCompleted {
		t.Fatalf("verified surviving multipart upload was not reopened: status=%q", intent.Status)
	}

	fixture.storage.setHead(intent.StorageKey, AttachmentHeadObjectOutput{
		ContentLength:        sizeBytes,
		ChecksumAlgorithm:    "SHA256",
		ChecksumValue:        multipartChecksumFromS3Parts(providerParts),
		ChecksumType:         "COMPOSITE",
		ServerSideEncryption: attachmentSSEValue(),
	})
	final := performAttachmentDirectUploadRequest(t, fixture, http.MethodPost, completePath, nil, &fixture.allowed)
	if final.Code != http.StatusCreated {
		t.Fatalf("completion after reconciliation status = %d, want %d; body=%s", final.Code, http.StatusCreated, final.Body.String())
	}
	if len(fixture.storage.completeMultipartCalls) != 2 {
		t.Fatalf("completion attempts = %d, want exactly 2", len(fixture.storage.completeMultipartCalls))
	}
	intent, err = fixture.repo.GetAttachmentUploadIntent(fixture.companyID, fixture.allowed.UserID, created.UploadIntentID)
	if err != nil {
		t.Fatalf("load finalized intent: %v", err)
	}
	if intent.Status != domain.AttachmentUploadStatusCompleted {
		t.Fatalf("final intent status = %q, want completed", intent.Status)
	}
}
