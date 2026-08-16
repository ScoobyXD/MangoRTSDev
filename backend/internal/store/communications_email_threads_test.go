package store

import (
	"context"
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
		Provider:             "google",
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
		PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com", Provider: "google",
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

func TestMemoryCommunicationsEmailThreadStaysDownloadingDuringLaterReconciliation(t *testing.T) {
	repo := NewMemoryRepo()
	input := CommunicationsEmailThreadUpsertInput{
		CompanyID:            "11111111-1111-4111-8111-111111111193",
		PersonalUserID:       "22222222-2222-4222-8222-222222222293",
		PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com", Provider: "google",
		ProviderThreadID: "provider-thread", SelectedMessageID: "provider-old", HistoryComplete: true,
		Messages: []domain.EmailMessageSnapshot{{ID: "provider-old", ThreadID: "provider-thread", DownloadComplete: true}},
	}
	stored, err := repo.UpsertCommunicationsEmailThread(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), CommunicationsEmailIngestionJobInput{
		CompanyID: input.CompanyID, EmailConnectionID: stored.EmailConnectionID, EmailThreadID: stored.EmailThreadID,
		ProviderMessageID: "provider-new", ProviderThreadID: stored.ProviderThreadID, Priority: CommunicationsEmailIngestionPriorityVisible,
	}); err != nil {
		t.Fatal(err)
	}
	input.SelectedMessageID = "provider-new"
	input.HistoryComplete = false
	input.Messages = []domain.EmailMessageSnapshot{{ID: "provider-new", ThreadID: "provider-thread", DownloadComplete: false}}
	reconciling, err := repo.UpsertCommunicationsEmailThread(input)
	if err != nil {
		t.Fatal(err)
	}
	if !reconciling.HistoryComplete || reconciling.DownloadStatus != CommunicationsEmailThreadDownloadDownloading {
		t.Fatalf("reconciling state=%q/%v, want downloading with prior history retained", reconciling.DownloadStatus, reconciling.HistoryComplete)
	}
}

