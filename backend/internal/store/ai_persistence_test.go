package store

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func newAIScope(t *testing.T, repo Repository) (companyID, userID, subject string) {
	t.Helper()
	company, err := repo.CreateCompany("AI persistence")
	if err != nil {
		t.Fatal(err)
	}
	subject = newUUIDv7String()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.test", "AI owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	return company.CompanyID, user.UserID, subject
}

func TestMemoryAILifecycleHistory(t *testing.T) { testAILifecycleHistory(t, NewMemoryRepo()) }
func TestPostgresAILifecycleHistory(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	testAILifecycleHistory(t, repo)
}

func TestPostgresAINoopUpdatesKeepStoredRow(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	ctx := context.Background()
	c, u, _ := newAIScope(t, repo)
	run, err := repo.ReserveAIRun(ctx, AIRun{CompanyID: c, UserID: u, RunID: newUUIDv7String(), PendingInput: "Input"})
	if err != nil {
		t.Fatal(err)
	}
	run, err = repo.BindAIRun(ctx, c, u, run.RunID, "native-run")
	if err != nil {
		t.Fatal(err)
	}
	event := AIHistoryEvent{ID: "hook:one", Type: "model.started", CreatedAt: run.CreatedAt, Data: json.RawMessage(`{"call":1}`)}
	if _, err := repo.AppendAIHistoryEvent(ctx, c, u, run.RunID, event); err != nil {
		t.Fatal(err)
	}
	var originalVersion string
	if err := db.QueryRow(`select xmin::text from ai_runs where company_id=$1::uuid and user_id=$2::uuid and run_id=$3::uuid`, c, u, run.RunID).Scan(&originalVersion); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		name  string
		apply func() (AIRun, error)
	}{
		{"same status", func() (AIRun, error) { return repo.SetAIRunStatus(ctx, c, u, run.RunID, "running") }},
		{"same native binding", func() (AIRun, error) { return repo.BindAIRun(ctx, c, u, run.RunID, run.HermesRunID) }},
		{"duplicate event", func() (AIRun, error) { return repo.AppendAIHistoryEvent(ctx, c, u, run.RunID, event) }},
		{"older status", func() (AIRun, error) { return repo.SetAIRunStatus(ctx, c, u, run.RunID, "pending") }},
	} {
		t.Run(check.name, func(t *testing.T) {
			if _, err := check.apply(); err != nil {
				t.Fatal(err)
			}
			var version string
			if err := db.QueryRow(`select xmin::text from ai_runs where company_id=$1::uuid and user_id=$2::uuid and run_id=$3::uuid`, c, u, run.RunID).Scan(&version); err != nil {
				t.Fatal(err)
			}
			if version != originalVersion {
				t.Fatal("unchanged run rewrote its stored row")
			}
		})
	}
}

