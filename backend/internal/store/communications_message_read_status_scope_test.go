package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMemoryRepoCommunicationsMessageReadStatusesSeparatePersonalAccounts(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("receipt-account-collision", "owner@example.com", "Receipt Owner")
	if err != nil {
		t.Fatal(err)
	}

	signalAt := time.Date(2026, time.July, 13, 12, 0, 0, 0, time.UTC)
	accountA, err := repo.UpsertCommunicationsMessageReadStatusContext(context.Background(), CommunicationsMessageReadStatusInput{
		UserID:               user.UserID,
		PersonalAccountEmail: "  Account-A@Example.com ",
		MessageID:            "provider-message-collision",
		ThreadID:             "thread-a",
		Status:               "likely_read",
		SignalCount:          2,
		SignalTimestamp:      signalAt,
	})
	if err != nil {
		t.Fatalf("upsert account A: %v", err)
	}
	accountB, err := repo.UpsertCommunicationsMessageReadStatusContext(context.Background(), CommunicationsMessageReadStatusInput{
		UserID:               user.UserID,
		PersonalAccountEmail: "account-b@example.com",
		MessageID:            "provider-message-collision",
		ThreadID:             "thread-b",
		Status:               "read",
		SignalCount:          7,
		SignalTimestamp:      signalAt.Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("upsert account B: %v", err)
	}
	if accountA.ScopeID == accountB.ScopeID {
		t.Fatalf("personal receipt scopes collided: %q", accountA.ScopeID)
	}
	if accountA.PersonalAccountEmail != "account-a@example.com" || accountB.PersonalAccountEmail != "account-b@example.com" {
		t.Fatalf("normalized account identities = %q and %q", accountA.PersonalAccountEmail, accountB.PersonalAccountEmail)
	}

	list := func(accountEmail string) []string {
		t.Helper()
		statuses, err := repo.ListCommunicationsMessageReadStatuses(CommunicationsMessageReadStatusListInput{
			UserID:               user.UserID,
			PersonalAccountEmail: accountEmail,
			MessageIDs:           []string{"provider-message-collision"},
		})
		if err != nil {
			t.Fatalf("list account %q: %v", accountEmail, err)
		}
		if len(statuses) != 1 {
			t.Fatalf("list account %q = %+v, want one exact receipt", accountEmail, statuses)
		}
		return []string{statuses[0].PersonalAccountEmail, statuses[0].ThreadID, statuses[0].Status}
	}
	if got := list("ACCOUNT-A@example.com"); got[0] != "account-a@example.com" || got[1] != "thread-a" || got[2] != "likely_read" {
		t.Fatalf("account A receipt = %v", got)
	}
	if got := list("account-b@example.com"); got[0] != "account-b@example.com" || got[1] != "thread-b" || got[2] != "read" {
		t.Fatalf("account B receipt = %v", got)
	}

	if _, err := repo.ListCommunicationsMessageReadStatuses(CommunicationsMessageReadStatusListInput{
		UserID:     user.UserID,
		MessageIDs: []string{"provider-message-collision"},
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("broad user-only receipt list error = %v, want ErrInvalid", err)
	}
	if _, err := repo.UpsertCommunicationsMessageReadStatusContext(context.Background(), CommunicationsMessageReadStatusInput{
		UserID:    user.UserID,
		MessageID: "new-provider-message",
		Status:    "likely_read",
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("broad user-only receipt write error = %v, want ErrInvalid", err)
	}
}

func TestMemoryRepoCommunicationsMessageReadStatusSameSignalIsIdempotent(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("receipt-signal-idempotency", "owner@example.com", "Receipt Owner")
	if err != nil {
		t.Fatal(err)
	}
	signalAt := time.Date(2026, time.July, 13, 13, 0, 0, 0, time.UTC)
	input := CommunicationsMessageReadStatusInput{
		UserID:               user.UserID,
		PersonalAccountEmail: "owner@example.com",
		MessageID:            "message-idempotent",
		Status:               "likely_read",
		SignalTimestamp:      signalAt,
	}

	first, err := repo.UpsertCommunicationsMessageReadStatusContext(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if first.SignalCount != 1 {
		t.Fatalf("first implicit signal count = %d, want 1", first.SignalCount)
	}
	retry, err := repo.UpsertCommunicationsMessageReadStatusContext(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if retry.SignalCount != 1 {
		t.Fatalf("same-timestamp retry signal count = %d, want 1", retry.SignalCount)
	}

	input.SignalTimestamp = signalAt.Add(time.Second)
	later, err := repo.UpsertCommunicationsMessageReadStatusContext(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if later.SignalCount != 2 {
		t.Fatalf("later distinct signal count = %d, want 2", later.SignalCount)
	}
}
