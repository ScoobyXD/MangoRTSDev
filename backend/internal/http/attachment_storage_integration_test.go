package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// TestAttachmentS3DevFixtureEndToEnd is intentionally excluded from normal
// test runs. It writes only to a specifically acknowledged development fixture
// and runs the repository's agent-access safety check before making any AWS or
// S3-compatible request.
//
// Required opt-in environment:
//
//   MANGORTS_RUN_ATTACHMENT_S3_INTEGRATION=1
//   MANGORTS_ATTACHMENT_S3_INTEGRATION_SAFE_FIXTURE_ACK=dev-only
//   MANGORTS_ATTACHMENT_S3_INTEGRATION_BUCKET=<private dev fixture bucket>
//   MANGORTS_ATTACHMENT_S3_INTEGRATION_REGION=<fixture region>
//   MANGORTS_ATTACHMENT_S3_INTEGRATION_PROFILE=<non-prod AWS SSO profile>
//   MANGORTS_ATTACHMENT_S3_INTEGRATION_PREFIX=agent-fixtures/<isolated prefix>
//   MANGORTS_ATTACHMENT_S3_INTEGRATION_ORIGIN=<allowed local/dev app origin>
//
// Custom S3 fixtures may also set the backend and browser endpoints. An agent
// must never opt in until Jonat has confirmed the bucket/prefix is disposable.
func TestAttachmentS3DevFixtureEndToEnd(t *testing.T) {
	if os.Getenv("MANGORTS_RUN_ATTACHMENT_S3_INTEGRATION") != "1" {
		t.Skip("set MANGORTS_RUN_ATTACHMENT_S3_INTEGRATION=1 only for the explicitly approved dev fixture")
	}
	if os.Getenv("MANGORTS_ATTACHMENT_S3_INTEGRATION_SAFE_FIXTURE_ACK") != "dev-only" {
		t.Fatal("refusing S3 integration writes without MANGORTS_ATTACHMENT_S3_INTEGRATION_SAFE_FIXTURE_ACK=dev-only")
	}

	bucket := strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_INTEGRATION_BUCKET"))
	region := strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_INTEGRATION_REGION"))
	profile := strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_INTEGRATION_PROFILE"))
	prefix := strings.Trim(strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_INTEGRATION_PREFIX")), "/")
	origin := strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_INTEGRATION_ORIGIN"))
	if bucket == "" || region == "" || profile == "" || prefix == "" || origin == "" {
		t.Fatal("S3 integration fixture requires bucket, region, non-prod SSO profile, isolated prefix, and allowed origin")
	}
	if strings.Contains(strings.ToLower(profile), "prod") {
		t.Fatalf("refusing production-like AWS profile %q", profile)
	}
	if !strings.HasPrefix(prefix, "agent-fixtures/") {
		t.Fatalf("fixture prefix %q must be beneath agent-fixtures/", prefix)
	}
	runAttachmentAgentBoundaryCheck(t)

	storage := &S3AttachmentStorage{
		Region:             region,
		BucketName:         bucket,
		EndpointURL:        strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_INTEGRATION_ENDPOINT")),
		PresignEndpointURL: strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_INTEGRATION_PRESIGN_ENDPOINT")),
		AWSProfile:         profile,
		HTTPClient:         &http.Client{Timeout: 60 * time.Second},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	unique := fmt.Sprintf("%d-%d", time.Now().UTC().UnixNano(), os.Getpid())
	singleKey := prefix + "/" + unique + "/single"
	multipartKey := prefix + "/" + unique + "/multipart"
	abortKey := prefix + "/" + unique + "/abort"

	defer func() {
		if err := storage.DeleteObject(context.Background(), singleKey); err != nil {
			t.Errorf("single cleanup: %v", err)
		}
		if err := storage.DeleteObject(context.Background(), multipartKey); err != nil {
			t.Errorf("multipart cleanup: %v", err)
		}
	}()

	singlePayload := []byte("MangoRTS browser-to-S3 integration fixture\n")
	singleChecksum := attachmentIntegrationChecksum(singlePayload)
	singleRequest, err := storage.PresignPutObject(ctx, AttachmentPresignPutInput{
		Key: singleKey, ContentType: "text/plain", ChecksumSHA256: singleChecksum, Expires: 10 * time.Minute,
	})
	if err != nil {
		t.Fatalf("presign single PUT: %v", err)
	}
	verifyAttachmentIntegrationCORSPreflight(t, ctx, singleRequest, origin)
	putAttachmentIntegrationPart(t, ctx, singleRequest, origin, singlePayload)
	singleHead, err := storage.HeadObject(ctx, AttachmentHeadObjectInput{Key: singleKey})
	if err != nil {
		t.Fatalf("HEAD single object: %v", err)
	}
	if singleHead.ContentLength != int64(len(singlePayload)) || singleHead.ChecksumAlgorithm != "SHA256" || singleHead.ChecksumValue != singleChecksum {
		t.Fatalf("single HEAD verification = %#v", singleHead)
	}
	if wantSSE := attachmentSSEValue(); wantSSE != "" && singleHead.ServerSideEncryption != wantSSE {
		t.Fatalf("single HEAD encryption = %q, want %q", singleHead.ServerSideEncryption, wantSSE)
	}

	firstPart := bytes.Repeat([]byte("m"), 5*1024*1024)
	secondPart := []byte("multipart tail")
	partPayloads := [][]byte{firstPart, secondPart}
	multipartID, err := storage.CreateMultipartUpload(ctx, AttachmentCreateMultipartInput{Key: multipartKey, ContentType: "application/octet-stream"})
	if err != nil {
		t.Fatalf("create multipart upload: %v", err)
	}
	multipartCompleted := false
	defer func() {
		if !multipartCompleted {
			if err := storage.AbortMultipartUpload(context.Background(), AttachmentMultipartInput{Key: multipartKey, UploadID: multipartID}); err != nil {
				t.Errorf("multipart abort cleanup: %v", err)
			}
		}
	}()
	for index, payload := range partPayloads {
		partRequest, signErr := storage.PresignUploadPart(ctx, AttachmentPresignPartInput{
			Key: multipartKey, UploadID: multipartID, PartNumber: index + 1,
			ChecksumSHA256: attachmentIntegrationChecksum(payload), Expires: 10 * time.Minute,
		})
		if signErr != nil {
			t.Fatalf("presign multipart part %d: %v", index+1, signErr)
		}
		putAttachmentIntegrationPart(t, ctx, partRequest, origin, payload)
	}
	parts, err := storage.ListMultipartParts(ctx, AttachmentMultipartInput{Key: multipartKey, UploadID: multipartID})
	if err != nil {
		t.Fatalf("list multipart parts: %v", err)
	}
	if len(parts) != len(partPayloads) || parts[0].ETag == "" || parts[1].ETag == "" {
		t.Fatalf("authoritative multipart parts = %#v", parts)
	}
	if err := storage.CompleteMultipartUpload(ctx, AttachmentCompleteMultipartInput{Key: multipartKey, UploadID: multipartID, Parts: parts}); err != nil {
		t.Fatalf("complete multipart upload: %v", err)
	}
	multipartCompleted = true
	multipartHead, err := storage.HeadObject(ctx, AttachmentHeadObjectInput{Key: multipartKey})
	if err != nil {
		t.Fatalf("HEAD multipart object: %v", err)
	}
	wantMultipartChecksum := attachmentIntegrationCompositeChecksum(partPayloads)
	if multipartHead.ContentLength != int64(len(firstPart)+len(secondPart)) || multipartHead.ChecksumType != "COMPOSITE" || multipartHead.ChecksumValue != wantMultipartChecksum {
		t.Fatalf("multipart HEAD verification = %#v", multipartHead)
	}

	abortID, err := storage.CreateMultipartUpload(ctx, AttachmentCreateMultipartInput{Key: abortKey, ContentType: "application/octet-stream"})
	if err != nil {
		t.Fatalf("create abort fixture: %v", err)
	}
	if err := storage.AbortMultipartUpload(ctx, AttachmentMultipartInput{Key: abortKey, UploadID: abortID}); err != nil {
		t.Fatalf("abort multipart fixture: %v", err)
	}
	if parts, err := storage.ListMultipartParts(ctx, AttachmentMultipartInput{Key: abortKey, UploadID: abortID}); err == nil || len(parts) != 0 {
		t.Fatalf("aborted multipart upload remained listable: parts=%#v err=%v", parts, err)
	}
}

func runAttachmentAgentBoundaryCheck(t *testing.T) {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate database/AWS agent-access safety check")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", ".."))
	check := filepath.Join(root, "scripts", "verify_agent_db_access_boundary.py")
	command := exec.Command("python", check)
	command.Dir = root
	if err := command.Run(); err != nil {
		t.Fatalf("agent-access safety check failed before S3 integration request: %v; stop and switch to a physically read-only agent profile/session", err)
	}
}

