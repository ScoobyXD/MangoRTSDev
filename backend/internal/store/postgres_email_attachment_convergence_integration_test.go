package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func openPostgresEmailAttachmentIntegration(t *testing.T) *sql.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_EMAIL_ATTACHMENT_CONVERGENCE_TEST_DSN"))
	if dsn == "" {
		t.Skip("set MANGORTS_EMAIL_ATTACHMENT_CONVERGENCE_TEST_DSN to a disposable PostgreSQL database")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	return db
}

func TestPostgresEmailAttachmentConvergenceRetiresOnlyDeterministicDuplicates(t *testing.T) {
	db := openPostgresEmailAttachmentIntegration(t)
	if _, err := db.Exec(`
create temp table attachments (
  company_id uuid not null,
  attachment_id uuid not null,
  deleted_timestamp timestamptz,
  primary key (company_id,attachment_id)
);
create temp table attachment_relationships (
  company_id uuid not null,
  attachment_relationship_id uuid not null,
  attachment_id uuid not null,
  resource_type text not null,
  resource_id text not null,
  deleted_timestamp timestamptz,
  primary key (company_id,attachment_relationship_id)
);
create temp table email_messages (
  company_id uuid not null,
  email_thread_id uuid not null,
  email_message_id uuid not null,
  provider_message_id text not null,
  attachment_metadata jsonb not null default '[]'::jsonb,
  download_complete boolean not null default false,
  primary key (company_id,email_message_id)
);`); err != nil {
		t.Fatal(err)
	}

	companyID := NewUUIDv7String()
	emailThreadID := NewUUIDv7String()
	emailMessageID := NewUUIDv7String()
	otherOwnerID := NewUUIDv7String()
	canonicalOne := NewUUIDv7String()
	canonicalTwo := NewUUIDv7String()
	providerMessageID := "provider-message"
	staleOne := ImportedEmailAttachmentID(companyID, emailThreadID, providerMessageID, "provider-local-1", "", "same.txt")
	staleTwo := ImportedEmailAttachmentID(companyID, emailThreadID, providerMessageID, "provider-local-2", "", "same.txt")
	preservedProvider := ImportedEmailAttachmentID(companyID, emailThreadID, providerMessageID, "provider-only", "", "provider.txt")
	metadata, err := json.Marshal([]domain.EmailAttachmentSnapshot{
		{ID: "provider-local-1", AttachmentID: canonicalOne, Filename: "same.txt"},
		{ID: "provider-local-2", AttachmentID: canonicalTwo, Filename: "same.txt"},
		{ID: "provider-only", AttachmentID: preservedProvider, Filename: "provider.txt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
insert into attachments(company_id,attachment_id) values
	 ($1::uuid,$2::uuid),($1::uuid,$3::uuid),($1::uuid,$4::uuid),($1::uuid,$5::uuid),($1::uuid,$6::uuid)`,
		companyID, canonicalOne, canonicalTwo, staleOne, staleTwo, preservedProvider); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
insert into email_messages(company_id,email_thread_id,email_message_id,provider_message_id,attachment_metadata,download_complete)
values ($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb,true)`,
		companyID, emailThreadID, emailMessageID, providerMessageID, string(metadata)); err != nil {
		t.Fatal(err)
	}
	links := []struct {
		attachmentID string
		resourceType string
		resourceID   string
	}{
		{canonicalOne, "email_message", emailMessageID},
		{canonicalTwo, "email_message", emailMessageID},
		{staleOne, "email_message", emailMessageID},
		{staleOne, "email_draft", otherOwnerID},
		{staleTwo, "email_message", emailMessageID},
		{preservedProvider, "email_message", emailMessageID},
	}
	for _, link := range links {
		if _, err := db.Exec(`
insert into attachment_relationships(company_id,attachment_relationship_id,attachment_id,resource_type,resource_id)
values ($1::uuid,$2::uuid,$3::uuid,$4,$5)`, companyID, NewUUIDv7String(), link.attachmentID, link.resourceType, link.resourceID); err != nil {
			t.Fatal(err)
		}
	}

	repo := &PostgresRepo{db: db}
	changed, err := repo.ConvergeCommunicationsEmailThreadAttachmentLinksContext(context.Background(), companyID, emailThreadID)
	if err != nil || !changed {
		t.Fatalf("convergence changed=%v err=%v", changed, err)
	}
	rows, err := db.Query(`
select attachment_id::text from attachment_relationships
where company_id=$1::uuid and resource_type='email_message' and resource_id=$2 and deleted_timestamp is null
order by attachment_id`, companyID, emailMessageID)
	if err != nil {
		t.Fatal(err)
	}
	active := make([]string, 0)
	for rows.Next() {
		var attachmentID string
		if err := rows.Scan(&attachmentID); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		active = append(active, attachmentID)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	wantActive := cleanUUIDTextSlice([]string{canonicalOne, canonicalTwo, preservedProvider})
	if strings.Join(active, ",") != strings.Join(wantActive, ",") {
		t.Fatalf("active message attachments=%v want=%v", active, wantActive)
	}
	var sharedDeleted, unownedDeleted bool
	if err := db.QueryRow(`select deleted_timestamp is not null from attachments where company_id=$1::uuid and attachment_id=$2::uuid`, companyID, staleOne).Scan(&sharedDeleted); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select deleted_timestamp is not null from attachments where company_id=$1::uuid and attachment_id=$2::uuid`, companyID, staleTwo).Scan(&unownedDeleted); err != nil {
		t.Fatal(err)
	}
	if sharedDeleted || !unownedDeleted {
		t.Fatalf("shared duplicate deleted=%v unowned duplicate deleted=%v", sharedDeleted, unownedDeleted)
	}
	if changed, err := repo.ConvergeCommunicationsEmailThreadAttachmentLinksContext(context.Background(), companyID, emailThreadID); err != nil || changed {
		t.Fatalf("idempotent convergence changed=%v err=%v", changed, err)
	}
}

func TestPostgresEmailAttachmentMergePreservesLocalIDsAcrossCompletionRaces(t *testing.T) {
	db := openPostgresEmailAttachmentIntegration(t)
	if _, err := db.Exec(`
create temp table email_connections (
  email_connection_id uuid not null,
  company_id uuid not null,
  connection_type text not null,
  personal_user_id uuid,
  provider text not null,
  account_email text not null,
  primary key (company_id,email_connection_id)
);
create temp table shared_inboxes (
  company_id uuid not null,
  shared_inbox_id uuid not null,
  company_email_connection_id uuid
);
create temp table email_threads (
  company_id uuid not null,
  email_thread_id uuid not null,
  email_connection_id uuid not null,
  provider_thread_key text not null,
  provider_thread_id text not null default '',
  root_provider_message_id text not null,
  download_status text not null default 'partial',
  history_complete boolean not null default false,
  fetched_timestamp timestamptz,
  last_download_error text not null default '',
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id,email_thread_id),
  unique (company_id,email_connection_id,provider_thread_key)
);
create temp table email_messages (
  company_id uuid not null,
  email_message_id uuid not null,
  email_thread_id uuid not null,
  provider_message_id text not null,
  message_order integer not null,
  subject text not null default '',
  sender_snapshot jsonb not null default '[]'::jsonb,
  to_snapshot jsonb not null default '[]'::jsonb,
  cc_snapshot jsonb not null default '[]'::jsonb,
  bcc_snapshot jsonb not null default '[]'::jsonb,
  reply_to_snapshot jsonb not null default '[]'::jsonb,
  message_timestamp timestamptz,
  rich_html_body text not null default '',
  text_fallback text not null default '',
  snippet text not null default '',
  unread boolean not null default false,
  starred boolean not null default false,
  folder_snapshot jsonb not null default '[]'::jsonb,
  folder_id_snapshot jsonb not null default '[]'::jsonb,
  attachment_metadata jsonb not null default '[]'::jsonb,
  download_complete boolean not null default false,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  primary key (company_id,email_message_id),
  unique (company_id,email_thread_id,provider_message_id),
  unique (company_id,email_thread_id,email_message_id)
);
create temp table email_relationships (
  company_id uuid not null,
  email_relationship_id uuid not null,
  email_thread_id uuid not null,
  email_message_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  resource_textbox_id text,
  created_timestamp timestamptz not null default now(),
  primary key (company_id,email_relationship_id)
);`); err != nil {
		t.Fatal(err)
	}

	companyID, userID, connectionID := NewUUIDv7String(), NewUUIDv7String(), NewUUIDv7String()
	accountEmail := "attachment-merge@example.com"
	if _, err := db.Exec(`
insert into email_connections(email_connection_id,company_id,connection_type,personal_user_id,provider,account_email)
values ($1::uuid,$2::uuid,'personal',$3::uuid,'google',$4)`, connectionID, companyID, userID, accountEmail); err != nil {
		t.Fatal(err)
	}
	repo := NewPostgresRepo(db)
	localOne, replacementLocalOne := NewUUIDv7String(), NewUUIDv7String()
	importedOne, importedTwo := NewUUIDv7String(), NewUUIDv7String()
	base := CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: userID, PersonalAccountEmail: accountEmail,
		AccountEmail: accountEmail, Provider: "google", ProviderThreadID: "provider-thread",
		SelectedMessageID: "sent-message", Messages: []domain.EmailMessageSnapshot{{
			ID: "sent-message", ThreadID: "provider-thread", Attachments: []domain.EmailAttachmentSnapshot{
				{ID: "provider-one", AttachmentID: localOne, Filename: "same.txt"},
				{ID: "provider-two", Filename: "same.txt"},
			},
		}},
	}
	if _, err := repo.UpsertCommunicationsEmailThreadContext(context.Background(), base); err != nil {
		t.Fatal(err)
	}
	worker := base
	worker.Messages = []domain.EmailMessageSnapshot{{
		ID: "sent-message", ThreadID: "provider-thread", DownloadComplete: true,
		Attachments: []domain.EmailAttachmentSnapshot{
			{ID: "provider-one", AttachmentID: importedOne, Filename: "same.txt"},
			{ID: "provider-two", AttachmentID: importedTwo, Filename: "same.txt"},
		},
	}}
	merged, err := repo.UpsertCommunicationsEmailThreadContext(context.Background(), worker)
	if err != nil {
		t.Fatal(err)
	}
	assertPostgresAttachmentMerge := func(thread domain.CommunicationsEmailThread, wantOne string) {
		t.Helper()
		if len(thread.Messages) != 1 || !thread.Messages[0].Message.DownloadComplete {
			t.Fatalf("merged thread=%+v", thread)
		}
		got := map[string]string{}
		for _, attachment := range thread.Messages[0].Message.Attachments {
			got[attachment.ID] = attachment.AttachmentID
		}
		if len(got) != 2 || got["provider-one"] != wantOne || got["provider-two"] != importedTwo {
			t.Fatalf("merged attachments=%v want provider-one=%s provider-two=%s", got, wantOne, importedTwo)
		}
	}
	assertPostgresAttachmentMerge(merged, localOne)

	local := base
	local.Messages = []domain.EmailMessageSnapshot{{
		ID: "sent-message", ThreadID: "provider-thread", Attachments: []domain.EmailAttachmentSnapshot{
			{ID: "provider-one", AttachmentID: replacementLocalOne, Filename: "same.txt"},
			{ID: "provider-two", Filename: "same.txt"},
		},
	}}
	merged, err = repo.UpsertCommunicationsEmailThreadContext(context.Background(), local)
	if err != nil {
		t.Fatal(err)
	}
	assertPostgresAttachmentMerge(merged, replacementLocalOne)
}
