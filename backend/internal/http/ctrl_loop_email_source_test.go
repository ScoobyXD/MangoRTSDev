package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type ctrlLoopSourceReaderRepo struct {
	*store.MemoryRepo
	store.CtrlLoopRepository
	mailboxDisabled, membershipRevoked bool
	editThread                         func(*domain.CommunicationsEmailThread)
	editConnection                     func(*domain.UserEmailConnection)
}

func (r *ctrlLoopSourceReaderRepo) GetAuthUserByIDContext(ctx context.Context, id string) (domain.User, error) {
	u, err := r.MemoryRepo.GetAuthUserByIDContext(ctx, id)
	u.MailboxEnabled = !r.mailboxDisabled
	return u, err
}

func (r *ctrlLoopSourceReaderRepo) ListUserMembershipsContext(ctx context.Context, id string) ([]domain.CompanyMembership, error) {
	if r.membershipRevoked {
		return nil, nil
	}
	return r.MemoryRepo.ListUserMembershipsContext(ctx, id)
}

func (r *ctrlLoopSourceReaderRepo) GetCommunicationsEmailThreadContext(ctx context.Context, company, id string) (domain.CommunicationsEmailThread, error) {
	thread, err := r.MemoryRepo.GetCommunicationsEmailThreadContext(ctx, company, id)
	if err == nil && r.editThread != nil {
		r.editThread(&thread)
	}
	return thread, err
}

func (r *ctrlLoopSourceReaderRepo) GetEmailConnectionByIDContext(ctx context.Context, company, id string) (domain.UserEmailConnection, error) {
	connection, err := r.MemoryRepo.GetEmailConnectionByIDContext(ctx, company, id)
	if err == nil && r.editConnection != nil {
		r.editConnection(&connection)
	}
	return connection, err
}

type ctrlLoopSourceReaderFixture struct {
	repo            *ctrlLoopSourceReaderRepo
	server          *Server
	owner, outsider domain.User
	thread          domain.CommunicationsEmailThread
	selected        domain.CommunicationsEmailMessage
	want            domain.EmailMessageSnapshot
}

