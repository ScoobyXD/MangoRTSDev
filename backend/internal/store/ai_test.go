package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func TestMemoryAIRunAndActionContract(t *testing.T) {
	testAIContract(t, NewMemoryRepo(), nil)
}

func TestPostgresAIRunAndActionContract(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	testAIContract(t, repo, func() Repository { return NewPostgresRepo(db) })
}

func testAIContract(t *testing.T, repo Repository, restart func() Repository) {
	t.Helper()
	ctx := context.Background()
	company, err := repo.CreateCompany("AI isolation")
	if err != nil {
		t.Fatal(err)
	}
	otherCompany, err := repo.CreateCompany("Other company")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("ai-owner", "ai-owner@example.test", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	otherUser, err := repo.UpsertAuthUser("ai-other", "ai-other@example.test", "Other")
	if err != nil {
		t.Fatal(err)
	}
	for _, membership := range []struct{ subject, company string }{{user.CognitoSubject, company.CompanyID}, {user.CognitoSubject, otherCompany.CompanyID}, {otherUser.CognitoSubject, company.CompanyID}} {
		if _, err := repo.AddCompanyMembership(membership.subject, membership.company, domain.RoleCompanyAdmin); err != nil {
			t.Fatal(err)
		}
	}
	process, err := repo.CreateLogicGate(company.CompanyID, "Customer onboarding")
	if err != nil {
		t.Fatal(err)
	}
	step, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: company.CompanyID, LogicGateID: process.LogicGateID, Name: "Check details", ActorUserID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	submission := AIRun{CompanyID: company.CompanyID, UserID: user.UserID, RunID: newUUIDv7String(), PendingInput: "Create a customer check"}
	var wait sync.WaitGroup
	for range 6 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if _, err := repo.ReserveAIRun(ctx, submission); err != nil {
				t.Errorf("concurrent reservation: %v", err)
			}
		}()
	}
	wait.Wait()
	changed := submission
	changed.PendingInput = "Different request"
	if saved, err := repo.ReserveAIRun(ctx, changed); err != nil || saved.PendingInput != submission.PendingInput {
		t.Fatalf("first submission must retain its input: %+v %v", saved, err)
	}
	changed = submission
	changed.RunID = newUUIDv7String()
	if _, err := repo.ReserveAIRun(ctx, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("second active run: %v", err)
	}
	if _, err := repo.GetAIRun(ctx, company.CompanyID, otherUser.UserID, submission.RunID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-user read: %v", err)
	}
	if _, err := repo.GetAIRun(ctx, otherCompany.CompanyID, user.UserID, submission.RunID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-company read: %v", err)
	}
	run, err := repo.BindAIRun(ctx, company.CompanyID, user.UserID, submission.RunID, "native-run-1")
	if err != nil || run.PendingInput != "" || run.HermesRunID != "native-run-1" || run.Status != "running" {
		t.Fatalf("bind must clear pending message: %v", err)
	}
	if _, err := repo.BindAIRun(ctx, company.CompanyID, user.UserID, submission.RunID, "replacement-run"); !errors.Is(err, ErrConflict) {
		t.Fatalf("native ID replacement: %v", err)
	}
	if restart != nil {
		repo = restart()
	}
	replayed, err := repo.ReserveAIRun(ctx, submission)
	if err != nil || replayed.RunID != run.RunID || replayed.PendingInput != "" {
		t.Fatalf("durable same request replay: %v", err)
	}
	input := LogicGateNodeAssignmentInput{CompanyID: otherCompany.CompanyID, ActorUserID: otherUser.UserID, LogicGateID: process.LogicGateID, NodeID: newUUIDv7String(), CreateNodeTitle: "Verify customer", Status: "pending", ProcessStepID: &step.Step.ProcessStepID, ProcessStepIDSet: true}
	invalid := input
	badStep := newUUIDv7String()
	invalid.ProcessStepID = &badStep
	if _, err := repo.AICreateNode(ctx, run, "invalid-step", invalid); err == nil {
		t.Fatal("unknown step must fail")
	}
	if _, err := repo.GetNode(company.CompanyID, input.NodeID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed command must leave no Node: %v", err)
	}
	if saved, err := repo.GetAIRun(ctx, run.CompanyID, run.UserID, run.RunID); err != nil || len(saved.History) != 2 {
		t.Fatalf("failed command changed run history: %+v %v", saved.History, err)
	}
	results := make(chan LogicGateNodeAssignmentResult, 6)
	for range 6 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			retry := input
			retry.NodeID = newUUIDv7String()
			result, err := repo.AICreateNode(ctx, run, "create-customer-check", retry)
			if err != nil {
				t.Errorf("concurrent action: %v", err)
				return
			}
			results <- result
		}()
	}
	wait.Wait()
	close(results)
	var created LogicGateNodeAssignmentResult
	eventResponses := 0
	for result := range results {
		if created.Node.NodeID != "" && result.Node.NodeID != created.Node.NodeID {
			t.Fatal("action retry duplicated the Node")
		}
		created = result
		if len(result.Events) > 0 {
			eventResponses++
		}
		if result.Node.CompanyID != run.CompanyID || result.Assignment.PlacedByUserID != run.UserID || result.Assignment.LogicGateID != process.LogicGateID || result.Assignment.ProcessStepID == nil || *result.Assignment.ProcessStepID != step.Step.ProcessStepID {
			t.Fatal("action lost canonical scope, actor or step")
		}
	}
	if created.Node.NodeID == "" || eventResponses != 1 {
		t.Fatal("exactly one command must commit events")
	}
	if saved, err := repo.GetAIRun(ctx, run.CompanyID, run.UserID, run.RunID); err != nil || len(saved.History) != 3 || saved.History[2].ID != "action:mango_create_node:create-customer-check" || saved.History[2].Type != "action_committed" {
		t.Fatalf("action history must commit exactly once with its command: %+v %v", saved.History, err)
	}
	if err := repo.DeleteNode(run.CompanyID, created.Node.NodeID); err != nil {
		t.Fatal(err)
	}
	if restart != nil {
		repo = restart()
	}
	deletedReplay, err := repo.AICreateNode(ctx, run, "create-customer-check", input)
	if err != nil || deletedReplay.Node.NodeID != created.Node.NodeID {
		t.Fatalf("deleted Node receipt: %v", err)
	}
	if _, err := repo.GetNode(run.CompanyID, created.Node.NodeID); !errors.Is(err, ErrNotFound) {
		t.Fatal("action retry must never resurrect a deleted Node")
	}
	if _, err := repo.SetAIRunStatus(ctx, run.CompanyID, run.UserID, run.RunID, "stopping"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AICreateNode(ctx, run, "new-after-stop", input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cancelled action: %v", err)
	}
	if _, err := repo.ReserveAIRun(ctx, changed); !errors.Is(err, ErrConflict) {
		t.Fatal("cancel must not settle before native completion")
	}
	if _, err := repo.SetAIRunStatus(ctx, run.CompanyID, run.UserID, run.RunID, "cancelled"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ActiveAIRun(ctx, run.CompanyID, run.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatal("settled run remains active")
	}
	if _, err := repo.ReserveAIRun(ctx, changed); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCompanyUser(run.CompanyID, run.UserID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetAIRun(ctx, run.CompanyID, run.UserID, run.RunID); !errors.Is(err, ErrNotFound) {
		t.Fatal("removed membership must not read dormant receipts")
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, run.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if receipt, err := repo.ReserveAIRun(ctx, submission); err != nil || receipt.HermesRunID != run.HermesRunID || receipt.Status != "cancelled" {
		t.Fatal("restored membership must retain the original receipt without reissuing the submission")
	}
}

func TestMemoryAIUsesCurrentProcessPermission(t *testing.T) {
	testAIProcessPermission(t, NewMemoryRepo())
}

func TestPostgresAIUsesCurrentProcessPermission(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	testAIProcessPermission(t, repo)
}

func testAIProcessPermission(t *testing.T, repo Repository) {
	t.Helper()
	company, err := repo.CreateCompany("AI current permission")
	if err != nil {
		t.Fatal(err)
	}
	companyID := company.CompanyID
	user, err := repo.UpsertAuthUser("permission-user", "permission-user@example.test", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(companyID, "Restricted process")
	if err != nil {
		t.Fatal(err)
	}
	edit := ResourceDefaultAccessEdit
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: process.LogicGateID, PermissionMode: PolicyModeCustomized, DefaultAccess: &edit, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	run, err := repo.ReserveAIRun(ctx, AIRun{CompanyID: companyID, UserID: user.UserID, RunID: newUUIDv7String(), PendingInput: "Create work"})
	if err != nil {
		t.Fatal(err)
	}
	run, err = repo.BindAIRun(ctx, companyID, user.UserID, run.RunID, "native-run")
	if err != nil {
		t.Fatal(err)
	}
	deny := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: process.LogicGateID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
		t.Fatal(err)
	}
	input := LogicGateNodeAssignmentInput{LogicGateID: process.LogicGateID, NodeID: newUUIDv7String(), CreateNodeTitle: "Forbidden"}
	if _, err := repo.AICreateNode(ctx, run, "create", input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked process edit: %v", err)
	}
	if _, err := repo.GetNode(companyID, input.NodeID); !errors.Is(err, ErrNotFound) {
		t.Fatal("denied action created a Node")
	}
}

func TestPostgresAIMigration(t *testing.T) {
	db := openPostgresProcessMapTestDatabase(t)
	if _, err := db.Exec(`create table companies(company_id uuid primary key); create table users(user_id uuid primary key)`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260907_hermes_action_receipts.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`select count(*) from information_schema.tables where table_schema='public' and table_name in ('ai_chats','ai_runs','ai_messages','ai_actions')`).Scan(&count); err != nil || count != 4 {
		t.Fatalf("ai receipt schema: %d %v", count, err)
	}
	for table, columns := range map[string][]string{
		"ai_chats":    {"company_id", "user_id", "chat_id", "name", "created_timestamp"},
		"ai_runs":     {"company_id", "user_id", "run_id", "hermes_run_id", "chat_id", "status", "pending_input", "history", "created_timestamp"},
		"ai_messages": {"company_id", "user_id", "message_id", "chat_id", "run_id", "role", "content", "created_timestamp"},
		"ai_actions":  {"company_id", "user_id", "run_id", "action_name", "action_key", "result"},
	} {
		rows, err := db.Query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, table)
		if err != nil {
			t.Fatal(err)
		}
		actual, expected, count := map[string]bool{}, map[string]bool{}, 0
		for rows.Next() {
			var column string
			if err := rows.Scan(&column); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			actual[column], count = true, count+1
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		rows.Close()
		for _, column := range columns {
			expected[column] = true
		}
		if count != len(columns) || !reflect.DeepEqual(actual, expected) {
			t.Fatalf("%s column contract: count=%d columns=%v", table, count, actual)
		}
	}
}
