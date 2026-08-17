package store

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPostgresConsolidatedNodeTextboxMetadataMigrationIsIdempotent(t *testing.T) {
	db, _ := openRealtimePostgresIntegration(t)
	raw, err := os.ReadFile("../../db/migrations/20260810_node_textbox_metadata.sql")
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= 2; attempt++ {
		if _, err := db.Exec(string(raw)); err != nil {
			t.Fatalf("apply consolidated Node textbox metadata migration attempt %d: %v", attempt, err)
		}
	}
	var colorNullable bool
	var colorDefaultMissing bool
	if err := db.QueryRow(`
select not attribute.attnotnull,
       default_value.adbin is null
from pg_catalog.pg_attribute attribute
left join pg_catalog.pg_attrdef default_value
  on default_value.adrelid=attribute.attrelid and default_value.adnum=attribute.attnum
where attribute.attrelid='node_textboxes'::regclass
  and attribute.attname='color'
  and not attribute.attisdropped`).Scan(&colorNullable, &colorDefaultMissing); err != nil {
		t.Fatal(err)
	}
	if !colorNullable || !colorDefaultMissing {
		t.Fatalf("Node textbox color nullable=%v default missing=%v", colorNullable, colorDefaultMissing)
	}
}

func TestPostgresNodeFinalTextboxChatEmailAndAttachmentStorage(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Node final storage integration")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	owner, err := repo.UpsertAuthUser("node-final-owner", "node-final-owner@example.test", "Node Final Owner")
	if err != nil {
		t.Fatal(err)
	}
	other, err := repo.UpsertAuthUser("node-final-other", "node-final-other@example.test", "Node Final Other")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(company.CompanyID, "Final Node")
	if err != nil {
		t.Fatal(err)
	}
	textboxID := "00000000-0000-4000-8000-000000000501"
	document := editorMergeTestDocument(t,
		`{"type":"paragraph","attrs":{"blockId":"node-final-a"},"content":[{"type":"text","text":"first"}]}`)
	commit, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: textboxID},
		OperationID: newUUIDv7String(), ClientID: "node-final", ActorUserID: owner.UserID,
		BaseRevision: 0, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
	})
	if err != nil || commit.Revision != 1 {
		t.Fatalf("initial Node textbox commit=%+v err=%v", commit, err)
	}
	updatedDocument := editorMergeTestDocument(t,
		`{"type":"paragraph","attrs":{"blockId":"node-final-a"},"content":[{"type":"text","text":"first and second"}]}`)
	if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: textboxID},
		OperationID: newUUIDv7String(), ClientID: "node-final-other", ActorUserID: other.UserID,
		BaseRevision: 1, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: updatedDocument,
	}); err != nil {
		t.Fatal(err)
	}
	emailThreadID := "00000000-0000-4000-8000-000000000502"
	emailMessageID := "00000000-0000-4000-8000-000000000503"
	if _, err := db.Exec(`insert into email_threads(
  company_id,email_thread_id,email_account_type,personal_user_id,personal_account_email,
  email_account_email,provider,provider_thread_key,provider_thread_id,root_provider_message_id
) values($1::uuid,$2::uuid,'personal_email_account',$3::uuid,'node-final-owner@example.test',
  'node-final-owner@example.test','google','node-final-thread','provider-node-thread','provider-node-message')`,
		company.CompanyID, emailThreadID, owner.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into email_messages(
  company_id,email_message_id,email_thread_id,provider_message_id,message_order,subject,snippet,sender_snapshot
) values($1::uuid,$2::uuid,$3::uuid,'provider-node-message',0,'Exact Node email','Node email snippet',
  '[{"name":"Sender","email":"sender@example.test"}]'::jsonb)`, company.CompanyID, emailMessageID, emailThreadID); err != nil {
		t.Fatal(err)
	}
	stagedEmailMessageID := "00000000-0000-4000-8000-000000000509"
	if _, err := db.Exec(`insert into email_messages(
  company_id,email_message_id,email_thread_id,provider_message_id,message_order,subject,snippet,sender_snapshot
) values($1::uuid,$2::uuid,$3::uuid,'provider-node-message-2',1,'Staged Node email','Staged email snippet',
  '[{"name":"Sender","email":"sender@example.test"}]'::jsonb)`, company.CompanyID, stagedEmailMessageID, emailThreadID); err != nil {
		t.Fatal(err)
	}
	nodeWidePayload, _ := json.Marshal(map[string]any{
		"email_message_id": stagedEmailMessageID, "link_scope": "message",
		"attached_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(nodeWidePayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	rolledBackTextboxID := "00000000-0000-4000-8000-000000000510"
	invalidFirstChatPayload, _ := json.Marshal(map[string]any{
		"block_id": rolledBackTextboxID, "ensure_email_textbox_link_on_send": true,
		"email_textbox_color_on_send": "#0EA5E9",
		"selection_source":            "email", "selection_block_id": rolledBackTextboxID,
		"selection_message_id": stagedEmailMessageID, "selection_quote": "Staged quote",
		"selection_start": 1, "selection_end": 13,
		"author_id": owner.UserID, "author_name": "Node Final Owner", "message": "",
		"created_timestamp": time.Now().UTC().Format(time.RFC3339Nano), "attachments": []any{},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(invalidFirstChatPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid first email chat err=%v, want ErrInvalid", err)
	}
	var rolledBackTextboxes, rolledBackRelationships int
	if err := db.QueryRow(`select
  (select count(*) from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid),
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node'
    and resource_id=$2::uuid and resource_textbox_id=$3::text)`,
		company.CompanyID, node.NodeID, rolledBackTextboxID).Scan(&rolledBackTextboxes, &rolledBackRelationships); err != nil {
		t.Fatal(err)
	}
	if rolledBackTextboxes != 0 || rolledBackRelationships != 0 {
		t.Fatalf("failed first-chat transaction leaked textbox/relationship=%d/%d", rolledBackTextboxes, rolledBackRelationships)
	}
	firstChatTextboxID := "00000000-0000-4000-8000-000000000511"
	firstChatID := "00000000-0000-4000-8000-000000000512"
	firstChatPayload, _ := json.Marshal(map[string]any{
		"block_id": firstChatTextboxID, "ensure_email_textbox_link_on_send": true,
		"email_textbox_color_on_send": "#0EA5E9",
		"selection_source":            "email", "selection_block_id": firstChatTextboxID,
		"selection_message_id": stagedEmailMessageID, "selection_quote": "Staged quote",
		"selection_start": 1, "selection_end": 13,
		"author_id": owner.UserID, "author_name": "Node Final Owner", "message": "Commit this chat",
		"created_timestamp": time.Now().UTC().Format(time.RFC3339Nano), "attachments": []any{},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: firstChatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(firstChatPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	var committedTextboxes, committedRelationships, committedChats int
	if err := db.QueryRow(`select
  (select count(*) from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null),
  (select count(*) from email_relationships where company_id=$1::uuid and email_message_id=$4::uuid
    and resource_type='node' and resource_id=$2::uuid and resource_textbox_id=$3::text),
  (select count(*) from node_textbox_chats where company_id=$1::uuid and node_id=$2::uuid
    and textbox_id=$3::uuid and chat_id=$5::uuid)`,
		company.CompanyID, node.NodeID, firstChatTextboxID, stagedEmailMessageID, firstChatID).
		Scan(&committedTextboxes, &committedRelationships, &committedChats); err != nil {
		t.Fatal(err)
	}
	if committedTextboxes != 1 || committedRelationships != 1 || committedChats != 1 {
		t.Fatalf("first-chat transaction textbox/relationship/chat=%d/%d/%d", committedTextboxes, committedRelationships, committedChats)
	}
	existingTextboxMessageID := "00000000-0000-4000-8000-000000000513"
	if _, err := db.Exec(`insert into email_messages(
  company_id,email_message_id,email_thread_id,provider_message_id,message_order,subject,snippet,sender_snapshot
) values($1::uuid,$2::uuid,$3::uuid,'provider-node-message-3',2,'Existing text box email','Existing text box snippet',
  '[{"name":"Sender","email":"sender@example.test"}]'::jsonb)`, company.CompanyID, existingTextboxMessageID, emailThreadID); err != nil {
		t.Fatal(err)
	}
	existingTextboxID := "00000000-0000-4000-8000-000000000514"
	if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: existingTextboxID},
		OperationID: newUUIDv7String(), ClientID: "node-existing-destination", ActorUserID: owner.UserID,
		BaseRevision: 0, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
	}); err != nil {
		t.Fatal(err)
	}
	existingTextboxNodeWidePayload, _ := json.Marshal(map[string]any{
		"email_message_id": existingTextboxMessageID, "link_scope": "message",
		"attached_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(existingTextboxNodeWidePayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	existingTextboxChatID := "00000000-0000-4000-8000-000000000515"
	existingTextboxChatPayload, _ := json.Marshal(map[string]any{
		"block_id": existingTextboxID, "ensure_email_textbox_link_on_send": true,
		"email_textbox_color_on_send": "#14B8A6",
		"selection_source":            "email", "selection_block_id": existingTextboxID,
		"selection_message_id": existingTextboxMessageID, "selection_quote": "Existing quote",
		"selection_start": 2, "selection_end": 16,
		"author_id": owner.UserID, "author_name": "Node Final Owner", "message": "Use this text box",
		"created_timestamp": time.Now().UTC().Format(time.RFC3339Nano), "attachments": []any{},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: existingTextboxChatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(existingTextboxChatPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	var existingTextboxLinks, existingTextboxChats int
	var existingTextboxColor string
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and email_message_id=$4::uuid
    and resource_type='node' and resource_id=$2::uuid and resource_textbox_id=$3::text),
  (select count(*) from node_textbox_chats where company_id=$1::uuid and node_id=$2::uuid
    and textbox_id=$3::uuid and chat_id=$5::uuid),
  (select color from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid)`,
		company.CompanyID, node.NodeID, existingTextboxID, existingTextboxMessageID, existingTextboxChatID).
		Scan(&existingTextboxLinks, &existingTextboxChats, &existingTextboxColor); err != nil {
		t.Fatal(err)
	}
	if existingTextboxLinks != 1 || existingTextboxChats != 1 || existingTextboxColor != "#14B8A6" {
		t.Fatalf("existing textbox link/chat/color=%d/%d/%q", existingTextboxLinks, existingTextboxChats, existingTextboxColor)
	}
	emailNodeWidePayload, _ := json.Marshal(map[string]any{
		"email_message_id": emailMessageID, "link_scope": "message",
		"attached_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(emailNodeWidePayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	emailPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "email_message_id": emailMessageID,
		"textbox_color":      "#0EA5E9",
		"attached_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	emailRelationshipID := "00000000-0000-4000-8000-000000000504"
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: emailRelationshipID,
		Type: "Attached email", Information: string(emailPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	converged, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(emailPayload), ActorUserID: owner.UserID,
	})
	if err != nil || converged.InformationID != emailRelationshipID {
		t.Fatalf("same Node/message/textbox did not converge to exact relationship: %+v err=%v", converged, err)
	}
	convergedByNodeEditor, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(emailPayload), ActorUserID: other.UserID,
	})
	if err != nil || convergedByNodeEditor.InformationID != emailRelationshipID {
		t.Fatalf("Node editor could not reuse the Node-wide exact email: %+v err=%v", convergedByNodeEditor, err)
	}
	secondTextboxID := "00000000-0000-4000-8000-000000000509"
	if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: secondTextboxID},
		OperationID: newUUIDv7String(), ClientID: "node-final-second-textbox", ActorUserID: owner.UserID,
		BaseRevision: 0, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
	}); err != nil {
		t.Fatal(err)
	}
	secondTextboxPayload, _ := json.Marshal(map[string]any{
		"block_id": secondTextboxID, "email_message_id": emailMessageID,
		"textbox_color":      "#14B8A6",
		"attached_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(secondTextboxPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrEmailMessageTextboxConflict) {
		t.Fatalf("same message in a second textbox of one Node err=%v, want conflict", err)
	}
	secondNode, err := repo.CreateNode(company.CompanyID, "Second exact-message Node")
	if err != nil {
		t.Fatal(err)
	}
	secondNodeTextboxID := "00000000-0000-4000-8000-000000000510"
	if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: secondNode.NodeID, DocumentID: secondNodeTextboxID},
		OperationID: newUUIDv7String(), ClientID: "node-final-second-node", ActorUserID: owner.UserID,
		BaseRevision: 0, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
	}); err != nil {
		t.Fatal(err)
	}
	secondNodeRelationshipID := "00000000-0000-4000-8000-000000000511"
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: secondNode.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(emailNodeWidePayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("attach exact message to second Node: %v", err)
	}
	secondNodePayload, _ := json.Marshal(map[string]any{
		"block_id": secondNodeTextboxID, "email_message_id": emailMessageID,
		"textbox_color":      "#14B8A6",
		"attached_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: secondNode.NodeID, InformationID: secondNodeRelationshipID,
		Type: "Attached email", Information: string(secondNodePayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("same message relationship in a different Node: %v", err)
	}

	chatID := "00000000-0000-4000-8000-000000000505"
	chatPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "selection_source": "email", "selection_message_id": emailMessageID,
		"author_id": owner.UserID, "author_name": "Node Final Owner", "message": "Exact Node comment",
		"created_timestamp": time.Now().UTC().Format(time.RFC3339Nano), "attachments": []any{},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: chatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(chatPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}

	attachmentID := "00000000-0000-4000-8000-000000000506"
	if _, err := db.Exec(`insert into attachments(
  attachment_id,company_id,uploaded_by_user_id,original_filename,mime_type,byte_size,sha256,
  storage_bucket,storage_key,source_kind
) values($1::uuid,$2::uuid,$3::uuid,'shared-node-file.txt','text/plain',5,
  '0000000000000000000000000000000000000000000000000000000000000000',
  'disposable-test-bucket','node-final-storage/shared-node-file.txt','editor_paste')`,
		attachmentID, company.CompanyID, owner.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into attachment_relationships(
  attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,information_id,
  message_id,editor_surface,relationship_kind,created_by_user_id
) values
  ('00000000-0000-4000-8000-000000000507',$1::uuid,'node',$2,$3::uuid,$4::uuid,'','node_textbox','file_attachment',$5::uuid),
  ('00000000-0000-4000-8000-000000000508',$1::uuid,'email_message',$6,$3::uuid,null,'','email_message','email_attachment',$5::uuid)`,
		company.CompanyID, node.NodeID, attachmentID, textboxID, owner.UserID, emailMessageID); err != nil {
		t.Fatal(err)
	}

	projections, err := repo.ListNodeProjections(company.CompanyID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, projection := range projections {
		found[projection.InformationID] = true
		if projection.InformationID == emailRelationshipID && !strings.Contains(projection.Information, emailMessageID) {
			t.Fatalf("Node email projection lost exact message identity: %s", projection.Information)
		}
		if projection.InformationID == chatID && !strings.Contains(projection.Information, emailMessageID) {
			t.Fatalf("Node chat projection lost exact email selection: %s", projection.Information)
		}
	}
	for _, id := range []string{textboxID, emailRelationshipID, chatID} {
		if !found[id] {
			t.Fatalf("final Node projection %s missing: %+v", id, projections)
		}
	}
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: textboxID,
		ExpectedRevision: func() *int64 { value := int64(2); return &value }(), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	var liveChats, liveEmails, activeNodeLinks, activeEmailLinks, storedMessages int
	if err := db.QueryRow(`select
  (select count(*) from node_textbox_chats where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid),
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid and resource_textbox_id=$3::text),
  (select count(*) from attachment_relationships where company_id=$1::uuid and attachment_id=$4::uuid and resource_type='node' and deleted_timestamp is null),
	  (select count(*) from attachment_relationships where company_id=$1::uuid and attachment_id=$4::uuid and resource_type='email_message' and deleted_timestamp is null),
	  (select count(*) from email_messages where company_id=$1::uuid and email_message_id=$5::uuid)`,
		company.CompanyID, node.NodeID, textboxID, attachmentID, emailMessageID).Scan(&liveChats, &liveEmails, &activeNodeLinks, &activeEmailLinks, &storedMessages); err != nil {
		t.Fatal(err)
	}
	if liveChats != 0 || liveEmails != 0 || activeNodeLinks != 1 || activeEmailLinks != 1 || storedMessages != 1 {
		t.Fatalf("textbox delete chat/email/node-link/email-link/message=%d/%d/%d/%d/%d", liveChats, liveEmails, activeNodeLinks, activeEmailLinks, storedMessages)
	}
	var attachmentActive bool
	if err := db.QueryRow(`select deleted_timestamp is null from attachments
where company_id=$1::uuid and attachment_id=$2::uuid`, company.CompanyID, attachmentID).Scan(&attachmentActive); err != nil {
		t.Fatal(err)
	}
	if !attachmentActive {
		t.Fatal("shared attachment was marked pending while its exact email_message owner survived")
	}
	var nodeARelationships, nodeBRelationships, survivingMessages int
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid and email_message_id=$4::uuid),
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node' and resource_id=$3::uuid and email_message_id=$4::uuid),
  (select count(*) from email_messages where company_id=$1::uuid and email_message_id=$4::uuid)`,
		company.CompanyID, node.NodeID, secondNode.NodeID, emailMessageID).Scan(&nodeARelationships, &nodeBRelationships, &survivingMessages); err != nil {
		t.Fatal(err)
	}
	if nodeARelationships != 1 || nodeBRelationships != 2 || survivingMessages != 1 {
		t.Fatalf("isolated relationship delete left NodeA/NodeB/message=%d/%d/%d", nodeARelationships, nodeBRelationships, survivingMessages)
	}
}

