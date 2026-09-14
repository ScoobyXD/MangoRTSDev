package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsv4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go/middleware"
	smithyhttp "github.com/aws/smithy-go/transport/http"
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

// Desktop Office cannot send Mango's bearer header. Authorize the file in the
// job handler before issuing a short-lived, GET-only link for the native app.
type AttachmentDownloadStorage interface {
	AttachmentObjectStorage
	PresignGetObject(context.Context, AttachmentPresignGetInput) (AttachmentPresignedRequest, error)
}

type AttachmentPresignGetInput struct {
	Key         string
	Filename    string
	ContentType string
}

func (s *S3AttachmentStorage) PresignGetObject(ctx context.Context, input AttachmentPresignGetInput) (AttachmentPresignedRequest, error) {
	if !s.validObjectInput(input.Key) {
		return AttachmentPresignedRequest{}, ErrAttachmentStorageUnavailable
	}
	_, presigner, err := s.clients(ctx)
	if err != nil {
		return AttachmentPresignedRequest{}, err
	}
	const expires = 5 * time.Minute
	now := time.Now().UTC()
	request, err := presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.Bucket()), Key: aws.String(input.Key),
		ResponseContentType:        aws.String(input.ContentType),
		ResponseContentDisposition: aws.String(mime.FormatMediaType("inline", map[string]string{"filename": input.Filename})),
		ResponseCacheControl:       aws.String("private, no-store"),
	}, s3.WithPresignExpires(expires), s3.WithPresignClientFromClientOptions(func(options *s3.Options) {
		// Excel can send only the URL. Do not require the SDK's optional
		// x-amz-checksum-mode header when signing this native download.
		options.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	}))
	if err != nil {
		return AttachmentPresignedRequest{}, err
	}
	return AttachmentPresignedRequest{Method: request.Method, URL: request.URL, ExpiresAt: now.Add(expires)}, nil
}

// AttachmentDirectUploadStorage is the S3 control plane used by browser
// uploads. It is separate from AttachmentObjectStorage so server-side email,
// import, migration, and job streaming remain available without exposing a
// second browser byte path.
type AttachmentDirectUploadStorage interface {
	AttachmentObjectStorage
	PresignPutObject(ctx context.Context, input AttachmentPresignPutInput) (AttachmentPresignedRequest, error)
	CreateMultipartUpload(ctx context.Context, input AttachmentCreateMultipartInput) (string, error)
	PresignUploadPart(ctx context.Context, input AttachmentPresignPartInput) (AttachmentPresignedRequest, error)
	ListMultipartParts(ctx context.Context, input AttachmentMultipartInput) ([]AttachmentS3Part, error)
	CompleteMultipartUpload(ctx context.Context, input AttachmentCompleteMultipartInput) error
	AbortMultipartUpload(ctx context.Context, input AttachmentMultipartInput) error
	HeadObject(ctx context.Context, input AttachmentHeadObjectInput) (AttachmentHeadObjectOutput, error)
	DeleteObject(ctx context.Context, key string) error
}

type AttachmentPresignPutInput struct {
	Key            string
	ContentType    string
	ChecksumSHA256 string
	Expires        time.Duration
}

type AttachmentCreateMultipartInput struct {
	Key         string
	ContentType string
}

type AttachmentPresignPartInput struct {
	Key            string
	UploadID       string
	PartNumber     int
	ChecksumSHA256 string
	Expires        time.Duration
}

type AttachmentMultipartInput struct {
	Key      string
	UploadID string
}

type AttachmentCompleteMultipartInput struct {
	Key      string
	UploadID string
	Parts    []AttachmentS3Part
}

type AttachmentS3Part struct {
	PartNumber     int
	SizeBytes      int64
	ETag           string
	ChecksumSHA256 string
}

type AttachmentHeadObjectInput struct {
	Key string
}

type AttachmentHeadObjectOutput struct {
	ContentLength        int64
	ChecksumAlgorithm    string
	ChecksumValue        string
	ChecksumType         string
	ServerSideEncryption string
}

type AttachmentPresignedRequest struct {
	Method          string            `json:"method"`
	URL             string            `json:"url"`
	RequiredHeaders map[string]string `json:"requiredHeaders"`
	ExpiresAt       time.Time         `json:"expiresAt"`
}

type AttachmentPutObjectInput struct {
	Key           string
	ContentType   string
	ContentLength int64
	SHA256        string
	Body          io.Reader
}

