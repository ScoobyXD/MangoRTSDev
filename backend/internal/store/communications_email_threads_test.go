package store

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryCommunicationsEmailThreadPersistsRichOrderedMailboxScopedSnapshots(t *testing.T) {
	repo := NewMemoryRepo()
	input := CommunicationsEmailThreadUpsertInput{
		CompanyID:            "11111111-1111-4111-8111-111111111191",
		PersonalUserID:       "22222222-2222-4222-8222-222222222291",
		PersonalAccountEmail: "owner@example.com",
		AccountEmail:         "owner@example.com",
		ProviderThreadID:     "provider-thread-1",
		SelectedMessageID:    "provider-message-late",
		FetchedAt:            time.Unix(1_780_000_000, 0).UTC(),
		Messages: []domain.EmailMessageSnapshot{
			{
				ID: "provider-message-late", ThreadID: "provider-thread-1", Subject: "Re: Rich thread",
				Date: 20, Body: "<table><tr><td><strong>Bold</strong></td></tr></table>", Snippet: "Bold",
				From:    []domain.EmailAddressSnapshot{{Name: "Sender", Email: "sender@example.com"}},
				To:      []domain.EmailAddressSnapshot{{Email: "owner@example.com"}},
				ReplyTo: []domain.EmailAddressSnapshot{{Email: "reply@example.com"}},
				Unread:  true, Starred: true, Folders: []string{"Inbox"}, FolderIDs: []string{"folder-inbox"},
				Attachments: []domain.EmailAttachmentSnapshot{{
					ID: "provider-attachment-1", Filename: "report.pdf", ContentType: "application/pdf", Size: 128,
				}},
			},
			{
				ID: "provider-message-early", ThreadID: "provider-thread-1", Subject: "Rich thread",
				Date: 10, Body: "<p style=\"font-family: serif\"><em>Earlier</em> <a href=\"https://example.com\">link</a></p>",
				Snippet: "Earlier link", Cc: []domain.EmailAddressSnapshot{{Email: "cc@example.com"}},
			},
		},
	}

	partial, err := repo.UpsertCommunicationsEmailThread(input)
	if err != nil {
		t.Fatalf("UpsertCommunicationsEmailThread partial: %v", err)
	}
	if partial.DownloadStatus != CommunicationsEmailThreadDownloadPartial || partial.HistoryComplete {
		t.Fatalf("partial download state = %q/%v", partial.DownloadStatus, partial.HistoryComplete)
	}
	if len(partial.Messages) != 2 || partial.Messages[0].ProviderMessageID != "provider-message-early" || partial.Messages[1].ProviderMessageID != "provider-message-late" {
		t.Fatalf("deterministic message order = %+v", partial.Messages)
	}
	stableMessageIDs := map[string]string{}
	for _, message := range partial.Messages {
		stableMessageIDs[message.ProviderMessageID] = message.EmailMessageID
	}

	input.HistoryComplete = true
	input.FetchedAt = input.FetchedAt.Add(time.Minute)
	complete, err := repo.UpsertCommunicationsEmailThread(input)
	if err != nil {
		t.Fatalf("UpsertCommunicationsEmailThread complete: %v", err)
	}
	if complete.EmailThreadID != partial.EmailThreadID || complete.DownloadStatus != CommunicationsEmailThreadDownloadComplete || !complete.HistoryComplete {
		t.Fatalf("completed thread identity/state = %+v", complete)
	}
	for _, message := range complete.Messages {
		if message.EmailMessageID != stableMessageIDs[message.ProviderMessageID] {
			t.Fatalf("Mango message ID changed for %s: %s", message.ProviderMessageID, message.EmailMessageID)
		}
	}
	late := complete.Messages[1].Message
	if !strings.Contains(late.Body, "<table>") || !strings.Contains(late.Body, "<strong>Bold</strong>") {
		t.Fatalf("rich HTML body was flattened: %q", late.Body)
	}
	if len(late.Attachments) != 1 || late.Attachments[0].Filename != "report.pdf" || late.Attachments[0].Size != 128 {
		t.Fatalf("attachment metadata = %+v", late.Attachments)
	}
	if len(late.To) != 1 || len(late.ReplyTo) != 1 || !late.Unread || !late.Starred {
		t.Fatalf("message envelope/read metadata = %+v", late)
	}

	otherScope := input
	otherScope.PersonalUserID = "33333333-3333-4333-8333-333333333391"
	otherScope.PersonalAccountEmail = "other@example.com"
	otherScope.AccountEmail = "other@example.com"
	other, err := repo.UpsertCommunicationsEmailThread(otherScope)
	if err != nil {
		t.Fatalf("UpsertCommunicationsEmailThread other mailbox: %v", err)
	}
	if other.EmailThreadID == complete.EmailThreadID {
		t.Fatal("provider thread IDs collided across personal mailbox scopes")
	}
}