func TestMemoryCommunicationsEmailPlacementsAreScopedToExactConnection(t *testing.T) {
	repo := NewMemoryRepo()
	const (
		companyID = "company-connection-placement"
		userID    = "user-connection-placement"
		messageID = "provider-message-shared-by-two-mailboxes"
	)
	repo.emailConnections[emailConnectionKey(userID, "first@example.com")] = domain.UserEmailConnection{
		EmailConnectionID: "connection-first", CompanyID: companyID, UserID: userID,
		AccountEmail: "first@example.com", Scope: "personal",
	}
	repo.emailConnections[emailConnectionKey(userID, "second@example.com")] = domain.UserEmailConnection{
		EmailConnectionID: "connection-second", CompanyID: companyID, UserID: userID,
		AccountEmail: "second@example.com", Scope: "personal",
	}
	now := time.Now().UTC()
	repo.emailNodeLinks["first"] = communicationsEmailNodeLink{
		CompanyID: companyID, UserID: userID, AccountEmail: "first@example.com",
		MessageID: messageID, NodeID: "node-first", CreatedTimestamp: now,
	}
	repo.emailNodeLinks["second"] = communicationsEmailNodeLink{
		CompanyID: companyID, UserID: userID, AccountEmail: "second@example.com",
		MessageID: messageID, NodeID: "node-second", CreatedTimestamp: now,
	}
	placements, err := repo.ListCommunicationsEmailPlacementsForConnection(
		userID, companyID, "connection-second", []string{messageID},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(placements) != 1 || placements[0].NodeID != "node-second" {
		t.Fatalf("connection-scoped placements=%+v, want only node-second", placements)
	}
}

func TestMemoryCommunicationsEmailMessageIdentitiesRequireOneExactConnectionMatch(t *testing.T) {
	repo := NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-111111111196"
	repo.EnsureCompany(companyID, "Stored identity company")
	firstUser, err := repo.UpsertAuthUser("identity-first", "first@example.com", "First")
	if err != nil {
		t.Fatal(err)
	}
	secondUser, err := repo.UpsertAuthUser("identity-second", "second@example.com", "Second")
	if err != nil {
		t.Fatal(err)
	}
	for _, subject := range []string{"identity-first", "identity-second"} {
		if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
	}
	firstConnection, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		CompanyID: companyID, UserID: firstUser.UserID, Provider: "google", AccountEmail: firstUser.Email,
		Scope: "personal", GrantID: "first-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	secondConnection, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		CompanyID: companyID, UserID: secondUser.UserID, Provider: "google", AccountEmail: secondUser.Email,
		Scope: "personal", GrantID: "second-grant", Status: "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	const providerMessageID = "same-provider-message-in-two-mailboxes"
	firstThread, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: firstUser.UserID, PersonalAccountEmail: firstUser.Email,
		AccountEmail: firstUser.Email, Provider: "google", ProviderThreadID: "first-provider-thread",
		SelectedMessageID: providerMessageID,
		Messages:          []domain.EmailMessageSnapshot{{ID: providerMessageID, ThreadID: "first-provider-thread"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	secondThread, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: secondUser.UserID, PersonalAccountEmail: secondUser.Email,
		AccountEmail: secondUser.Email, Provider: "google", ProviderThreadID: "second-provider-thread",
		SelectedMessageID: providerMessageID,
		Messages:          []domain.EmailMessageSnapshot{{ID: providerMessageID, ThreadID: "second-provider-thread"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	identities, err := repo.ResolveCommunicationsEmailMessageIdentitiesForConnectionContext(
		context.Background(), companyID, firstConnection.EmailConnectionID, []string{providerMessageID},
	)
	if err != nil {
		t.Fatal(err)
	}
	identity := identities[providerMessageID]
	if identity.EmailThreadID != firstThread.EmailThreadID || identity.EmailMessageID != firstThread.Messages[0].EmailMessageID {
		t.Fatalf("first connection identity=%+v, want first stored row", identity)
	}
	identities, err = repo.ResolveCommunicationsEmailMessageIdentitiesForConnectionContext(
		context.Background(), companyID, secondConnection.EmailConnectionID, []string{providerMessageID},
	)
	if err != nil {
		t.Fatal(err)
	}
	identity = identities[providerMessageID]
	if identity.EmailThreadID != secondThread.EmailThreadID || identity.EmailMessageID != secondThread.Messages[0].EmailMessageID {
		t.Fatalf("second connection identity=%+v, want second stored row", identity)
	}

	if _, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: firstUser.UserID, PersonalAccountEmail: firstUser.Email,
		AccountEmail: firstUser.Email, Provider: "google", ProviderThreadID: "duplicate-provider-thread",
		SelectedMessageID: "duplicate-thread-root",
		Messages: []domain.EmailMessageSnapshot{
			{ID: "duplicate-thread-root", ThreadID: "duplicate-provider-thread"},
			{ID: providerMessageID, ThreadID: "duplicate-provider-thread"},
		},
	}); err != nil {
		t.Fatal(err)
	}
	identities, err = repo.ResolveCommunicationsEmailMessageIdentitiesForConnectionContext(
		context.Background(), companyID, firstConnection.EmailConnectionID, []string{providerMessageID},
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, found := identities[providerMessageID]; found {
		t.Fatalf("ambiguous same-connection provider identity was returned: %+v", identities[providerMessageID])
	}
}

func TestCommunicationsEmailThreadRejectsCrossThreadAndMissingSelectedMessage(t *testing.T) {
	repo := NewMemoryRepo()
	input := CommunicationsEmailThreadUpsertInput{
		CompanyID:            "11111111-1111-4111-8111-111111111195",
		PersonalUserID:       "22222222-2222-4222-8222-222222222295",
		PersonalAccountEmail: "owner@example.com",
		AccountEmail:         "owner@example.com",
		Provider:             "google",
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
	raw, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("read canonical schema: %v", err)
	}
	source := strings.ToLower(string(raw))
	for _, required := range []string{
		"create table if not exists email_threads",
		"create table if not exists email_messages",
		"create table if not exists email_relationships",
		"rich_html_body text",
		"attachment_metadata jsonb",
		"references email_messages(company_id, email_thread_id, email_message_id)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("canonical schema missing %q", required)
		}
	}
	for _, forbidden := range []string{"attachment_bytes", "presigned_url", "object_url"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("canonical email schema must not persist %q", forbidden)
		}
	}
}
func TestMemoryCommunicationsEmailIngestionJobsAreDurableAndIdempotent(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111196"
	userID := "22222222-2222-4222-8222-222222222296"
	thread, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com", Provider: "google",
		ProviderThreadID: "provider-thread", SelectedMessageID: "provider-root",
		Messages: []domain.EmailMessageSnapshot{{ID: "provider-root", ThreadID: "provider-thread", Body: "<p>Selected</p>"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	jobInput := CommunicationsEmailIngestionJobInput{
		CompanyID: companyID, EmailConnectionID: thread.EmailConnectionID, EmailThreadID: thread.EmailThreadID,
		ProviderMessageID: thread.RootProviderMessageID, ProviderThreadID: thread.ProviderThreadID, Priority: CommunicationsEmailIngestionPriorityVisible,
		EnqueueSourceID: "original-producer-fingerprint",
	}
	first, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), jobInput)
	if err != nil || !created {
		t.Fatalf("first durable job = %+v created=%v err=%v", first, created, err)
	}
	secondInput := jobInput
	secondInput.EnqueueSourceID = "later-unrelated-producer"
	second, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), secondInput)
	if err != nil || created || second.IngestionJobID != first.IngestionJobID || second.EnqueueSourceID != jobInput.EnqueueSourceID {
		t.Fatalf("duplicate ensure = %+v created=%v err=%v", second, created, err)
	}

	attempt, started, err := repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), first.IngestionJobID)
	if err != nil || !started || attempt.ProviderAttemptCount != 1 || attempt.Status != CommunicationsEmailIngestionJobProcessing || attempt.AttemptToken == "" {
		t.Fatalf("first attempt = %+v started=%v err=%v", attempt, started, err)
	}
	if err := repo.FailCommunicationsEmailIngestionAttemptContext(context.Background(), first.IngestionJobID, attempt.AttemptToken, "email_thread_source_unavailable", nil); err != nil {
		t.Fatal(err)
	}
	retrying, err := repo.GetCommunicationsEmailThread(companyID, thread.EmailThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if retrying.DownloadStatus != CommunicationsEmailThreadDownloadDownloading {
		t.Fatalf("retrying thread status = %q, want downloading", retrying.DownloadStatus)
	}
	attempt, started, err = repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), first.IngestionJobID)
	if err != nil || !started || attempt.ProviderAttemptCount != 2 {
		t.Fatalf("second attempt = %+v started=%v err=%v", attempt, started, err)
	}
	if err := repo.CompleteCommunicationsEmailIngestionAttemptContext(context.Background(), first.IngestionJobID, attempt.AttemptToken, nil); err != nil {
		t.Fatal(err)
	}
	jobs, err := repo.ListCommunicationsEmailIngestionJobsForThreadContext(context.Background(), companyID, thread.EmailThreadID)
	if err != nil || len(jobs) != 1 || jobs[0].Status != CommunicationsEmailIngestionJobCompleted {
		t.Fatalf("jobs = %+v err=%v", jobs, err)
	}
	completedDuplicate, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), jobInput)
	if err != nil || created || completedDuplicate.IngestionJobID != first.IngestionJobID {
		t.Fatalf("completed duplicate ensure = %+v created=%v err=%v", completedDuplicate, created, err)
	}
}

