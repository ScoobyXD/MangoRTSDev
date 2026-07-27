package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestNodeV2Phase2TextboxesSyncCommentsAndBoundedWorkspace(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "71717171-7171-4717-8717-717171717171"
	repo.EnsureCompany(companyID, "Node v2 test")
	actor, err := repo.UpsertAuthUser("node-v2-actor", "node-v2@example.com", "Node V2 Actor")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Large Node v2")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	created := make([]NodeV2TextBoxMutationResult, 0, 140)
	for index := 0; index < 140; index++ {
		result, createErr := repo.CreateNodeV2TextBox(NodeV2CreateTextBoxInput{
			CompanyID: companyID, NodeID: node.NodeID, ActorUserID: actor.UserID,
			IdempotencyKey: fmt.Sprintf("textbox-%03d", index),
		})
		if createErr != nil {
			t.Fatalf("CreateNodeV2TextBox %d: %v", index, createErr)
		}
		created = append(created, result)
	}
	replayed, err := repo.CreateNodeV2TextBox(NodeV2CreateTextBoxInput{CompanyID: companyID, NodeID: node.NodeID, ActorUserID: actor.UserID, IdempotencyKey: "textbox-000"})
	if err != nil || replayed.Textbox.TextboxID != created[0].Textbox.TextboxID {
		t.Fatalf("idempotent create = %+v, %v", replayed.Textbox, err)
	}

	workspace, err := repo.GetNodeV2Workspace(NodeV2WorkspaceQuery{CompanyID: companyID, NodeID: node.NodeID, TimelineLimit: 25, AggregateLimit: 25})
	if err != nil {
		t.Fatalf("GetNodeV2Workspace: %v", err)
	}
	if workspace.Counts.Textboxes != 140 || len(workspace.Textboxes) != 25 || workspace.TextboxNextCursor == nil {
		t.Fatalf("workspace textboxes count=%d payload=%d", workspace.Counts.Textboxes, len(workspace.Textboxes))
	}
	if len(workspace.Timeline.Items) != 25 || workspace.Timeline.NextCursor == nil {
		t.Fatalf("bounded timeline page = %+v", workspace.Timeline)
	}
	secondTimeline, err := repo.ListNodeV2Timeline(NodeV2TimelineQuery{CompanyID: companyID, NodeID: node.NodeID, Limit: 25, Cursor: workspace.Timeline.NextCursor})
	if err != nil || len(secondTimeline.Items) != 25 || secondTimeline.Items[0].TimelineItemID == workspace.Timeline.Items[len(workspace.Timeline.Items)-1].TimelineItemID {
		t.Fatalf("second timeline page items=%d err=%v", len(secondTimeline.Items), err)
	}

	textbox := created[0].Textbox
	payload := []byte{1, 2, 3, 4, 5}
	digest := sha256.Sum256(payload)
	updateInput := NodeV2YjsUpdateInput{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, ActorUserID: actor.UserID, CollaborationEpoch: textbox.CollaborationEpoch, UpdateID: "update-1", UpdateSHA256: hex.EncodeToString(digest[:]), ClientID: "tab-1", Payload: payload}
	firstUpdate, err := repo.AppendNodeV2YjsUpdate(updateInput)
	if err != nil {
		t.Fatalf("AppendNodeV2YjsUpdate: %v", err)
	}
	retryUpdate, err := repo.AppendNodeV2YjsUpdate(updateInput)
	if err != nil || retryUpdate.UpdateSequence != firstUpdate.UpdateSequence {
		t.Fatalf("idempotent update=%+v err=%v", retryUpdate, err)
	}
	recoveryRetryInput := updateInput
	recoveryRetryInput.UpdateID = "update-1-recovery-retry"
	recoveryRetry, err := repo.AppendNodeV2YjsUpdate(recoveryRetryInput)
	if err != nil || recoveryRetry.UpdateSequence != firstUpdate.UpdateSequence {
		t.Fatalf("checksum-idempotent recovery update=%+v err=%v", recoveryRetry, err)
	}

	syncPage, err := repo.GetNodeV2TextBoxSync(NodeV2SyncQuery{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, IncludeCheckpoint: true, Limit: 10})
	if err != nil || syncPage.Checkpoint == nil || len(syncPage.Updates) != 1 {
		t.Fatalf("sync page=%+v err=%v", syncPage, err)
	}
	document := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Recovered"}]}]}`)
	untrustedInput := NodeV2CheckpointInput{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, ActorUserID: actor.UserID, CheckpointID: "malicious-checkpoint", CollaborationEpoch: textbox.CollaborationEpoch, ThroughSequence: firstUpdate.UpdateSequence, CheckpointPayload: []byte{0, 0}, StateVector: []byte{0}, DocumentJSON: document, PlainText: "omits durable state", Reason: "test"}
	if _, err := repo.CheckpointNodeV2TextBox(untrustedInput); !errors.Is(err, ErrNodeV2UntrustedCheckpoint) {
		t.Fatalf("untrusted checkpoint err=%v", err)
	}
	staleClaim := untrustedInput
	staleClaim.Trusted, staleClaim.CheckpointID, staleClaim.ThroughSequence = true, "future-checkpoint", firstUpdate.UpdateSequence+1
	if _, err := repo.CheckpointNodeV2TextBox(staleClaim); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("future checkpoint claim err=%v", err)
	}
	checkpointed, err := repo.CheckpointNodeV2TextBox(NodeV2CheckpointInput{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, ActorUserID: actor.UserID, CheckpointID: "checkpoint-1", CollaborationEpoch: textbox.CollaborationEpoch, ThroughSequence: firstUpdate.UpdateSequence, CheckpointPayload: []byte{0, 0}, StateVector: []byte{0}, DocumentJSON: document, PlainText: "Recovered", Reason: "test", Trusted: true})
	if err != nil || checkpointed.PlainText != "Recovered" || checkpointed.MaterializedThroughSequence != firstUpdate.UpdateSequence {
		t.Fatalf("checkpoint=%+v err=%v", checkpointed, err)
	}

	for index := 0; index < 2_000; index++ {
		_, err := repo.CreateNodeV2CommentThread(NodeV2CreateCommentThreadInput{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, ActorUserID: actor.UserID, IdempotencyKey: fmt.Sprintf("comment-%03d", index), BodyText: fmt.Sprintf("Comment %d", index), SelectedQuote: "Recovered", AnchorBeforeText: "Before", AnchorAfterText: "After", AnchorStart: []byte{1, byte(index)}, AnchorEnd: []byte{2, byte(index)}, Mentions: []NodeV2MentionInput{{PrincipalType: "user", PrincipalID: actor.UserID}}})
		if err != nil {
			t.Fatalf("CreateNodeV2CommentThread %d: %v", index, err)
		}
	}
	commentPage, err := repo.ListNodeV2Comments(NodeV2CommentQuery{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, Limit: 30})
	if err != nil || len(commentPage.Threads) != 30 || commentPage.NextCursor == nil {
		t.Fatalf("comment page items=%d cursor=%v err=%v", len(commentPage.Threads), commentPage.NextCursor, err)
	}
	nextComments, err := repo.ListNodeV2Comments(NodeV2CommentQuery{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, Limit: 30, Cursor: commentPage.NextCursor})
	if err != nil || len(nextComments.Threads) != 30 {
		t.Fatalf("second comment page items=%d err=%v", len(nextComments.Threads), err)
	}
	reply, err := repo.ReplyNodeV2Comment(NodeV2ReplyCommentInput{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, ThreadID: commentPage.Threads[0].ThreadID, ActorUserID: actor.UserID, IdempotencyKey: "reply-1", ParentCommentID: commentPage.Threads[0].Comments[0].CommentID, BodyText: "Reply"})
	if err != nil || reply.ParentCommentID == "" {
		t.Fatalf("reply=%+v err=%v", reply, err)
	}

	archived, err := repo.SetNodeV2TextBoxArchived(NodeV2ArchiveTextBoxInput{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, ActorUserID: actor.UserID, Archived: true, IdempotencyKey: "archive-1"})
	if err != nil || archived.DeletedTimestamp == nil {
		t.Fatalf("archive=%+v err=%v", archived, err)
	}
	restored, err := repo.SetNodeV2TextBoxArchived(NodeV2ArchiveTextBoxInput{CompanyID: companyID, NodeID: node.NodeID, TextboxID: textbox.TextboxID, ActorUserID: actor.UserID, Archived: false, IdempotencyKey: "restore-1"})
	if err != nil || restored.DeletedTimestamp != nil {
		t.Fatalf("restore=%+v err=%v", restored, err)
	}
}

