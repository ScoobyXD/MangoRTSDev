package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
	"time"
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
	first, err := repo.CreateCommunicationsArchiveJob(CommunicationsArchiveJobInput{
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
	second, err := repo.CreateCommunicationsArchiveJob(CommunicationsArchiveJobInput{
		ActorUserID: user.UserID,
		Connection:  connection,
		MessageIDs:  []string{"message-1", "message-3"},
	})
	if err != nil {
		t.Fatalf("CreateCommunicationsArchiveJob second: %v", err)
	}
	if second.CreatedItemCount != 1 || len(second.Items) != 1 || second.Items[0].MessageID != "message-3" {
		t.Fatalf("second job = %+v, want only non-active duplicate item", second)
	}
	claimed, err := repo.ClaimCommunicationsArchiveJobItems(10, time.Minute)
	if err != nil {
		t.Fatalf("ClaimCommunicationsArchiveJobItems: %v", err)
	}
	if len(claimed) != 3 {
		t.Fatalf("claimed = %+v, want three active unique messages", claimed)
	}
}

func TestCommunicationsArchiveJobRetryAndFinalFailureBookkeeping(t *testing.T) {
	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("archive-job-retry-user", "archive-job-retry@example.com", "Archive Retry User")
	if err != nil {
		t.Fatal(err)
	}
	job, err := repo.CreateCommunicationsArchiveJob(CommunicationsArchiveJobInput{
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
	claimed, err := repo.ClaimCommunicationsArchiveJobItems(10, time.Minute)
	if err != nil {
		t.Fatalf("ClaimCommunicationsArchiveJobItems: %v", err)
	}
	if len(claimed) != 1 || claimed[0].AttemptCount != 1 || claimed[0].Status != CommunicationsArchiveJobItemStatusProcessing {
		t.Fatalf("claimed = %+v, want one processing attempt", claimed)
	}
	future := time.Now().UTC().Add(time.Hour)
	if err := repo.MarkCommunicationsArchiveJobItemFailed(claimed[0].JobItemID, "nylas_rate_limited", future, false); err != nil {
		t.Fatalf("MarkCommunicationsArchiveJobItemFailed retry: %v", err)
	}
	early, err := repo.ClaimCommunicationsArchiveJobItems(10, time.Minute)
	if err != nil {
		t.Fatalf("ClaimCommunicationsArchiveJobItems early: %v", err)
	}
	if len(early) != 0 {
		t.Fatalf("early retry claim = %+v, want none before available_at", early)
	}
	if err := repo.MarkCommunicationsArchiveJobItemFailed(claimed[0].JobItemID, "nylas_request_rejected", time.Time{}, true); err != nil {
		t.Fatalf("MarkCommunicationsArchiveJobItemFailed final: %v", err)
	}
	items, err := repo.ListCommunicationsArchiveJobItems(job.JobID)
	if err != nil {
		t.Fatalf("ListCommunicationsArchiveJobItems: %v", err)
	}
	if len(items) != 1 || items[0].Status != CommunicationsArchiveJobItemStatusFailed || items[0].FailedTimestamp == nil || items[0].LastError != "nylas_request_rejected" {
		t.Fatalf("final items = %+v, want failed item", items)
	}
}
