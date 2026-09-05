package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func aiRunFixture(companyID, userID string) AIRun {
	return AIRun{
		CompanyID: companyID, UserID: userID, AIRunsID: "a0000000-0000-4000-8000-000000000001",
		StartTime:      time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC),
		FinishTime:     time.Date(2026, 9, 5, 10, 0, 3, 0, time.UTC),
		InspectionJSON: json.RawMessage(`[{"sequence":1,"time":"2026-09-05T10:00:00.123Z","kind":"request","status":"running","data":{"prompt":"Inspect"}},{"sequence":2,"time":"2026-09-05T10:00:03Z","kind":"run","status":"completed","data":{"result":"Saved"}}]`),
	}
}

func TestMemoryAIRunArchivePreservesSnapshotAndOwnerScope(t *testing.T) {
	repo := NewMemoryRepo()
	company, _ := repo.CreateCompany("AI archive company")
	otherCompany, _ := repo.CreateCompany("Other AI archive company")
	owner, _ := repo.UpsertAuthUser("ai-owner", "owner@example.com", "Owner")
	otherUser, _ := repo.UpsertAuthUser("ai-other", "other@example.com", "Other")
	for _, membership := range []struct{ subject, company string }{
		{owner.CognitoSubject, company.CompanyID},
		{owner.CognitoSubject, otherCompany.CompanyID},
		{otherUser.CognitoSubject, company.CompanyID},
	} {
		if _, err := repo.AddCompanyMembership(membership.subject, membership.company, domain.RoleCompanyAdmin); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	run := aiRunFixture(company.CompanyID, owner.UserID)
	originalJSON := string(run.InspectionJSON)
	if err := repo.SaveAIRunContext(ctx, run); err != nil {
		t.Fatal(err)
	}
	// The archive owns its bytes, even if the capture buffer is reused afterward.
	run.InspectionJSON[2] = 'X'
	duplicate := aiRunFixture(company.CompanyID, owner.UserID)
	duplicate.AIRunsID = strings.ToUpper(duplicate.AIRunsID)
	duplicate.InspectionJSON = json.RawMessage(`[]`)
	duplicate.FinishTime = duplicate.FinishTime.Add(time.Minute)
	var saves sync.WaitGroup
	for range 8 {
		saves.Add(1)
		go func() {
			defer saves.Done()
			if err := repo.SaveAIRunContext(ctx, duplicate); err != nil {
				t.Error(err)
			}
		}()
	}
	saves.Wait()
	key := company.CompanyID + ":" + owner.UserID + ":" + run.AIRunsID
	saved := repo.aiRuns[key]
	if len(repo.aiRuns) != 1 || string(saved.InspectionJSON) != originalJSON || !saved.StartTime.Equal(run.StartTime) || !saved.FinishTime.Equal(run.FinishTime) {
		t.Fatalf("archive duplicated or changed: %+v", saved)
	}
	for _, scoped := range []AIRun{
		aiRunFixture(company.CompanyID, otherUser.UserID),
		aiRunFixture(otherCompany.CompanyID, owner.UserID),
	} {
		if err := repo.SaveAIRunContext(ctx, scoped); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.AddCompanyMembership(otherUser.CognitoSubject, company.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if allowed, err := repo.UserHasCompanyAccess(otherUser.CognitoSubject, otherCompany.CompanyID); err != nil || !allowed {
		t.Fatalf("existing global administrator access: %t, %v", allowed, err)
	}
	if err := repo.SaveAIRunContext(ctx, aiRunFixture(otherCompany.CompanyID, otherUser.UserID)); err != nil {
		t.Fatalf("authorized global administrator archive failed: %v", err)
	}
	// A failed membership deletion must not discard an archive.
	repo.domainEventAppendErr = errors.New("event store unavailable")
	if _, err := repo.DeleteCompanyUser(company.CompanyID, owner.UserID, false); err == nil {
		t.Fatal("expected membership deletion failure")
	}
	if len(repo.aiRuns) != 4 {
		t.Fatal("failed membership deletion discarded archive")
	}
	repo.domainEventAppendErr = nil
	if _, err := repo.DeleteCompanyUser(company.CompanyID, owner.UserID, false); err != nil {
		t.Fatal(err)
	}
	if len(repo.aiRuns) != 4 {
		t.Fatal("membership removal discarded historical archives")
	}
	// This Send was admitted before its owner lost membership.
	finishingRun := aiRunFixture(company.CompanyID, owner.UserID)
	finishingRun.AIRunsID = newUUIDv7String()
	if err := repo.SaveAIRunContext(ctx, finishingRun); err != nil {
		t.Fatalf("admitted Send lost its archive after membership removal: %v", err)
	}
	if _, err := repo.DeleteCompanyUser(otherCompany.CompanyID, owner.UserID, true); err != nil {
		t.Fatal(err)
	}
	if len(repo.aiRuns) != 2 {
		t.Fatal("identity cleanup crossed owner scope")
	}
	for _, saved := range repo.aiRuns {
		if saved.UserID != otherUser.UserID {
			t.Fatal("deleted user still owns archive")
		}
	}
}

func TestMemoryAIRunArchiveRejectsInvalidOrCancelledSave(t *testing.T) {
	repo := NewMemoryRepo()
	company, _ := repo.CreateCompany("AI archive validation")
	user, _ := repo.UpsertAuthUser("ai-validation", "validation@example.com", "Validation")
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []struct {
		name   string
		change func(*AIRun)
	}{
		{"company", func(run *AIRun) { run.CompanyID = "" }},
		{"user", func(run *AIRun) { run.UserID = "not-a-uuid" }},
		{"request", func(run *AIRun) { run.AIRunsID = "" }},
		{"start", func(run *AIRun) { run.StartTime = time.Time{} }},
		{"finish", func(run *AIRun) { run.FinishTime = run.StartTime.Add(-time.Second) }},
		{"json", func(run *AIRun) { run.InspectionJSON = nil }},
		{"not event array", func(run *AIRun) { run.InspectionJSON = json.RawMessage(`{}`) }},
	} {
		t.Run(invalid.name, func(t *testing.T) {
			run := aiRunFixture(company.CompanyID, user.UserID)
			invalid.change(&run)
			if err := repo.SaveAIRunContext(context.Background(), run); !errors.Is(err, ErrInvalid) {
				t.Fatalf("invalid archive accepted: %v", err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := repo.SaveAIRunContext(ctx, aiRunFixture(company.CompanyID, user.UserID)); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled archive write accepted: %v", err)
	}
	for _, missing := range []AIRun{
		aiRunFixture(newUUIDv7String(), user.UserID),
		aiRunFixture(company.CompanyID, newUUIDv7String()),
	} {
		if err := repo.SaveAIRunContext(context.Background(), missing); !errors.Is(err, ErrNotFound) {
			t.Fatalf("archive with missing owner endpoint accepted: %v", err)
		}
	}
	if len(repo.aiRuns) != 0 {
		t.Fatal("rejected save inserted an archive")
	}
}
