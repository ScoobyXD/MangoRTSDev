package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type fakeAttachmentObjectStorage struct {
	bucket  string
	objects map[string]fakeAttachmentObject
}

type fakeAttachmentObject struct {
	contentType string
	body        []byte
}

func newFakeAttachmentObjectStorage() *fakeAttachmentObjectStorage {
	return &fakeAttachmentObjectStorage{
		bucket:  "mango-attachments-test",
		objects: map[string]fakeAttachmentObject{},
	}
}

func (s *fakeAttachmentObjectStorage) Bucket() string {
	return s.bucket
}

func (s *fakeAttachmentObjectStorage) PutObject(ctx context.Context, input AttachmentPutObjectInput) error {
	s.objects[input.Key] = fakeAttachmentObject{contentType: input.ContentType, body: bytes.Clone(input.Body)}
	return nil
}

func (s *fakeAttachmentObjectStorage) GetObject(ctx context.Context, input AttachmentGetObjectInput) (AttachmentGetObjectOutput, error) {
	object, ok := s.objects[input.Key]
	if !ok {
		return AttachmentGetObjectOutput{}, ErrAttachmentObjectNotFound
	}
	return AttachmentGetObjectOutput{
		ContentType:   object.contentType,
		ContentLength: int64(len(object.body)),
		Body:          io.NopCloser(bytes.NewReader(object.body)),
	}, nil
}

