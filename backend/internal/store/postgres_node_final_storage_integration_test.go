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
	stagedTextboxID := "00000000-0000-4000-8000-000000000513"
	if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: stagedTextboxID},
		OperationID: newUUIDv7String(), ClientID: "node-final-staged-email", ActorUserID: owner.UserID,
		BaseRevision: 0, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document,
	}); err != nil {
		t.Fatal(err)
	}
	stagedPayload, _ := json.Marshal(map[string]any{
		"block_id": stagedTextboxID, "email_message_id": stagedEmailMessageID, "link_scope": "message",
		"attached_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(stagedPayload), ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	invalidChatID := "00000000-0000-4000-8000-000000000510"
	invalidFirstChatPayload, _ := json.Marshal(map[string]any{
		"block_id":         stagedTextboxID,
		"selection_source": "email", "selection_block_id": stagedTextboxID,
		"selection_message_id": stagedEmailMessageID, "selection_quote": "Staged quote",
		"selection_start": 1, "selection_end": 13,
		"author_id": owner.UserID, "author_name": "Node Final Owner", "message": "",
		"created_timestamp": time.Now().UTC().Format(time.RFC3339Nano), "attachments": []any{},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: invalidChatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(invalidFirstChatPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid email chat err=%v, want ErrInvalid", err)
	}
	var invalidChats int
	if err := db.QueryRow(`select count(*) from node_textbox_chats
where company_id=$1::uuid and node_id=$2::uuid and chat_id=$3::uuid`,
		company.CompanyID, node.NodeID, invalidChatID).Scan(&invalidChats); err != nil {
		t.Fatal(err)
	}
	if invalidChats != 0 {
		t.Fatalf("invalid email chat leaked %d chat rows", invalidChats)
	}
	firstChatID := "00000000-0000-4000-8000-000000000512"
	firstChatPayload, _ := json.Marshal(map[string]any{
		"block_id":         stagedTextboxID,
		"selection_source": "email", "selection_block_id": stagedTextboxID,
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
		company.CompanyID, node.NodeID, stagedTextboxID, stagedEmailMessageID, firstChatID).
		Scan(&committedTextboxes, &committedRelationships, &committedChats); err != nil {
		t.Fatal(err)
	}
	if committedTextboxes != 1 || committedRelationships != 1 || committedChats != 1 {
		t.Fatalf("stored textbox/relationship/chat=%d/%d/%d", committedTextboxes, committedRelationships, committedChats)
	}
	emailPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "email_message_id": emailMessageID,
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
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(emailPayload), ActorUserID: other.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unowned exact email attach err=%v, want ErrInvalid", err)
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
		"attached_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(secondTextboxPayload), ActorUserID: owner.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("same message in a second textbox of one Node err=%v, want ErrInvalid", err)
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
	secondNodePayload, _ := json.Marshal(map[string]any{
		"block_id": secondNodeTextboxID, "email_message_id": emailMessageID,
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
	if liveChats != 0 || liveEmails != 1 || activeNodeLinks != 1 || activeEmailLinks != 1 || storedMessages != 1 {
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
	if err := repo.DeleteNodeProjection(company.CompanyID, node.NodeID, emailRelationshipID); err != nil {
		t.Fatalf("delete Node A email relationship: %v", err)
	}
	var nodeARelationships, nodeBRelationships, survivingMessages int
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node' and resource_id=$2::uuid and email_message_id=$4::uuid),
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='node' and resource_id=$3::uuid and email_message_id=$4::uuid),
  (select count(*) from email_messages where company_id=$1::uuid and email_message_id=$4::uuid)`,
		company.CompanyID, node.NodeID, secondNode.NodeID, emailMessageID).Scan(&nodeARelationships, &nodeBRelationships, &survivingMessages); err != nil {
		t.Fatal(err)
	}
	if nodeARelationships != 0 || nodeBRelationships != 1 || survivingMessages != 1 {
		t.Fatalf("isolated relationship delete left NodeA/NodeB/message=%d/%d/%d", nodeARelationships, nodeBRelationships, survivingMessages)
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
