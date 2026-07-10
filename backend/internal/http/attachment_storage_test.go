package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestS3AttachmentStoragePutObjectStreamsWithPrecomputedHash(t *testing.T) {
	payload := bytes.Repeat([]byte("stream-to-s3\n"), 10_000)
	wantHash := sha256.Sum256(payload)
	wantHashText := fmt.Sprintf("%x", wantHash[:])

	var gotBody []byte
	var gotContentLength int64
	var gotPayloadHash string
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		gotBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read streamed request: %v", err)
		}
		gotContentLength = r.ContentLength
		gotPayloadHash = r.Header.Get("X-Amz-Content-Sha256")
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	t.Setenv("AWS_ACCESS_KEY_ID", "attachment-test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "attachment-test-secret-key")
	t.Setenv("AWS_SESSION_TOKEN", "")
	t.Setenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION", "none")

	reader := bytes.NewReader(payload)
	if _, err := reader.Seek(17, io.SeekStart); err != nil {
		t.Fatalf("seek test reader: %v", err)
	}
	storage := &S3AttachmentStorage{
		Region:      "us-west-1",
		BucketName:  "attachment-test-bucket",
		EndpointURL: server.URL,
		HTTPClient:  server.Client(),
	}
	err := storage.PutObject(context.Background(), AttachmentPutObjectInput{
		Key:           "companies/company-1/attachments/attachment-1/original",
		ContentType:   "text/plain",
		ContentLength: int64(len(payload)),
		SHA256:        wantHashText,
		Body:          reader,
	})
	if err != nil {
		t.Fatalf("PutObject: %v", err)
	}

	if !bytes.Equal(gotBody, payload) {
		t.Fatalf("streamed body did not match original payload")
	}
	if gotContentLength != int64(len(payload)) {
		t.Fatalf("content length = %d, want %d", gotContentLength, len(payload))
	}
	if gotPayloadHash != wantHashText {
		t.Fatalf("payload hash = %q, want %q", gotPayloadHash, wantHashText)
	}
	if gotPath != "/attachment-test-bucket/companies/company-1/attachments/attachment-1/original" {
		t.Fatalf("request path = %q", gotPath)
	}
}

func TestS3AttachmentStoragePutObjectSendsExplicitEmptyPayload(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")
	t.Setenv("AWS_SESSION_TOKEN", "")
	t.Setenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION", "none")

	var gotContentLength int64
	var gotTransferEncoding []string
	var gotBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotContentLength = r.ContentLength
		gotTransferEncoding = append([]string(nil), r.TransferEncoding...)
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	emptyHash := sha256.Sum256(nil)
	storage := &S3AttachmentStorage{
		Region:      "us-west-1",
		BucketName:  "test-bucket",
		EndpointURL: server.URL,
		HTTPClient:  server.Client(),
	}
	err := storage.PutObject(context.Background(), AttachmentPutObjectInput{
		Key:           "company/empty",
		ContentType:   "application/octet-stream",
		ContentLength: 0,
		SHA256:        fmt.Sprintf("%x", emptyHash),
		Body:          bytes.NewReader(nil),
	})
	if err != nil {
		t.Fatalf("PutObject returned error: %v", err)
	}
	if gotContentLength != 0 {
		t.Fatalf("ContentLength = %d, want 0", gotContentLength)
	}
	if len(gotTransferEncoding) != 0 {
		t.Fatalf("TransferEncoding = %v, want none", gotTransferEncoding)
	}
	if len(gotBody) != 0 {
		t.Fatalf("body length = %d, want 0", len(gotBody))
	}
}

func TestS3AttachmentStoragePutObjectRejectsInvalidStreamMetadata(t *testing.T) {
	storage := &S3AttachmentStorage{Region: "us-west-1", BucketName: "attachment-test-bucket"}
	err := storage.PutObject(context.Background(), AttachmentPutObjectInput{
		Key:           "object-key",
		ContentLength: 3,
		SHA256:        "not-a-sha256",
		Body:          bytes.NewReader([]byte("abc")),
	})
	if err != ErrAttachmentStorageUnavailable {
		t.Fatalf("PutObject error = %v, want %v", err, ErrAttachmentStorageUnavailable)
	}
}
