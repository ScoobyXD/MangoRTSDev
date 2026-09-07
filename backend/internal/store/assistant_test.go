package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestMemoryAssistantRunAndActionContract(t *testing.T) {
	testAssistantContract(t, NewMemoryRepo(), nil)
}

func TestPostgresAssistantRunAndActionContract(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	testAssistantContract(t, repo, func() Repository { return NewPostgresRepo(db) })
}

func testAssistantContract(t *testing.T, repo Repository, restart func() Repository) {
	t.Helper()
	ctx := context.Background()
	company, err := repo.CreateCompany("Assistant isolation")
	if err != nil {
		t.Fatal(err)
	}
	otherCompany, err := repo.CreateCompany("Other company")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("assistant-owner", "assistant-owner@example.test", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	otherUser, err := repo.UpsertAuthUser("assistant-other", "assistant-other@example.test", "Other")
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
	submission := AssistantRun{CompanyID: company.CompanyID, UserID: user.UserID, RequestID: "request-1", ConversationID: "session-1", Message: "Create a customer check"}
	var wait sync.WaitGroup
	for range 6 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if _, err := repo.ReserveAssistantRun(ctx, submission); err != nil {
				t.Errorf("concurrent reservation: %v", err)
			}
		}()
	}
	wait.Wait()
	changed := submission
	changed.Message = "Different request"
	if _, err := repo.ReserveAssistantRun(ctx, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed payload: %v", err)
	}
	changed = submission
	changed.RequestID = "request-2"
	if _, err := repo.ReserveAssistantRun(ctx, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("second active run: %v", err)
	}
	if _, err := repo.GetAssistantRun(ctx, company.CompanyID, otherUser.UserID, submission.RequestID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-user read: %v", err)
	}
	if _, err := repo.GetAssistantRun(ctx, otherCompany.CompanyID, user.UserID, submission.RequestID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-company read: %v", err)
	}
	run, err := repo.BindAssistantRun(ctx, company.CompanyID, user.UserID, submission.RequestID, "native-run-1")
	if err != nil || run.Message != "" {
		t.Fatalf("bind must clear pending message: %v", err)
	}
	if _, err := repo.BindAssistantRun(ctx, company.CompanyID, user.UserID, submission.RequestID, "replacement-run"); !errors.Is(err, ErrConflict) {
		t.Fatalf("native ID replacement: %v", err)
	}
	if restart != nil {
		repo = restart()
	}
	replayed, err := repo.ReserveAssistantRun(ctx, submission)
	if err != nil || replayed.RunID != run.RunID || replayed.Message != "" {
		t.Fatalf("durable same request replay: %v", err)
	}
	input := LogicGateNodeAssignmentInput{CompanyID: otherCompany.CompanyID, ActorUserID: otherUser.UserID, LogicGateID: process.LogicGateID, NodeID: newUUIDv7String(), CreateNodeTitle: "Verify customer", Status: "pending", ProcessStepID: &step.Step.ProcessStepID, ProcessStepIDSet: true}
	invalid := input
	badStep := newUUIDv7String()
	invalid.ProcessStepID = &badStep
	if _, err := repo.AssistantCreateNode(ctx, run, "invalid-step", invalid); err == nil {
		t.Fatal("unknown step must fail")
	}
	if _, err := repo.GetNode(company.CompanyID, input.NodeID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed command must leave no Node: %v", err)
	}
	results := make(chan LogicGateNodeAssignmentResult, 6)
	for range 6 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			retry := input
			retry.NodeID = newUUIDv7String()
			result, err := repo.AssistantCreateNode(ctx, run, "create-customer-check", retry)
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
	if err := repo.DeleteNode(run.CompanyID, created.Node.NodeID); err != nil {
		t.Fatal(err)
	}
	if restart != nil {
		repo = restart()
	}
	deletedReplay, err := repo.AssistantCreateNode(ctx, run, "create-customer-check", input)
	if err != nil || deletedReplay.Node.NodeID != created.Node.NodeID {
		t.Fatalf("deleted Node receipt: %v", err)
	}
	if _, err := repo.GetNode(run.CompanyID, created.Node.NodeID); !errors.Is(err, ErrNotFound) {
		t.Fatal("action retry must never resurrect a deleted Node")
	}
	if err := repo.CancelAssistantRun(ctx, run.CompanyID, run.UserID, run.RequestID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssistantCreateNode(ctx, run, "new-after-stop", input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cancelled action: %v", err)
	}
	if _, err := repo.ReserveAssistantRun(ctx, changed); !errors.Is(err, ErrConflict) {
		t.Fatal("cancel must not settle before native completion")
	}
	if err := repo.SettleAssistantRun(ctx, run.CompanyID, run.UserID, run.RequestID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ActiveAssistantRun(ctx, run.CompanyID, run.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatal("settled run remains active")
	}
	if _, err := repo.ReserveAssistantRun(ctx, changed); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCompanyUser(run.CompanyID, run.UserID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetAssistantRun(ctx, run.CompanyID, run.UserID, run.RequestID); !errors.Is(err, ErrNotFound) {
		t.Fatal("removed membership must not read dormant receipts")
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, run.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if receipt, err := repo.ReserveAssistantRun(ctx, submission); err != nil || receipt.RunID != run.RunID || !receipt.Settled {
		t.Fatal("restored membership must retain the original receipt without reissuing the submission")
	}
}

func TestMemoryAssistantUsesCurrentProcessPermission(t *testing.T) {
	testAssistantProcessPermission(t, NewMemoryRepo())
}

func TestPostgresAssistantUsesCurrentProcessPermission(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	testAssistantProcessPermission(t, repo)
}

func testAssistantProcessPermission(t *testing.T, repo Repository) {
	t.Helper()
	company, err := repo.CreateCompany("Assistant current permission")
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
	run, err := repo.ReserveAssistantRun(ctx, AssistantRun{CompanyID: companyID, UserID: user.UserID, RequestID: "permission-run", ConversationID: "session", Message: "Create work"})
	if err != nil {
		t.Fatal(err)
	}
	run, err = repo.BindAssistantRun(ctx, companyID, user.UserID, run.RequestID, "native-run")
	if err != nil {
		t.Fatal(err)
	}
	deny := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: process.LogicGateID, PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
		t.Fatal(err)
	}
	input := LogicGateNodeAssignmentInput{LogicGateID: process.LogicGateID, NodeID: newUUIDv7String(), CreateNodeTitle: "Forbidden"}
	if _, err := repo.AssistantCreateNode(ctx, run, "create", input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked process edit: %v", err)
	}
	if _, err := repo.GetNode(companyID, input.NodeID); !errors.Is(err, ErrNotFound) {
		t.Fatal("denied action created a Node")
	}
}

func TestPostgresAssistantMigration(t *testing.T) {
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
	if err := db.QueryRow(`select count(*) from information_schema.tables where table_schema='public' and table_name in ('assistant_runs','assistant_node_actions')`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("assistant receipt schema: %d %v", count, err)
	}
}