type AttachmentGetObjectInput struct {
	Key string
}

type AttachmentGetObjectOutput struct {
	ContentType   string
	ContentLength int64
	Body          io.ReadCloser
}

// S3AttachmentStorage uses the AWS SDK's default credential chain. That chain
// supports environment credentials, shared config/SSO, ECS task roles, EC2
// instance roles, and the other standard SDK providers without this package
// retrieving or persisting credentials itself.
type S3AttachmentStorage struct {
	Region             string
	BucketName         string
	EndpointURL        string
	PresignEndpointURL string
	AWSProfile         string
	HTTPClient         *http.Client

	clientMu      sync.Mutex
	controlClient *s3.Client
	presignClient *s3.PresignClient
}

var _ AttachmentDirectUploadStorage = (*S3AttachmentStorage)(nil)

func NewS3AttachmentStorageFromEnv() AttachmentObjectStorage {
	bucket := firstNonBlankEnv("MANGORTS_ATTACHMENT_S3_BUCKET", "MANGORTS_ATTACHMENT_BUCKET", "ATTACHMENT_S3_BUCKET")
	region := firstNonBlankEnv("MANGORTS_ATTACHMENT_AWS_REGION", "MANGORTS_ATTACHMENT_REGION", "AWS_REGION", "AWS_DEFAULT_REGION")
	if bucket == "" || region == "" {
		return nil
	}
	return &S3AttachmentStorage{
		Region:             region,
		BucketName:         bucket,
		EndpointURL:        firstNonBlankEnv("MANGORTS_ATTACHMENT_S3_ENDPOINT", "ATTACHMENT_S3_ENDPOINT"),
		PresignEndpointURL: firstNonBlankEnv("MANGORTS_ATTACHMENT_S3_PRESIGN_ENDPOINT"),
		AWSProfile:         firstNonBlankEnv("MANGORTS_ATTACHMENT_AWS_PROFILE", "AWS_PROFILE"),
		HTTPClient:         &http.Client{Timeout: 30 * time.Second},
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
	if !s.validObjectInput(input.Key) || input.Body == nil || input.ContentLength < 0 || !validAttachmentSHA256Hex(payloadHash) {
		return ErrAttachmentStorageUnavailable
	}
	client, _, err := s.clients(ctx)
	if err != nil {
		return err
	}
	rawChecksum, _ := hex.DecodeString(payloadHash)
	request := &s3.PutObjectInput{
		Bucket:         aws.String(s.Bucket()),
		Key:            aws.String(strings.TrimLeft(strings.TrimSpace(input.Key), "/")),
		Body:           input.Body,
		ContentLength:  aws.Int64(input.ContentLength),
		ChecksumSHA256: aws.String(base64.StdEncoding.EncodeToString(rawChecksum)),
	}
	if contentType := strings.TrimSpace(input.ContentType); contentType != "" {
		request.ContentType = aws.String(contentType)
	}
	applyAttachmentSSEPut(request)
	_, seekable := input.Body.(io.ReadSeeker)
	_, err = client.PutObject(ctx, request, func(options *s3.Options) {
		options.APIOptions = append(options.APIOptions, func(stack *middleware.Stack) error {
			return stack.Initialize.Add(attachmentPayloadHashMiddleware{hash: payloadHash}, middleware.Before)
		})
		// A non-seekable producer cannot be replayed safely after a partial send.
		// Keep the operation streaming and make retry ownership explicit to the
		// caller instead of risking a truncated retry.
		if !seekable {
			options.Retryer = aws.NopRetryer{}
		}
	})
	return err
}

func (s *S3AttachmentStorage) GetObject(ctx context.Context, input AttachmentGetObjectInput) (AttachmentGetObjectOutput, error) {
	if !s.validObjectInput(input.Key) {
		return AttachmentGetObjectOutput{}, ErrAttachmentStorageUnavailable
	}
	client, _, err := s.clients(ctx)
	if err != nil {
		return AttachmentGetObjectOutput{}, err
	}
	output, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.Bucket()),
		Key:    aws.String(strings.TrimLeft(strings.TrimSpace(input.Key), "/")),
	})
	if err != nil {
		if attachmentS3NotFound(err) {
			return AttachmentGetObjectOutput{}, ErrAttachmentObjectNotFound
		}
		return AttachmentGetObjectOutput{}, err
	}
	return AttachmentGetObjectOutput{
		ContentType:   aws.ToString(output.ContentType),
		ContentLength: aws.ToInt64(output.ContentLength),
		Body:          output.Body,
	}, nil
}

