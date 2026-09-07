package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestMemoryAIStreamExclusionAndRelease(t *testing.T) {
	repo := NewMemoryRepo()
	testAIStream(t, repo, repo)
}

func TestPostgresAIStreamExclusionAndRelease(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	testAIStream(t, repo, NewPostgresRepo(db))
	if db.Stats().InUse != 0 {
		t.Fatal("stream release retained a private database connection")
	}
}

func testAIStream(t *testing.T, repo Repository, otherReplica AIRepository) {
	t.Helper()
	ctx := context.Background()
	company, err := repo.CreateCompany("Exclusive streams")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("stream-owner", "stream-owner@example.test", "Stream owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	run, err := repo.ReserveAIRun(ctx, AIRun{CompanyID: company.CompanyID, UserID: user.UserID, RunID: newUUIDv7String(), PendingInput: "A streamed reply"})
	if err != nil {
		t.Fatal(err)
	}
	streamCtx, cancel := context.WithCancel(ctx)
	release, err := repo.AcquireAIStream(streamCtx, company.CompanyID, user.UserID, run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if extra, err := otherReplica.AcquireAIStream(ctx, company.CompanyID, user.UserID, run.RunID); !errors.Is(err, ErrConflict) || extra != nil {
		t.Fatalf("two subscribers acquired one native stream: %v", err)
	}
	if extra, err := otherReplica.AcquireAIStream(ctx, company.CompanyID, user.UserID, "unknown"); !errors.Is(err, ErrNotFound) || extra != nil {
		t.Fatalf("unknown run stream: %v", err)
	}
	cancel()
	release() // A disconnected request must still release its advisory lock.
	nextRelease, err := otherReplica.AcquireAIStream(ctx, company.CompanyID, user.UserID, run.RunID)
	if err != nil {
		t.Fatalf("stream could not resume after disconnect: %v", err)
	}
	defer nextRelease()
	release() // Releasing the previous request twice must not release this request.
	if extra, err := repo.AcquireAIStream(ctx, company.CompanyID, user.UserID, run.RunID); !errors.Is(err, ErrConflict) || extra != nil {
		t.Fatal("old release unlocked the replacement subscriber")
	}
	otherUser, err := repo.UpsertAuthUser("other-stream-owner", "other-stream-owner@example.test", "Other owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(otherUser.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ReserveAIRun(ctx, AIRun{CompanyID: company.CompanyID, UserID: otherUser.UserID, RunID: run.RunID, PendingInput: "Independent reply"}); err != nil {
		t.Fatal(err)
	}
	otherRelease, err := repo.AcquireAIStream(ctx, company.CompanyID, otherUser.UserID, run.RunID)
	if err != nil {
		t.Fatalf("another user was blocked by this stream: %v", err)
	}
	otherRelease()
	nextRelease()
	if extra, err := repo.AcquireAIStream(streamCtx, company.CompanyID, user.UserID, run.RunID); err == nil || extra != nil {
		t.Fatal("cancelled request acquired a stream lock")
	}
}
