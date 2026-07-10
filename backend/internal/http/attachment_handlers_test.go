package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
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
	if input.Body == nil {
		return fmt.Errorf("missing attachment body")
	}
	if seeker, ok := any(input.Body).(io.Seeker); ok {
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return err
		}
	}
	body, err := io.ReadAll(input.Body)
	if err != nil {
		return err
	}
	if int64(len(body)) != input.ContentLength {
		return fmt.Errorf("attachment length = %d, want %d", len(body), input.ContentLength)
	}
	sum := sha256.Sum256(body)
	if fmt.Sprintf("%x", sum[:]) != input.SHA256 {
		return fmt.Errorf("attachment hash mismatch")
	}
	s.objects[input.Key] = fakeAttachmentObject{contentType: input.ContentType, body: body}
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

func TestLegacyAttachmentUploadRouteRejectsBrowserBytes(t *testing.T) {
	_, server, storage, companyID, allowed, _, _ := newAttachmentRouteTestFixture(t)
	req := httptest.NewRequest(http.MethodPost, "/v1/attachments", strings.NewReader("browser-file-bytes"))
	req = attachmentRequestWithActor(req, allowed, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusGone {
		t.Fatalf("legacy upload status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(storage.objects) != 0 {
		t.Fatalf("legacy upload wrote storage objects: %+v", storage.objects)
	}
}

func TestAttachmentContentRequiresLinkedResourceAccess(t *testing.T) {
	repo, server, storage, companyID, allowed, denied, node := newAttachmentRouteTestFixture(t)
	handler := server.Routes()
	attachmentID := seedAttachmentForTest(t, repo, storage, companyID, node.NodeID, allowed)

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
	repo, server, storage, companyID, allowed, _, node := newAttachmentRouteTestFixture(t)
	handler := server.Routes()
	attachmentID := seedAttachmentForTest(t, repo, storage, companyID, node.NodeID, allowed)

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

func seedAttachmentForTest(t *testing.T, repo *store.MemoryRepo, storage *fakeAttachmentObjectStorage, companyID, nodeID string, actor domain.User) string {
	t.Helper()
	body := []byte("hello attachment")
	sum := sha256.Sum256(body)
	attachmentID := store.NewUUIDv7String()
	storageKey := attachmentOriginalObjectKey(companyID, attachmentID)
	storage.objects[storageKey] = fakeAttachmentObject{contentType: "text/plain", body: body}
	if _, _, err := repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
		CompanyID: companyID, AttachmentID: attachmentID, UploadedByUserID: actor.UserID,
		OriginalFilename: "hello.txt", MimeType: "text/plain", ByteSize: int64(len(body)),
		SHA256: fmt.Sprintf("%x", sum[:]), SHA256VerificationMethod: "server_stream",
		StorageBucket: storage.bucket, StorageKey: storageKey, SourceKind: store.AttachmentSourceUserUpload,
		ResourceLink: store.ResourceAttachmentInput{CompanyID: companyID, ResourceType: "node", ResourceID: nodeID,
			RelationshipKind: store.AttachmentRelationshipFileAttachment, CreatedByUserID: actor.UserID},
	}); err != nil {
		t.Fatalf("seed attachment: %v", err)
	}
	return attachmentID
}

func TestAttachmentLinkRequiresSourceReadAccess(t *testing.T) {
	repo, server, storage, companyID, allowed, denied, sourceNode := newAttachmentRouteTestFixture(t)
	attachmentID := seedAttachmentForTest(t, repo, storage, companyID, sourceNode.NodeID, allowed)
	targetNode, err := repo.CreateNode(companyID, "Destination")
	if err != nil {
		t.Fatalf("CreateNode target: %v", err)
	}
	grantAttachmentTestAccess(t, repo, companyID, targetNode.NodeID, denied.UserID)
	body, _ := json.Marshal(map[string]string{"company_id": companyID, "attachment_id": attachmentID, "relationship_kind": "file_attachment"})
	req := httptest.NewRequest(http.MethodPost, "/v1/resources/node/"+targetNode.NodeID+"/attachments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = attachmentRequestWithActor(req, denied, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("source-inaccessible link status = %d body=%s", rec.Code, rec.Body.String())
	}
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
