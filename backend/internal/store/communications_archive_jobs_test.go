package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestCommunicationsArchiveJobSkipsDuplicateActiveItems(t *testing.T) {
	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("archive-job-user", "archive-job@example.com", "Archive Job User")
	if err != nil {
		t.Fatal(err)
	}
	connection := domain.UserEmailConnection{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		Scope:        "personal",
		GrantID:      "grant-archive-job",
		Status:       "connected",
	}
	first, err := repo.CreateCommunicationsArchiveJobContext(context.Background(), CommunicationsArchiveJobInput{
		ActorUserID: user.UserID,
		Connection:  connection,
		MessageIDs:  []string{"message-1", "message-2", "message-1"},
	})
	if err != nil {
		t.Fatalf("CreateCommunicationsArchiveJob first: %v", err)
	}
	if first.CreatedItemCount != 2 || len(first.Items) != 2 {
		t.Fatalf("first job = %+v, want two unique items", first)
	}
	second, err := repo.CreateCommunicationsArchiveJobContext(context.Background(), CommunicationsArchiveJobInput{
		ActorUserID: user.UserID,
		Connection:  connection,
		MessageIDs:  []string{"message-1", "message-3"},
	})
	if err != nil {
		t.Fatalf("CreateCommunicationsArchiveJob second: %v", err)
	}
	if second.JobID != first.JobID || second.CreatedItemCount != 1 || len(second.Items) != 2 || second.Items[0].JobItemID != first.Items[0].JobItemID || second.Items[1].MessageID != "message-3" {
		t.Fatalf("second job = %+v, want the existing active marker plus one new item", second)
	}
	firstItems, err := repo.ListCommunicationsArchiveJobItemsContext(context.Background(), first.JobID)
	if err != nil {
		t.Fatalf("ListCommunicationsArchiveJobItems: %v", err)
	}
	if len(firstItems) != 3 || len(second.Items) != 2 {
		t.Fatalf("stable items first=%+v second=%+v", firstItems, second.Items)
	}
}

func TestCommunicationsArchiveJobRetryAndFinalFailureBookkeeping(t *testing.T) {
	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("archive-job-retry-user", "archive-job-retry@example.com", "Archive Retry User")
	if err != nil {
		t.Fatal(err)
	}
	job, err := repo.CreateCommunicationsArchiveJobContext(context.Background(), CommunicationsArchiveJobInput{
		ActorUserID: user.UserID,
		Connection: domain.UserEmailConnection{
			UserID:       user.UserID,
			Provider:     "google",
			AccountEmail: user.Email,
			Scope:        "personal",
			GrantID:      "grant-retry",
			Status:       "connected",
		},
		MessageIDs: []string{"message-1"},
	})
	if err != nil {
		t.Fatalf("CreateCommunicationsArchiveJob: %v", err)
	}
	itemID := job.Items[0].JobItemID
	for attemptNumber := 1; attemptNumber <= 3; attemptNumber++ {
		attempt, started, err := repo.StartCommunicationsArchiveJobItemAttemptContext(context.Background(), itemID)
		if err != nil || !started || attempt.ProviderAttemptCount != attemptNumber || attempt.Status != CommunicationsArchiveJobItemStatusProcessing {
			t.Fatalf("attempt %d = %+v started=%v err=%v", attemptNumber, attempt, started, err)
		}
		if attempt.AttemptToken == "" {
			t.Fatalf("attempt %d has no settlement token", attemptNumber)
		}
		if err := repo.FailCommunicationsArchiveJobItemAttemptContext(context.Background(), itemID, attempt.AttemptToken, "nylas_request_rejected", nil); err != nil {
			t.Fatalf("fail attempt %d: %v", attemptNumber, err)
		}
	}
	items, err := repo.ListCommunicationsArchiveJobItemsContext(context.Background(), job.JobID)
	if err != nil {
		t.Fatalf("ListCommunicationsArchiveJobItems: %v", err)
	}
	if len(items) != 1 || items[0].Status != CommunicationsArchiveJobItemStatusFailed || items[0].ProviderAttemptCount != 3 || items[0].AttemptToken != "" || items[0].FailedTimestamp == nil || items[0].LastError != "nylas_request_rejected" {
		t.Fatalf("final items = %+v, want failed item", items)
	}
}

func TestCommunicationsArchiveJobSettlementRejectsStaleAttemptToken(t *testing.T) {
	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("archive-token-user", "archive-token@example.com", "Archive Token User")
	if err != nil {
		t.Fatal(err)
	}
	job, err := repo.CreateCommunicationsArchiveJobContext(context.Background(), CommunicationsArchiveJobInput{
		ActorUserID: user.UserID,
		Connection: domain.UserEmailConnection{
			UserID:       user.UserID,
			Provider:     "google",
			AccountEmail: user.Email,
			Scope:        "personal",
			GrantID:      "grant-token",
			Status:       "connected",
		},
		MessageIDs: []string{"message-token"},
	})
	if err != nil {
		t.Fatal(err)
	}
	first, started, err := repo.StartCommunicationsArchiveJobItemAttemptContext(context.Background(), job.Items[0].JobItemID)
	if err != nil || !started {
		t.Fatalf("start first attempt: item=%+v started=%v err=%v", first, started, err)
	}
	second, started, err := repo.StartCommunicationsArchiveJobItemAttemptContext(context.Background(), job.Items[0].JobItemID)
	if err != nil || !started || first.AttemptToken == second.AttemptToken {
		t.Fatalf("start second attempt: first=%+v second=%+v started=%v err=%v", first, second, started, err)
	}
	if err := repo.CompleteCommunicationsArchiveJobItemAttemptContext(context.Background(), second.JobItemID, first.AttemptToken, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stale settlement error=%v, want ErrNotFound", err)
	}
	if err := repo.CompleteCommunicationsArchiveJobItemAttemptContext(context.Background(), second.JobItemID, second.AttemptToken, nil); err != nil {
		t.Fatalf("current settlement: %v", err)
	}
}