func (s *S3AttachmentStorage) PresignPutObject(ctx context.Context, input AttachmentPresignPutInput) (AttachmentPresignedRequest, error) {
	if !s.validObjectInput(input.Key) || !validAttachmentChecksumBase64(input.ChecksumSHA256) {
		return AttachmentPresignedRequest{}, ErrAttachmentStorageUnavailable
	}
	_, presigner, err := s.clients(ctx)
	if err != nil {
		return AttachmentPresignedRequest{}, err
	}
	contentType := strings.TrimSpace(input.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	request := &s3.PutObjectInput{
		Bucket:         aws.String(s.Bucket()),
		Key:            aws.String(strings.TrimLeft(strings.TrimSpace(input.Key), "/")),
		ContentType:    aws.String(contentType),
		ChecksumSHA256: aws.String(strings.TrimSpace(input.ChecksumSHA256)),
	}
	applyAttachmentSSEPut(request)
	expires := normalizePresignDuration(input.Expires, time.Hour)
	if expires > time.Hour {
		expires = time.Hour
	}
	now := time.Now().UTC()
	presigned, err := presigner.PresignPutObject(
		ctx,
		request,
		s3.WithPresignExpires(expires),
		s3.WithPresignClientFromClientOptions(func(options *s3.Options) {
			options.APIOptions = append(options.APIOptions, func(stack *middleware.Stack) error {
				// The generated presign stack removes Content-Type when there is no
				// local request body. A control-plane presign intentionally has no
				// body, so restore the declared media type after that middleware and
				// let the SDK include it in the real SigV4 signed-header set.
				return stack.Build.Add(attachmentPresignContentTypeMiddleware{contentType: contentType}, middleware.After)
			})
		}),
	)
	if err != nil {
		return AttachmentPresignedRequest{}, err
	}
	headers, err := attachmentPresignedHeaders(presigned.SignedHeader, map[string]string{
		"content-type":                 contentType,
		"x-amz-checksum-sha256":        strings.TrimSpace(input.ChecksumSHA256),
		"x-amz-server-side-encryption": attachmentSSEValue(),
	})
	if err != nil {
		return AttachmentPresignedRequest{}, err
	}
	return AttachmentPresignedRequest{
		Method:          presigned.Method,
		URL:             presigned.URL,
		RequiredHeaders: headers,
		ExpiresAt:       now.Add(expires),
	}, nil
}

func (s *S3AttachmentStorage) CreateMultipartUpload(ctx context.Context, input AttachmentCreateMultipartInput) (string, error) {
	if !s.validObjectInput(input.Key) {
		return "", ErrAttachmentStorageUnavailable
	}
	client, _, err := s.clients(ctx)
	if err != nil {
		return "", err
	}
	contentType := strings.TrimSpace(input.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	request := &s3.CreateMultipartUploadInput{
		Bucket:            aws.String(s.Bucket()),
		Key:               aws.String(strings.TrimLeft(strings.TrimSpace(input.Key), "/")),
		ContentType:       aws.String(contentType),
		ChecksumAlgorithm: s3types.ChecksumAlgorithmSha256,
		ChecksumType:      s3types.ChecksumTypeComposite,
	}
	applyAttachmentSSECreateMultipart(request)
	output, err := client.CreateMultipartUpload(ctx, request)
	if err != nil {
		return "", err
	}
	uploadID := strings.TrimSpace(aws.ToString(output.UploadId))
	if uploadID == "" {
		return "", ErrAttachmentStorageUnavailable
	}
	return uploadID, nil
}

func (s *S3AttachmentStorage) PresignUploadPart(ctx context.Context, input AttachmentPresignPartInput) (AttachmentPresignedRequest, error) {
	if !s.validObjectInput(input.Key) || strings.TrimSpace(input.UploadID) == "" || input.PartNumber < 1 ||
		!validAttachmentChecksumBase64(input.ChecksumSHA256) {
		return AttachmentPresignedRequest{}, ErrAttachmentStorageUnavailable
	}
	_, presigner, err := s.clients(ctx)
	if err != nil {
		return AttachmentPresignedRequest{}, err
	}
	request := &s3.UploadPartInput{
		Bucket:         aws.String(s.Bucket()),
		Key:            aws.String(strings.TrimLeft(strings.TrimSpace(input.Key), "/")),
		UploadId:       aws.String(strings.TrimSpace(input.UploadID)),
		PartNumber:     aws.Int32(int32(input.PartNumber)),
		ChecksumSHA256: aws.String(strings.TrimSpace(input.ChecksumSHA256)),
	}
	expires := normalizePresignDuration(input.Expires, 15*time.Minute)
	if expires > 15*time.Minute {
		expires = 15 * time.Minute
	}
	now := time.Now().UTC()
	presigned, err := presigner.PresignUploadPart(ctx, request, s3.WithPresignExpires(expires))
	if err != nil {
		return AttachmentPresignedRequest{}, err
	}
	headers, err := attachmentPresignedHeaders(presigned.SignedHeader, map[string]string{
		"x-amz-checksum-sha256": strings.TrimSpace(input.ChecksumSHA256),
	})
	if err != nil {
		return AttachmentPresignedRequest{}, err
	}
	return AttachmentPresignedRequest{
		Method:          presigned.Method,
		URL:             presigned.URL,
		RequiredHeaders: headers,
		ExpiresAt:       now.Add(expires),
	}, nil
}

func (s *S3AttachmentStorage) ListMultipartParts(ctx context.Context, input AttachmentMultipartInput) ([]AttachmentS3Part, error) {
	if !s.validObjectInput(input.Key) || strings.TrimSpace(input.UploadID) == "" {
		return nil, ErrAttachmentStorageUnavailable
	}
	client, _, err := s.clients(ctx)
	if err != nil {
		return nil, err
	}
	paginator := s3.NewListPartsPaginator(client, &s3.ListPartsInput{
		Bucket:   aws.String(s.Bucket()),
		Key:      aws.String(strings.TrimLeft(strings.TrimSpace(input.Key), "/")),
		UploadId: aws.String(strings.TrimSpace(input.UploadID)),
	})
	parts := make([]AttachmentS3Part, 0)
	for paginator.HasMorePages() {
		page, pageErr := paginator.NextPage(ctx)
		if pageErr != nil {
			if attachmentS3NotFound(pageErr) {
				return nil, ErrAttachmentObjectNotFound
			}
			return nil, pageErr
		}
		for _, part := range page.Parts {
			parts = append(parts, AttachmentS3Part{
				PartNumber:     int(aws.ToInt32(part.PartNumber)),
				SizeBytes:      aws.ToInt64(part.Size),
				ETag:           strings.TrimSpace(aws.ToString(part.ETag)),
				ChecksumSHA256: strings.TrimSpace(aws.ToString(part.ChecksumSHA256)),
			})
			if len(parts) > attachmentMaxMultipartParts {
				return nil, ErrAttachmentStorageUnavailable
			}
		}
	}
	sort.Slice(parts, func(i, j int) bool { return parts[i].PartNumber < parts[j].PartNumber })
	return parts, nil
}

func (s *S3AttachmentStorage) CompleteMultipartUpload(ctx context.Context, input AttachmentCompleteMultipartInput) error {
	if !s.validObjectInput(input.Key) || strings.TrimSpace(input.UploadID) == "" || len(input.Parts) == 0 {
		return ErrAttachmentStorageUnavailable
	}
	client, _, err := s.clients(ctx)
	if err != nil {
		return err
	}
	parts := append([]AttachmentS3Part(nil), input.Parts...)
	sort.Slice(parts, func(i, j int) bool { return parts[i].PartNumber < parts[j].PartNumber })
	completed := make([]s3types.CompletedPart, 0, len(parts))
	for _, part := range parts {
		etag := strings.TrimSpace(part.ETag)
		if part.PartNumber < 1 || etag == "" || !validAttachmentChecksumBase64(part.ChecksumSHA256) {
			return ErrAttachmentStorageUnavailable
		}
		if !strings.HasPrefix(etag, "\"") {
			etag = "\"" + etag + "\""
		}
		completed = append(completed, s3types.CompletedPart{
			PartNumber:     aws.Int32(int32(part.PartNumber)),
			ETag:           aws.String(etag),
			ChecksumSHA256: aws.String(strings.TrimSpace(part.ChecksumSHA256)),
		})
	}
	_, err = client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:       aws.String(s.Bucket()),
		Key:          aws.String(strings.TrimLeft(strings.TrimSpace(input.Key), "/")),
		UploadId:     aws.String(strings.TrimSpace(input.UploadID)),
		ChecksumType: s3types.ChecksumTypeComposite,
		MultipartUpload: &s3types.CompletedMultipartUpload{
			Parts: completed,
		},
	})
	return err
}