func TestNodeV2PrimaryTimelineContainsExactlyThreeTypes(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "72727272-7272-4727-8727-727272727272"
	repo.EnsureCompany(companyID, "Timeline")
	actor, _ := repo.UpsertAuthUser("node-v2-timeline", "timeline@example.com", "Timeline Actor")
	node, _ := repo.CreateNode(companyID, "Timeline node")
	_, err := repo.CreateNodeV2TextBox(NodeV2CreateTextBoxInput{CompanyID: companyID, NodeID: node.NodeID, ActorUserID: actor.UserID, IdempotencyKey: "textbox"})
	if err != nil {
		t.Fatal(err)
	}
	repo.mu.Lock()
	repo.appendNodeV2MovementLocked(domainTimelineTransferForTest(companyID, node.NodeID, actor.UserID))
	repo.appendNodeV2VerificationStampLocked(companyID, node.NodeID, "legacy-request", actor.UserID, repo.nodeV2.timeline[memoryNodeV2NodeKey(companyID, node.NodeID)][0].OccurredAt)
	repo.mu.Unlock()
	page, err := repo.ListNodeV2Timeline(NodeV2TimelineQuery{CompanyID: companyID, NodeID: node.NodeID, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, item := range page.Items {
		seen[item.ItemType] = true
		if item.ItemType != "textbox_created" && item.ItemType != "node_moved" && item.ItemType != "verification_stamp" {
			t.Fatalf("unexpected primary timeline type %q", item.ItemType)
		}
	}
	for _, expected := range []string{"textbox_created", "node_moved", "verification_stamp"} {
		if !seen[expected] {
			t.Fatalf("missing timeline type %q in %+v", expected, seen)
		}
	}
}

func domainTimelineTransferForTest(companyID, nodeID, actorUserID string) domain.NodeTimelineEvent {
	now := time.Now().UTC()
	return domain.NodeTimelineEvent{EventID: newUUIDv7String(), CompanyID: companyID, NodeID: nodeID, ActorUserID: actorUserID, ActorDisplayName: "Timeline Actor", FromLogicGateID: newUUIDv7String(), FromLogicGateName: "Before", ToLogicGateID: newUUIDv7String(), ToLogicGateName: "After", CreatedTimestamp: now}
}
