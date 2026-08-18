package store

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestPostgresFirstEmailChatUsesPartialNodeThreadMembership(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Partial Node email thread chat")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	owner, err := repo.UpsertAuthUser("partial-node-thread-owner", "partial-node-thread@example.test", "Partial Thread Owner")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(company.CompanyID, "Partial thread Node")
	if err != nil {
		t.Fatal(err)
	}

	connectionID := "00000000-0000-4000-8000-000000000901"
	threadID := "00000000-0000-4000-8000-000000000902"
	messageAID := "00000000-0000-4000-8000-000000000903"
	messageBID := "00000000-0000-4000-8000-000000000904"
	messageCID := "00000000-0000-4000-8000-000000000905"
	unrelatedThreadID := "00000000-0000-4000-8000-000000000906"
	unrelatedMessageID := "00000000-0000-4000-8000-000000000907"
	if _, err := db.Exec(`insert into email_connections(
  email_connection_id,company_id,connection_type,personal_user_id,provider,account_email,grant_id,connected_by_user_id
) values($1::uuid,$2::uuid,'personal',$3::uuid,'google','partial-node-thread@example.test',
  'partial-node-thread-grant',$3::uuid)`, connectionID, company.CompanyID, owner.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into email_threads(
  company_id,email_thread_id,email_connection_id,provider_thread_key,provider_thread_id,root_provider_message_id
) values
  ($1::uuid,$2::uuid,$3::uuid,'partial-node-thread','provider-partial-node-thread','provider-partial-a'),
  ($1::uuid,$4::uuid,$3::uuid,'unrelated-node-thread','provider-unrelated-node-thread','provider-unrelated')`,
		company.CompanyID, threadID, connectionID, unrelatedThreadID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into email_messages(
  company_id,email_message_id,email_thread_id,provider_message_id,message_order,subject,snippet,sender_snapshot,message_timestamp
) values
  ($1::uuid,$2::uuid,$5::uuid,'provider-partial-a',0,'Message A','A','[]'::jsonb,'2026-01-01T12:00:00Z'),
  ($1::uuid,$3::uuid,$5::uuid,'provider-partial-b',1,'Message B','B','[]'::jsonb,'2026-01-02T12:00:00Z'),
  ($1::uuid,$4::uuid,$5::uuid,'provider-partial-c',2,'Message C','C','[]'::jsonb,'2026-01-03T12:00:00Z'),
  ($1::uuid,$6::uuid,$7::uuid,'provider-unrelated',0,'Unrelated','Unrelated','[]'::jsonb,'2026-01-04T12:00:00Z')`,
		company.CompanyID, messageAID, messageBID, messageCID, threadID, unrelatedMessageID, unrelatedThreadID); err != nil {
		t.Fatal(err)
	}

	widePayload, _ := json.Marshal(map[string]any{
		"email_message_id": messageAID,
		"link_scope":       "message",
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(widePayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	if count := countPostgresRows(t, db, `select count(*) from email_relationships
where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid
  and email_thread_id=$3::uuid and resource_textbox_id is null`, company.CompanyID, node.NodeID, threadID); count != 1 {
		t.Fatalf("initial Node-wide rows=%d, want one partial row", count)
	}

	textboxID := "00000000-0000-4000-8000-000000000908"
	chatID := "00000000-0000-4000-8000-000000000909"
	chatPayload, _ := json.Marshal(map[string]any{
		"block_id":                          textboxID,
		"ensure_email_textbox_link_on_send": true,
		"email_textbox_color_on_send":       "#0EA5E9",
		"selection_source":                  "email",
		"selection_block_id":                textboxID,
		"selection_message_id":              messageBID,
		"selection_quote":                   "Message B",
		"selection_start":                   0,
		"selection_end":                     9,
		"author_id":                         owner.UserID,
		"author_name":                       "Partial Thread Owner",
		"message":                           "Chat from stored sibling",
		"created_timestamp":                 time.Now().UTC().Format(time.RFC3339Nano),
		"attachments":                       []any{},
		"entity_links":                      []any{},
		"mentioned_user_ids":                []string{},
		"mentioned_group_ids":               []string{},
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: chatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(chatPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("first chat from stored sibling: %v", err)
	}

	var wideRows, exactTextboxRows, exactChats int
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node'
    and resource_id=$2::uuid and email_thread_id=$3::uuid and resource_textbox_id is null),
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node'
    and resource_id=$2::uuid and email_message_id=$4::uuid and resource_textbox_id=$5::text),
  (select count(*) from node_textbox_chats where company_id=$1::uuid and node_id=$2::uuid
    and chat_id=$6::uuid and selection_email_message_id=$4::uuid)`,
		company.CompanyID, node.NodeID, threadID, messageBID, textboxID, chatID).
		Scan(&wideRows, &exactTextboxRows, &exactChats); err != nil {
		t.Fatal(err)
	}
	if wideRows != 1 || exactTextboxRows != 1 || exactChats != 1 {
		t.Fatalf("atomic sibling link wide/textbox/chat=%d/%d/%d, want 1/1/1", wideRows, exactTextboxRows, exactChats)
	}

	directLinkPayload, _ := json.Marshal(map[string]any{
		"block_id":         textboxID,
		"email_message_id": messageCID,
		"link_scope":       "message",
		"textbox_color":    "#0EA5E9",
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(directLinkPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("direct-link stored sibling: %v", err)
	}
	if count := countPostgresRows(t, db, `select count(*) from email_relationships
where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid
  and email_message_id=$3::uuid and resource_textbox_id=$4::text`, company.CompanyID, node.NodeID, messageCID, textboxID); count != 1 {
		t.Fatalf("direct sibling textbox rows=%d, want one", count)
	}
	if count := countPostgresRows(t, db, `select count(*) from email_relationships
where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid
  and email_thread_id=$3::uuid and resource_textbox_id is null`, company.CompanyID, node.NodeID, threadID); count != 1 {
		t.Fatalf("sibling links changed Node-wide rows=%d, want one", count)
	}

	unrelatedTextboxID := "00000000-0000-4000-8000-000000000910"
	unrelatedChatID := "00000000-0000-4000-8000-000000000911"
	chatPayloadMap := map[string]any{}
	if err := json.Unmarshal(chatPayload, &chatPayloadMap); err != nil {
		t.Fatal(err)
	}
	chatPayloadMap["block_id"] = unrelatedTextboxID
	chatPayloadMap["selection_block_id"] = unrelatedTextboxID
	chatPayloadMap["selection_message_id"] = unrelatedMessageID
	unrelatedPayload, _ := json.Marshal(chatPayloadMap)
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: unrelatedChatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(unrelatedPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrEmailMessageNotAttachedToNode) {
		t.Fatalf("unrelated thread chat err=%v, want ErrEmailMessageNotAttachedToNode", err)
	}
	if count := countPostgresRows(t, db, `select count(*) from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, company.CompanyID, node.NodeID, unrelatedTextboxID); count != 0 {
		t.Fatalf("unrelated thread failure leaked %d textboxes", count)
	}
	unrelatedLinkPayload, _ := json.Marshal(map[string]any{
		"block_id":         textboxID,
		"email_message_id": unrelatedMessageID,
		"link_scope":       "message",
		"textbox_color":    "#0EA5E9",
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(unrelatedLinkPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrEmailMessageNotAttachedToNode) {
		t.Fatalf("unrelated direct link err=%v, want ErrEmailMessageNotAttachedToNode", err)
	}
}