func (s *S3AttachmentStorage) AbortMultipartUpload(ctx context.Context, input AttachmentMultipartInput) error {
	if !s.validObjectInput(input.Key) || strings.TrimSpace(input.UploadID) == "" {
		return ErrAttachmentStorageUnavailable
	}
	client, _, err := s.clients(ctx)
	if err != nil {
		return err
	}
	_, err = client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
		Bucket:   aws.String(s.Bucket()),
		Key:      aws.String(strings.TrimLeft(strings.TrimSpace(input.Key), "/")),
		UploadId: aws.String(strings.TrimSpace(input.UploadID)),
	})
	if attachmentS3NotFound(err) {
		return nil
	}
	return err
}

func (s *S3AttachmentStorage) HeadObject(ctx context.Context, input AttachmentHeadObjectInput) (AttachmentHeadObjectOutput, error) {
	if !s.validObjectInput(input.Key) {
		return AttachmentHeadObjectOutput{}, ErrAttachmentStorageUnavailable
	}
	client, _, err := s.clients(ctx)
	if err != nil {
		return AttachmentHeadObjectOutput{}, err
	}
	output, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket:       aws.String(s.Bucket()),
		Key:          aws.String(strings.TrimLeft(strings.TrimSpace(input.Key), "/")),
		ChecksumMode: s3types.ChecksumModeEnabled,
	})
	if err != nil {
		if attachmentS3NotFound(err) {
			return AttachmentHeadObjectOutput{}, ErrAttachmentObjectNotFound
		}
		return AttachmentHeadObjectOutput{}, err
	}
	if output.ContentLength == nil || aws.ToInt64(output.ContentLength) < 0 {
		return AttachmentHeadObjectOutput{}, ErrAttachmentStorageUnavailable
	}
	checksum := strings.TrimSpace(aws.ToString(output.ChecksumSHA256))
	algorithm := ""
	if checksum != "" {
		algorithm = "SHA256"
	}
	return AttachmentHeadObjectOutput{
		ContentLength:        aws.ToInt64(output.ContentLength),
		ChecksumAlgorithm:    algorithm,
		ChecksumValue:        checksum,
		ChecksumType:         string(output.ChecksumType),
		ServerSideEncryption: string(output.ServerSideEncryption),
	}, nil
}