func TestAttachmentUploadCreatesMetadataS3KeyAndResourceLinks(t *testing.T) {
	repo, server, storage, companyID, allowed, _, nodeA := newAttachmentRouteTestFixture(t)
	nodeB, err := repo.CreateNode(companyID, "Attachment linked node")
	if err != nil {
		t.Fatalf("CreateNode B: %v", err)
	}
	grantAttachmentTestAccess(t, repo, companyID, nodeB.NodeID, allowed.UserID)

	handler := server.Routes()
	body, contentType := attachmentMultipartBody(t, map[string]string{
		"company_id":        companyID,
		"resource_type":     "node",
		"resource_id":       nodeA.NodeID,
		"relationship_kind": "file_attachment",
		"source_kind":       "user_upload",
	}, "hello.txt", "text/plain", []byte("hello attachment"))
	req := httptest.NewRequest(http.MethodPost, "/v1/attachments", body)
	req.Header.Set("Content-Type", contentType)
	req = attachmentRequestWithActor(req, allowed, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/attachments status = %d body=%s", rec.Code, rec.Body.String())
	}

	var created attachmentUploadResponse
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode attachment response: %v", err)
	}
	if created.Attachment.AttachmentID == "" {
		t.Fatalf("attachment id was empty")
	}
	wantKey := attachmentOriginalObjectKey(companyID, created.Attachment.AttachmentID)
	if created.Attachment.StorageBucket != storage.bucket || created.Attachment.StorageKey != wantKey {
		t.Fatalf("storage metadata = bucket %q key %q, want %q %q", created.Attachment.StorageBucket, created.Attachment.StorageKey, storage.bucket, wantKey)
	}
	if created.Attachment.ByteSize != int64(len("hello attachment")) || created.Attachment.SHA256 == "" {
		t.Fatalf("attachment metadata missing byte size/hash: %+v", created.Attachment)
	}
	stored, ok := storage.objects[wantKey]
	if !ok {
		t.Fatalf("fake storage missing key %s", wantKey)
	}
	if string(stored.body) != "hello attachment" {
		t.Fatalf("stored body = %q", string(stored.body))
	}
	if strings.Contains(rec.Body.String(), "data:") {
		t.Fatalf("attachment response included inline data URL: %s", rec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/resources/node/"+nodeA.NodeID+"/attachments?company_id="+companyID, nil)
	listReq = attachmentRequestWithActor(listReq, allowed, companyID, domain.RoleCompanyUser)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET resource attachments status = %d body=%s", listRec.Code, listRec.Body.String())
	}
	var listed struct {
		Attachments []domain.ResourceAttachment `json:"attachments"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listed.Attachments) != 1 || listed.Attachments[0].Attachment == nil || listed.Attachments[0].Attachment.AttachmentID != created.Attachment.AttachmentID {
		t.Fatalf("listed attachments = %+v", listed.Attachments)
	}

	linkBody, _ := json.Marshal(map[string]string{
		"company_id":        companyID,
		"attachment_id":     created.Attachment.AttachmentID,
		"relationship_kind": "file_attachment",
	})
	linkReq := httptest.NewRequest(http.MethodPost, "/v1/resources/node/"+nodeB.NodeID+"/attachments", bytes.NewReader(linkBody))
	linkReq.Header.Set("Content-Type", "application/json")
	linkReq = attachmentRequestWithActor(linkReq, allowed, companyID, domain.RoleCompanyUser)
	linkRec := httptest.NewRecorder()
	handler.ServeHTTP(linkRec, linkReq)
	if linkRec.Code != http.StatusCreated {
		t.Fatalf("POST resource attachment link status = %d body=%s", linkRec.Code, linkRec.Body.String())
	}
}

func TestAttachmentContentRequiresLinkedResourceAccess(t *testing.T) {
	_, server, _, companyID, allowed, denied, node := newAttachmentRouteTestFixture(t)
	handler := server.Routes()
	attachmentID := uploadAttachmentForTest(t, handler, companyID, node.NodeID, allowed)

	allowedReq := httptest.NewRequest(http.MethodGet, "/v1/attachments/"+attachmentID+"/content?company_id="+companyID+"&variant=thumbnail", nil)
	allowedReq = attachmentRequestWithActor(allowedReq, allowed, companyID, domain.RoleCompanyUser)
	allowedRec := httptest.NewRecorder()
	handler.ServeHTTP(allowedRec, allowedReq)
	if allowedRec.Code != http.StatusOK {
		t.Fatalf("allowed content status = %d body=%s", allowedRec.Code, allowedRec.Body.String())
	}
	if allowedRec.Body.String() != "hello attachment" {
		t.Fatalf("allowed content body = %q", allowedRec.Body.String())
	}

	deniedReq := httptest.NewRequest(http.MethodGet, "/v1/attachments/"+attachmentID+"/content?company_id="+companyID, nil)
	deniedReq = attachmentRequestWithActor(deniedReq, denied, companyID, domain.RoleCompanyUser)
	deniedRec := httptest.NewRecorder()
	handler.ServeHTTP(deniedRec, deniedReq)
	if deniedRec.Code != http.StatusNotFound {
		t.Fatalf("denied content status = %d body=%s", deniedRec.Code, deniedRec.Body.String())
	}
}

func TestAttachmentUnlinkSoftDeletesResourceAccess(t *testing.T) {
	_, server, _, companyID, allowed, _, node := newAttachmentRouteTestFixture(t)
	handler := server.Routes()
	attachmentID := uploadAttachmentForTest(t, handler, companyID, node.NodeID, allowed)

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/resources/node/"+node.NodeID+"/attachments/"+attachmentID+"?company_id="+companyID, nil)
	deleteReq = attachmentRequestWithActor(deleteReq, allowed, companyID, domain.RoleCompanyUser)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE resource attachment status = %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/resources/node/"+node.NodeID+"/attachments?company_id="+companyID, nil)
	listReq = attachmentRequestWithActor(listReq, allowed, companyID, domain.RoleCompanyUser)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET resource attachments after delete status = %d body=%s", listRec.Code, listRec.Body.String())
	}
	var listed struct {
		Attachments []domain.ResourceAttachment `json:"attachments"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listed); err != nil {
		t.Fatalf("decode list after delete: %v", err)
	}
	if len(listed.Attachments) != 0 {
		t.Fatalf("listed attachments after delete = %+v", listed.Attachments)
	}

	contentReq := httptest.NewRequest(http.MethodGet, "/v1/attachments/"+attachmentID+"/content?company_id="+companyID, nil)
	contentReq = attachmentRequestWithActor(contentReq, allowed, companyID, domain.RoleCompanyUser)
	contentRec := httptest.NewRecorder()
	handler.ServeHTTP(contentRec, contentReq)
	if contentRec.Code != http.StatusNotFound {
		t.Fatalf("content after unlink status = %d body=%s", contentRec.Code, contentRec.Body.String())
	}
}