func TestMemoryCommunicationsEmailThreadConvergesMessageFallbackToProviderThread(t *testing.T) {
	repo := NewMemoryRepo()
	input := CommunicationsEmailThreadUpsertInput{
		CompanyID:            "11111111-1111-4111-8111-111111111194",
		PersonalUserID:       "22222222-2222-4222-8222-222222222294",
		PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com",
		SelectedMessageID: "provider-root",
		Messages:          []domain.EmailMessageSnapshot{{ID: "provider-root", Subject: "Fallback identity", Body: "<p>Stored</p>"}},
	}
	fallback, err := repo.UpsertCommunicationsEmailThread(input)
	if err != nil {
		t.Fatalf("fallback upsert: %v", err)
	}
	input.ProviderThreadID = "provider-thread-known-later"
	input.Messages[0].ThreadID = input.ProviderThreadID
	input.HistoryComplete = true
	downloaded, err := repo.UpsertCommunicationsEmailThread(input)
	if err != nil {
		t.Fatalf("provider-thread upsert: %v", err)
	}
	if downloaded.EmailThreadID != fallback.EmailThreadID ||
		downloaded.Messages[0].EmailMessageID != fallback.Messages[0].EmailMessageID {
		t.Fatalf("fallback identity forked after provider thread became known: fallback=%+v downloaded=%+v", fallback, downloaded)
	}
}

func TestCommunicationsEmailThreadRejectsCrossThreadAndMissingSelectedMessage(t *testing.T) {
	repo := NewMemoryRepo()
	input := CommunicationsEmailThreadUpsertInput{
		CompanyID:            "11111111-1111-4111-8111-111111111195",
		PersonalUserID:       "22222222-2222-4222-8222-222222222295",
		PersonalAccountEmail: "owner@example.com",
		AccountEmail:         "owner@example.com",
		ProviderThreadID:     "provider-thread-a",
		SelectedMessageID:    "provider-message-a",
		Messages: []domain.EmailMessageSnapshot{
			{ID: "provider-message-a", ThreadID: "provider-thread-a"},
			{ID: "provider-message-b", ThreadID: "provider-thread-b"},
		},
	}
	if _, err := repo.UpsertCommunicationsEmailThread(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-thread upsert error = %v, want ErrInvalid", err)
	}
	input.Messages = input.Messages[:1]
	input.SelectedMessageID = "missing-provider-message"
	if _, err := repo.UpsertCommunicationsEmailThread(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing selected message error = %v, want ErrInvalid", err)
	}
}

func TestCommunicationsEmailThreadSchemaKeepsBodiesAndMetadataOutOfHotProjections(t *testing.T) {
	for _, path := range []string{
		"../../db/schema.sql",
		"../../db/migrations/20260719_persist_node_email_threads.sql",
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		source := strings.ToLower(string(raw))
		for _, required := range []string{
			"create table if not exists communications_email_threads",
			"create table if not exists communications_email_messages",
			"create table if not exists communications_node_email_threads",
			"rich_html_body text",
			"attachment_metadata jsonb",
			"foreign key (company_id, email_thread_id)",
		} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s missing %q", path, required)
			}
		}
		for _, forbidden := range []string{"attachment_bytes", "presigned_url", "object_url"} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s must not persist %q", path, forbidden)
			}
		}
	}
}