func verifyAttachmentIntegrationCORSPreflight(t *testing.T, ctx context.Context, request AttachmentPresignedRequest, origin string) {
	t.Helper()
	preflight, err := http.NewRequestWithContext(ctx, http.MethodOptions, request.URL, nil)
	if err != nil {
		t.Fatalf("create CORS preflight: %v", err)
	}
	preflight.Header.Set("Origin", origin)
	preflight.Header.Set("Access-Control-Request-Method", http.MethodPut)
	headerNames := make([]string, 0, len(request.RequiredHeaders))
	for name := range request.RequiredHeaders {
		headerNames = append(headerNames, strings.ToLower(name))
	}
	preflight.Header.Set("Access-Control-Request-Headers", strings.Join(headerNames, ","))
	response, err := http.DefaultClient.Do(preflight)
	if err != nil {
		t.Fatalf("CORS preflight: %v", err)
	}
	defer response.Body.Close()
	io.Copy(io.Discard, response.Body)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		t.Fatalf("CORS preflight status = %d", response.StatusCode)
	}
	if response.Header.Get("Access-Control-Allow-Origin") != origin || !strings.Contains(response.Header.Get("Access-Control-Allow-Methods"), http.MethodPut) {
		t.Fatalf("CORS preflight headers = %#v", response.Header)
	}
	allowedHeaders := strings.ToLower(response.Header.Get("Access-Control-Allow-Headers"))
	for _, name := range headerNames {
		if !strings.Contains(allowedHeaders, name) {
			t.Fatalf("CORS preflight did not allow signed header %q: %q", name, allowedHeaders)
		}
	}
}

