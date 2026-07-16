package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type fakeAttachmentRemoteImageDownloader struct {
	calls    int
	download attachmentRemoteImageDownload
	err      error
}

func (f *fakeAttachmentRemoteImageDownloader) Download(_ context.Context, _ *url.URL) (attachmentRemoteImageDownload, error) {
	f.calls++
	return f.download, f.err
}

func TestAttachmentRemoteImageImportStoresDurableReferenceWithoutSourceURL(t *testing.T) {
	repo, server, storage, companyID, allowed, _, node := newAttachmentRouteTestFixture(t)
	server.attachmentVariantEnsurer = nil
	downloader := &fakeAttachmentRemoteImageDownloader{download: attachmentRemoteImageDownload{
		Body:              []byte("\x89PNG\r\n\x1a\nclipboard-image"),
		MimeType:          "image/png",
		SuggestedFilename: "source-image.png",
	}}
	server.attachmentRemoteImageDownloader = downloader

	sourceURL := "https://assets.example.test/private/sop.png?temporary_secret=do-not-store"
	body, err := json.Marshal(attachmentRemoteImageImportRequest{
		CompanyID: companyID, ResourceType: "node", ResourceID: node.NodeID,
		SourceURL: sourceURL, OriginalFilename: "Procedure screenshot.png",
		InformationID: "22222222-2222-4222-8222-222222222222", EditorSurface: "node_text_block",
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/attachments/imports/remote-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = attachmentRequestWithActor(req, allowed, companyID, domain.RoleCompanyUser)
	recorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("remote image import status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if downloader.calls != 1 {
		t.Fatalf("remote image downloader calls=%d, want 1", downloader.calls)
	}
	if strings.Contains(recorder.Body.String(), "temporary_secret") || strings.Contains(recorder.Body.String(), sourceURL) {
		t.Fatalf("response exposed remote source URL: %s", recorder.Body.String())
	}
	var response attachmentUploadResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode import response: %v", err)
	}
	if response.Attachment.SourceKind != store.AttachmentSourceEditorPaste || response.Attachment.SourceProvider != "external_clipboard" {
		t.Fatalf("unexpected attachment source: %+v", response.Attachment)
	}
	if response.Attachment.OriginalFilename != "Procedure screenshot.png" || response.Attachment.MimeType != "image/png" {
		t.Fatalf("unexpected attachment metadata: %+v", response.Attachment)
	}
	if response.ResourceAttachment.RelationshipKind != store.AttachmentRelationshipInlineImage ||
		response.ResourceAttachment.ResourceType != "node" ||
		response.ResourceAttachment.ResourceID != node.NodeID ||
		response.ResourceAttachment.InformationID != "22222222-2222-4222-8222-222222222222" {
		t.Fatalf("unexpected resource link: %+v", response.ResourceAttachment)
	}
	storedObject, ok := storage.objects[attachmentOriginalObjectKey(companyID, response.Attachment.AttachmentID)]
	if !ok || !bytes.Equal(storedObject.body, downloader.download.Body) {
		t.Fatalf("remote image bytes were not stored under the durable attachment key")
	}
	persisted, err := repo.GetAttachment(companyID, response.Attachment.AttachmentID)
	if err != nil {
		t.Fatalf("load imported attachment: %v", err)
	}
	if persisted.SourceProvider != "external_clipboard" || len(persisted.ResourceLinks) != 1 {
		t.Fatalf("unexpected persisted attachment: %+v", persisted)
	}
}

func TestAttachmentRemoteImageImportChecksDestinationPermissionBeforeFetch(t *testing.T) {
	_, server, _, companyID, _, denied, node := newAttachmentRouteTestFixture(t)
	downloader := &fakeAttachmentRemoteImageDownloader{download: attachmentRemoteImageDownload{
		Body: []byte("\x89PNG\r\n\x1a\nclipboard-image"), MimeType: "image/png",
	}}
	server.attachmentRemoteImageDownloader = downloader
	body, _ := json.Marshal(attachmentRemoteImageImportRequest{
		CompanyID: companyID, ResourceType: "node", ResourceID: node.NodeID,
		SourceURL: "https://assets.example.test/sop.png",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/attachments/imports/remote-image", bytes.NewReader(body))
	req = attachmentRequestWithActor(req, denied, companyID, domain.RoleCompanyUser)
	recorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("denied remote image import status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if downloader.calls != 0 {
		t.Fatalf("denied import made %d external requests", downloader.calls)
	}
}

func TestAttachmentRemoteImageSourceURLRejectsUnsafeNetworkTargets(t *testing.T) {
	rejected := []string{
		"file:///etc/passwd",
		"https://localhost/image.png",
		"https://api.localhost/image.png",
		"http://127.0.0.1/image.png",
		"http://10.0.0.8/image.png",
		"http://169.254.169.254/latest/meta-data",
		"https://[::1]/image.png",
		"https://user:secret@example.test/image.png",
		"https://example.test:8443/image.png",
	}
	for _, candidate := range rejected {
		t.Run(candidate, func(t *testing.T) {
			if _, err := validateAttachmentRemoteImageSourceURL(candidate); err == nil {
				t.Fatalf("unsafe remote image URL was accepted: %s", candidate)
			}
		})
	}
	accepted, err := validateAttachmentRemoteImageSourceURL("https://assets.example.test/image.png?token=temporary#fragment")
	if err != nil {
		t.Fatalf("public HTTPS image URL rejected: %v", err)
	}
	if accepted.Fragment != "" {
		t.Fatalf("remote image fragment was not removed: %s", accepted.String())
	}
}

func TestAttachmentRemoteImageIPPolicyRejectsPrivateAndSpecialAddresses(t *testing.T) {
	for _, candidate := range []string{"127.0.0.1", "10.1.2.3", "100.64.0.1", "169.254.169.254", "192.0.2.1", "198.18.0.1", "224.0.0.1", "::1", "fe80::1", "64:ff9b::a00:1", "2001:db8::1", "2002:0a00:0001::"} {
		if isSafeAttachmentRemoteImageIP(net.ParseIP(candidate)) {
			t.Fatalf("unsafe remote image IP was accepted: %s", candidate)
		}
	}
	if !isSafeAttachmentRemoteImageIP(net.ParseIP("8.8.8.8")) {
		t.Fatal("public unicast IP was rejected")
	}
}

func TestAttachmentRemoteImageImportRejectsClaimedRasterWithNonRasterBody(t *testing.T) {
	_, server, _, companyID, allowed, _, node := newAttachmentRouteTestFixture(t)
	server.attachmentVariantEnsurer = nil
	downloader := &fakeAttachmentRemoteImageDownloader{download: attachmentRemoteImageDownload{
		Body:     []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"),
		MimeType: "image/png",
	}}
	server.attachmentRemoteImageDownloader = downloader
	body, _ := json.Marshal(attachmentRemoteImageImportRequest{
		CompanyID: companyID, ResourceType: "node", ResourceID: node.NodeID,
		SourceURL: "https://assets.example.test/not-really-an-image.png",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/attachments/imports/remote-image", bytes.NewReader(body))
	req = attachmentRequestWithActor(req, allowed, companyID, domain.RoleCompanyUser)
	recorder := httptest.NewRecorder()
	server.Routes().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("non-raster remote image status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if downloader.calls != 1 {
		t.Fatalf("remote image downloader calls=%d, want 1", downloader.calls)
	}
}