func (s *S3AttachmentStorage) DeleteObject(ctx context.Context, key string) error {
	if !s.validObjectInput(key) {
		return ErrAttachmentStorageUnavailable
	}
	client, _, err := s.clients(ctx)
	if err != nil {
		return err
	}
	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.Bucket()),
		Key:    aws.String(strings.TrimLeft(strings.TrimSpace(key), "/")),
	})
	if attachmentS3NotFound(err) {
		return nil
	}
	return err
}

func (s *S3AttachmentStorage) validObjectInput(key string) bool {
	return s != nil && strings.TrimSpace(s.Region) != "" && s.Bucket() != "" && strings.TrimSpace(key) != ""
}

func (s *S3AttachmentStorage) clients(ctx context.Context) (*s3.Client, *s3.PresignClient, error) {
	if s == nil || strings.TrimSpace(s.Region) == "" || s.Bucket() == "" {
		return nil, nil, ErrAttachmentStorageUnavailable
	}
	s.clientMu.Lock()
	defer s.clientMu.Unlock()
	if s.controlClient != nil && s.presignClient != nil {
		return s.controlClient, s.presignClient, nil
	}
	loadOptions := []func(*awsconfig.LoadOptions) error{
		awsconfig.WithRegion(strings.TrimSpace(s.Region)),
	}
	if profile := strings.TrimSpace(s.AWSProfile); profile != "" {
		loadOptions = append(loadOptions, awsconfig.WithSharedConfigProfile(profile))
	}
	if s.HTTPClient != nil {
		loadOptions = append(loadOptions, awsconfig.WithHTTPClient(s.HTTPClient))
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, loadOptions...)
	if err != nil {
		return nil, nil, err
	}
	s.controlClient = newAttachmentS3Client(cfg, s.EndpointURL)
	presignEndpoint := strings.TrimSpace(s.PresignEndpointURL)
	if presignEndpoint == "" {
		presignEndpoint = strings.TrimSpace(s.EndpointURL)
	}
	if presignEndpoint == strings.TrimSpace(s.EndpointURL) {
		s.presignClient = newAttachmentS3PresignClient(s.controlClient)
	} else {
		s.presignClient = newAttachmentS3PresignClient(newAttachmentS3Client(cfg, presignEndpoint))
	}
	return s.controlClient, s.presignClient, nil
}

