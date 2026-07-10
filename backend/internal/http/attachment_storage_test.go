package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestS3AttachmentStoragePutObjectStreamsWithPrecomputedHash(t *testing.T) {
	payload := bytes.Repeat([]byte("stream-to-s3\n"), 10_000)
	wantHash := sha256.Sum256(payload)
	wantHashText := fmt.Sprintf("%x", wantHash[:])

	var gotBody []byte
	var gotContentLength int64
	var gotPayloadHash string
	var gotChecksum string
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		gotBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read streamed request: %v", err)
		}
		gotContentLength = r.ContentLength
		gotPayloadHash = r.Header.Get("X-Amz-Content-Sha256")
		gotChecksum = r.Header.Get("X-Amz-Checksum-Sha256")
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	t.Setenv("AWS_ACCESS_KEY_ID", "attachment-test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "attachment-test-secret-key")
	t.Setenv("AWS_SESSION_TOKEN", "")
	t.Setenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION", "none")

	// bytes.Buffer intentionally does not implement io.Seeker. Server-originated
	// email/import/job bodies must remain streaming and must not be buffered or
	// rewound by attachment storage.
	reader := bytes.NewBuffer(payload)
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
	if wantChecksum := base64.StdEncoding.EncodeToString(wantHash[:]); gotChecksum != wantChecksum {
		t.Fatalf("object checksum = %q, want %q", gotChecksum, wantChecksum)
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
		Body:          bytes.NewBuffer(nil),
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

func TestS3AttachmentStoragePutObjectDoesNotReplayNonSeekableBody(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "attachment-test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "attachment-test-secret-key")
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION", "none")

	payload := []byte("non-seekable producer")
	digest := sha256.Sum256(payload)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		io.Copy(io.Discard, r.Body)
		http.Error(w, "retryable provider failure", http.StatusInternalServerError)
	}))
	defer server.Close()
	storage := &S3AttachmentStorage{Region: "us-west-1", BucketName: "test-bucket", EndpointURL: server.URL, HTTPClient: server.Client()}
	err := storage.PutObject(context.Background(), AttachmentPutObjectInput{
		Key: "company/object", ContentType: "text/plain", ContentLength: int64(len(payload)),
		SHA256: fmt.Sprintf("%x", digest[:]), Body: bytes.NewBuffer(payload),
	})
	if err == nil {
		t.Fatal("PutObject returned nil for provider failure")
	}
	if requests != 1 {
		t.Fatalf("non-seekable body request count = %d, want 1", requests)
	}
}