func TestMemoryCommunicationsEmailIngestionAttemptsAreFencedAndStopAtThree(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111296"
	connectionID := "22222222-2222-4222-8222-222222222296"
	for _, item := range []struct {
		messageID string
		priority  int
	}{
		{"scan-message", CommunicationsEmailIngestionPriorityScan},
		{"visible-message", CommunicationsEmailIngestionPriorityVisible},
		{"live-message", CommunicationsEmailIngestionPriorityLive},
	} {
		if _, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), CommunicationsEmailIngestionJobInput{
			CompanyID: companyID, EmailConnectionID: connectionID,
			ProviderMessageID: item.messageID, Priority: item.priority,
		}); err != nil || !created {
			t.Fatalf("ensure %s created=%v err=%v", item.messageID, created, err)
		}
	}
	var job CommunicationsEmailIngestionJob
	for _, candidate := range repo.emailIngestionJobs {
		if candidate.ProviderMessageID == "live-message" {
			job = candidate
		}
	}
	for attemptNumber := 1; attemptNumber <= 3; attemptNumber++ {
		attempt, started, err := repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID)
		if err != nil || !started || attempt.ProviderAttemptCount != attemptNumber {
			t.Fatalf("attempt %d = %+v started=%v err=%v", attemptNumber, attempt, started, err)
		}
		if err := repo.FailCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID, attempt.AttemptToken, "provider_failed", nil); err != nil {
			t.Fatal(err)
		}
	}
	terminal, started, err := repo.StartCommunicationsEmailIngestionAttemptContext(context.Background(), job.IngestionJobID)
	if err != nil || started || terminal.Status != CommunicationsEmailIngestionJobExhausted || terminal.ProviderAttemptCount != 3 {
		t.Fatalf("terminal attempt = %+v started=%v err=%v", terminal, started, err)
	}
}

