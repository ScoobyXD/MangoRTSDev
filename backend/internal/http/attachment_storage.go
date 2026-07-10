package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrAttachmentStorageUnavailable = errors.New("attachment storage unavailable")
	ErrAttachmentObjectNotFound     = errors.New("attachment object not found")
)

type AttachmentObjectStorage interface {
	Bucket() string
	PutObject(ctx context.Context, input AttachmentPutObjectInput) error
	GetObject(ctx context.Context, input AttachmentGetObjectInput) (AttachmentGetObjectOutput, error)
}

type AttachmentPutObjectInput struct {
	Key           string
	ContentType   string
	ContentLength int64
	SHA256        string
	Body          io.ReadSeeker
}

type AttachmentGetObjectInput struct {
	Key string
}

type AttachmentGetObjectOutput struct {
	ContentType   string
	ContentLength int64
	Body          io.ReadCloser
}

type S3AttachmentStorage struct {
	Region      string
	BucketName  string
	EndpointURL string
	AWSProfile  string
	HTTPClient  *http.Client

	mu     sync.Mutex
	cached attachmentAWSCredentials
}

type attachmentAWSCredentials struct {
	AccessKeyID     string
	SecretAccessKey string
	SessionToken    string
	Expiration      time.Time
}

func NewS3AttachmentStorageFromEnv() AttachmentObjectStorage {
	bucket := firstNonBlankEnv("MANGORTS_ATTACHMENT_S3_BUCKET", "MANGORTS_ATTACHMENT_BUCKET", "ATTACHMENT_S3_BUCKET")
	region := firstNonBlankEnv("MANGORTS_ATTACHMENT_AWS_REGION", "MANGORTS_ATTACHMENT_REGION", "AWS_REGION", "AWS_DEFAULT_REGION")
	if bucket == "" || region == "" {
		return nil
	}
	return &S3AttachmentStorage{
		Region:      region,
		BucketName:  bucket,
		EndpointURL: firstNonBlankEnv("MANGORTS_ATTACHMENT_S3_ENDPOINT", "ATTACHMENT_S3_ENDPOINT"),
		AWSProfile:  firstNonBlankEnv("MANGORTS_ATTACHMENT_AWS_PROFILE", "AWS_PROFILE"),
		HTTPClient:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *S3AttachmentStorage) Bucket() string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(s.BucketName)
}

func (s *S3AttachmentStorage) PutObject(ctx context.Context, input AttachmentPutObjectInput) error {
	payloadHash := strings.ToLower(strings.TrimSpace(input.SHA256))
	if s == nil || s.Region == "" || s.BucketName == "" || strings.TrimSpace(input.Key) == "" ||
		input.Body == nil || input.ContentLength < 0 || !validAttachmentSHA256Hex(payloadHash) {
		return ErrAttachmentStorageUnavailable
	}
	if _, err := input.Body.Seek(0, io.SeekStart); err != nil {
		return err
	}
	creds, err := s.credentials(ctx)
	if err != nil {
		return err
	}
	objectURL, err := s.objectURL(input.Key)
	if err != nil {
		return err
	}
	var requestBody io.Reader = input.Body
	if input.ContentLength == 0 {
		requestBody = nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, objectURL, requestBody)
	if err != nil {
		return err
	}
	req.ContentLength = input.ContentLength
	if contentType := strings.TrimSpace(input.ContentType); contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if !strings.EqualFold(strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION")), "none") {
		req.Header.Set("X-Amz-Server-Side-Encryption", getenvDefaultHTTP("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION", "AES256"))
	}
	signAttachmentV4WithPayloadHash(req, payloadHash, creds, s.Region, "s3", time.Now().UTC())
	res, err := s.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
		return fmt.Errorf("s3 put object failed: status=%d", res.StatusCode)
	}
	return nil
}