func TestS3AttachmentStoragePresignsBrowserEndpointAndExactHeaders(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "attachment-test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "attachment-test-secret-key")
	t.Setenv("AWS_SESSION_TOKEN", "attachment-test-session-token")
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION", "AES256")

	checksumBytes := sha256.Sum256([]byte("presigned upload"))
	checksum := base64.StdEncoding.EncodeToString(checksumBytes[:])
	storage := &S3AttachmentStorage{
		Region:             "us-west-1",
		BucketName:         "attachment-test-bucket",
		EndpointURL:        "http://backend-s3.internal:9000/backend-prefix",
		PresignEndpointURL: "https://uploads.example.test/browser-prefix",
	}

	put, err := storage.PresignPutObject(context.Background(), AttachmentPresignPutInput{
		Key:            "companies/company-1/nodes/node-1/attachments/attachment-1/original",
		ContentType:    "image/png",
		ChecksumSHA256: checksum,
		Expires:        2 * time.Hour,
	})
	if err != nil {
		t.Fatalf("PresignPutObject: %v", err)
	}
	putURL := parseAttachmentTestURL(t, put.URL)
	if put.Method != http.MethodPut {
		t.Fatalf("put method = %q, want PUT", put.Method)
	}
	if putURL.Host != "uploads.example.test" {
		t.Fatalf("put host = %q, want browser endpoint", putURL.Host)
	}
	wantPath := "/browser-prefix/attachment-test-bucket/companies/company-1/nodes/node-1/attachments/attachment-1/original"
	if putURL.Path != wantPath {
		t.Fatalf("put path = %q, want %q", putURL.Path, wantPath)
	}
	if got := putURL.Query().Get("X-Amz-Expires"); got != "3600" {
		t.Fatalf("put expiry = %q, want 3600", got)
	}
	if got := putURL.Query().Get("X-Amz-SignedHeaders"); got != "content-type;host;x-amz-checksum-sha256;x-amz-server-side-encryption" {
		t.Fatalf("put signed headers = %q", got)
	}
	wantPutHeaders := map[string]string{
		"content-type":                 "image/png",
		"x-amz-checksum-sha256":        checksum,
		"x-amz-server-side-encryption": "AES256",
	}
	if !reflect.DeepEqual(put.RequiredHeaders, wantPutHeaders) {
		t.Fatalf("put required headers = %#v, want %#v", put.RequiredHeaders, wantPutHeaders)
	}
	if credential := putURL.Query().Get("X-Amz-Credential"); !strings.Contains(credential, "/us-west-1/s3/aws4_request") {
		t.Fatalf("put credential scope = %q", credential)
	}

	part, err := storage.PresignUploadPart(context.Background(), AttachmentPresignPartInput{
		Key:            "companies/company-1/nodes/node-1/attachments/attachment-1/original",
		UploadID:       "server-owned-upload-id",
		PartNumber:     7,
		ChecksumSHA256: checksum,
		Expires:        time.Hour,
	})
	if err != nil {
		t.Fatalf("PresignUploadPart: %v", err)
	}
	partURL := parseAttachmentTestURL(t, part.URL)
	if partURL.Host != "uploads.example.test" || partURL.Path != wantPath {
		t.Fatalf("part URL = %q", part.URL)
	}
	if got := partURL.Query().Get("partNumber"); got != "7" {
		t.Fatalf("part number = %q, want 7", got)
	}
	if got := partURL.Query().Get("uploadId"); got != "server-owned-upload-id" {
		t.Fatalf("upload id = %q", got)
	}
	if got := partURL.Query().Get("X-Amz-Expires"); got != "900" {
		t.Fatalf("part expiry = %q, want 900", got)
	}
	if got := partURL.Query().Get("X-Amz-SignedHeaders"); got != "host;x-amz-checksum-sha256" {
		t.Fatalf("part signed headers = %q", got)
	}
	if !reflect.DeepEqual(part.RequiredHeaders, map[string]string{"x-amz-checksum-sha256": checksum}) {
		t.Fatalf("part required headers = %#v", part.RequiredHeaders)
	}
}

