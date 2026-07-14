package store

import (
	"testing"
	"time"
)

func TestMemoryCommunicationsReadReceiptStoresObservedSignals(t *testing.T) {
	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("receipt-signals", "receipt-signals@example.com", "Receipt Signals")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	first := time.Date(2026, 7, 14, 17, 5, 0, 0, time.UTC)
	second := first.Add(time.Hour)
	input := CommunicationsMessageReadStatusInput{
		ScopeType:            "personal",
		UserID:               user.UserID,
		PersonalAccountEmail: user.Email,
		MessageID:            "message-signals",
		Status:               "likely_read",
		SignalTimestamp:      second,
		SignalTimestamps:     []time.Time{second, first, second},
		SignalCount:          3,
	}
	status, err := repo.UpsertCommunicationsMessageReadStatus(input)
	if err != nil {
		t.Fatalf("UpsertCommunicationsMessageReadStatus: %v", err)
	}
	if len(status.Signals) != 2 || !status.Signals[0].Timestamp.Equal(first) || !status.Signals[1].Timestamp.Equal(second) {
		t.Fatalf("Signals = %+v, want ascending deduplicated timestamps", status.Signals)
	}

	third := second.Add(time.Hour)
	input.SignalTimestamp = third
	input.SignalTimestamps = []time.Time{third}
	input.SignalCount = 4
	if _, err := repo.UpsertCommunicationsMessageReadStatus(input); err != nil {
		t.Fatalf("second UpsertCommunicationsMessageReadStatus: %v", err)
	}
	statuses, err := repo.ListCommunicationsMessageReadStatuses(CommunicationsMessageReadStatusListInput{
		ScopeType:            "personal",
		UserID:               user.UserID,
		PersonalAccountEmail: user.Email,
		MessageIDs:           []string{"message-signals"},
	})
	if err != nil {
		t.Fatalf("ListCommunicationsMessageReadStatuses: %v", err)
	}
	if len(statuses) != 1 || len(statuses[0].Signals) != 3 || !statuses[0].Signals[2].Timestamp.Equal(third) {
		t.Fatalf("listed Signals = %+v, want three retained events", statuses)
	}
}
