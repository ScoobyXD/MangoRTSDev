package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type ctrlLoopDeleteRepo struct {
	*ctrlLoopSourceReaderRepo
	job          store.CtrlLoopJob
	deleteErr    error
	beforeDelete func()
	deleted      bool
}

func (r *ctrlLoopDeleteRepo) GetCtrlLoopJob(_ context.Context, c, u, id string) (store.CtrlLoopJob, error) {
	if r.deleted || c != r.job.CompanyID || u != r.job.UserID || id != r.job.ID {
		return store.CtrlLoopJob{}, store.ErrNotFound
	}
	return r.job, nil
}

func (r *ctrlLoopDeleteRepo) DeleteCtrlLoopJob(ctx context.Context, c, u, id string) error {
	if _, err := r.GetCtrlLoopJob(ctx, c, u, id); err != nil {
		return err
	}
	r.beforeDelete()
	if r.deleteErr != nil {
		return r.deleteErr
	}
	r.deleted = true
	return nil
}

func TestCtrlLoopDeleteRequiresExactOwnerAndWakesCleanupAfterCommit(t *testing.T) {
	for _, name := range []string{
		"owner without setup", "disconnected mailbox", "other owner", "other company", "anonymous",
		"membership removed", "mailbox disabled", "mailbox owned by another user", "missing job",
		"workbook processing", "database failure",
	} {
		t.Run(name, func(t *testing.T) {
			f := newCtrlLoopSourceReaderFixture(t)
			repo := &ctrlLoopDeleteRepo{ctrlLoopSourceReaderRepo: f.repo, job: store.CtrlLoopJob{
				ID: store.NewUUIDv7String(), CompanyID: f.thread.CompanyID,
				UserID: f.owner.UserID, EmailConnectionID: f.thread.EmailConnectionID,
			}}
			f.server.repo = repo
			repo.beforeDelete = func() { assertAttachmentRetirementWake(t, f.server, false) }
			user, company, id := f.owner, f.thread.CompanyID, repo.job.ID
			status := http.StatusNoContent
			switch name {
			case "disconnected mailbox":
				repo.editConnection = func(c *domain.UserEmailConnection) { c.Status = "disconnected" }
			case "other owner":
				user, status = f.outsider, http.StatusNotFound
			case "other company":
				company, status = store.NewUUIDv7String(), http.StatusForbidden
			case "anonymous":
				status = http.StatusUnauthorized
			case "membership removed":
				repo.membershipRevoked, status = true, http.StatusForbidden
			case "mailbox disabled":
				status = http.StatusForbidden
			case "mailbox owned by another user":
				repo.editConnection = func(c *domain.UserEmailConnection) { c.UserID = f.outsider.UserID }
				status = http.StatusNotFound
			case "missing job":
				id, status = store.NewUUIDv7String(), http.StatusNotFound
			case "workbook processing":
				repo.deleteErr, status = store.ErrConflict, http.StatusConflict
			case "database failure":
				repo.deleteErr, status = errors.New("delete failed"), http.StatusServiceUnavailable
			}
			request := attachmentRequestWithActor(httptest.NewRequest(http.MethodDelete, "/v1/ctrl-loop/jobs/"+id+"?company_id="+company, nil), user, company, domain.RoleCompanyUser)
			if name == "anonymous" {
				request = request.WithContext(context.Background())
			} else if name == "mailbox disabled" {
				actor, _ := authenticatedActor(request)
				actor.User.MailboxEnabled = false
				request = request.WithContext(context.WithValue(request.Context(), actorContextKey{}, actor))
			}
			response := httptest.NewRecorder()
			f.server.Routes().ServeHTTP(response, request)
			if response.Code != status || repo.deleted != (status == http.StatusNoContent) {
				t.Fatalf("status=%d deleted=%t want=%d body=%s", response.Code, repo.deleted, status, response.Body.String())
			}
			assertAttachmentRetirementWake(t, f.server, status == http.StatusNoContent)
			if repo.deleted {
				retry := httptest.NewRecorder()
				f.server.Routes().ServeHTTP(retry, request)
				if retry.Code != http.StatusNotFound {
					t.Fatalf("deleted job remained available: %d", retry.Code)
				}
				assertAttachmentRetirementWake(t, f.server, false)
			}
		})
	}
}