func TestPostgresNodeTextboxSupportsSeveralExactEmailRelationshipsAndGuardedRemoval(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Node multi-email textbox integration")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	owner, err := repo.UpsertAuthUser("node-multi-email-owner", "node-multi-email-owner@example.test", "Node Multi Email Owner")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(company.CompanyID, "Multi-email textbox Node")
	if err != nil {
		t.Fatal(err)
	}

	connectionID := "00000000-0000-4000-8000-000000000610"
	threadID := "00000000-0000-4000-8000-000000000611"
	messageAID := "00000000-0000-4000-8000-000000000612"
	messageBID := "00000000-0000-4000-8000-000000000613"
	messageCID := "00000000-0000-4000-8000-000000000614"
	if _, err := db.Exec(`insert into email_connections(
  email_connection_id,company_id,connection_type,personal_user_id,provider,account_email,grant_id,connected_by_user_id
) values($1::uuid,$2::uuid,'personal',$3::uuid,'google','node-multi-email-owner@example.test',
  'node-multi-email-test-grant',$3::uuid)`, connectionID, company.CompanyID, owner.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into email_threads(
  company_id,email_thread_id,email_connection_id,provider_thread_key,provider_thread_id,root_provider_message_id
) values($1::uuid,$2::uuid,$3::uuid,'node-multi-email-thread-key','provider-node-multi-thread','provider-node-multi-a')`,
		company.CompanyID, threadID, connectionID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into email_messages(
  company_id,email_message_id,email_thread_id,provider_message_id,message_order,subject,snippet,sender_snapshot,message_timestamp
) values
  ($1::uuid,$2::uuid,$5::uuid,'provider-node-multi-a',0,'Message A','A','[]'::jsonb,'2026-01-02T12:00:00Z'),
  ($1::uuid,$3::uuid,$5::uuid,'provider-node-multi-b',1,'Message B','B','[]'::jsonb,'2026-01-01T12:00:00Z'),
  ($1::uuid,$4::uuid,$5::uuid,'provider-node-multi-c',2,'Message C','C','[]'::jsonb,'2026-01-03T12:00:00Z')`,
		company.CompanyID, messageAID, messageBID, messageCID, threadID); err != nil {
		t.Fatal(err)
	}

	textboxID := "00000000-0000-4000-8000-000000000615"
	secondTextboxID := "00000000-0000-4000-8000-000000000616"
	document := editorMergeTestDocument(t,
		`{"type":"paragraph","attrs":{"blockId":"node-multi-email"},"content":[{"type":"text","text":"notes"}]}`)
	if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: textboxID},
		OperationID: newUUIDv7String(), ClientID: "node-multi-email", ActorUserID: owner.UserID,
		BaseRevision: 0, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: secondTextboxID},
		OperationID: newUUIDv7String(), ClientID: "node-multi-email-second", ActorUserID: owner.UserID,
		BaseRevision: 0, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
	}); err != nil {
		t.Fatal(err)
	}

	wideAID := "00000000-0000-4000-8000-000000000617"
	wideBID := "00000000-0000-4000-8000-000000000618"
	wideAPayload, _ := json.Marshal(map[string]any{"email_message_id": messageAID, "link_scope": "message"})
	wideBPayload, _ := json.Marshal(map[string]any{"email_message_id": messageBID, "link_scope": "message"})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: wideAID,
		Type: "Attached email", Information: string(wideAPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: wideBID,
		Type: "Attached email", Information: string(wideBPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}

	linkAID := "00000000-0000-4000-8000-000000000619"
	linkBID := "00000000-0000-4000-8000-000000000620"
	linkAPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "email_message_id": messageAID, "link_scope": "message", "textbox_color": "#0EA5E9",
	})
	linkBPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "email_message_id": messageBID, "link_scope": "message", "textbox_color": "#14B8A6",
	})
	versionBeforeLinks, err := repo.CurrentNodeViewVersion(company.CompanyID, node.NodeID, owner.UserID)
	if err != nil {
		t.Fatal(err)
	}
	missingColorPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "email_message_id": messageAID, "link_scope": "message",
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID,
		InformationID: "00000000-0000-4000-8000-000000000629",
		Type:          "Attached email", Information: string(missingColorPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("uncolored textbox direct link without color err=%v", err)
	}
	versionAfterMissingColor, err := repo.CurrentNodeViewVersion(company.CompanyID, node.NodeID, owner.UserID)
	if err != nil || versionAfterMissingColor.Shared != versionBeforeLinks.Shared {
		t.Fatalf("failed colorless relationship changed view version before=%+v after=%+v err=%v", versionBeforeLinks, versionAfterMissingColor, err)
	}
	var missingColorRelationshipCount int
	var missingColorTextboxStillNull bool
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node'
    and resource_id=$2::uuid and resource_textbox_id=$3::text),
  (select color is null from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid)`,
		company.CompanyID, node.NodeID, textboxID).Scan(&missingColorRelationshipCount, &missingColorTextboxStillNull); err != nil {
		t.Fatal(err)
	}
	if missingColorRelationshipCount != 0 || !missingColorTextboxStillNull {
		t.Fatalf("failed colorless relationship leaked edge/color=%d/null:%v", missingColorRelationshipCount, missingColorTextboxStillNull)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: linkAID,
		Type: "Attached email", Information: string(linkAPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: linkBID,
		Type: "Attached email", Information: string(linkBPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	versionAfterLinks, err := repo.CurrentNodeViewVersion(company.CompanyID, node.NodeID, owner.UserID)
	if err != nil || versionAfterLinks.Shared <= versionBeforeLinks.Shared {
		t.Fatalf("direct relationship link view version before=%+v after=%+v err=%v", versionBeforeLinks, versionAfterLinks, err)
	}

	converged, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID,
		InformationID: "00000000-0000-4000-8000-000000000624",
		Type:          "Attached email", Information: string(linkAPayload), ActorUserID: owner.UserID,
	})
	if err != nil || converged.InformationID != linkAID {
		t.Fatalf("idempotent exact relationship=%+v err=%v", converged, err)
	}
	versionAfterIdempotentLink, err := repo.CurrentNodeViewVersion(company.CompanyID, node.NodeID, owner.UserID)
	if err != nil || versionAfterIdempotentLink.Shared != versionAfterLinks.Shared {
		t.Fatalf("idempotent relationship changed view version before=%+v after=%+v err=%v", versionAfterLinks, versionAfterIdempotentLink, err)
	}
	conflictPayload, _ := json.Marshal(map[string]any{
		"block_id": secondTextboxID, "email_message_id": messageAID, "link_scope": "message", "textbox_color": "#F59E0B",
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID,
		InformationID: "00000000-0000-4000-8000-000000000625",
		Type:          "Attached email", Information: string(conflictPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrEmailMessageTextboxConflict) {
		t.Fatalf("second textbox conflict err=%v", err)
	}
	var linkedTextboxColor string
	var conflictTextboxColorMissing bool
	if err := db.QueryRow(`select
  (select color from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid),
  (select color is null from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$4::uuid)`,
		company.CompanyID, node.NodeID, textboxID, secondTextboxID).Scan(&linkedTextboxColor, &conflictTextboxColorMissing); err != nil {
		t.Fatal(err)
	}
	if linkedTextboxColor != "#0EA5E9" || !conflictTextboxColorMissing {
		t.Fatalf("direct link primary/conflict colors=%q/null:%v", linkedTextboxColor, conflictTextboxColorMissing)
	}
	if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: textboxID},
		Title: "Metadata saved after link",
	}); err != nil {
		t.Fatalf("empty-color metadata save after direct link: %v", err)
	}
	if err := db.QueryRow(`select color from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
		company.CompanyID, node.NodeID, textboxID).Scan(&linkedTextboxColor); err != nil || linkedTextboxColor != "#0EA5E9" {
		t.Fatalf("linked textbox color after stale metadata save=%q err=%v", linkedTextboxColor, err)
	}
	if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: textboxID},
		Title: "Explicit recolor after link", Color: "#F59E0B",
	}); err != nil {
		t.Fatalf("explicit metadata recolor after direct link: %v", err)
	}
	if err := db.QueryRow(`select color from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
		company.CompanyID, node.NodeID, textboxID).Scan(&linkedTextboxColor); err != nil || linkedTextboxColor != "#0EA5E9" {
		t.Fatalf("linked textbox color after explicit metadata recolor=%q err=%v", linkedTextboxColor, err)
	}
	missingWidePayload, _ := json.Marshal(map[string]any{"block_id": textboxID, "email_message_id": messageCID, "link_scope": "message"})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID,
		InformationID: "00000000-0000-4000-8000-000000000626",
		Type:          "Attached email", Information: string(missingWidePayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrEmailMessageNotAttachedToNode) {
		t.Fatalf("missing Node-wide relationship err=%v", err)
	}
	wideCID := "00000000-0000-4000-8000-000000000630"
	wideCPayload, _ := json.Marshal(map[string]any{"email_message_id": messageCID, "link_scope": "message"})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: wideCID,
		Type: "Attached email", Information: string(wideCPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("attach C Node-wide: %v", err)
	}
	linkCID := "00000000-0000-4000-8000-000000000631"
	linkCPayload, _ := json.Marshal(map[string]any{
		"block_id": secondTextboxID, "email_message_id": messageCID, "link_scope": "message", "textbox_color": "#8B5CF6",
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: linkCID,
		Type: "Attached email", Information: string(linkCPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("link C to neutral textbox: %v", err)
	}
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: linkCID, ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("remove final relationship from C textbox: %v", err)
	}
	if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: secondTextboxID},
		Title: "Stale metadata after final detach", Color: "#8B5CF6",
	}); err != nil {
		t.Fatalf("stale metadata after final direct detach: %v", err)
	}
	if err := db.QueryRow(`select color is null from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
		company.CompanyID, node.NodeID, secondTextboxID).Scan(&conflictTextboxColorMissing); err != nil || !conflictTextboxColorMissing {
		t.Fatalf("final direct detach did not neutralize textbox null=%v err=%v", conflictTextboxColorMissing, err)
	}
	providerPayload, _ := json.Marshal(map[string]any{"block_id": textboxID, "email_message_id": "provider-node-multi-c", "link_scope": "message"})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID,
		InformationID: "00000000-0000-4000-8000-000000000627",
		Type:          "Attached email", Information: string(providerPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrEmailMessageIdentityInvalid) {
		t.Fatalf("provider relationship identity err=%v", err)
	}

	projections, err := repo.ListNodeProjections(company.CompanyID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	var linked struct {
		EmailMessageIDs []string `json:"email_message_ids"`
	}
	for _, projection := range projections {
		if projection.InformationID == textboxID {
			if err := json.Unmarshal([]byte(strings.TrimPrefix(projection.Information, editorTextBlockProjectionPrefix)), &linked); err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(linked.EmailMessageIDs) != 2 || linked.EmailMessageIDs[0] != messageBID || linked.EmailMessageIDs[1] != messageAID {
		t.Fatalf("timestamp-ordered linked messages=%v", linked.EmailMessageIDs)
	}
	if count := countPostgresRows(t, db, `select count(*) from email_relationships
where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid
  and resource_textbox_id=$3::text`, company.CompanyID, node.NodeID, secondTextboxID); count != 0 {
		t.Fatalf("conflict leaked %d relationship rows", count)
	}

	versionBeforeRemoval, err := repo.CurrentNodeViewVersion(company.CompanyID, node.NodeID, owner.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: linkBID, ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("remove chat-free exact relationship: %v", err)
	}
	versionAfterRemoval, err := repo.CurrentNodeViewVersion(company.CompanyID, node.NodeID, owner.UserID)
	if err != nil || versionAfterRemoval.Shared <= versionBeforeRemoval.Shared {
		t.Fatalf("direct relationship removal view version before=%+v after=%+v err=%v", versionBeforeRemoval, versionAfterRemoval, err)
	}
	var wideBCount, textboxBCount int
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and email_relationship_id=$3::uuid),
  (select count(*) from email_relationships where company_id=$1::uuid and email_message_id=$4::uuid
    and resource_type='node' and resource_id=$2::uuid and resource_textbox_id is not null)`,
		company.CompanyID, node.NodeID, wideBID, messageBID).Scan(&wideBCount, &textboxBCount); err != nil {
		t.Fatal(err)
	}
	if wideBCount != 1 || textboxBCount != 0 {
		t.Fatalf("chat-free removal wide/textbox=%d/%d", wideBCount, textboxBCount)
	}
	if err := db.QueryRow(`select color from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
		company.CompanyID, node.NodeID, textboxID).Scan(&linkedTextboxColor); err != nil || linkedTextboxColor != "#0EA5E9" {
		t.Fatalf("removing one of two relationships changed textbox color=%q err=%v", linkedTextboxColor, err)
	}

	chatID := "00000000-0000-4000-8000-000000000621"
	chatPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "selection_source": "email", "selection_message_id": messageAID,
		"author_id": owner.UserID, "author_name": "Node Multi Email Owner", "message": "Anchored chat",
		"attachments": []any{}, "entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: chatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(chatPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	secondMessageChatID := "00000000-0000-4000-8000-000000000628"
	secondMessageChatPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "ensure_email_textbox_link_on_send": true,
		"email_textbox_color_on_send": "#0EA5E9", "selection_source": "email",
		"selection_block_id": textboxID, "selection_message_id": messageBID,
		"selection_quote": "Second exact message", "selection_start": 0, "selection_end": 20,
		"author_id": owner.UserID, "author_name": "Node Multi Email Owner", "message": "Second message chat",
		"attachments": []any{}, "entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: secondMessageChatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(secondMessageChatPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("second exact message first-chat send to existing textbox: %v", err)
	}
	projections, err = repo.ListNodeProjections(company.CompanyID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	linked.EmailMessageIDs = nil
	for _, projection := range projections {
		if projection.InformationID == textboxID {
			if err := json.Unmarshal([]byte(strings.TrimPrefix(projection.Information, editorTextBlockProjectionPrefix)), &linked); err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(linked.EmailMessageIDs) != 2 || linked.EmailMessageIDs[0] != messageBID || linked.EmailMessageIDs[1] != messageAID {
		t.Fatalf("second-message Enter projection=%v", linked.EmailMessageIDs)
	}
	var exactTextboxLinks, exactEmailChats int
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node'
    and resource_id=$2::uuid and resource_textbox_id=$3::text and email_message_id in ($4::uuid,$5::uuid)),
  (select count(*) from node_textbox_chats where company_id=$1::uuid and node_id=$2::uuid
    and textbox_id=$3::uuid and selection_source='email'
    and selection_email_message_id in ($4::uuid,$5::uuid))`,
		company.CompanyID, node.NodeID, textboxID, messageAID, messageBID).Scan(&exactTextboxLinks, &exactEmailChats); err != nil {
		t.Fatal(err)
	}
	if exactTextboxLinks != 2 || exactEmailChats != 2 {
		t.Fatalf("second-message Enter links/chats=%d/%d", exactTextboxLinks, exactEmailChats)
	}
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: linkAID, ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrEmailRelationshipRequiredByChat) {
		t.Fatalf("anchored relationship removal err=%v", err)
	}
	var linkACount, chatCount int
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and email_relationship_id=$3::uuid),
  (select count(*) from node_textbox_chats where company_id=$1::uuid and node_id=$2::uuid and chat_id=$4::uuid)`,
		company.CompanyID, node.NodeID, linkAID, chatID).Scan(&linkACount, &chatCount); err != nil {
		t.Fatal(err)
	}
	if linkACount != 1 || chatCount != 1 {
		t.Fatalf("blocked removal relationship/chat=%d/%d", linkACount, chatCount)
	}
	if err := db.QueryRow(`select color from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
		company.CompanyID, node.NodeID, textboxID).Scan(&linkedTextboxColor); err != nil || linkedTextboxColor != "#0EA5E9" {
		t.Fatalf("blocked detach changed textbox color=%q err=%v", linkedTextboxColor, err)
	}

	providerChatTextboxID := "00000000-0000-4000-8000-000000000622"
	providerChatID := "00000000-0000-4000-8000-000000000623"
	providerChatPayload, _ := json.Marshal(map[string]any{
		"block_id": providerChatTextboxID, "ensure_email_textbox_link_on_send": true,
		"email_textbox_color_on_send": "#0EA5E9", "selection_source": "email",
		"selection_block_id": providerChatTextboxID, "selection_message_id": "provider-node-multi-a",
		"selection_quote": "Provider identity", "author_id": owner.UserID, "message": "Must fail",
		"attachments": []any{}, "entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: providerChatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(providerChatPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrEmailMessageIdentityInvalid) {
		t.Fatalf("provider chat identity err=%v", err)
	}
	var leakedTextbox, leakedChat int
	if err := db.QueryRow(`select
  (select count(*) from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid),
  (select count(*) from node_textbox_chats where company_id=$1::uuid and node_id=$2::uuid and chat_id=$4::uuid)`,
		company.CompanyID, node.NodeID, providerChatTextboxID, providerChatID).Scan(&leakedTextbox, &leakedChat); err != nil {
		t.Fatal(err)
	}
	if leakedTextbox != 0 || leakedChat != 0 {
		t.Fatalf("provider chat failure leaked textbox/chat=%d/%d", leakedTextbox, leakedChat)
	}

	var textboxRevision int64
	if err := db.QueryRow(`select revision from node_textboxes
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
		company.CompanyID, node.NodeID, textboxID).Scan(&textboxRevision); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: textboxID,
		ExpectedRevision: &textboxRevision, ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("delete linked textbox: %v", err)
	}
	var oldTextboxLinks, oldTextboxChats, wideLinks int
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node'
    and resource_id=$2::uuid and resource_textbox_id=$3::text),
  (select count(*) from node_textbox_chats where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid),
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node'
    and resource_id=$2::uuid and resource_textbox_id is null and email_message_id in ($4::uuid,$5::uuid))`,
		company.CompanyID, node.NodeID, textboxID, messageAID, messageBID).
		Scan(&oldTextboxLinks, &oldTextboxChats, &wideLinks); err != nil {
		t.Fatal(err)
	}
	if oldTextboxLinks != 0 || oldTextboxChats != 0 || wideLinks != 2 {
		t.Fatalf("textbox delete links/chats/wide=%d/%d/%d", oldTextboxLinks, oldTextboxChats, wideLinks)
	}
	deletedTextboxChatID := "00000000-0000-4000-8000-000000000633"
	deletedTextboxChatPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "author_id": owner.UserID,
		"author_name": "Node Multi Email Owner", "message": "Must not attach to deleted textbox",
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: deletedTextboxChatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(deletedTextboxChatPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("chat on deleted textbox err=%v, want ErrNotFound", err)
	}
	if count := countPostgresRows(t, db, `select count(*) from node_textbox_chats
