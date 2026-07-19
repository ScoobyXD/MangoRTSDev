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
	if partial.HydrationStatus != CommunicationsEmailThreadHydrationPartial || partial.HistoryComplete {
		t.Fatalf("partial hydration state = %q/%v", partial.HydrationStatus, partial.HistoryComplete)
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
	if complete.EmailThreadID != partial.EmailThreadID || complete.HydrationStatus != CommunicationsEmailThreadHydrationComplete || !complete.HistoryComplete {
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
	hydrated, err := repo.UpsertCommunicationsEmailThread(input)
	if err != nil {
		t.Fatalf("provider-thread upsert: %v", err)
	}
	if hydrated.EmailThreadID != fallback.EmailThreadID ||
		hydrated.Messages[0].EmailMessageID != fallback.Messages[0].EmailMessageID {
		t.Fatalf("fallback identity forked after provider thread became known: fallback=%+v hydrated=%+v", fallback, hydrated)
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
