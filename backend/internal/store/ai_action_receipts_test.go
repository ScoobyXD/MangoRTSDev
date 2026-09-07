package store

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryAIActionReceipts(t *testing.T) {
	repo := NewMemoryRepo()
	run := newAIActionReceiptRun(t, repo)
	repo.mu.Lock()
	defer repo.mu.Unlock()
	testAIActionReceipts(t,
		func(action aiActionKey, outcome any) error { return repo.saveAIActionLocked(run, action, outcome) },
		func(action aiActionKey, outcome any) (bool, error) {
			return repo.loadAIActionLocked(run, action, outcome)
		},
	)
}

func TestPostgresAIActionReceipts(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	run := newAIActionReceiptRun(t, repo)
	ctx := context.Background()
	testAIActionReceipts(t, func(action aiActionKey, outcome any) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if err := saveAIActionTx(ctx, tx, run, action, outcome); err != nil {
			return err
		}
		return tx.Commit()
	}, func(action aiActionKey, outcome any) (bool, error) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return false, err
		}
		defer tx.Rollback()
		return loadAIActionTx(ctx, tx, run, action, outcome)
	})
}

func testAIActionReceipts(t *testing.T, save func(aiActionKey, any) error, load func(aiActionKey, any) (bool, error)) {
	t.Helper()
	create := aiActionKey{Name: aiCreateNodeAction, Key: "same-argument-hash"}
	update := aiActionKey{Name: "fixture_update_fields", Key: create.Key}
	type createdResult struct {
		NodeID  string `json:"node_id"`
		Created bool   `json:"created"`
	}
	type updatedResult struct {
		Count  int      `json:"count"`
		Fields []string `json:"fields"`
	}
	wantCreated := createdResult{NodeID: newUUIDv7String(), Created: true}
	wantUpdated := updatedResult{Count: 2, Fields: []string{"title", "status"}}
	var created createdResult
	if found, err := load(create, &created); err != nil || found {
		t.Fatalf("missing receipt: found=%v err=%v", found, err)
	}
	if err := save(create, wantCreated); err != nil {
		t.Fatal(err)
	}
	if err := save(update, wantUpdated); err != nil {
		t.Fatalf("different action with the same argument hash collided: %v", err)
	}
	if found, err := load(create, &created); err != nil || !found || created != wantCreated {
		t.Fatalf("create result: found=%v result=%+v err=%v", found, created, err)
	}
	var updated updatedResult
	if found, err := load(update, &updated); err != nil || !found || !reflect.DeepEqual(updated, wantUpdated) {
		t.Fatalf("different JSON result shape: found=%v result=%+v err=%v", found, updated, err)
	}
	updated.Fields[0] = "changed by caller"
	if found, err := load(update, &updated); err != nil || !found || !reflect.DeepEqual(updated, wantUpdated) {
		t.Fatal("mutating a replay changed the saved receipt")
	}
	if err := save(create, createdResult{NodeID: newUUIDv7String()}); !errors.Is(err, ErrConflict) {
		t.Fatalf("overwriting an existing action receipt: %v", err)
	}
	if found, err := load(create, &created); err != nil || !found || created != wantCreated {
		t.Fatal("duplicate save changed the original action result")
	}
}

func TestPostgresAIActionReceiptRollback(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	run := newAIActionReceiptRun(t, repo)
	ctx := context.Background()
	action := aiActionKey{Name: "fixture_rolled_back_action", Key: "same-argument-hash"}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := saveAIActionTx(ctx, tx, run, action, map[string]bool{"saved": true}); err != nil {
		t.Fatal(err)
	}
	var outcome map[string]bool
	if found, err := loadAIActionTx(ctx, tx, run, action, &outcome); err != nil || !found || !outcome["saved"] {
		t.Fatalf("receipt was not part of the open transaction: found=%v err=%v", found, err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	after, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer after.Rollback()
	if found, err := loadAIActionTx(ctx, after, run, action, &outcome); err != nil || found {
		t.Fatalf("rolled-back transaction retained an action receipt: found=%v err=%v", found, err)
	}
}

func newAIActionReceiptRun(t *testing.T, repo Repository) AssistantRun {
	t.Helper()
	company, err := repo.CreateCompany("Shared AI action receipts")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("ai-receipt-owner", "ai-receipt-owner@example.test", "Receipt owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	run, err := repo.ReserveAssistantRun(context.Background(), AssistantRun{CompanyID: company.CompanyID, UserID: user.UserID, RequestID: "shared-receipt-run", Message: "Fixture action request"})
	if err != nil {
		t.Fatal(err)
	}
	return run
}