func newCtrlLoopSourceReaderFixture(t *testing.T) ctrlLoopSourceReaderFixture {
	t.Helper()
	memory, owner, outsider, _ := newEmailCollaborationThreadTestRepo(t)
	if _, err := memory.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		CompanyID: emailCollaborationThreadTestCompanyID, UserID: owner.UserID, Provider: "google",
		AccountEmail: owner.Email, Scope: "personal", GrantID: "stored-only-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	message := domain.EmailMessageSnapshot{
		ID: "provider-source-message", ThreadID: "provider-source-thread", Subject: "PO 742 received",
		Body: "<p>PO 742 arrived at the factory.</p>", Snippet: "PO 742 arrived", Date: 1789344660,
		From:             []domain.EmailAddressSnapshot{{Name: "Factory", Email: "factory@example.com"}},
		To:               []domain.EmailAddressSnapshot{{Name: "Planner", Email: owner.Email}},
		Cc:               []domain.EmailAddressSnapshot{{Name: "Logistics", Email: "logistics@example.com"}},
		Attachments:      []domain.EmailAttachmentSnapshot{{ID: "provider-attachment", AttachmentID: store.NewUUIDv7String(), Filename: "receipt.pdf", ContentType: "application/pdf", Size: 37}},
		DownloadComplete: true,
	}
	thread, err := memory.UpsertCommunicationsEmailThread(store.CommunicationsEmailThreadUpsertInput{
		CompanyID: emailCollaborationThreadTestCompanyID, PersonalUserID: owner.UserID,
		PersonalAccountEmail: owner.Email, AccountEmail: owner.Email, Provider: "google",
		ProviderThreadID: message.ThreadID, SelectedMessageID: message.ID, HistoryComplete: true,
		Messages: []domain.EmailMessageSnapshot{
			{ID: "provider-sibling", ThreadID: message.ThreadID, Subject: "Sibling subject must stay private", Body: "Sibling body must stay private", Date: message.Date - 1, DownloadComplete: true},
			message,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	selected, ok := storedEmailMessageForProvider(thread, message.ID)
	if !ok {
		t.Fatal("fixture source missing")
	}
	repo := &ctrlLoopSourceReaderRepo{MemoryRepo: memory}
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(func() {
		provider.Close()
		if calls.Load() != 0 {
			t.Fatalf("stored source reader made %d provider requests", calls.Load())
		}
	})
	server := NewServerWithOptions(repo, ServerOptions{
		NylasClient: NewNylasRESTClient(provider.URL, "fixture", "fixture"), NylasConfig: testNylasConfig(),
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	})
	t.Cleanup(server.Close)
	return ctrlLoopSourceReaderFixture{repo: repo, server: server, owner: owner, outsider: outsider, thread: thread, selected: selected, want: message}
}

func (f ctrlLoopSourceReaderFixture) read(user domain.User, company, thread, message string) *httptest.ResponseRecorder {
	path := "/v1/ctrl-loop/emails/" + thread + "/" + message + "?company_id=" + company
	r := attachmentRequestWithActor(httptest.NewRequest(http.MethodGet, path, nil), user, company, domain.RoleCompanyUser)
	w := httptest.NewRecorder()
	f.server.Routes().ServeHTTP(w, r)
	return w
}

func TestCtrlLoopStoredSourceReturnsOnlyExactMessageWithoutProviderRequests(t *testing.T) {
	f := newCtrlLoopSourceReaderFixture(t)
	w := f.read(f.owner, f.thread.CompanyID, f.thread.EmailThreadID, f.selected.EmailMessageID)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var response struct {
		Message struct {
			domain.EmailMessageSnapshot
			DetailFetched bool `json:"detail_fetched"`
		} `json:"message"`
		AccountEmail string `json:"account_email"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	got := response.Message
	if got.EmailMessageID != f.selected.EmailMessageID || got.EmailThreadID != f.thread.EmailThreadID || got.ID != f.want.ID || got.ThreadID != f.want.ThreadID || got.MessageOrder == nil || *got.MessageOrder != f.selected.MessageOrder {
		t.Fatalf("canonical message identity lost: %+v", got)
	}
	if got.Subject != f.want.Subject || got.Body != f.want.Body || got.Date != f.want.Date || !reflect.DeepEqual(got.From, f.want.From) || !reflect.DeepEqual(got.To, f.want.To) || !reflect.DeepEqual(got.Cc, f.want.Cc) || !reflect.DeepEqual(got.Attachments, f.want.Attachments) {
		t.Fatalf("source content changed: %+v", got)
	}
	if !got.DetailFetched || !got.DownloadComplete || response.AccountEmail != f.owner.Email || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("source readiness/account/cache incorrect: %+v headers=%v", response, w.Header())
	}
	if strings.Contains(w.Body.String(), "Sibling") || strings.Contains(w.Body.String(), "provider-sibling") || strings.Contains(w.Body.String(), `"messages"`) || strings.Contains(w.Body.String(), "stored-only-grant") {
		t.Fatal("source response included sibling data, a whole thread, or provider credentials")
	}
}

func TestCtrlLoopStoredSourceEnforcesExactScopeAndCurrentAccess(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*ctrlLoopSourceReaderFixture)
		want int
	}{
		{"other owner", func(f *ctrlLoopSourceReaderFixture) { f.owner = f.outsider }, http.StatusNotFound},
		{"missing thread", func(f *ctrlLoopSourceReaderFixture) { f.thread.EmailThreadID = store.NewUUIDv7String() }, http.StatusNotFound},
		{"missing message", func(f *ctrlLoopSourceReaderFixture) { f.selected.EmailMessageID = store.NewUUIDv7String() }, http.StatusNotFound},
		{"provider ID is not canonical", func(f *ctrlLoopSourceReaderFixture) { f.selected.EmailMessageID = f.want.ID }, http.StatusNotFound},
		{"wrong company", func(f *ctrlLoopSourceReaderFixture) {
			company := store.NewUUIDv7String()
			f.repo.EnsureCompany(company, "Other company")
			if _, err := f.repo.AddCompanyMembership(f.owner.CognitoSubject, company, domain.RoleCompanyUser); err != nil {
				t.Fatal(err)
			}
			f.thread.CompanyID = company
		}, http.StatusNotFound},
		{"returned thread mismatch", func(f *ctrlLoopSourceReaderFixture) {
			f.repo.editThread = func(v *domain.CommunicationsEmailThread) { v.EmailThreadID = store.NewUUIDv7String() }
		}, http.StatusNotFound},
		{"returned message thread mismatch", func(f *ctrlLoopSourceReaderFixture) {
			f.repo.editThread = func(v *domain.CommunicationsEmailThread) {
				for i := range v.Messages {
					v.Messages[i].EmailThreadID = store.NewUUIDv7String()
				}
			}
		}, http.StatusNotFound},
		{"shared thread", func(f *ctrlLoopSourceReaderFixture) {
			f.repo.editThread = func(v *domain.CommunicationsEmailThread) { v.ScopeType = "shared" }
		}, http.StatusNotFound},
		{"missing connection", func(f *ctrlLoopSourceReaderFixture) {
			f.repo.editThread = func(v *domain.CommunicationsEmailThread) { v.EmailConnectionID = store.NewUUIDv7String() }
		}, http.StatusNotFound},
		{"connection changed owner", func(f *ctrlLoopSourceReaderFixture) {
			f.repo.editConnection = func(v *domain.UserEmailConnection) { v.UserID = f.outsider.UserID }
		}, http.StatusNotFound},
		{"connection account mismatch", func(f *ctrlLoopSourceReaderFixture) {
			f.repo.editConnection = func(v *domain.UserEmailConnection) { v.AccountEmail = "other@example.com" }
		}, http.StatusNotFound},
		{"revoked membership despite stale actor", func(f *ctrlLoopSourceReaderFixture) { f.repo.membershipRevoked = true }, http.StatusForbidden},
		{"disabled mailbox despite stale actor", func(f *ctrlLoopSourceReaderFixture) { f.repo.mailboxDisabled = true }, http.StatusForbidden},
		{"incomplete source", func(f *ctrlLoopSourceReaderFixture) {
			f.repo.editThread = func(v *domain.CommunicationsEmailThread) {
				for i := range v.Messages {
					v.Messages[i].Message.DownloadComplete = false
				}
			}
		}, http.StatusConflict},
		{"disconnected stored mailbox", func(f *ctrlLoopSourceReaderFixture) {
			f.repo.editConnection = func(v *domain.UserEmailConnection) { v.Status = "disconnected" }
		}, http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newCtrlLoopSourceReaderFixture(t)
			tc.edit(&f)
			w := f.read(f.owner, f.thread.CompanyID, f.thread.EmailThreadID, f.selected.EmailMessageID)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
			if tc.want != http.StatusOK && strings.Contains(w.Body.String(), f.want.Body) {
				t.Fatal("denied response included message body")
			}
		})
	}
}

func TestCtrlLoopStoredSourceEmptyBodyIsAlreadyFetched(t *testing.T) {
	f := newCtrlLoopSourceReaderFixture(t)
	f.repo.editThread = func(v *domain.CommunicationsEmailThread) {
		for i := range v.Messages {
			v.Messages[i].Message.Body = ""
			v.Messages[i].Message.Snippet = ""
		}
	}
	w := f.read(f.owner, f.thread.CompanyID, f.thread.EmailThreadID, f.selected.EmailMessageID)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"detail_fetched":true`) || !strings.Contains(w.Body.String(), `"download_complete":true`) || strings.Contains(w.Body.String(), `"body":`) {
		t.Fatalf("empty stored message was treated as unfetched: status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestCtrlLoopStoredSourceRequiresAuthentication(t *testing.T) {
	f := newCtrlLoopSourceReaderFixture(t)
	path := "/v1/ctrl-loop/emails/" + f.thread.EmailThreadID + "/" + f.selected.EmailMessageID + "?company_id=" + f.thread.CompanyID
	w := httptest.NewRecorder()
	f.server.Routes().ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	if w.Code != http.StatusUnauthorized || strings.Contains(w.Body.String(), f.want.Body) {
		t.Fatalf("anonymous source response status=%d body=%s", w.Code, w.Body.String())
	}
}
