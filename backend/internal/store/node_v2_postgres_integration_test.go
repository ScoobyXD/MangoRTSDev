package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestPostgresRealtimeNodeV2PaginationDurabilityAndOutbox(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	installRealtimeOutboxFailureTrigger(t, db)

	company, err := repo.CreateCompany("Node V2 PostgreSQL audit")
	if err != nil {
		t.Fatal(err)
	}
	companyDeleted := false
	t.Cleanup(func() {
		if companyDeleted {
			return
		}
		tx, cleanupErr := db.Begin()
		if cleanupErr != nil {
			t.Errorf("begin Node V2 company cleanup: %v", cleanupErr)
			return
		}
		defer tx.Rollback()
		if _, cleanupErr = tx.Exec("select mangorts_prepare_company_editor_purge($1::uuid)", company.CompanyID); cleanupErr != nil {
			t.Errorf("prepare Node V2 company cleanup: %v", cleanupErr)
			return
		}
		if _, cleanupErr = tx.Exec("delete from companies where company_id=$1::uuid", company.CompanyID); cleanupErr != nil {
			t.Errorf("delete Node V2 company: %v", cleanupErr)
			return
		}
		if cleanupErr = tx.Commit(); cleanupErr != nil {
			t.Errorf("commit Node V2 company cleanup: %v", cleanupErr)
		}
	})
	suffix := fmt.Sprint(time.Now().UnixNano())
	subject := "node-v2-postgres-" + suffix
	actor, err := repo.UpsertAuthUser(subject, subject+"@example.test", "Node V2 PostgreSQL")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(company.CompanyID, "145 text boxes")
	if err != nil {
		t.Fatal(err)
	}
	var rolloutRunID string
	if err := db.QueryRow(`insert into editor_conversion_runs(conversion_run_id,company_id,owner_type,mode,status,batch_size,source_snapshot_timestamp,backup_reference,completed_timestamp) values(gen_random_uuid(),$1::uuid,'all','shadow_validate','completed',100,now(),'disposable PostgreSQL integration proof',now()) returning conversion_run_id::text`, company.CompanyID).Scan(&rolloutRunID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into editor_rollout_gates(company_id,owner_type,rollout_state,validation_run_id,validated_timestamp,activated_timestamp) select $1::uuid,owner_type,'active',$2::uuid,now(),now() from unnest(array['node','project','logic_gate']) owner_type`, company.CompanyID, rolloutRunID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into workspace_editor_formats(company_id,editor_format,migration_state,expected_document_count,converted_document_count,validated_timestamp,cutover_timestamp) values($1::uuid,'tiptap_json','ready',0,0,now(),now())`, company.CompanyID); err != nil {
		t.Fatal(err)
	}

	created := make([]NodeV2TextBoxMutationResult, 0, 145)
	for index := 0; index < 145; index++ {
		item, createErr := repo.CreateNodeV2TextBox(NodeV2CreateTextBoxInput{
			CompanyID: company.CompanyID, NodeID: node.NodeID, ActorUserID: actor.UserID,
			IdempotencyKey: fmt.Sprintf("postgres-textbox-%03d", index),
		})
		if createErr != nil {
			t.Fatalf("create textbox %d: %v", index, createErr)
		}
		created = append(created, item)
	}

	workspace, err := repo.GetNodeV2Workspace(NodeV2WorkspaceQuery{CompanyID: company.CompanyID, NodeID: node.NodeID, TimelineLimit: 23, AggregateLimit: 25})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(workspace)
	if len(workspace.Textboxes) != 25 || workspace.TextboxNextCursor == nil {
		t.Fatalf("initial metadata page items=%d cursor=%v", len(workspace.Textboxes), workspace.TextboxNextCursor)
	}
	if containsJSONField(encoded, "document_json") || containsJSONField(encoded, "plain_text") {
		t.Fatalf("metadata workspace leaked editor content: %s", encoded)
	}

	seen := map[string]bool{}
	cursor := (*NodeV2Cursor)(nil)
	for {
		page, pageErr := repo.ListNodeV2TextBoxes(NodeV2TextBoxPageQuery{CompanyID: company.CompanyID, NodeID: node.NodeID, Limit: 19, Cursor: cursor})
		if pageErr != nil {
			t.Fatal(pageErr)
		}
		for _, item := range page.Items {
			if seen[item.TextboxID] {
				t.Fatalf("duplicate textbox %s", item.TextboxID)
			}
			seen[item.TextboxID] = true
		}
		if page.NextCursor == nil {
			break
		}
		cursor = page.NextCursor
	}
	if len(seen) != 145 {
		t.Fatalf("reachable textboxes=%d want=145", len(seen))
	}

	firstPage, _ := repo.ListNodeV2TextBoxes(NodeV2TextBoxPageQuery{CompanyID: company.CompanyID, NodeID: node.NodeID, Limit: 20})
	laterPage, _ := repo.ListNodeV2TextBoxes(NodeV2TextBoxPageQuery{CompanyID: company.CompanyID, NodeID: node.NodeID, Limit: 20, Cursor: firstPage.NextCursor})
	moved, err := repo.MoveNodeV2TextBox(NodeV2TextBoxMoveInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, ActorUserID: actor.UserID,
		TextboxID: firstPage.Items[0].TextboxID, ReferenceID: laterPage.Items[5].TextboxID,
		Placement: "after", IdempotencyKey: "cross-page-move",
	})
	if err != nil || moved.TextboxID == "" {
		t.Fatalf("cross-page move=%+v err=%v", moved, err)
	}
	allAfterMove, _ := repo.ListNodeV2TextBoxes(NodeV2TextBoxPageQuery{CompanyID: company.CompanyID, NodeID: node.NodeID, Limit: NodeV2MaxPageLimit})
	for index, item := range allAfterMove.Items {
		if item.TextboxID == moved.TextboxID && (index == 0 || allAfterMove.Items[index-1].TextboxID != laterPage.Items[5].TextboxID) {
			t.Fatalf("moved textbox not adjacent to reference at index %d", index)
		}
	}

	largeText := make([]byte, 1024*1024)
	for index := range largeText {
		largeText[index] = 'x'
	}
	document := map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": string(largeText)}}}}}
	envelope, _ := json.Marshal(map[string]any{"format": "mango-tiptap-json", "schema_version": 1, "document": document})
	target := created[0].Textbox
	if _, err := db.Exec(`update node_textboxes set document_json=$4::jsonb,plain_text=$5 where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, company.CompanyID, node.NodeID, target.TextboxID, envelope, string(largeText)); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 20; index++ {
		payload := []byte(fmt.Sprintf("small-yjs-delta-%02d", index))
		digest := sha256.Sum256(payload)
		if _, err := repo.AppendNodeV2YjsUpdate(NodeV2YjsUpdateInput{
			CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: target.TextboxID,
			ActorUserID: actor.UserID, CollaborationEpoch: target.CollaborationEpoch,
			UpdateID: newUUIDv7String(), UpdateSHA256: hex.EncodeToString(digest[:]),
			ClientID: "large-document-test", Payload: payload,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if got := countPostgresRows(t, db, `select count(*) from node_textbox_yjs_updates where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, company.CompanyID, node.NodeID, target.TextboxID); got != 20 {
		t.Fatalf("durable delta rows=%d want=20", got)
	}
	if got := countPostgresRows(t, db, `select count(*) from node_textbox_yjs_checkpoints where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, company.CompanyID, node.NodeID, target.TextboxID); got != 1 {
		t.Fatalf("ordinary typing checkpoint rows=%d want=1 seed only", got)
	}
	var revision int64
	if err := db.QueryRow(`select content_revision from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, company.CompanyID, node.NodeID, target.TextboxID).Scan(&revision); err != nil || revision != 0 {
		t.Fatalf("typing materialized revision=%d err=%v", revision, err)
	}

	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role: domain.GVICRoleVerified, PrincipalType: EntityPermissionSubjectUser, PrincipalID: actor.UserID,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	verification, err := repo.CreateNodeVerificationRequest(NodeVerificationRequestInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, ActorUserID: actor.UserID,
		IdempotencyKey: "node-v2-retention-verification",
	})
	if err != nil {
		t.Fatalf("create exact-content verification: %v", err)
	}
	if got := countPostgresRows(t, db, `select count(*) from node_verification_content_pins where company_id=$1::uuid and node_id=$2::uuid and verification_request_id=$3::uuid`, company.CompanyID, node.NodeID, verification.TimelineEvent.EventID); got != 145 {
		t.Fatalf("verification checkpoint pins=%d want=145", got)
	}
	if got := countPostgresRows(t, db, `select count(*) from node_verification_update_pins where company_id=$1::uuid and node_id=$2::uuid and verification_request_id=$3::uuid and textbox_id=$4::uuid`, company.CompanyID, node.NodeID, verification.TimelineEvent.EventID, target.TextboxID); got != 20 {
		t.Fatalf("verification tail pins=%d want=20", got)
	}
	if _, err := repo.CheckpointNodeV2TextBox(NodeV2CheckpointInput{
		CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: target.TextboxID,
		ActorUserID: actor.UserID, CheckpointID: newUUIDv7String(), CollaborationEpoch: target.CollaborationEpoch,
		ThroughSequence: 20, CheckpointPayload: []byte{0, 0}, StateVector: []byte{0},
		DocumentJSON: envelope, PlainText: string(largeText), Reason: "manual_recovery", Trusted: true,
	}); err != nil {
		t.Fatalf("checkpoint verified tail: %v", err)
	}

	control := created[1].Textbox
	var controlUpdates []domain.NodeV2YjsUpdate
	for index := 0; index < 2; index++ {
		payload := []byte(fmt.Sprintf("retention-control-%d", index))
		digest := sha256.Sum256(payload)
		item, appendErr := repo.AppendNodeV2YjsUpdate(NodeV2YjsUpdateInput{
			CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: control.TextboxID,
			ActorUserID: actor.UserID, CollaborationEpoch: control.CollaborationEpoch,
			UpdateID: newUUIDv7String(), UpdateSHA256: hex.EncodeToString(digest[:]),
			ClientID: "retention-control", Payload: payload,
		})
		if appendErr != nil {
			t.Fatal(appendErr)
		}
		controlUpdates = append(controlUpdates, item)
		if _, checkpointErr := repo.CheckpointNodeV2TextBox(NodeV2CheckpointInput{
			CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: control.TextboxID,
			ActorUserID: actor.UserID, CheckpointID: newUUIDv7String(), CollaborationEpoch: control.CollaborationEpoch,
			ThroughSequence: item.UpdateSequence, CheckpointPayload: []byte{0, 0}, StateVector: []byte{0},
			DocumentJSON: json.RawMessage(nodeV2EmptyDocument), PlainText: "", Reason: "manual_recovery", Trusted: true,
		}); checkpointErr != nil {
			t.Fatal(checkpointErr)
		}
	}
	if _, err := db.Exec(`update node_textbox_yjs_updates set received_timestamp=now()-interval '30 days',checkpointed_timestamp=now()-interval '20 days',retain_until=now()-interval '1 day' where company_id=$1::uuid and node_id=$2::uuid and textbox_id in ($3::uuid,$4::uuid)`, company.CompanyID, node.NodeID, target.TextboxID, control.TextboxID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`update node_textbox_yjs_checkpoints set created_timestamp=now()-interval '30 days',retain_until=now()-interval '1 day' where company_id=$1::uuid and node_id=$2::uuid and ((textbox_id=$3::uuid and through_update_sequence=0) or (textbox_id=$4::uuid and through_update_sequence=1))`, company.CompanyID, node.NodeID, target.TextboxID, control.TextboxID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`select mangorts_cleanup_node_v2_yjs_retention(1000)`); err != nil {
		t.Fatal(err)
	}
	if got := countPostgresRows(t, db, `select count(*) from node_textbox_yjs_updates where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, company.CompanyID, node.NodeID, target.TextboxID); got != 20 {
		t.Fatalf("retention removed verification-pinned updates: got=%d want=20", got)
	}
	if got := countPostgresRows(t, db, `select count(*) from node_textbox_yjs_checkpoints where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and through_update_sequence=0`, company.CompanyID, node.NodeID, target.TextboxID); got != 1 {
		t.Fatalf("retention removed verification-pinned checkpoint: got=%d want=1", got)
	}
	if got := countPostgresRows(t, db, `select count(*) from node_textbox_yjs_updates where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and update_sequence in ($4,$5)`, company.CompanyID, node.NodeID, control.TextboxID, controlUpdates[0].UpdateSequence, controlUpdates[1].UpdateSequence); got != 0 {
		t.Fatalf("retention kept unpinned covered updates: got=%d want=0", got)
	}
	if got := countPostgresRows(t, db, `select count(*) from node_textbox_yjs_checkpoints where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and through_update_sequence=1`, company.CompanyID, node.NodeID, control.TextboxID); got != 0 {
		t.Fatalf("retention kept unpinned superseded checkpoint: got=%d want=0", got)
	}

	if _, err := db.Exec(`update node_timeline_items set occurred_at='2026-01-01T00:00:00Z' where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, node.NodeID); err != nil {
		t.Fatal(err)
	}
	timelineSeen := map[string]bool{}
	var timelineCursor *NodeV2Cursor
	for {
		page, pageErr := repo.ListNodeV2Timeline(NodeV2TimelineQuery{CompanyID: company.CompanyID, NodeID: node.NodeID, Limit: 17, Cursor: timelineCursor})
		if pageErr != nil {
			t.Fatal(pageErr)
		}
		for _, item := range page.Items {
			if timelineSeen[item.TimelineItemID] {
				t.Fatalf("duplicate timeline item %s", item.TimelineItemID)
			}
			timelineSeen[item.TimelineItemID] = true
		}
		if page.NextCursor == nil {
			break
		}
		timelineCursor = page.NextCursor
	}
	if len(timelineSeen) != 145 {
		t.Fatalf("tied timeline items=%d want=145", len(timelineSeen))
	}

	emailThreadID := newUUIDv7String()
	if _, err := db.Exec(`insert into communications_email_threads(
company_id,email_thread_id,scope_type,personal_user_id,personal_account_email,account_email,
provider_thread_key,provider_thread_id,root_provider_message_id,hydration_status,history_complete)
values($1::uuid,$2::uuid,'personal',$3::uuid,$4,$4,'audit-thread','audit-thread','provider-000','complete',true)`,
		company.CompanyID, emailThreadID, actor.UserID, subject+"@example.test"); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 65; index++ {
		providerID := fmt.Sprintf("provider-%03d", index)
		if _, err := db.Exec(`insert into communications_email_messages(
company_id,email_message_id,email_thread_id,provider_message_id,message_order,subject,message_timestamp,
rich_html_body,text_fallback,snippet)
values($1::uuid,$2::uuid,$3::uuid,$4,$5,'Stable email cursor',1700000000,'<p>body</p>','body','body')`,
			company.CompanyID, newUUIDv7String(), emailThreadID, providerID, index/3); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`insert into communications_node_email_threads(
company_id,node_id,information_id,email_thread_id,selected_provider_message_id,created_by_user_id)
values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'provider-000',$5::uuid)`,
		company.CompanyID, node.NodeID, newUUIDv7String(), emailThreadID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	emailSeen := map[string]bool{}
	var emailCursor *NodeV2Cursor
	for {
		page, pageErr := repo.ListNodeV2EmailMessages(NodeV2EmailMessageQuery{CompanyID: company.CompanyID, NodeID: node.NodeID, EmailThreadID: emailThreadID, Limit: 7, Cursor: emailCursor, IncludeBody: true})
		if pageErr != nil {
			t.Fatal(pageErr)
		}
		for _, message := range page.Items {
			if emailSeen[message.ProviderMessageID] {
				t.Fatalf("duplicate tied-order email %s", message.ProviderMessageID)
			}
			emailSeen[message.ProviderMessageID] = true
		}
		if page.NextCursor == nil {
			break
		}
		emailCursor = page.NextCursor
	}
	if len(emailSeen) != 65 {
		t.Fatalf("paged email messages=%d want=65", len(emailSeen))
	}
	commentInput := NodeV2CreateCommentThreadInput{CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: target.TextboxID, ActorUserID: actor.UserID, IdempotencyKey: "business-comment", BodyText: "Atomic business comment"}
	firstComment, err := repo.CreateNodeV2CommentThread(commentInput)
	if err != nil {
		t.Fatal(err)
	}
	retriedComment, err := repo.CreateNodeV2CommentThread(commentInput)
	if err != nil || retriedComment.ThreadID != firstComment.ThreadID {
		t.Fatalf("comment retry=%+v err=%v", retriedComment, err)
	}
	if _, err := db.Exec(`insert into node_textbox_comments(
company_id,node_id,textbox_id,thread_id,comment_id,parent_comment_id,author_user_id,
author_display_name,body_text,idempotency_key,created_timestamp)
select $1::uuid,$2::uuid,$3::uuid,$4::uuid,gen_random_uuid(),$5::uuid,$6::uuid,
'Node V2 PostgreSQL','Bulk reply '||reply_index,'bulk-reply-'||reply_index,
clock_timestamp()+(reply_index*interval '1 millisecond')
from generate_series(1,1001) reply_index`, company.CompanyID, node.NodeID, target.TextboxID, firstComment.ThreadID, firstComment.Comments[0].CommentID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into node_textbox_comment_mentions(
company_id,node_id,textbox_id,thread_id,comment_id,principal_type,principal_id,principal_display_name)
select company_id,node_id,textbox_id,thread_id,comment_id,'user',$5::uuid,'Node V2 PostgreSQL'
from node_textbox_comments
where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and thread_id=$4::uuid
  and idempotency_key like 'bulk-reply-%'`, company.CompanyID, node.NodeID, target.TextboxID, firstComment.ThreadID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	boundedThreads, err := repo.ListNodeV2Comments(NodeV2CommentQuery{
		CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: target.TextboxID, Limit: 1,
	})
	if err != nil || len(boundedThreads.Threads) != 1 {
		t.Fatalf("bounded comment thread page=%+v err=%v", boundedThreads, err)
	}
	boundedThread := boundedThreads.Threads[0]
	if boundedThread.CommentCount != 1002 || len(boundedThread.Comments) != NodeV2DefaultPageLimit || boundedThread.CommentsNextCursor == nil {
		t.Fatalf("huge thread initial window count=%d loaded=%d cursor=%v", boundedThread.CommentCount, len(boundedThread.Comments), boundedThread.CommentsNextCursor)
	}
	replyIDs := map[string]bool{}
	replyCursor := (*NodeV2Cursor)(nil)
	for {
		replyPage, pageErr := repo.ListNodeV2CommentReplies(NodeV2CommentReplyQuery{
			CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: target.TextboxID,
			ThreadID: firstComment.ThreadID, Limit: 37, Cursor: replyCursor,
		})
		if pageErr != nil {
			t.Fatal(pageErr)
		}
		if len(replyPage.Items) > 37 {
			t.Fatalf("unbounded reply page returned %d items", len(replyPage.Items))
		}
		for _, reply := range replyPage.Items {
			if replyIDs[reply.CommentID] {
				t.Fatalf("duplicate reply across cursor pages: %s", reply.CommentID)
			}
			replyIDs[reply.CommentID] = true
			if strings.HasPrefix(reply.BodyText, "Bulk reply ") && len(reply.Mentions) != 1 {
				t.Fatalf("bounded mention hydration for %s = %d, want 1", reply.CommentID, len(reply.Mentions))
			}
		}
		if replyPage.NextCursor == nil {
			break
		}
		replyCursor = replyPage.NextCursor
	}
	if len(replyIDs) != 1002 {
		t.Fatalf("reachable huge-thread comments=%d want=1002", len(replyIDs))
	}

	attachmentID := newUUIDv7String()
	if _, err := db.Exec(`insert into attachments(
attachment_id,company_id,uploaded_by_user_id,original_filename,mime_type,byte_size,sha256,
storage_bucket,storage_key,source_kind)
values($1::uuid,$2::uuid,$3::uuid,'audit.txt','text/plain',1,$4,'disposable','audit/'||$1,'user_upload')`,
		attachmentID, company.CompanyID, actor.UserID, strings.Repeat("0", 64)); err != nil {
		t.Fatal(err)
	}
	attachmentInput := NodeV2AttachmentLinkInput{CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: target.TextboxID, AttachmentID: attachmentID, RelationshipKind: "file_attachment", ActorUserID: actor.UserID, IdempotencyKey: "business-attachment"}
	firstAttachment, err := repo.SetNodeV2AttachmentLink(attachmentInput)
	if err != nil {
		t.Fatal(err)
	}
	retriedAttachment, err := repo.SetNodeV2AttachmentLink(attachmentInput)
	if err != nil || retriedAttachment.AttachmentLinkID != firstAttachment.AttachmentLinkID {
		t.Fatalf("attachment retry=%+v err=%v", retriedAttachment, err)
	}

	emailInput := NodeV2EmailLinkInput{CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: target.TextboxID, EmailThreadID: emailThreadID, ActorUserID: actor.UserID, IdempotencyKey: "business-email"}
	if err := repo.SetNodeV2EmailLink(emailInput); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetNodeV2EmailLink(emailInput); err != nil {
		t.Fatalf("email retry: %v", err)
	}
	for _, event := range []struct {
		eventType string
		key       string
	}{
		{"node.comment.created", "node-v2-comment:business-comment"},
		{"node.attachment.linked", "node-v2-attachment:business-attachment"},
		{"node.email.linked", "node-v2-email:business-email"},
	} {
		if got := countPostgresRows(t, db, `select count(*) from domain_events where company_id=$1::uuid and event_type=$2 and idempotency_key=$3`, company.CompanyID, event.eventType, event.key); got != 1 {
			t.Fatalf("%s domain events=%d want=1", event.eventType, got)
		}
		if got := countPostgresRows(t, db, `select count(*) from realtime_outbox where company_id=$1::uuid and event_type=$2`, company.CompanyID, event.eventType); got != 1 {
			t.Fatalf("%s outbox rows=%d want=1", event.eventType, got)
		}
	}

	forceRealtimeOutboxEvent(t, db, "node.textbox.archived", true)
	_, err = repo.SetNodeV2TextBoxArchived(NodeV2ArchiveTextBoxInput{CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: target.TextboxID, ActorUserID: actor.UserID, Archived: true, IdempotencyKey: "atomic-archive"})
	if err == nil {
		t.Fatal("archive succeeded despite forced outbox failure")
	}
	var deleted bool
	if err := db.QueryRow(`select deleted_timestamp is not null from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, company.CompanyID, node.NodeID, target.TextboxID).Scan(&deleted); err != nil || deleted {
		t.Fatalf("archive mutation was not rolled back deleted=%v err=%v", deleted, err)
	}
	forceRealtimeOutboxEvent(t, db, "node.textbox.archived", false)
	archiveInput := NodeV2ArchiveTextBoxInput{CompanyID: company.CompanyID, NodeID: node.NodeID, TextboxID: target.TextboxID, ActorUserID: actor.UserID, Archived: true, IdempotencyKey: "atomic-archive"}
	if _, err := repo.SetNodeV2TextBoxArchived(archiveInput); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetNodeV2TextBoxArchived(archiveInput); err != nil {
		t.Fatal(err)
	}
	if got := countPostgresRows(t, db, `select count(*) from domain_events where company_id=$1::uuid and event_type='node.textbox.archived' and idempotency_key='node-v2-textbox-archive:atomic-archive'`, company.CompanyID); got != 1 {
		t.Fatalf("archive domain events=%d want=1", got)
	}
	if got := countPostgresRows(t, db, `select count(*) from realtime_outbox where company_id=$1::uuid and event_type='node.textbox.archived'`, company.CompanyID); got != 1 {
		t.Fatalf("archive outbox rows=%d want=1", got)
	}

	if _, err := db.Exec(`insert into node_textbox_comment_attachment_links(
company_id,node_id,textbox_id,thread_id,comment_id,attachment_link_id)
values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid)`,
		company.CompanyID, node.NodeID, target.TextboxID, firstComment.ThreadID,
		firstComment.Comments[0].CommentID, firstAttachment.AttachmentLinkID); err != nil {
		t.Fatal(err)
	}
	purgeTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer purgeTx.Rollback()
	var purgeJSON []byte
	if err := purgeTx.QueryRow(`select mangorts_prepare_company_editor_purge($1::uuid)`, company.CompanyID).Scan(&purgeJSON); err != nil {
		t.Fatal(err)
	}
	var purgeCounts map[string]int
	if err := json.Unmarshal(purgeJSON, &purgeCounts); err != nil {
		t.Fatal(err)
	}
	for relation, count := range map[string]int{
		"node_textbox_comment_attachment_links": 1,
		"node_textbox_email_links":              1,
		"node_textbox_attachment_links":         1,
	} {
		if purgeCounts[relation] != count {
			t.Fatalf("company purge %s=%d want=%d; report=%s", relation, purgeCounts[relation], count, purgeJSON)
		}
	}
	if _, err := purgeTx.Exec(`delete from companies where company_id=$1::uuid`, company.CompanyID); err != nil {
		t.Fatalf("company deletion after ordered Node V2 purge: %v", err)
	}
	if err := purgeTx.Commit(); err != nil {
		t.Fatal(err)
	}
	companyDeleted = true
	if got := countPostgresRows(t, db, `select count(*) from companies where company_id=$1::uuid`, company.CompanyID); got != 0 {
		t.Fatalf("company remains after ordered purge transaction: %d", got)
	}
}