func testAILifecycleHistory(t *testing.T, repo Repository) {
	t.Helper()
	ctx := context.Background()
	c, u, _ := newAIScope(t, repo)
	input := AIRun{CompanyID: c, UserID: u, RunID: newUUIDv7String(), ChatID: "native-session", PendingInput: " Original input "}
	if _, err := repo.ReserveAIRun(ctx, input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown chat: %v", err)
	}
	if _, err := repo.UpsertAIChat(ctx, AIChat{CompanyID: c, UserID: u, ChatID: input.ChatID, Name: "Original"}); err != nil {
		t.Fatal(err)
	}
	run, err := repo.ReserveAIRun(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "pending" || run.PendingInput != "Original input" || len(run.History) != 1 || run.History[0].ID != "status:pending" || !run.History[0].CreatedAt.Equal(run.CreatedAt) {
		t.Fatalf("pending evidence: %+v", run)
	}
	changed := input
	changed.ChatID, changed.PendingInput = "missing-session", "A different retry"
	retry, err := repo.ReserveAIRun(ctx, changed)
	if err != nil || retry.ChatID != run.ChatID || retry.PendingInput != run.PendingInput || !retry.CreatedAt.Equal(run.CreatedAt) {
		t.Fatalf("first submission changed: %+v %v", retry, err)
	}
	if _, err := repo.SetAIRunStatus(ctx, c, u, run.RunID, "running"); !errors.Is(err, ErrConflict) {
		t.Fatalf("running before bind: %v", err)
	}
	event := AIHistoryEvent{ID: "hook:one", Type: "tool_start", CreatedAt: run.CreatedAt.Add(-time.Second), Data: json.RawMessage(`{"b":2,"a":{"value":"start"},"duration_seconds":1e-7,"native_message_id":9223372036854775807}`)}
	var wait sync.WaitGroup
	for range 6 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if _, err := repo.AppendAIHistoryEvent(ctx, c, u, run.RunID, event); err != nil {
				t.Errorf("concurrent evidence: %v", err)
			}
		}()
	}
	wait.Wait()
	event.Data = json.RawMessage(`{ "a": {"value":"start"}, "b":2, "duration_seconds":0.0000001,"native_message_id":9223372036854775807 }`)
	run, err = repo.AppendAIHistoryEvent(ctx, c, u, run.RunID, event)
	if err != nil || len(run.History) != 2 || run.History[1].ID != event.ID {
		t.Fatalf("ordered idempotent evidence: %+v %v", run.History, err)
	}
	event.Data = json.RawMessage(`{"a":{"value":"start"},"b":2,"duration_seconds":1e-7,"native_message_id":9223372036854775806}`)
	if _, err := repo.AppendAIHistoryEvent(ctx, c, u, run.RunID, event); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed retry evidence: %v", err)
	}
	run.History[0].Data[0] = '['
	saved, err := repo.GetAIRun(ctx, c, u, run.RunID)
	if err != nil || string(saved.History[0].Data) != "{}" {
		t.Fatal("caller changed stored history")
	}
	run, err = repo.SetAIRunStatus(ctx, c, u, run.RunID, "stopping")
	if err != nil || run.PendingInput != "Original input" || len(run.History) != 3 {
		t.Fatalf("unbound stop must keep recovery input: %+v %v", run, err)
	}
	stoppedAt := run.History[2].CreatedAt
	run, err = repo.SetAIRunStatus(ctx, c, u, run.RunID, "stopping")
	if err != nil || len(run.History) != 3 || !run.History[2].CreatedAt.Equal(stoppedAt) {
		t.Fatal("duplicate stop changed lifecycle evidence")
	}
	run, err = repo.BindAIRun(ctx, c, u, run.RunID, "native-run")
	if err != nil || run.Status != "stopping" || run.HermesRunID != "native-run" || run.PendingInput != "" || len(run.History) != 3 {
		t.Fatalf("late bind reopened stopped run: %+v %v", run, err)
	}
	if found, err := repo.FindAIRun(ctx, c, u, "native-run"); err != nil || found.RunID != run.RunID {
		t.Fatalf("native lookup: %+v %v", found, err)
	}
	for _, status := range []string{"pending", "running"} {
		if same, err := repo.SetAIRunStatus(ctx, c, u, run.RunID, status); err != nil || same.Status != "stopping" || len(same.History) != 3 {
			t.Fatalf("stop downgraded by %s: %+v %v", status, same, err)
		}
	}
	run, err = repo.SetAIRunStatus(ctx, c, u, run.RunID, "cancelled")
	if err != nil || len(run.History) != 4 || run.History[3].ID != "status:cancelled" {
		t.Fatalf("terminal evidence: %+v %v", run, err)
	}
	for _, status := range []string{"completed", "failed", "running", "stopping", "pending"} {
		if same, err := repo.SetAIRunStatus(ctx, c, u, run.RunID, status); err != nil || same.Status != "cancelled" || len(same.History) != 4 {
			t.Fatalf("terminal state reopened: %+v %v", same, err)
		}
	}
	next := input
	next.RunID = newUUIDv7String()
	if _, err := repo.ReserveAIRun(ctx, next); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.BindAIRun(ctx, c, u, next.RunID, "native-run"); !errors.Is(err, ErrConflict) {
		t.Fatalf("native identity reuse: %v", err)
	}
	if pending, err := repo.GetAIRun(ctx, c, u, next.RunID); err != nil || pending.Status != "pending" || pending.PendingInput != "Original input" || len(pending.History) != 1 {
		t.Fatalf("failed bind changed run: %+v %v", pending, err)
	}
	if failed, err := repo.SetAIRunStatus(ctx, c, u, next.RunID, "failed"); err != nil || failed.PendingInput != "" {
		t.Fatalf("unbound terminal input: %+v %v", failed, err)
	}
}