func (s *S3AttachmentStorage) GetObject(ctx context.Context, input AttachmentGetObjectInput) (AttachmentGetObjectOutput, error) {
	if s == nil || s.Region == "" || s.BucketName == "" || strings.TrimSpace(input.Key) == "" {
		return AttachmentGetObjectOutput{}, ErrAttachmentStorageUnavailable
	}
	creds, err := s.credentials(ctx)
	if err != nil {
		return AttachmentGetObjectOutput{}, err
	}
	objectURL, err := s.objectURL(input.Key)
	if err != nil {
		return AttachmentGetObjectOutput{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, objectURL, nil)
	if err != nil {
		return AttachmentGetObjectOutput{}, err
	}
	req.Header.Set("X-Amz-Content-Sha256", attachmentSHA256Hex(nil))
	signAttachmentV4(req, nil, creds, s.Region, "s3", time.Now().UTC())
	res, err := s.httpClient().Do(req)
	if err != nil {
		return AttachmentGetObjectOutput{}, err
	}
	if res.StatusCode == http.StatusNotFound {
		res.Body.Close()
		return AttachmentGetObjectOutput{}, ErrAttachmentObjectNotFound
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		res.Body.Close()
		return AttachmentGetObjectOutput{}, fmt.Errorf("s3 get object failed: status=%d", res.StatusCode)
	}
	return AttachmentGetObjectOutput{
		ContentType:   res.Header.Get("Content-Type"),
		ContentLength: res.ContentLength,
		Body:          res.Body,
	}, nil
}

func (s *S3AttachmentStorage) httpClient() *http.Client {
	if s.HTTPClient != nil {
		return s.HTTPClient
	}
	return http.DefaultClient
}

func (s *S3AttachmentStorage) objectURL(key string) (string, error) {
	key = strings.TrimLeft(strings.TrimSpace(key), "/")
	if key == "" {
		return "", ErrAttachmentStorageUnavailable
	}
	if endpoint := strings.TrimRight(strings.TrimSpace(s.EndpointURL), "/"); endpoint != "" {
		parsed, err := url.Parse(endpoint)
		if err != nil {
			return "", err
		}
		parsed.Path = strings.TrimRight(parsed.Path, "/") + "/" + s.BucketName + "/" + key
		return parsed.String(), nil
	}
	parsed := url.URL{
		Scheme: "https",
		Host:   s.BucketName + ".s3." + s.Region + ".amazonaws.com",
		Path:   "/" + key,
	}
	return parsed.String(), nil
}

func (s *S3AttachmentStorage) credentials(ctx context.Context) (attachmentAWSCredentials, error) {
	s.mu.Lock()
	if s.cached.AccessKeyID != "" && (s.cached.Expiration.IsZero() || time.Until(s.cached.Expiration) > 5*time.Minute) {
		creds := s.cached
		s.mu.Unlock()
		return creds, nil
	}
	s.mu.Unlock()

	if env := attachmentCredentialsFromEnv(); env.AccessKeyID != "" {
		s.cacheCredentials(env)
		return env, nil
	}
	if cli, err := attachmentCredentialsFromAWSCLI(ctx, s.AWSProfile); err == nil && cli.AccessKeyID != "" {
		s.cacheCredentials(cli)
		return cli, nil
	}
	creds, err := s.credentialsFromContainer(ctx)
	if err != nil {
		return attachmentAWSCredentials{}, err
	}
	s.cacheCredentials(creds)
	return creds, nil
}

func (s *S3AttachmentStorage) cacheCredentials(creds attachmentAWSCredentials) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cached = creds
}

func attachmentCredentialsFromEnv() attachmentAWSCredentials {
	accessKeyID := strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID"))
	secretAccessKey := strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY"))
	if accessKeyID == "" || secretAccessKey == "" {
		return attachmentAWSCredentials{}
	}
	return attachmentAWSCredentials{
		AccessKeyID:     accessKeyID,
		SecretAccessKey: secretAccessKey,
		SessionToken:    strings.TrimSpace(os.Getenv("AWS_SESSION_TOKEN")),
	}
}

func attachmentCredentialsFromAWSCLI(ctx context.Context, profile string) (attachmentAWSCredentials, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	args := []string{"configure", "export-credentials", "--format", "json"}
	if profile = strings.TrimSpace(profile); profile != "" {
		args = append(args, "--profile", profile)
	}
	output, err := exec.CommandContext(timeoutCtx, "aws", args...).Output()
	if err != nil {
		return attachmentAWSCredentials{}, err
	}
	var payload struct {
		AccessKeyID     string    `json:"AccessKeyId"`
		SecretAccessKey string    `json:"SecretAccessKey"`
		SessionToken    string    `json:"SessionToken"`
		Expiration      time.Time `json:"Expiration"`
	}
	if err := json.Unmarshal(output, &payload); err != nil {
		return attachmentAWSCredentials{}, err
	}
	if strings.TrimSpace(payload.AccessKeyID) == "" || strings.TrimSpace(payload.SecretAccessKey) == "" {
		return attachmentAWSCredentials{}, ErrAttachmentStorageUnavailable
	}
	return attachmentAWSCredentials{
		AccessKeyID:     strings.TrimSpace(payload.AccessKeyID),
		SecretAccessKey: strings.TrimSpace(payload.SecretAccessKey),
		SessionToken:    strings.TrimSpace(payload.SessionToken),
		Expiration:      payload.Expiration,
	}, nil
}