func containsJSONField(encoded []byte, field string) bool {
	var value any
	if json.Unmarshal(encoded, &value) != nil {
		return false
	}
	var walk func(any) bool
	walk = func(candidate any) bool {
		switch typed := candidate.(type) {
		case map[string]any:
			if _, ok := typed[field]; ok {
				return true
			}
			for _, child := range typed {
				if walk(child) {
					return true
				}
			}
		case []any:
			for _, child := range typed {
				if walk(child) {
					return true
				}
			}
		}
		return false
	}
	return walk(value)
}

func TestPostgresPreV2TimelineBridgeIsCapabilityGated(t *testing.T) {
	if os.Getenv("MANGORTS_PRE_V2_POSTGRES_TEST") != "1" {
		t.Skip("disposable pre-V2 PostgreSQL integration database not configured")
	}
	db := openPostgresFromEnvironment(t)
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	item := domain.NodeTimelineEvent{CompanyID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", NodeID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", EventID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"}
	if err := insertNodeV2MovementForLegacyTimelineTx(context.Background(), tx, item); err != nil {
		t.Fatalf("pre-V2 bridge should be a safe no-op: %v", err)
	}
}

func openPostgresFromEnvironment(t *testing.T) *sql.DB {
	t.Helper()
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), os.Getenv("DB_SSLMODE"))
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db
}
