package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	v3NodeTextboxChatExpandComponent = "v3_node_textbox_chats_expand_component.sql"
	v3NodeTextboxChatCopyScript      = "copy_v3_node_textbox_chats.sql"
	v3NodeTextboxChatStep1Script     = "v3_node_textbox_chats_step1_count.sql"
	v3NodeTextboxChatStep2Script     = "v3_node_textbox_chats_step2_create_copy_verify.sql"
)

func readV3NodeTextboxChatSQL(t *testing.T, path ...string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(path...))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestV3NodeTextboxChatPhaseIsAdditiveAndOperatorGated(t *testing.T) {
	expansion := strings.ToLower(readV3NodeTextboxChatSQL(
		t, "..", "..", "..", "scripts", v3NodeTextboxChatExpandComponent,
	))
	copySQL := strings.ToLower(readV3NodeTextboxChatSQL(
		t, "..", "..", "..", "scripts", v3NodeTextboxChatCopyScript,
	))
	step1SQL := strings.ToLower(readV3NodeTextboxChatSQL(
		t, "..", "..", "..", "scripts", v3NodeTextboxChatStep1Script,
	))
	step2SQL := strings.ToLower(readV3NodeTextboxChatSQL(
		t, "..", "..", "..", "scripts", v3NodeTextboxChatStep2Script,
	))
	schema := strings.ToLower(readV3NodeTextboxChatSQL(t, "..", "..", "db", "schema.sql"))

	for name, sqlText := range map[string]string{"expansion component": expansion, "canonical schema": schema} {
		for _, required := range []string{
			"create table node_textbox_chats",
			"primary key (company_id, chat_id)",
			"references node_textboxes(company_id, node_id, textbox_id) on delete cascade",
			"references users(user_id) on delete set null",
			"edited_timestamp timestamptz",
			"selection_source = 'email' and selection_email_message_id is not null",
		} {
			if !strings.Contains(sqlText, required) && !(name == "canonical schema" && strings.Contains(sqlText, strings.Replace(required, "create table ", "create table if not exists ", 1))) {
				t.Errorf("%s is missing %q", name, required)
			}
		}
	}
	for _, required := range []string{
		"create view v3_node_textbox_chat_source_v1",
		"from node_projection_table projection",
		"where projection.type = 'text block chat'::information_type",
		"and not projection.is_deleted",
		"'discarded_deleted_host'",
		"'needs_human_mapping'",
		"mapping_checksum",
		"'ready_to_copy'",
	} {
		if !strings.Contains(expansion, required) {
			t.Errorf("expansion component is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"delete from node_information",
		"delete from node_projection_table",
		"update node_information",
		"update node_projection_table",
		"drop table node_information",
		"drop table node_projection_table",
	} {
		if strings.Contains(expansion, forbidden) || strings.Contains(copySQL, forbidden) {
			t.Errorf("additive chat phase contains destructive legacy operation %q", forbidden)
		}
	}
	if strings.Contains(expansion, "insert into node_textbox_chats") {
		t.Error("expansion component must not copy legacy chat data")
	}
	for _, required := range []string{
		"insert into node_textbox_chats",
		"insert into resource_attachments",
		"'node_chat_message'",
		"on conflict (company_id, chat_id) do nothing",
		"insert into v3_migration_items",
		"set local lock_timeout = '5s'",
	} {
		if !strings.Contains(copySQL, required) {
			t.Errorf("operator copy script is missing %q", required)
		}
	}
	for _, required := range []string{
		"begin transaction isolation level repeatable read read only",
		"current_legacy_chats",
		"chats_to_copy",
		"missing_textbox_chats",
		"chats_requiring_review",
	} {
		if !strings.Contains(step1SQL, required) {
			t.Errorf("Step 1 count script is missing %q", required)
		}
	}
	for _, forbidden := range []string{"insert into", "update ", "delete from", "create table", "alter table", "drop table"} {
		if strings.Contains(step1SQL, forbidden) {
			t.Errorf("Step 1 count script contains write operation %q", forbidden)
		}
	}
	for _, required := range []string{
		"pause node chat writes",
		"create table node_textbox_chats",
		"insert into node_textbox_chats",
		"v3 node textbox chat final count mismatch",
		"commit;",
	} {
		if !strings.Contains(step2SQL, required) {
			t.Errorf("Step 2 create-copy-verify script is missing %q", required)
		}
	}
	if strings.Count(step2SQL, "\nbegin;\n") != 1 || strings.Count(step2SQL, "\ncommit;") != 1 {
		t.Error("Step 2 must use one outer transaction for creation, copy, and final verification")
	}
}

func openV3NodeTextboxChatPostgresIntegration(t *testing.T) *sql.DB {
	t.Helper()
	if os.Getenv("MANGORTS_V3_CHAT_POSTGRES_TEST") != "1" || os.Getenv("DB_NAME") != "mangorts_v3_chat_test" {
		t.Skip("disposable V3 chat PostgreSQL integration database not configured")
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), os.Getenv("DB_SSLMODE"),
	)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestPostgresV3NodeTextboxChatCopyIsRestartable(t *testing.T) {
	db := openV3NodeTextboxChatPostgresIntegration(t)
	schemaName := "v3_chat_" + strings.ReplaceAll(newUUIDv7String(), "-", "")
	if _, err := db.Exec("create schema " + schemaName); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("drop schema " + schemaName + " cascade") })
	if _, err := db.Exec("set search_path to " + schemaName); err != nil {
		t.Fatal(err)
	}

	fixtureSchema := `
create type information_type as enum ('Text box', 'Text block chat', 'Attached email');
create table users(user_id uuid primary key);
create table nodes(company_id uuid not null, node_id uuid not null, primary key(company_id,node_id));
create table node_textboxes(
  company_id uuid not null, node_id uuid not null, textbox_id uuid not null,
  deleted_timestamp timestamptz,
  primary key(company_id,node_id,textbox_id)
);
create table node_projection_table(
  company_id uuid not null, node_id uuid not null, information_id uuid not null,
  type information_type not null, information text not null, is_deleted boolean not null default false,
  revision bigint not null default 0, created_timestamp timestamptz not null,
  updated_timestamp timestamptz not null,
  primary key(company_id,node_id,information_id)
);
create table communications_email_messages(
  company_id uuid not null, email_message_id uuid not null, email_thread_id uuid not null,
  provider_message_id text not null,
  primary key(company_id,email_message_id)
);
create table attachments(
  company_id uuid not null, attachment_id uuid not null,
  original_filename text not null, mime_type text not null, byte_size bigint not null,
  deleted_timestamp timestamptz,
  primary key(company_id,attachment_id)
);
create table resource_attachments(
  resource_attachment_id uuid primary key, company_id uuid not null,
  resource_type text not null, resource_id text not null, attachment_id uuid not null,
  information_id uuid, message_id text not null default '', editor_surface text not null default '',
  relationship_kind text not null, created_by_user_id uuid,
  created_timestamp timestamptz not null default now(), deleted_timestamp timestamptz
);`
	if _, err := db.Exec(fixtureSchema); err != nil {
		t.Fatal(err)
	}

	companyID := newUUIDv7String()
	nodeID := newUUIDv7String()
	textboxID := newUUIDv7String()
	missingTextboxID := newUUIDv7String()
	authorID := newUUIDv7String()
	deletedAuthorID := newUUIDv7String()
	rootChatID := newUUIDv7String()
	replyChatID := newUUIDv7String()
	hostlessChatID := newUUIDv7String()
	missingParentChatID := newUUIDv7String()
	invalidChatID := newUUIDv7String()
	emailChatID := newUUIDv7String()
	unresolvedEmailChatID := newUUIDv7String()
	conflictChatID := newUUIDv7String()
	emailMessageID := newUUIDv7String()
	emailThreadID := newUUIDv7String()
	attachmentID := newUUIDv7String()

	setup := []struct {
		query string
		args  []any
	}{
		{`insert into users(user_id) values($1::uuid)`, []any{authorID}},
		{`insert into nodes(company_id,node_id) values($1::uuid,$2::uuid)`, []any{companyID, nodeID}},
		{`insert into node_textboxes(company_id,node_id,textbox_id,deleted_timestamp) values($1::uuid,$2::uuid,$3::uuid,now())`, []any{companyID, nodeID, missingTextboxID}},
		{`insert into node_textboxes(company_id,node_id,textbox_id) values($1::uuid,$2::uuid,$3::uuid)`, []any{companyID, nodeID, textboxID}},
		{`insert into communications_email_messages(company_id,email_message_id,email_thread_id,provider_message_id)
values($1::uuid,$2::uuid,$3::uuid,'provider-message-1')`, []any{companyID, emailMessageID, emailThreadID}},
		{`insert into attachments(company_id,attachment_id,original_filename,mime_type,byte_size)
values($1::uuid,$2::uuid,'evidence.txt','text/plain',8)`, []any{companyID, attachmentID}},
	}
	for _, statement := range setup {
		if _, err := db.Exec(statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}

	chatPayload := func(blockID, parentID, selectionSource, selectionMessageID, authorID, message string) string {
		t.Helper()
		payload := map[string]any{
			"block_id": blockID, "parent_id": parentID, "selection_source": selectionSource,
			"selection_block_id": blockID, "selection_message_id": selectionMessageID,
			"selection_quote": "selected", "selection_start": 0, "selection_end": 3,
			"author_id": authorID, "author_name": "Captured author", "message": message,
			"edited_timestamp": "2099-01-01T00:00:00Z",
			"attachments":      []any{map[string]any{"id": attachmentID, "attachment_id": attachmentID, "name": "evidence.txt", "type": "text/plain", "size": 8}},
			"entity_links":     []any{}, "mentioned_user_ids": []any{}, "mentioned_group_ids": []any{},
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	rows := []struct {
		chatID string
		body   string
	}{
		{rootChatID, chatPayload(textboxID, "", "text", "", authorID, "Root")},
		{replyChatID, chatPayload(textboxID, rootChatID, "text", "", deletedAuthorID, "Reply")},
		{hostlessChatID, chatPayload(missingTextboxID, "", "text", "", authorID, "Hidden orphan")},
		{missingParentChatID, chatPayload(textboxID, newUUIDv7String(), "text", "", authorID, "Detached reply")},
		{invalidChatID, "not-json"},
		{emailChatID, chatPayload(textboxID, "", "email", "provider-message-1", authorID, "Email selection")},
		{unresolvedEmailChatID, chatPayload(textboxID, "", "email", "missing-provider-message", authorID, "Unresolved email")},
		{conflictChatID, chatPayload(textboxID, "", "text", "", authorID, "Source message")},
	}
	for index, row := range rows {
		if _, err := db.Exec(`insert into node_projection_table(
company_id,node_id,information_id,type,information,is_deleted,revision,created_timestamp,updated_timestamp
) values($1::uuid,$2::uuid,$3::uuid,'Text block chat',$4,false,1,now()+($5::integer || ' seconds')::interval,now()+($5::integer || ' seconds')::interval)`,
			companyID, nodeID, row.chatID, row.body, index); err != nil {
			t.Fatal(err)
		}
	}

	expandSQL := readV3NodeTextboxChatSQL(t, "..", "..", "..", "scripts", v3NodeTextboxChatExpandComponent)
	copySQL := readV3NodeTextboxChatSQL(t, "..", "..", "..", "scripts", v3NodeTextboxChatCopyScript)
	if _, err := db.Exec(expandSQL); err != nil {
		t.Fatalf("expand migration: %v", err)
	}
	if _, err := db.Exec(`insert into node_textbox_chats(
company_id,chat_id,node_id,textbox_id,message,revision,created_timestamp,updated_timestamp
)
select company_id,information_id,node_id,$4::uuid,'Conflicting target',revision,created_timestamp,updated_timestamp
from node_projection_table
where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid`,
		companyID, nodeID, conflictChatID, textboxID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(copySQL); err != nil {
		t.Fatalf("first copy: %v", err)
	}

	var targetRows, sourceRows int
	if err := db.QueryRow(`select
  (select count(*) from node_textbox_chats),
  (select count(*) from node_projection_table where type='Text block chat')`).Scan(&targetRows, &sourceRows); err != nil {
		t.Fatal(err)
	}
	if targetRows != 5 || sourceRows != 8 {
		t.Fatalf("first copy target=%d source=%d, want target=5 source=8", targetRows, sourceRows)
	}
	var parentID sql.NullString
	var copiedAuthor sql.NullString
	var mappedEmail sql.NullString
	var mappedSelectionTextbox sql.NullString
	var copiedAttachmentLinks int
	var copiedEditedTimestamp sql.NullTime
	if err := db.QueryRow(`select parent_chat_id::text, author_user_id::text
from node_textbox_chats where company_id=$1::uuid and chat_id=$2::uuid`, companyID, replyChatID).
		Scan(&parentID, &copiedAuthor); err != nil {
		t.Fatal(err)
	}
	if !parentID.Valid || parentID.String != rootChatID || copiedAuthor.Valid {
		t.Fatalf("reply parent=%v author=%v, want preserved parent and null deleted author", parentID, copiedAuthor)
	}
	if err := db.QueryRow(`select selection_email_message_id::text, selection_textbox_id::text
from node_textbox_chats where company_id=$1::uuid and chat_id=$2::uuid`, companyID, emailChatID).
		Scan(&mappedEmail, &mappedSelectionTextbox); err != nil {
		t.Fatal(err)
	}
	if !mappedEmail.Valid || mappedEmail.String != emailMessageID {
		t.Fatalf("mapped email=%v, want %s", mappedEmail, emailMessageID)
	}
	if !mappedSelectionTextbox.Valid || mappedSelectionTextbox.String != textboxID {
		t.Fatalf("mapped email selection textbox=%v, want %s", mappedSelectionTextbox, textboxID)
	}
	if err := db.QueryRow(`select
  (select count(*) from resource_attachments
   where company_id=$1::uuid and resource_type='node_chat_message' and resource_id=$2
     and attachment_id=$3::uuid and relationship_kind='chat_attachment' and deleted_timestamp is null),
  (select edited_timestamp from node_textbox_chats where company_id=$1::uuid and chat_id=$2::uuid)`,
		companyID, rootChatID, attachmentID).Scan(&copiedAttachmentLinks, &copiedEditedTimestamp); err != nil {
		t.Fatal(err)
	}
	if copiedAttachmentLinks != 1 || !copiedEditedTimestamp.Valid {
		t.Fatalf("copied attachment links=%d edited=%v, want preserved payload fields", copiedAttachmentLinks, copiedEditedTimestamp)
	}
	if err := db.QueryRow(`select parent_chat_id::text
from node_textbox_chats where company_id=$1::uuid and chat_id=$2::uuid`, companyID, missingParentChatID).
		Scan(&parentID); err != nil {
		t.Fatal(err)
	}
	if parentID.Valid {
		t.Fatalf("missing parent was not detached: %v", parentID)
	}
	var conflictMessage string
	if err := db.QueryRow(`select message
from node_textbox_chats where company_id=$1::uuid and chat_id=$2::uuid`, companyID, conflictChatID).
		Scan(&conflictMessage); err != nil {
		t.Fatal(err)
	}
	if conflictMessage != "Conflicting target" {
		t.Fatalf("target conflict was overwritten with %q", conflictMessage)
	}

	if _, err := db.Exec(copySQL); err != nil {
		t.Fatalf("second copy: %v", err)
	}
	if err := db.QueryRow(`select count(*) from node_textbox_chats`).Scan(&targetRows); err != nil {
		t.Fatal(err)
	}
	if targetRows != 5 {
		t.Fatalf("rerun target rows=%d, want 5", targetRows)
	}
	var alreadyCopied, discarded, needsReview int
	if err := db.QueryRow(`with latest as (
  select run_id from v3_migration_runs where phase='node_textbox_chats'
  order by started_timestamp desc, run_id desc limit 1
)
select
  count(*) filter(where disposition='already_copied'),
  count(*) filter(where disposition='discarded_deleted_host'),
  count(*) filter(where disposition='needs_human_mapping')
from v3_migration_items where run_id=(select run_id from latest)`).
		Scan(&alreadyCopied, &discarded, &needsReview); err != nil {
		t.Fatal(err)
	}
	if alreadyCopied != 4 || discarded != 1 || needsReview != 3 {
		t.Fatalf("rerun dispositions already=%d discarded=%d review=%d", alreadyCopied, discarded, needsReview)
	}
	runtimeChatID := newUUIDv7String()
	runtimeInput := NodeInformationInput{
		CompanyID: companyID, NodeID: nodeID, InformationID: runtimeChatID,
		Type:        CommunicationsEmailCollaborationChatInformationType,
		Information: chatPayload(textboxID, "", "email", "provider-message-1", authorID, "Runtime write"),
	}
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	projection, existed, err := upsertPostgresNodeTextboxChatTx(context.Background(), tx, runtimeInput, runtimeChatID)
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("runtime chat insert: %v", err)
	}
	if existed {
		_ = tx.Rollback()
		t.Fatal("runtime chat unexpectedly existed")
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(projection.Information, "provider-message-1") || !strings.Contains(projection.Information, attachmentID) {
		t.Fatalf("runtime projection did not rebuild the frontend payload: %s", projection.Information)
	}
	listed, err := listPostgresNodeTextboxChatProjections(context.Background(), db, companyID, nodeID)
	if err != nil {
		t.Fatal(err)
	}
	foundRuntime := false
	for _, item := range listed {
		foundRuntime = foundRuntime || item.InformationID == runtimeChatID
	}
	if !foundRuntime {
		t.Fatal("runtime chat was not returned by the permanent-table reader")
	}
	var legacyRuntimeRows int
	if err := db.QueryRow(`select count(*) from node_projection_table where information_id=$1::uuid`, runtimeChatID).Scan(&legacyRuntimeRows); err != nil {
		t.Fatal(err)
	}
	if legacyRuntimeRows != 0 {
		t.Fatalf("runtime chat also wrote %d legacy projection rows", legacyRuntimeRows)
	}
	tx, err = db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	_, deleted, err := deletePostgresNodeTextboxChatTx(context.Background(), tx, NodeProjectionDeleteInput{
		CompanyID: companyID, NodeID: nodeID, InformationID: runtimeChatID,
	})
	if err != nil || !deleted {
		_ = tx.Rollback()
		t.Fatalf("runtime chat delete deleted=%v err=%v", deleted, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var remainingChatRows, remainingEmailRows, remainingAttachmentLinks int
	if err := db.QueryRow(`select
  (select count(*) from node_textbox_chats where chat_id=$1::uuid),
  (select count(*) from communications_email_messages where email_message_id=$2::uuid),
  (select count(*) from resource_attachments where resource_type='node_chat_message' and resource_id=($1::uuid)::text and deleted_timestamp is null)`,
		runtimeChatID, emailMessageID).Scan(&remainingChatRows, &remainingEmailRows, &remainingAttachmentLinks); err != nil {
		t.Fatal(err)
	}
	if remainingChatRows != 0 || remainingEmailRows != 1 || remainingAttachmentLinks != 0 {
		t.Fatalf("chat/email/attachment-link delete result=%d/%d/%d, want 0/1/0", remainingChatRows, remainingEmailRows, remainingAttachmentLinks)
	}
}