func newAttachmentS3Client(cfg aws.Config, endpoint string) *s3.Client {
	return s3.NewFromConfig(cfg, func(options *s3.Options) {
		if endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/"); endpoint != "" {
			options.BaseEndpoint = aws.String(endpoint)
			options.UsePathStyle = true
		}
	})
}

func newAttachmentS3PresignClient(client *s3.Client) *s3.PresignClient {
	return s3.NewPresignClient(client, func(options *s3.PresignOptions) {
		options.Presigner = awsv4.NewSigner(func(signerOptions *awsv4.SignerOptions) {
			signerOptions.DisableHeaderHoisting = true
			signerOptions.DisableURIPathEscaping = true
		})
	})
}

func applyAttachmentSSEPut(input *s3.PutObjectInput) {
	if value := attachmentSSEValue(); value != "" {
		input.ServerSideEncryption = s3types.ServerSideEncryption(value)
	}
}

func applyAttachmentSSECreateMultipart(input *s3.CreateMultipartUploadInput) {
	if value := attachmentSSEValue(); value != "" {
		input.ServerSideEncryption = s3types.ServerSideEncryption(value)
	}
}

func attachmentSSEValue() string {
	value := strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION"))
	if strings.EqualFold(value, "none") {
		return ""
	}
	if value == "" {
		return string(s3types.ServerSideEncryptionAes256)
	}
	return value
}

func attachmentPresignedHeaders(signed http.Header, expected map[string]string) (map[string]string, error) {
	result := make(map[string]string)
	for name, values := range signed {
		name = strings.ToLower(strings.TrimSpace(name))
		if name == "" || name == "host" {
			continue
		}
		value := strings.TrimSpace(strings.Join(values, ","))
		want, allowed := expected[name]
		if !allowed || strings.TrimSpace(want) == "" || value != strings.TrimSpace(want) {
			return nil, fmt.Errorf("unexpected S3 presign signed header %q", name)
		}
		result[name] = value
	}
	for name, value := range expected {
		if strings.TrimSpace(value) == "" {
			continue
		}
		if result[name] != strings.TrimSpace(value) {
			return nil, fmt.Errorf("S3 presign omitted required header %q", name)
		}
	}
	return result, nil
}

func attachmentS3NotFound(err error) bool {
	if err == nil {
		return false
	}
	var responseError *smithyhttp.ResponseError
	return errors.As(err, &responseError) && responseError.HTTPStatusCode() == http.StatusNotFound
}

type attachmentPayloadHashMiddleware struct {
	hash string
}

type attachmentPresignContentTypeMiddleware struct {
	contentType string
}

func (attachmentPresignContentTypeMiddleware) ID() string {
	return "MangoRTSAttachmentPresignContentType"
}

func (m attachmentPresignContentTypeMiddleware) HandleBuild(
	ctx context.Context,
	input middleware.BuildInput,
	next middleware.BuildHandler,
) (middleware.BuildOutput, middleware.Metadata, error) {
	request, ok := input.Request.(*smithyhttp.Request)
	if !ok {
		return middleware.BuildOutput{}, middleware.Metadata{}, fmt.Errorf("unexpected S3 presign transport %T", input.Request)
	}
	request.Header.Set("Content-Type", m.contentType)
	return next.HandleBuild(ctx, input)
}

func (attachmentPayloadHashMiddleware) ID() string {
	return "MangoRTSAttachmentPayloadHash"
}

func (m attachmentPayloadHashMiddleware) HandleInitialize(
	ctx context.Context,
	input middleware.InitializeInput,
	next middleware.InitializeHandler,
) (middleware.InitializeOutput, middleware.Metadata, error) {
	return next.HandleInitialize(awsv4.SetPayloadHash(ctx, m.hash), input)
}

func normalizePresignDuration(value, fallback time.Duration) time.Duration {
	if value <= 0 {
		value = fallback
	}
	if value > 7*24*time.Hour {
		value = 7 * 24 * time.Hour
	}
	return time.Duration(int64(value/time.Second)) * time.Second
}

func validAttachmentChecksumBase64(value string) bool {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(value))
	return err == nil && len(decoded) == sha256.Size
}

func validAttachmentSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func firstNonBlankEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}