func TestS3AttachmentStorageSDKProviderOperationsAndPagination(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "attachment-test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "attachment-test-secret-key")
	t.Setenv("AWS_SESSION_TOKEN", "")
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION", "AES256")

	partOneBytes := sha256.Sum256([]byte("part one"))
	partTwoBytes := sha256.Sum256([]byte("part two"))
	partOneChecksum := base64.StdEncoding.EncodeToString(partOneBytes[:])
	partTwoChecksum := base64.StdEncoding.EncodeToString(partTwoBytes[:])
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/attachment-test-bucket/companies/company-1/attachment" {
			t.Errorf("provider path = %q", r.URL.Path)
		}
		query := r.URL.Query()
		switch {
		case r.Method == http.MethodPost && query.Has("uploads"):
			calls = append(calls, "create")
			if got := r.Header.Get("x-amz-checksum-algorithm"); got != "SHA256" {
				t.Errorf("create checksum algorithm = %q", got)
			}
			if got := r.Header.Get("x-amz-checksum-type"); got != "COMPOSITE" {
				t.Errorf("create checksum type = %q", got)
			}
			if got := r.Header.Get("x-amz-server-side-encryption"); got != "AES256" {
				t.Errorf("create encryption = %q", got)
			}
			w.Header().Set("Content-Type", "application/xml")
			fmt.Fprint(w, `<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>attachment-test-bucket</Bucket><Key>companies/company-1/attachment</Key><UploadId>sdk-upload-id</UploadId></InitiateMultipartUploadResult>`)
		case r.Method == http.MethodGet && query.Get("uploadId") == "sdk-upload-id":
			marker := query.Get("part-number-marker")
			calls = append(calls, "list:"+marker)
			w.Header().Set("Content-Type", "application/xml")
			if marker == "" {
				fmt.Fprintf(w, `<ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>attachment-test-bucket</Bucket><Key>companies/company-1/attachment</Key><UploadId>sdk-upload-id</UploadId><PartNumberMarker>0</PartNumberMarker><NextPartNumberMarker>1</NextPartNumberMarker><MaxParts>1</MaxParts><IsTruncated>true</IsTruncated><Part><PartNumber>1</PartNumber><ETag>&quot;etag-1&quot;</ETag><Size>16777216</Size><ChecksumSHA256>%s</ChecksumSHA256></Part></ListPartsResult>`, partOneChecksum)
				return
			}
			if marker != "1" {
				t.Errorf("list marker = %q, want 1", marker)
			}
			fmt.Fprintf(w, `<ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>attachment-test-bucket</Bucket><Key>companies/company-1/attachment</Key><UploadId>sdk-upload-id</UploadId><PartNumberMarker>1</PartNumberMarker><NextPartNumberMarker>2</NextPartNumberMarker><MaxParts>1</MaxParts><IsTruncated>false</IsTruncated><Part><PartNumber>2</PartNumber><ETag>&quot;etag-2&quot;</ETag><Size>42</Size><ChecksumSHA256>%s</ChecksumSHA256></Part></ListPartsResult>`, partTwoChecksum)
		case r.Method == http.MethodPost && query.Get("uploadId") == "sdk-upload-id":
			calls = append(calls, "complete")
			body, _ := io.ReadAll(r.Body)
			bodyText := string(body)
			if !strings.Contains(bodyText, "<PartNumber>1</PartNumber>") ||
				!strings.Contains(bodyText, "<ChecksumSHA256>"+partTwoChecksum+"</ChecksumSHA256>") {
				t.Errorf("complete body = %s", bodyText)
			}
			if got := r.Header.Get("x-amz-checksum-type"); got != "COMPOSITE" {
				t.Errorf("complete checksum type = %q", got)
			}
			w.Header().Set("Content-Type", "application/xml")
			fmt.Fprint(w, `<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Location>test</Location><Bucket>attachment-test-bucket</Bucket><Key>companies/company-1/attachment</Key><ETag>&quot;complete-etag&quot;</ETag></CompleteMultipartUploadResult>`)
		case r.Method == http.MethodHead:
			calls = append(calls, "head")
			if got := r.Header.Get("x-amz-checksum-mode"); got != "ENABLED" {
				t.Errorf("head checksum mode = %q", got)
			}
			w.Header().Set("Content-Length", "16777258")
			w.Header().Set("x-amz-checksum-sha256", partOneChecksum+"-2")
			w.Header().Set("x-amz-checksum-type", "COMPOSITE")
			w.Header().Set("x-amz-server-side-encryption", "AES256")
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodDelete && query.Get("uploadId") == "sdk-upload-id":
			calls = append(calls, "abort")
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodDelete:
			calls = append(calls, "delete")
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected provider request: %s %s", r.Method, r.URL.String())
			http.Error(w, "unexpected", http.StatusBadRequest)
		}
	}))
	defer server.Close()

	storage := &S3AttachmentStorage{
		Region:      "us-west-1",
		BucketName:  "attachment-test-bucket",
		EndpointURL: server.URL,
		HTTPClient:  server.Client(),
	}
	ctx := context.Background()
	uploadID, err := storage.CreateMultipartUpload(ctx, AttachmentCreateMultipartInput{
		Key:         "companies/company-1/attachment",
		ContentType: "application/octet-stream",
	})
	if err != nil {
		t.Fatalf("CreateMultipartUpload: %v", err)
	}
	if uploadID != "sdk-upload-id" {
		t.Fatalf("upload id = %q", uploadID)
	}
	parts, err := storage.ListMultipartParts(ctx, AttachmentMultipartInput{Key: "companies/company-1/attachment", UploadID: uploadID})
	if err != nil {
		t.Fatalf("ListMultipartParts: %v", err)
	}
	wantParts := []AttachmentS3Part{
		{PartNumber: 1, SizeBytes: 16777216, ETag: `"etag-1"`, ChecksumSHA256: partOneChecksum},
		{PartNumber: 2, SizeBytes: 42, ETag: `"etag-2"`, ChecksumSHA256: partTwoChecksum},
	}
	if !reflect.DeepEqual(parts, wantParts) {
		t.Fatalf("parts = %#v, want %#v", parts, wantParts)
	}
	if err := storage.CompleteMultipartUpload(ctx, AttachmentCompleteMultipartInput{
		Key: "companies/company-1/attachment", UploadID: uploadID, Parts: parts,
	}); err != nil {
		t.Fatalf("CompleteMultipartUpload: %v", err)
	}
	head, err := storage.HeadObject(ctx, AttachmentHeadObjectInput{Key: "companies/company-1/attachment"})
	if err != nil {
		t.Fatalf("HeadObject: %v", err)
	}
	if head.ContentLength != 16777258 || head.ChecksumAlgorithm != "SHA256" ||
		head.ChecksumValue != partOneChecksum+"-2" || head.ChecksumType != "COMPOSITE" || head.ServerSideEncryption != "AES256" {
		t.Fatalf("head = %#v", head)
	}
	if err := storage.AbortMultipartUpload(ctx, AttachmentMultipartInput{Key: "companies/company-1/attachment", UploadID: uploadID}); err != nil {
		t.Fatalf("AbortMultipartUpload: %v", err)
	}
	if err := storage.DeleteObject(ctx, "companies/company-1/attachment"); err != nil {
		t.Fatalf("DeleteObject: %v", err)
	}
	wantCalls := []string{"create", "list:", "list:1", "complete", "head", "abort", "delete"}
	if !reflect.DeepEqual(calls, wantCalls) {
		t.Fatalf("provider calls = %#v, want %#v", calls, wantCalls)
	}
}