func TestMemoryCommunicationsEmailThreadDownloadJobsAreDurableAndIdempotent(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111196"
	userID := "22222222-2222-4222-8222-222222222296"
	thread, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com",
		ProviderThreadID: "provider-thread", SelectedMessageID: "provider-root",
		Messages: []domain.EmailMessageSnapshot{{ID: "provider-root", ThreadID: "provider-thread", Body: "<p>Selected</p>"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	first, created, err := repo.EnsureCommunicationsEmailThreadDownloadJob(companyID, thread.EmailThreadID, CommunicationsEmailThreadDownloadScopeFullThread, "", userID)
	if err != nil || !created {
		t.Fatalf("first durable job = %+v created=%v err=%v", first, created, err)
	}
	second, created, err := repo.EnsureCommunicationsEmailThreadDownloadJob(companyID, thread.EmailThreadID, CommunicationsEmailThreadDownloadScopeFullThread, "", userID)
	if err != nil || created || second.DownloadJobID != first.DownloadJobID {
		t.Fatalf("duplicate ensure = %+v created=%v err=%v", second, created, err)
	}

	claimed, err := repo.ClaimCommunicationsEmailThreadDownloadJobs(10, time.Minute)
	if err != nil || len(claimed) != 1 || claimed[0].AttemptCount != 1 || claimed[0].Status != CommunicationsEmailThreadDownloadJobProcessing {
		t.Fatalf("first claim = %+v err=%v", claimed, err)
	}
	if err := repo.MarkCommunicationsEmailThreadDownloadJobFailed(first.DownloadJobID, "email_thread_source_unavailable", time.Now().Add(time.Hour), false); err != nil {
		t.Fatal(err)
	}
	retrying, err := repo.GetCommunicationsEmailThread(companyID, thread.EmailThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if retrying.DownloadStatus != CommunicationsEmailThreadDownloadDownloading {
		t.Fatalf("retrying thread status = %q, want downloading", retrying.DownloadStatus)
	}
	claimed, err = repo.ClaimCommunicationsEmailThreadDownloadJobs(10, time.Minute)
	if err != nil || len(claimed) != 0 {
		t.Fatalf("early retry claim = %+v err=%v", claimed, err)
	}
	if err := repo.MarkCommunicationsEmailThreadDownloadJobFailed(first.DownloadJobID, "email_thread_source_unavailable", time.Now().Add(-time.Second), false); err != nil {
		t.Fatal(err)
	}
	claimed, err = repo.ClaimCommunicationsEmailThreadDownloadJobs(10, time.Minute)
	if err != nil || len(claimed) != 1 || claimed[0].AttemptCount != 2 {
		t.Fatalf("retry claim = %+v err=%v", claimed, err)
	}
	if err := repo.MarkCommunicationsEmailThreadDownloadJobCompleted(first.DownloadJobID); err != nil {
		t.Fatal(err)
	}
	jobs, err := repo.ListCommunicationsEmailThreadDownloadJobs(companyID, thread.EmailThreadID)
	if err != nil || len(jobs) != 1 || jobs[0].Status != CommunicationsEmailThreadDownloadJobCompleted {
		t.Fatalf("jobs = %+v err=%v", jobs, err)
	}
}

func TestMemoryCommunicationsEmailThreadLaterManualMessageReusesThreadAndQueuesOnlyMessage(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111197"
	userID := "22222222-2222-4222-8222-222222222297"
	base := CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com",
		ProviderThreadID: "provider-thread", SelectedMessageID: "provider-old", HistoryComplete: true,
		Messages: []domain.EmailMessageSnapshot{{ID: "provider-old", ThreadID: "provider-thread", Date: 10, Body: "old", DownloadComplete: true}},
	}
	stored, err := repo.UpsertCommunicationsEmailThread(base)
	if err != nil {
		t.Fatal(err)
	}
	oldMangoMessageID := stored.Messages[0].EmailMessageID

	later := base
	later.SelectedMessageID = "provider-new"
	later.Messages = []domain.EmailMessageSnapshot{{ID: "provider-new", ThreadID: "provider-thread", Date: 20, Body: "new"}}
	later.RequestDownload = true
	later.RequestedByUserID = userID
	updated, err := repo.UpsertCommunicationsEmailThread(later)
	if err != nil {
		t.Fatal(err)
	}
	if updated.EmailThreadID != stored.EmailThreadID || len(updated.Messages) != 2 || updated.Messages[0].EmailMessageID != oldMangoMessageID {
		t.Fatalf("later message forked stored thread: before=%+v after=%+v", stored, updated)
	}
	scope, messageID, ok := communicationsEmailThreadDownloadRequest(updated, later)
	if !ok || scope != CommunicationsEmailThreadDownloadScopeMessage || messageID != "provider-new" {
		t.Fatalf("later download request = scope=%q message=%q ok=%v", scope, messageID, ok)
	}
	job, created, err := repo.EnsureCommunicationsEmailThreadDownloadJob(companyID, updated.EmailThreadID, scope, messageID, userID)
	if err != nil || !created || job.DownloadScope != CommunicationsEmailThreadDownloadScopeMessage {
		t.Fatalf("later job=%+v created=%v err=%v", job, created, err)
	}
	duplicate, created, err := repo.EnsureCommunicationsEmailThreadDownloadJob(companyID, updated.EmailThreadID, scope, messageID, userID)
	if err != nil || created || duplicate.DownloadJobID != job.DownloadJobID {
		t.Fatalf("later duplicate=%+v created=%v err=%v", duplicate, created, err)
	}
}

func TestMemoryCommunicationsEmailThreadFindsExistingNonRootMessageBeforeAssigningThreadID(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111198"
	userID := "22222222-2222-4222-8222-222222222298"
	stored, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com",
		SelectedMessageID: "provider-root",
		Messages: []domain.EmailMessageSnapshot{
			{ID: "provider-root", Date: 10, Body: "root"},
			{ID: "provider-known-reply", Date: 20, Body: "known reply"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if stored.ProviderThreadID != "" {
		t.Fatalf("initial provider thread id = %q, want empty", stored.ProviderThreadID)
	}

	assigned, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com",
		ProviderThreadID: "provider-thread", SelectedMessageID: "provider-known-reply",
		Messages: []domain.EmailMessageSnapshot{{ID: "provider-known-reply", ThreadID: "provider-thread", Date: 20, Body: "known reply complete"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if assigned.EmailThreadID != stored.EmailThreadID || assigned.ProviderThreadID != "provider-thread" || len(assigned.Messages) != 2 {
		t.Fatalf("thread-id assignment duplicated stored thread: before=%+v after=%+v", stored, assigned)
	}

	appended, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com",
		ProviderThreadID: "provider-thread", SelectedMessageID: "provider-new-reply",
		Messages: []domain.EmailMessageSnapshot{{ID: "provider-new-reply", ThreadID: "provider-thread", Date: 30, Body: "new reply"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if appended.EmailThreadID != stored.EmailThreadID || len(appended.Messages) != 3 {
		t.Fatalf("new reply did not reuse assigned thread: %+v", appended)
	}

	_, err = repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com",
		ProviderThreadID: "conflicting-thread", SelectedMessageID: "provider-known-reply",
		Messages: []domain.EmailMessageSnapshot{{ID: "provider-known-reply", ThreadID: "conflicting-thread"}},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("conflicting thread identity error = %v, want ErrInvalid", err)
	}
}

func TestCommunicationsEmailThreadDurableDownloadSchemaContract(t *testing.T) {
	checks := map[string][]string{
		"../../db/schema.sql": {
			"download_status text not null",
			"download_complete boolean not null default false",
			"create table if not exists communications_email_thread_download_jobs",
			"idx_communications_email_thread_download_jobs_active_full",
			"idx_communications_email_thread_download_jobs_active_message",
			"unique (company_id, email_thread_id, provider_message_id)",
		},
		"../../db/migrations/20260728_durable_email_thread_download_jobs.sql": {
			"rename column hydration_status to download_status",
			"rename column last_hydration_error to last_download_error",
			"add column if not exists download_complete boolean not null default false",
			"create table if not exists communications_email_thread_download_jobs",
			"idx_communications_email_thread_download_jobs_active_full",
			"idx_communications_email_thread_download_jobs_active_message",
		},
	}
	for path, required := range checks {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		source := strings.ToLower(string(raw))
		for _, fragment := range required {
			if !strings.Contains(source, fragment) {
				t.Fatalf("%s missing %q", path, fragment)
			}
		}
	}
}
