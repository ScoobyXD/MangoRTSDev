package store

import (
	"errors"
	"testing"
)

func TestMemoryLogicGateWorkspaceEventsAreAtomic(t *testing.T) {
	companyID := "19191919-1919-4191-8191-191919191906"
	forced := errors.New("forced event append failure")

	t.Run("create", func(t *testing.T) {
		repo := NewMemoryRepo()
		repo.domainEventAppendErr = forced
		if _, _, err := repo.CreateLogicGateWithWorkspaceEvent(companyID, "not committed", ""); !errors.Is(err, forced) {
			t.Fatalf("CreateLogicGateWithWorkspaceEvent error = %v, want forced failure", err)
		}
		if gates, _ := repo.ListLogicGates(companyID); len(gates) != 0 {
			t.Fatalf("logic gates after failed append = %d, want 0", len(gates))
		}
		if len(repo.domainEvents) != 0 || len(repo.realtimeOutbox) != 0 {
			t.Fatalf("split create domain_events=%d outbox=%d", len(repo.domainEvents), len(repo.realtimeOutbox))
		}
	})

	t.Run("update", func(t *testing.T) {
		repo := NewMemoryRepo()
		gate, event, err := repo.CreateLogicGateWithWorkspaceEvent(companyID, "original", "")
		if err != nil {
			t.Fatalf("CreateLogicGateWithWorkspaceEvent: %v", err)
		}
		if event.Type != "logic_gate_created" || len(repo.realtimeOutbox) != 2 {
			t.Fatalf("create event=%q outbox=%d, want Logic Gate and Process Map invalidations", event.Type, len(repo.realtimeOutbox))
		}
		repo.domainEventAppendErr = forced
		if _, _, err := repo.UpdateLogicGateHeaderWithWorkspaceEvent(companyID, gate.LogicGateID, "not committed"); !errors.Is(err, forced) {
			t.Fatalf("UpdateLogicGateHeaderWithWorkspaceEvent error = %v, want forced failure", err)
		}
		stored, err := repo.GetLogicGate(companyID, gate.LogicGateID)
		if err != nil || stored.Header != "original" {
			t.Fatalf("logic gate after failed update = %+v err=%v", stored, err)
		}

		if len(repo.domainEvents) != 1 || len(repo.realtimeOutbox) != 2 {
			t.Fatalf("failed update domain_events=%d outbox=%d, want 1/2", len(repo.domainEvents), len(repo.realtimeOutbox))
		}

		repo.domainEventAppendErr = nil
		updated, updateEvent, err := repo.UpdateLogicGateHeaderWithWorkspaceEvent(companyID, gate.LogicGateID, "committed")
		if err != nil {
			t.Fatalf("UpdateLogicGateHeaderWithWorkspaceEvent: %v", err)
		}
		if updated.Header != "committed" || updateEvent.Type != "logic_gate_updated" {
			t.Fatalf("update=%+v event=%q", updated, updateEvent.Type)
		}

		if len(repo.domainEvents) != 2 || len(repo.realtimeOutbox) != 4 {
			t.Fatalf("committed update domain_events=%d outbox=%d, want 2 events and board plus Process Map invalidations", len(repo.domainEvents), len(repo.realtimeOutbox))
		}
	})
}
