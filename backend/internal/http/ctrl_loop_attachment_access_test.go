package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type ctrlLoopAttachmentRepo struct {
	*store.MemoryRepo
	store.CtrlLoopRepository
	job store.CtrlLoopJob
}

func (r *ctrlLoopAttachmentRepo) GetCtrlLoopJob(_ context.Context, companyID, userID, jobID string) (store.CtrlLoopJob, error) {
	if r.job.CompanyID != companyID || r.job.UserID != userID || r.job.ID != jobID {
		return store.CtrlLoopJob{}, store.ErrNotFound
	}
	return r.job, nil
}

func TestCtrlLoopAttachmentReadRequiresExactOwnerMembershipAndMailbox(t *testing.T) {
	memory, server, _, companyID, owner, stranger, _ := newAttachmentRouteTestFixture(t)
	jobID := store.NewUUIDv7String()
	attachmentID := store.NewUUIDv7String()
	server.repo = &ctrlLoopAttachmentRepo{MemoryRepo: memory, job: store.CtrlLoopJob{ID: jobID, CompanyID: companyID, UserID: owner.UserID, OriginalAttachmentID: attachmentID, CurrentAttachmentID: attachmentID}}
	request := func(user domain.User, company, role string) *http.Request {
		return attachmentRequestWithActor(httptest.NewRequest(http.MethodGet, "/", nil), user, company, role)
	}
	for _, tc := range []struct {
		name         string
		r            *http.Request
		company, job string
		want         bool
	}{
		{"owner", request(owner, companyID, domain.RoleCompanyUser), companyID, jobID, true},
		{"other owner", request(stranger, companyID, domain.RoleCompanyAdmin), companyID, jobID, false},
		{"other company", request(owner, "other-company", domain.RoleCompanyAdmin), "other-company", jobID, false},
		{"membership removed", request(owner, companyID, ""), companyID, jobID, false},
		{"missing job", request(owner, companyID, domain.RoleCompanyUser), companyID, store.NewUUIDv7String(), false},
		{"anonymous", httptest.NewRequest(http.MethodGet, "/", nil), companyID, jobID, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := server.canViewCtrlLoopAttachment(tc.r, tc.company, tc.job, attachmentID)
			if err != nil || got != tc.want {
				t.Fatalf("allowed=%v err=%v", got, err)
			}
		})
	}
	owner.MailboxEnabled = false
	disabled := httptest.NewRequest(http.MethodGet, "/", nil)
	disabled = disabled.WithContext(context.WithValue(disabled.Context(), actorContextKey{}, ActorContext{User: owner, Memberships: []domain.CompanyMembership{{CompanyID: companyID, UserID: owner.UserID, Role: domain.RoleCompanyUser}}}))
	if allowed, err := server.canViewCtrlLoopAttachment(disabled, companyID, jobID, attachmentID); err != nil || allowed {
		t.Fatalf("mailbox disabled allowed=%v err=%v", allowed, err)
	}
}

func TestCtrlLoopAttachmentProvisionalVersionsCannotBeRead(t *testing.T) {
	memory, server, _, companyID, owner, _, _ := newAttachmentRouteTestFixture(t)
	job := store.CtrlLoopJob{ID: store.NewUUIDv7String(), CompanyID: companyID, UserID: owner.UserID, OriginalAttachmentID: store.NewUUIDv7String(), CurrentAttachmentID: store.NewUUIDv7String()}
	repo := &ctrlLoopAttachmentRepo{MemoryRepo: memory, job: job}
	server.repo = repo
	request := attachmentRequestWithActor(httptest.NewRequest(http.MethodGet, "/", nil), owner, companyID, domain.RoleCompanyUser)
	provisional := store.NewUUIDv7String()
	for _, tc := range []struct {
		id   string
		want bool
	}{
		{job.OriginalAttachmentID, true}, {job.CurrentAttachmentID, true}, {provisional, false}, {"", false},
	} {
		w := httptest.NewRecorder()
		got := server.canReadAttachmentThroughLinks(w, request, companyID, []domain.ResourceAttachment{{CompanyID: companyID, ResourceType: "ctrl_loop_job", ResourceID: job.ID, AttachmentID: tc.id}})
		if got != tc.want {
			t.Fatalf("attachment=%s allowed=%v status=%d", tc.id, got, w.Code)
		}
	}
	// Publication is the pointer commit. A newly committed version becomes
	// readable and the prior intermediate version stops being public.
	repo.job.CurrentAttachmentID = provisional
	if allowed, err := server.canViewCtrlLoopAttachment(request, companyID, job.ID, provisional); err != nil || !allowed {
		t.Fatalf("published version denied: %v", err)
	}
	if allowed, err := server.canViewCtrlLoopAttachment(request, companyID, job.ID, job.CurrentAttachmentID); err != nil || allowed {
		t.Fatalf("prior version exposed: %v", err)
	}
	w := httptest.NewRecorder()
	server.handleResourceAttachmentList(w, attachmentRequestWithActor(httptest.NewRequest(http.MethodGet, "/?company_id="+companyID, nil), owner, companyID, domain.RoleCompanyUser), "ctrl_loop_job", job.ID)
	if w.Code != http.StatusForbidden {
		t.Fatalf("generic list exposed unpublished files: %d", w.Code)
	}
}

func TestCtrlLoopGenericAttachmentMutationsAreRejected(t *testing.T) {
	_, server, _, companyID, owner, _, _ := newAttachmentRouteTestFixture(t)
	jobID := store.NewUUIDv7String()
	attachmentID := store.NewUUIDv7String()
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodPost, "/v1/resources/ctrl_loop_job/" + jobID + "/attachments", `{"company_id":"` + companyID + `","attachment_id":"` + attachmentID + `"}`},
		{http.MethodDelete, "/v1/resources/ctrl_loop_job/" + jobID + "/attachments/" + attachmentID + "?company_id=" + companyID, ""},
	} {
		r := attachmentRequestWithActor(httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)), owner, companyID, domain.RoleCompanyUser)
		w := httptest.NewRecorder()
		server.Routes().ServeHTTP(w, r)
		if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "ctrl_loop_workbooks_require_automation_command") {
			t.Fatalf("%s status=%d body=%s", tc.method, w.Code, w.Body.String())
		}
	}
	// Every direct-upload entry point uses this same edit gate before storage.
	w := httptest.NewRecorder()
	if server.requireAttachmentResourceEdit(w, httptest.NewRequest(http.MethodPost, "/", nil), companyID, "ctrl_loop_job", jobID) || w.Code != http.StatusForbidden {
		t.Fatal("generic upload owner gate allowed CtrlLoop")
	}
}