where company_id=$1::uuid and node_id=$2::uuid and chat_id=$3::uuid`,
		company.CompanyID, node.NodeID, deletedTextboxChatID); count != 0 {
		t.Fatalf("deleted textbox accepted %d chat rows", count)
	}
	releasedLinkID := "00000000-0000-4000-8000-000000000632"
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: releasedLinkID,
		Type: "Attached email", Information: string(conflictPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("link released message to second textbox: %v", err)
	}
	if count := countPostgresRows(t, db, `select count(*) from email_relationships
where company_id=$1::uuid and email_relationship_id=$3::uuid and resource_type='node'
  and resource_id=$2::uuid and resource_textbox_id=$4::text and email_message_id=$5::uuid`,
		company.CompanyID, node.NodeID, releasedLinkID, secondTextboxID, messageAID); count != 1 {
		t.Fatalf("released message links to second textbox=%d, want 1", count)
	}
}

func TestPostgresOrdinaryNodeTextboxTitlePersistsWithNoColor(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Node textbox metadata integration")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	node, err := repo.CreateNode(company.CompanyID, "Metadata Node")
	if err != nil {
		t.Fatal(err)
	}
	textboxID := "00000000-0000-4000-8000-000000000591"
	metadata, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: textboxID},
		Title:    "Stored title",
	})
	if err != nil || metadata.ProjectionRevision != 1 {
		t.Fatalf("metadata=%+v err=%v", metadata, err)
	}
	document := editorMergeTestDocument(t,
		`{"type":"paragraph","attrs":{"blockId":"metadata-body"},"content":[{"type":"text","text":"private canonical marker"}]}`)
	commit, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document:    EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: textboxID},
		OperationID: newUUIDv7String(), ClientID: "metadata-client", BaseRevision: 1,
		SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
	})
	if err != nil || commit.Revision != 2 {
		t.Fatalf("commit=%+v err=%v", commit, err)
	}

	projections, err := repo.ListNodeProjections(company.CompanyID, node.NodeID)
	if err != nil || len(projections) != 1 {
		t.Fatalf("projections=%+v err=%v", projections, err)
	}
	if !strings.Contains(projections[0].Information, `"title": "Stored title"`) ||
		!strings.Contains(projections[0].Information, `"color": ""`) ||
		strings.Contains(projections[0].Information, `"email_accent"`) ||
		!strings.Contains(projections[0].Information, "private canonical marker") {
		t.Fatalf("full projection lost metadata or document: %s", projections[0].Information)
	}
	view, err := repo.GetNodeView(NodeViewInput{CompanyID: company.CompanyID, NodeID: node.NodeID})
	if err != nil || len(view.Projections) != 1 {
		t.Fatalf("view=%+v err=%v", view, err)
	}
	if strings.Contains(view.Projections[0].Information, "private canonical marker") ||
		!strings.Contains(view.Projections[0].Information, `"title": "Stored title"`) ||
		!strings.Contains(view.Projections[0].Information, `"color": ""`) {
		t.Fatalf("Node view projection carried the wrong payload: %s", view.Projections[0].Information)
	}
	var colorMissing bool
	if err := db.QueryRow(`select color is null from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, company.CompanyID, node.NodeID, textboxID).Scan(&colorMissing); err != nil || !colorMissing {
		t.Fatalf("ordinary Node textbox color is null=%v err=%v", colorMissing, err)
	}
}