func TestAttachmentUploadRejectsMissingResourceContext(t *testing.T) {
	_, server, storage, companyID, allowed, _, _ := newAttachmentRouteTestFixture(t)
	handler := server.Routes()
	body, contentType := attachmentMultipartBody(t, map[string]string{
		"company_id":    companyID,
		"resource_type": "node",
	}, "bad.txt", "text/plain", []byte("bad"))
	req := httptest.NewRequest(http.MethodPost, "/v1/attachments", body)
	req.Header.Set("Content-Type", contentType)
	req = attachmentRequestWithActor(req, allowed, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing resource context status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(storage.objects) != 0 {
		t.Fatalf("storage objects were written despite validation failure: %+v", storage.objects)
	}
}

func TestAttachmentSystemDoesNotAddWebSocketFileBytePayloadRoute(t *testing.T) {
	_, server, _, companyID, allowed, _, _ := newAttachmentRouteTestFixture(t)
	handler := server.Routes()
	req := httptest.NewRequest(http.MethodPost, "/v1/realtime/ws?company_id="+companyID, strings.NewReader("file-bytes"))
	req = attachmentRequestWithActor(req, allowed, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code == http.StatusCreated || rec.Code == http.StatusOK {
		t.Fatalf("realtime websocket accepted file-byte POST, status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func newAttachmentRouteTestFixture(t *testing.T) (*store.MemoryRepo, *Server, *fakeAttachmentObjectStorage, string, domain.User, domain.User, domain.Node) {
	t.Helper()
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	repo.EnsureCompany(companyID, "Attachment Spine Company")
	allowed, err := repo.UpsertAuthUser("attachment-allowed", "allowed@example.com", "Allowed User")
	if err != nil {
		t.Fatalf("UpsertAuthUser allowed: %v", err)
	}
	denied, err := repo.UpsertAuthUser("attachment-denied", "denied@example.com", "Denied User")
	if err != nil {
		t.Fatalf("UpsertAuthUser denied: %v", err)
	}
	if _, err := repo.AddCompanyMembership(allowed.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership allowed: %v", err)
	}
	if _, err := repo.AddCompanyMembership(denied.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership denied: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Attachment node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	grantAttachmentTestAccess(t, repo, companyID, node.NodeID, allowed.UserID)
	storage := newFakeAttachmentObjectStorage()
	server := NewServerWithOptions(repo, ServerOptions{AttachmentStorage: storage})
	return repo, server, storage, companyID, allowed, denied, node
}

func grantAttachmentTestAccess(t *testing.T, repo *store.MemoryRepo, companyID, nodeID, userID string) {
	t.Helper()
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         nodeID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   userID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
}

func uploadAttachmentForTest(t *testing.T, handler http.Handler, companyID, nodeID string, actor domain.User) string {
	t.Helper()
	body, contentType := attachmentMultipartBody(t, map[string]string{
		"company_id":        companyID,
		"resource_type":     "node",
		"resource_id":       nodeID,
		"relationship_kind": "file_attachment",
		"source_kind":       "user_upload",
	}, "hello.txt", "text/plain", []byte("hello attachment"))
	req := httptest.NewRequest(http.MethodPost, "/v1/attachments", body)
	req.Header.Set("Content-Type", contentType)
	req = attachmentRequestWithActor(req, actor, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload attachment status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created attachmentUploadResponse
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode upload attachment: %v", err)
	}
	return created.Attachment.AttachmentID
}

func attachmentMultipartBody(t *testing.T, fields map[string]string, filename, contentType string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("WriteField %s: %v", key, err)
		}
	}
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	return &body, writer.FormDataContentType()
}

func attachmentRequestWithActor(req *http.Request, user domain.User, companyID, role string) *http.Request {
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID,
			UserID:    user.UserID,
			Role:      role,
		}},
		CompanyID:   companyID,
		CompanyRole: role,
	}))
}