func (s *S3AttachmentStorage) credentialsFromContainer(ctx context.Context) (attachmentAWSCredentials, error) {
	uri := strings.TrimSpace(os.Getenv("AWS_CONTAINER_CREDENTIALS_FULL_URI"))
	if uri == "" {
		relative := strings.TrimSpace(os.Getenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"))
		if relative != "" {
			uri = "http://169.254.170.2" + relative
		}
	}
	if uri == "" {
		return attachmentAWSCredentials{}, ErrAttachmentStorageUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, uri, nil)
	if err != nil {
		return attachmentAWSCredentials{}, err
	}
	if token := strings.TrimSpace(os.Getenv("AWS_CONTAINER_AUTHORIZATION_TOKEN")); token != "" {
		req.Header.Set("Authorization", token)
	}
	res, err := s.httpClient().Do(req)
	if err != nil {
		return attachmentAWSCredentials{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return attachmentAWSCredentials{}, ErrAttachmentStorageUnavailable
	}
	var payload struct {
		AccessKeyID     string    `json:"AccessKeyId"`
		SecretAccessKey string    `json:"SecretAccessKey"`
		Token           string    `json:"Token"`
		Expiration      time.Time `json:"Expiration"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		return attachmentAWSCredentials{}, err
	}
	if payload.AccessKeyID == "" || payload.SecretAccessKey == "" {
		return attachmentAWSCredentials{}, ErrAttachmentStorageUnavailable
	}
	return attachmentAWSCredentials{
		AccessKeyID:     payload.AccessKeyID,
		SecretAccessKey: payload.SecretAccessKey,
		SessionToken:    payload.Token,
		Expiration:      payload.Expiration,
	}, nil
}

func signAttachmentV4(req *http.Request, body []byte, creds attachmentAWSCredentials, region, service string, now time.Time) {
	signAttachmentV4WithPayloadHash(req, attachmentSHA256Hex(body), creds, region, service, now)
}

func signAttachmentV4WithPayloadHash(req *http.Request, payloadHash string, creds attachmentAWSCredentials, region, service string, now time.Time) {
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	if creds.SessionToken != "" {
		req.Header.Set("X-Amz-Security-Token", creds.SessionToken)
	}

	type signedHeader struct {
		name  string
		value string
	}
	headers := []signedHeader{{name: "host", value: req.URL.Host}}
	for name, values := range req.Header {
		if strings.EqualFold(name, "Authorization") {
			continue
		}
		cleanName := strings.ToLower(strings.TrimSpace(name))
		if cleanName == "" || len(values) == 0 {
			continue
		}
		cleanValues := make([]string, 0, len(values))
		for _, value := range values {
			cleanValues = append(cleanValues, strings.Join(strings.Fields(value), " "))
		}
		headers = append(headers, signedHeader{name: cleanName, value: strings.Join(cleanValues, ",")})
	}
	sort.Slice(headers, func(i, j int) bool {
		return headers[i].name < headers[j].name
	})
	var canonicalHeaders strings.Builder
	signedHeaderNames := make([]string, 0, len(headers))
	for _, header := range headers {
		canonicalHeaders.WriteString(header.name)
		canonicalHeaders.WriteByte(':')
		canonicalHeaders.WriteString(header.value)
		canonicalHeaders.WriteByte('\n')
		signedHeaderNames = append(signedHeaderNames, header.name)
	}
	signedHeaders := strings.Join(signedHeaderNames, ";")
	canonicalURI := req.URL.EscapedPath()
	if canonicalURI == "" {
		canonicalURI = "/"
	}
	canonicalRequest := strings.Join([]string{
		req.Method,
		canonicalURI,
		attachmentCanonicalQueryString(req.URL.Query()),
		canonicalHeaders.String(),
		signedHeaders,
		payloadHash,
	}, "\n")
	scope := dateStamp + "/" + region + "/" + service + "/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		attachmentSHA256Hex([]byte(canonicalRequest)),
	}, "\n")
	signature := hex.EncodeToString(attachmentHMACSHA256(attachmentSigningKey(creds.SecretAccessKey, dateStamp, region, service), []byte(stringToSign)))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+creds.AccessKeyID+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
}

func validAttachmentSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func attachmentCanonicalQueryString(values url.Values) string {
	if len(values) == 0 {
		return ""
	}
	parts := make([]string, 0)
	for key, items := range values {
		encodedKey := attachmentAWSQueryEscape(key)
		if len(items) == 0 {
			parts = append(parts, encodedKey+"=")
			continue
		}
		for _, value := range items {
			parts = append(parts, encodedKey+"="+attachmentAWSQueryEscape(value))
		}
	}
	sort.Strings(parts)
	return strings.Join(parts, "&")
}

func attachmentAWSQueryEscape(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

func attachmentSHA256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func attachmentSigningKey(secret, dateStamp, region, service string) []byte {
	kDate := attachmentHMACSHA256([]byte("AWS4"+secret), []byte(dateStamp))
	kRegion := attachmentHMACSHA256(kDate, []byte(region))
	kService := attachmentHMACSHA256(kRegion, []byte(service))
	return attachmentHMACSHA256(kService, []byte("aws4_request"))
}

func attachmentHMACSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

func escapeS3Key(key string) string {
	parts := strings.Split(strings.TrimLeft(key, "/"), "/")
	for i, part := range parts {
		parts[i] = escapeS3PathSegment(part)
	}
	return strings.Join(parts, "/")
}

func escapeS3PathSegment(value string) string {
	return strings.ReplaceAll(url.PathEscape(value), "+", "%20")
}

func firstNonBlankEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func getenvDefaultHTTP(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