func putAttachmentIntegrationPart(t *testing.T, ctx context.Context, request AttachmentPresignedRequest, origin string, payload []byte) {
	t.Helper()
	put, err := http.NewRequestWithContext(ctx, request.Method, request.URL, bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("create browser PUT: %v", err)
	}
	put.Header.Set("Origin", origin)
	for name, value := range request.RequiredHeaders {
		put.Header.Set(name, value)
	}
	response, err := http.DefaultClient.Do(put)
	if err != nil {
		t.Fatalf("browser PUT: %v", err)
	}
	defer response.Body.Close()
	io.Copy(io.Discard, response.Body)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		t.Fatalf("browser PUT status = %d", response.StatusCode)
	}
	exposed := strings.ToLower(response.Header.Get("Access-Control-Expose-Headers"))
	if !strings.Contains(exposed, "etag") || !strings.Contains(exposed, "x-amz-checksum-sha256") {
		t.Fatalf("browser PUT does not expose ETag/checksum headers: %q", exposed)
	}
	if response.Header.Get("ETag") == "" {
		t.Fatal("browser PUT response omitted ETag")
	}
}

func attachmentIntegrationChecksum(payload []byte) string {
	sum := sha256.Sum256(payload)
	return base64.StdEncoding.EncodeToString(sum[:])
}

func attachmentIntegrationCompositeChecksum(parts [][]byte) string {
	combined := sha256.New()
	for _, part := range parts {
		partSum := sha256.Sum256(part)
		combined.Write(partSum[:])
	}
	return base64.StdEncoding.EncodeToString(combined.Sum(nil)) + fmt.Sprintf("-%d", len(parts))
}