func TestMemoryCommunicationsEmailThreadLaterManualMessageReusesThreadAndQueuesOnlyMessage(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111197"
	userID := "22222222-2222-4222-8222-222222222297"
	base := CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com", Provider: "google",
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
	messageID, sourceID, ok := communicationsEmailIngestionRequest(updated, later)
	if !ok || messageID != "provider-new" || sourceID != CommunicationsEmailUserProducerFingerprint(userID) {
		t.Fatalf("later ingestion request = message=%q source=%q ok=%v", messageID, sourceID, ok)
	}
	jobInput := CommunicationsEmailIngestionJobInput{
		CompanyID: companyID, EmailConnectionID: updated.EmailConnectionID, EmailThreadID: updated.EmailThreadID,
		ProviderMessageID: messageID, ProviderThreadID: updated.ProviderThreadID, Priority: CommunicationsEmailIngestionPriorityVisible,
	}
	job, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), jobInput)
	if err != nil || !created || job.Priority != CommunicationsEmailIngestionPriorityVisible || job.ProviderMessageID != "provider-new" {
		t.Fatalf("later job=%+v created=%v err=%v", job, created, err)
	}
	duplicate, created, err := repo.EnsureCommunicationsEmailIngestionJobContext(context.Background(), jobInput)
	if err != nil || created || duplicate.IngestionJobID != job.IngestionJobID {
		t.Fatalf("later duplicate=%+v created=%v err=%v", duplicate, created, err)
	}
}

func TestMemoryCommunicationsEmailThreadFindsExistingNonRootMessageBeforeAssigningThreadID(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111198"
	userID := "22222222-2222-4222-8222-222222222298"
	stored, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com", Provider: "google",
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
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com", Provider: "google",
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
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com", Provider: "google",
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
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: "owner@example.com", AccountEmail: "owner@example.com", Provider: "google",
		ProviderThreadID: "conflicting-thread", SelectedMessageID: "provider-known-reply",
		Messages: []domain.EmailMessageSnapshot{{ID: "provider-known-reply", ThreadID: "conflicting-thread"}},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("conflicting thread identity error = %v, want ErrInvalid", err)
	}
}

func TestCommunicationsEmailThreadDurableDownloadSchemaContract(t *testing.T) {
	raw, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("read canonical schema: %v", err)
	}
	source := strings.ToLower(string(raw))
	for _, fragment := range []string{
		"download_status text not null",
		"download_complete boolean not null default false",
		"create table if not exists email_ingestion_jobs",
		"email_connection_id uuid not null",
		"priority smallint not null",
		"unique (company_id,email_thread_id,provider_message_id)",
	} {
		if !strings.Contains(strings.ReplaceAll(source, " ", ""), strings.ReplaceAll(fragment, " ", "")) {
			t.Fatalf("canonical schema missing %q", fragment)
		}
	}
}

func TestMemoryEmailThreadPropagatesCompletedMessagesToEveryNodeDestination(t *testing.T) {
	repo := NewMemoryRepo()
	const companyID = "11111111-1111-4111-8111-111111111199"
	repo.EnsureCompany(companyID, "Multi-Node email propagation")
	owner := mustEmailCollaborationGuardUser(t, repo, companyID, "multi-node-owner", "multi-node@example.com", domain.RoleCompanyUser)
	base := CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", CreatedByUserID: owner.UserID,
		Message: domain.EmailMessageSnapshot{ID: "multi-node-root", ThreadID: "multi-node-thread", DownloadComplete: true},
	}
	base.RequestedNodeID = "11111111-1111-4111-8111-111111111191"
	first, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), base)
	if err != nil {
		t.Fatal(err)
	}
	base.RequestedNodeID = "11111111-1111-4111-8111-111111111192"
	second, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), base)
	if err != nil {
		t.Fatal(err)
	}
	if first.Collaboration.NodeID == second.Collaboration.NodeID {
		t.Fatal("distinct Node destinations collapsed")
	}
	if _, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: owner.Email,
		AccountEmail: owner.Email, Provider: "google", ProviderThreadID: "multi-node-thread",
		SelectedMessageID: "multi-node-reply",
		Messages:          []domain.EmailMessageSnapshot{{ID: "multi-node-reply", ThreadID: "multi-node-thread", DownloadComplete: true}},
	}); err != nil {
		t.Fatal(err)
	}
	nodes := map[string]bool{}
	for _, destination := range repo.nodeEmailThreads {
		if destination.CompanyID == companyID && destination.EmailThreadID == first.Collaboration.EmailThreadID {
			nodes[destination.NodeID] = true
		}
	}
	if len(nodes) != 2 || !nodes[first.Collaboration.NodeID] || !nodes[second.Collaboration.NodeID] {
		t.Fatalf("thread destinations=%v, want both Nodes after new completed message", nodes)
	}
	placements, err := repo.ListCommunicationsEmailPlacements(owner.UserID, companyID, []string{"multi-node-reply"})
	if err != nil || len(placements) != 2 {
		t.Fatalf("new-message placements=%+v err=%v, want both existing Nodes", placements, err)
	}
	textBoxCount := 0
	for _, projections := range repo.nodeText {
		for _, projection := range projections {
			if isEditorTextBoxType(projection.Type) {
				textBoxCount++
			}
		}
	}
	if textBoxCount != 0 {
		t.Fatalf("text boxes=%d, want none until a message receives a chat", textBoxCount)
	}
}
