package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type ctrlLoopOpenRepo struct {
	*ctrlLoopDeleteRepo
	attachment domain.Attachment
	readID     string
}

func (r *ctrlLoopOpenRepo) GetAttachment(c, id string) (domain.Attachment, error) {
	r.readID = id
	return r.attachment, nil
}

type ctrlLoopOpenStorage struct {
	*fakeAttachmentObjectStorage
	inputs []AttachmentPresignGetInput
	err    error
}

func (s *ctrlLoopOpenStorage) PresignGetObject(_ context.Context, input AttachmentPresignGetInput) (AttachmentPresignedRequest, error) {
	s.inputs = append(s.inputs, input)
	return AttachmentPresignedRequest{URL: "https://files.example.com/current.xlsx?signature=fixture", ExpiresAt: time.Now().Add(5 * time.Minute)}, s.err
}

func TestCtrlLoopOpenAuthorizesCurrentWorkbook(t *testing.T) {
	for _, name := range []string{"owner", "other owner", "other company", "anonymous", "membership removed", "mailbox disabled", "mailbox reassigned", "no workbook", "deleted file", "wrong company file", "wrong bucket", "signing failed", "wrong method", "removed preview"} {
		t.Run(name, func(t *testing.T) {
			f := newCtrlLoopSourceReaderFixture(t)
			storage := &ctrlLoopOpenStorage{fakeAttachmentObjectStorage: newFakeAttachmentObjectStorage()}
			repo := &ctrlLoopOpenRepo{ctrlLoopDeleteRepo: &ctrlLoopDeleteRepo{ctrlLoopSourceReaderRepo: f.repo, job: store.CtrlLoopJob{
				ID: store.NewUUIDv7String(), CompanyID: f.thread.CompanyID, UserID: f.owner.UserID, EmailConnectionID: f.thread.EmailConnectionID,
				OriginalAttachmentID: "original-id", CurrentAttachmentID: "current-id", FileName: "Orders.xlsx",
			}}, attachment: domain.Attachment{AttachmentID: "current-id", CompanyID: f.thread.CompanyID, StorageBucket: storage.Bucket(), StorageKey: "exact/current/object", ByteSize: 100}}
			f.server.repo, f.server.attachmentStorage = repo, storage
			user, company, method, suffix := f.owner, f.thread.CompanyID, http.MethodGet, "/open"
			status := http.StatusOK
			switch name {
			case "other owner":
				user, status = f.outsider, http.StatusNotFound
			case "other company":
				company, status = store.NewUUIDv7String(), http.StatusForbidden
			case "anonymous":
				status = http.StatusUnauthorized
			case "membership removed":
				repo.membershipRevoked, status = true, http.StatusForbidden
			case "mailbox disabled":
				repo.mailboxDisabled, status = true, http.StatusServiceUnavailable
			case "mailbox reassigned":
				repo.editConnection = func(c *domain.UserEmailConnection) { c.UserID = f.outsider.UserID }
				status = http.StatusNotFound
			case "no workbook":
				repo.job.CurrentAttachmentID, status = "", http.StatusNotFound
			case "deleted file":
				now := time.Now()
				repo.attachment.DeletedTimestamp, status = &now, http.StatusNotFound
			case "wrong company file":
				repo.attachment.CompanyID, status = "other", http.StatusNotFound
			case "wrong bucket":
				repo.attachment.StorageBucket, status = "other", http.StatusNotFound
			case "signing failed":
				storage.err, status = errors.New("synthetic signing failure"), http.StatusServiceUnavailable
			case "wrong method":
				method, status = http.MethodPost, http.StatusMethodNotAllowed
			case "removed preview":
				suffix, status = "/preview", http.StatusNotFound
			}
			request := attachmentRequestWithActor(httptest.NewRequest(method, "/v1/ctrl-loop/jobs/"+repo.job.ID+suffix+"?company_id="+company, nil), user, company, domain.RoleCompanyUser)
			if name == "anonymous" {
				request = request.WithContext(context.Background())
			}
			response := httptest.NewRecorder()
			f.server.Routes().ServeHTTP(response, request)
			if response.Code != status {
				t.Fatalf("status=%d want=%d body=%s", response.Code, status, response.Body.String())
			}
			if status == http.StatusOK {
				var result struct {
					URL string `json:"url"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.URL == "" {
					t.Fatalf("missing native link: %v", err)
				}
				if response.Header().Get("Cache-Control") != "no-store" || repo.readID != "current-id" || len(storage.inputs) != 1 {
					t.Fatal("open must select current file and never cache the link")
				}
				if input := storage.inputs[0]; input.Key != "exact/current/object" || input.Filename != "Orders.xlsx" || input.ContentType != ctrlLoopMIME {
					t.Fatalf("incorrect file signed: %+v", input)
				}
			} else if name != "signing failed" && len(storage.inputs) != 0 {
				t.Fatal("denied request signed a file")
			}
			if repo.deleted || repo.job.OriginalAttachmentID != "original-id" || len(storage.getKeys) != 0 {
				t.Fatal("native link must not mutate the job or stream workbook bytes")
			}
		})
	}
}

func TestS3AttachmentNativeOpenSignsOnlyFiveMinuteGET(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "synthetic-test-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "synthetic-test-secret")
	t.Setenv("AWS_SESSION_TOKEN", "")
	storage := &S3AttachmentStorage{Region: "us-west-1", BucketName: "sample-bucket", EndpointURL: "https://s3.example.com"}
	before := time.Now()
	result, err := storage.PresignGetObject(context.Background(), AttachmentPresignGetInput{Key: "exact/current/object", Filename: "Orders.xlsx", ContentType: ctrlLoopMIME})
	if err != nil {
		t.Fatal(err)
	}
	link, err := url.Parse(result.URL)
	if err != nil {
		t.Fatal(err)
	}
	query := link.Query()
	if result.Method != "GET" || link.Path != "/sample-bucket/exact/current/object" || query.Get("X-Amz-Expires") != "300" || query.Get("X-Amz-Signature") == "" || query.Get("X-Amz-SignedHeaders") != "host" {
		t.Fatalf("native link must authorize one GET with no custom headers for five minutes: method=%s path=%s expires=%s headers=%s", result.Method, link.Path, query.Get("X-Amz-Expires"), query.Get("X-Amz-SignedHeaders"))
	}
	if query.Get("response-content-type") != ctrlLoopMIME || query.Get("response-content-disposition") != "inline; filename=Orders.xlsx" || query.Get("response-cache-control") != "private, no-store" {
		t.Fatal("native Excel metadata missing")
	}
	if result.ExpiresAt.Before(before.Add(5*time.Minute)) || result.ExpiresAt.After(time.Now().Add(5*time.Minute)) {
		t.Fatal("invalid expiry")
	}
}
