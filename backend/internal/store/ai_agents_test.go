package store

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func TestAIAgentMemoryOwnershipAndExactReceipt(t *testing.T) {
	repo := NewMemoryRepo()
	ctx := context.Background()
	session := AIAgentSession{ID: "asess_owner", CompanyID: "company_a", UserID: "owner", Prompt: "private", Skills: json.RawMessage(`[{"name":"review","content":"private"}]`)}
	if err := repo.CreateAIAgentSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	action := AIAgentAction{SessionID: session.ID, TurnID: "turn_a", CallID: "call_a", Name: "create_process_node", Arguments: json.RawMessage(`{"title":"original"}`), Consequential: true}
	if err := repo.PutAIAgentAction(ctx, session.CompanyID, session.UserID, action); err != nil {
		t.Fatal(err)
	}
	for _, scope := range [][2]string{{"company_a", "other_user"}, {"company_b", "owner"}} {
		if _, err := repo.GetAIAgentSession(ctx, scope[0], scope[1], session.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign session read: %v", err)
		}
		if items, err := repo.ListAIAgentSessions(ctx, scope[0], scope[1]); err != nil || len(items) != 0 {
			t.Fatalf("foreign session list: %+v, %v", items, err)
		}
		if _, err := repo.ListAIAgentActions(ctx, scope[0], scope[1], session.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign action read: %v", err)
		}
		if err := repo.PutAIAgentAction(ctx, scope[0], scope[1], action); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign put: %v", err)
		}
		if claimed, err := repo.ClaimAIAgentAction(ctx, scope[0], scope[1], session.ID, action.TurnID, action.CallID); claimed || !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign claim: %v, %v", claimed, err)
		}
		if err := repo.StopAIAgentSession(ctx, scope[0], scope[1], session.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign stop: %v", err)
		}
		if err := repo.DeleteAIAgentSession(ctx, scope[0], scope[1], session.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign delete: %v", err)
		}
	}
	changed := action
	changed.Name, changed.Arguments, changed.Consequential = "other_tool", json.RawMessage(`{"title":"changed"}`), false
	if err := repo.PutAIAgentAction(ctx, session.CompanyID, session.UserID, changed); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListAIAgentActions(ctx, session.CompanyID, session.UserID, session.ID)
	if err != nil || len(items) != 1 || items[0].Name != action.Name || string(items[0].Arguments) != string(action.Arguments) || !items[0].Consequential {
		t.Fatalf("original receipt replaced: %+v, %v", items, err)
	}
	items[0].Arguments[0] = '!'
	again, _ := repo.ListAIAgentActions(ctx, session.CompanyID, session.UserID, session.ID)
	if string(again[0].Arguments) != string(action.Arguments) {
		t.Fatal("returned action aliases stored arguments")
	}
	got, _ := repo.GetAIAgentSession(ctx, session.CompanyID, session.UserID, session.ID)
	got.Skills[0] = '!'
	got, _ = repo.GetAIAgentSession(ctx, session.CompanyID, session.UserID, session.ID)
	if !json.Valid(got.Skills) {
		t.Fatal("returned session aliases stored skills")
	}
	claimed, err := repo.ClaimAIAgentAction(ctx, session.CompanyID, session.UserID, session.ID, action.TurnID, action.CallID)
	if err != nil || !claimed {
		t.Fatalf("claim original receipt: %v, %v", claimed, err)
	}
	changed.State, changed.Output = "completed", json.RawMessage(`{"created":true}`)
	if err := repo.FinishAIAgentAction(ctx, session.CompanyID, "other_user", changed); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign finish: %v", err)
	}
	if err := repo.FinishAIAgentAction(ctx, session.CompanyID, session.UserID, changed); err != nil {
		t.Fatal(err)
	}
	again, _ = repo.ListAIAgentActions(ctx, session.CompanyID, session.UserID, session.ID)
	if again[0].Name != action.Name || string(again[0].Arguments) != string(action.Arguments) || !again[0].Consequential || again[0].State != "completed" {
		t.Fatalf("finishing changed the approved receipt identity: %+v", again[0])
	}
}

func TestAIAgentMemoryClaimsOnceAndStopsNewClaims(t *testing.T) {
	repo := NewMemoryRepo()
	ctx := context.Background()
	session := AIAgentSession{ID: "asess_claim", CompanyID: "company", UserID: "owner", Skills: json.RawMessage(`[]`)}
	if err := repo.CreateAIAgentSession(ctx, session); err != nil {
		t.Fatal(err)
	}
	action := AIAgentAction{SessionID: session.ID, TurnID: "turn", CallID: "call", Name: "create_process_node", Arguments: json.RawMessage(`{}`), Consequential: true}
	if err := repo.PutAIAgentAction(ctx, session.CompanyID, session.UserID, action); err != nil {
		t.Fatal(err)
	}
	var claims atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			claimed, err := repo.ClaimAIAgentAction(ctx, session.CompanyID, session.UserID, session.ID, action.TurnID, action.CallID)
			if err != nil {
				t.Error(err)
			}
			if claimed {
				claims.Add(1)
			}
		}()
	}
	wg.Wait()
	if claims.Load() != 1 {
		t.Fatalf("approved action claimed %d times", claims.Load())
	}
	action.State, action.Output = "completed", json.RawMessage(`{"node_id":"actual-node"}`)
	if err := repo.FinishAIAgentAction(ctx, session.CompanyID, session.UserID, action); err != nil {
		t.Fatal(err)
	}
	if claimed, err := repo.ClaimAIAgentAction(ctx, session.CompanyID, session.UserID, session.ID, action.TurnID, action.CallID); claimed || err != nil {
		t.Fatalf("completed receipt reclaimed: %v, %v", claimed, err)
	}
	action.CallID, action.State, action.Output = "next", "", nil
	if err := repo.PutAIAgentAction(ctx, session.CompanyID, session.UserID, action); err != nil {
		t.Fatal(err)
	}
	if err := repo.StopAIAgentSession(ctx, session.CompanyID, session.UserID, session.ID); err != nil {
		t.Fatal(err)
	}
	if claimed, err := repo.ClaimAIAgentAction(ctx, session.CompanyID, session.UserID, session.ID, action.TurnID, action.CallID); claimed || err != nil {
		t.Fatalf("stopped session claimed action: %v, %v", claimed, err)
	}
	if err := repo.DeleteAIAgentSession(ctx, session.CompanyID, session.UserID, session.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ListAIAgentActions(ctx, session.CompanyID, session.UserID, session.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted session retained public receipts: %v", err)
	}
}