func TestS3AttachmentStorageCompleteMultipartSurfacesEmbeddedS3Error(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "attachment-test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "attachment-test-secret-key")
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION", "none")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `<Error><Code>InternalError</Code><Message>retry completion</Message><RequestId>request-id</RequestId></Error>`)
	}))
	defer server.Close()
	checksumBytes := sha256.Sum256([]byte("part"))
	checksum := base64.StdEncoding.EncodeToString(checksumBytes[:])
	storage := &S3AttachmentStorage{Region: "us-west-1", BucketName: "test-bucket", EndpointURL: server.URL, HTTPClient: server.Client()}
	err := storage.CompleteMultipartUpload(context.Background(), AttachmentCompleteMultipartInput{
		Key: "object", UploadID: "upload", Parts: []AttachmentS3Part{{PartNumber: 1, ETag: `"etag"`, ChecksumSHA256: checksum}},
	})
	if err == nil {
		t.Fatal("CompleteMultipartUpload returned nil for HTTP 200 embedded S3 error")
	}
}

func TestS3AttachmentStorageGetObjectStreamsSDKResponse(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "attachment-test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "attachment-test-secret-key")
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/test-bucket/company/object" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("Content-Length", "7")
		fmt.Fprint(w, "payload")
	}))
	defer server.Close()
	storage := &S3AttachmentStorage{Region: "us-west-1", BucketName: "test-bucket", EndpointURL: server.URL, HTTPClient: server.Client()}
	output, err := storage.GetObject(context.Background(), AttachmentGetObjectInput{Key: "company/object"})
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	defer output.Body.Close()
	body, err := io.ReadAll(output.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if output.ContentType != "text/plain" || output.ContentLength != 7 || string(body) != "payload" {
		t.Fatalf("output = %#v body=%q", output, body)
	}
}

func parseAttachmentTestURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse URL %q: %v", raw, err)
	}
	return parsed
}