func TestMemoryAIChatMessages(t *testing.T) { testAIChatMessages(t, NewMemoryRepo()) }
func TestPostgresAIChatMessages(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	testAIChatMessages(t, repo)
}

func testAIChatMessages(t *testing.T, repo Repository) {
	t.Helper()
	ctx := context.Background()
	c, u, subject := newAIScope(t, repo)
	otherC, otherU, _ := newAIScope(t, repo)
	if _, err := repo.AddCompanyMembership(subject, otherC, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 9, 7, 1, 2, 3, 123456000, time.UTC)
	chat := AIChat{CompanyID: c, UserID: u, ChatID: "native-chat", Name: "First name", CreatedAt: stamp}
	if _, err := repo.UpsertAIChat(ctx, chat); err != nil {
		t.Fatal(err)
	}
	chat.Name, chat.CreatedAt = "New name", stamp.Add(time.Hour)
	updated, err := repo.UpsertAIChat(ctx, chat)
	if err != nil || updated.Name != "New name" || !updated.CreatedAt.Equal(stamp) {
		t.Fatalf("chat rename changed creation: %+v %v", updated, err)
	}
	if _, err := repo.UpsertAIChat(ctx, AIChat{CompanyID: c, UserID: u, ChatID: "newer-chat", CreatedAt: stamp.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertAIChat(ctx, AIChat{CompanyID: otherC, UserID: otherU, ChatID: chat.ChatID, CreatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	chats, err := repo.ListAIChats(ctx, c, u, 1, 0)
	if err != nil || len(chats) != 1 || chats[0].ChatID != "newer-chat" {
		t.Fatalf("chat latest page: %+v %v", chats, err)
	}
	chats, err = repo.ListAIChats(ctx, c, u, 1, 1)
	if err != nil || len(chats) != 1 || chats[0].ChatID != chat.ChatID {
		t.Fatalf("chat older page: %+v %v", chats, err)
	}
	run, err := repo.ReserveAIRun(ctx, AIRun{CompanyID: c, UserID: u, RunID: newUUIDv7String(), ChatID: chat.ChatID, PendingInput: "Input"})
	if err != nil {
		t.Fatal(err)
	}
	first := AIMessage{MessageID: 11, ChatID: chat.ChatID, Role: "user", Content: "Exact user text\n", CreatedAt: stamp.Add(time.Second)}
	second := AIMessage{MessageID: 20, ChatID: chat.ChatID, Role: "ai", Content: `{"text":"plain JSON-looking text"}`, CreatedAt: stamp}
	third := AIMessage{MessageID: 30, ChatID: chat.ChatID, Role: "ai", Content: "Visible answer", CreatedAt: stamp.Add(-time.Second), RunID: run.RunID}
	if err := repo.ImportAIMessages(ctx, c, u, []AIMessage{third, first, second}); err != nil {
		t.Fatal(err)
	}
	if err := repo.ImportAIMessages(ctx, otherC, otherU, []AIMessage{first}); err != nil {
		t.Fatalf("native ID must be scoped per home: %v", err)
	}
	page, err := repo.ListAIMessages(ctx, c, u, chat.ChatID, 2, 0)
	if err != nil || len(page) != 2 || page[0].MessageID != 20 || page[1].MessageID != 30 || page[0].Content != second.Content {
		t.Fatalf("native ID page order: %+v %v", page, err)
	}
	page, err = repo.ListAIMessages(ctx, c, u, chat.ChatID, 2, 2)
	if err != nil || len(page) != 1 || page[0].MessageID != 11 {
		t.Fatalf("older native ID page: %+v %v", page, err)
	}
	first.RunID = run.RunID
	if err := repo.ImportAIMessages(ctx, c, u, []AIMessage{first, second}); err != nil {
		t.Fatalf("idempotent import and run association: %v", err)
	}
	for _, change := range []func(*AIMessage){
		func(m *AIMessage) { m.Content = "Changed" },
		func(m *AIMessage) { m.Role = "ai" },
		func(m *AIMessage) { m.CreatedAt = m.CreatedAt.Add(time.Second) },
		func(m *AIMessage) { m.ChatID = "newer-chat"; m.RunID = "" },
	} {
		changed := first
		change(&changed)
		if err := repo.ImportAIMessages(ctx, c, u, []AIMessage{changed}); !errors.Is(err, ErrConflict) {
			t.Fatalf("immutable native message changed: %+v %v", changed, err)
		}
	}
	addition := second
	addition.MessageID = 40
	changedAddition := addition
	changedAddition.Content = "Changed duplicate in one batch"
	if err := repo.ImportAIMessages(ctx, c, u, []AIMessage{addition, changedAddition}); !errors.Is(err, ErrConflict) {
		t.Fatalf("new duplicate message collision: %v", err)
	}
	if err := repo.ImportAIMessages(ctx, c, u, []AIMessage{first, first}); err != nil {
		t.Fatalf("identical duplicate message: %v", err)
	}
	changed := first
	changed.Content = "Collision after the new row"
	if err := repo.ImportAIMessages(ctx, c, u, []AIMessage{addition, changed}); !errors.Is(err, ErrConflict) {
		t.Fatalf("batch collision: %v", err)
	}
	page, err = repo.ListAIMessages(ctx, c, u, chat.ChatID, 10, 0)
	if err != nil || len(page) != 3 || page[0].RunID != run.RunID {
		t.Fatalf("batch rollback or association lost: %+v %v", page, err)
	}
	wrongRun := addition
	wrongRun.ChatID = "newer-chat"
	wrongRun.RunID = run.RunID
	if err := repo.ImportAIMessages(ctx, c, u, []AIMessage{first, wrongRun}); !errors.Is(err, ErrConflict) {
		t.Fatalf("run from different chat: %v", err)
	}
	for _, ids := range [][]int64{{11, 999}, {11, 11}, {0}} {
		if err := repo.PruneAIMessages(ctx, c, u, chat.ChatID, ids); err == nil {
			t.Fatalf("invalid snapshot accepted: %v", ids)
		}
		if kept, err := repo.ListAIMessages(ctx, c, u, chat.ChatID, 10, 0); err != nil || len(kept) != 3 {
			t.Fatalf("invalid snapshot deleted messages: %+v %v", kept, err)
		}
	}
	if err := repo.PruneAIMessages(ctx, c, u, chat.ChatID, []int64{30, 11}); err != nil {
		t.Fatal(err)
	}
	page, err = repo.ListAIMessages(ctx, c, u, chat.ChatID, 10, 0)
	if err != nil || len(page) != 2 || page[0].MessageID != 11 || page[1].MessageID != 30 {
		t.Fatalf("compaction snapshot: %+v %v", page, err)
	}
	if _, err := repo.DeleteCompanyUser(c, u, false); err != nil {
		t.Fatal(err)
	}
	if err := repo.ImportAIMessages(ctx, c, u, []AIMessage{addition}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked member import: %v", err)
	}
	if err := repo.PruneAIMessages(ctx, c, u, chat.ChatID, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked member prune: %v", err)
	}
	if _, err := repo.ListAIChats(ctx, c, u, 10, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked member chats: %v", err)
	}
	if _, err := repo.AddCompanyMembership(subject, c, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if restored, err := repo.ListAIMessages(ctx, c, u, chat.ChatID, 10, 0); err != nil || !reflect.DeepEqual(restored, page) {
		t.Fatalf("membership removal erased history: %+v %v", restored, err)
	}
	if err := repo.PruneAIMessages(ctx, c, u, chat.ChatID, nil); err != nil {
		t.Fatal(err)
	}
	if empty, err := repo.ListAIMessages(ctx, c, u, chat.ChatID, 10, 0); err != nil || len(empty) != 0 {
		t.Fatalf("empty native snapshot: %+v %v", empty, err)
	}
	if other, err := repo.ListAIMessages(ctx, otherC, otherU, chat.ChatID, 10, 0); err != nil || len(other) != 1 {
		t.Fatalf("prune crossed scope: %+v %v", other, err)
	}
}
