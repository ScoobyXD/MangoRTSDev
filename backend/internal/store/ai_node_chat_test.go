package store

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryAINodeChatContract(t *testing.T) {
	testAINodeChatContract(t, NewMemoryRepo())
}

func TestPostgresAINodeChatContract(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	testAINodeChatContract(t, repo)
}

func testAINodeChatContract(t *testing.T, repo Repository) {
	t.Helper()
	ctx := context.Background()
	run := newAIActionReceiptRun(t, repo)
	if _, err := repo.AddCompanyMembership("ai-receipt-owner", run.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	run, err := repo.BindAIRun(ctx, run.CompanyID, run.UserID, run.RunID, "native-node-chat")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(run.CompanyID, "Chat owner")
	if err != nil {
		t.Fatal(err)
	}
	ref := EditorJSONDocumentRef{CompanyID: run.CompanyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: NewUUIDv7String()}
	if _, err := repo.CommitEditorJSONDocument(EditorJSONCommitInput{
		Document: ref, OperationID: "textbox", ClientID: "fixture", ActorUserID: run.UserID,
		SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: emptyMangoTiptapDocument,
	}); err != nil {
		t.Fatal(err)
	}
	input := AINodeChatCreateInput{NodeID: node.NodeID, TextboxID: ref.DocumentID, Body: "Review this <plain text>\nSecond line", ActorDisplayName: "Current author"}
	chat, err := repo.AICreateNodeChat(ctx, run, "first-chat", input)
	if err != nil {
		t.Fatal(err)
	}
	var payload textboxChatPayload
	if json.Unmarshal([]byte(chat.Information), &payload) != nil || payload.BlockID != ref.DocumentID || payload.Message != input.Body || payload.AuthorID != run.UserID || payload.AuthorName != input.ActorDisplayName {
		t.Fatalf("wrong canonical chat: %+v", chat)
	}
	if replay, err := repo.AICreateNodeChat(ctx, run, "first-chat", input); err != nil || !reflect.DeepEqual(replay, chat) {
		t.Fatalf("receipt did not retain exact chat: %+v %v", replay, err)
	}
	assertChats := func(want int) {
		t.Helper()
		projections, err := repo.ListNodeProjections(run.CompanyID, node.NodeID)
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		for _, projection := range projections {
			if projection.Type == "Text block chat" {
				count++
				if projection.InformationID != chat.InformationID {
					t.Fatalf("unexpected chat identity: %+v", projection)
				}
			}
		}
		if count != want {
			t.Fatalf("got %d chats, want %d", count, want)
		}
		outboxCount := 0
		switch r := repo.(type) {
		case *MemoryRepo:
			for _, event := range r.realtimeOutbox {
				if event.CompanyID == run.CompanyID && event.Scope == "chat:node:"+node.NodeID && event.EventType == "chat.message.created" {
					outboxCount++
				}
			}
		case *PostgresRepo:
			if err := r.db.QueryRowContext(ctx, `select count(*) from realtime_outbox where company_id=$1::uuid and scope=$2 and event_type='chat.message.created'`, run.CompanyID, "chat:node:"+node.NodeID).Scan(&outboxCount); err != nil {
				t.Fatal(err)
			}
		}
		if outboxCount != want {
			t.Fatalf("got %d chat outbox events, want %d", outboxCount, want)
		}
	}
	assertChats(1)
	beforeFailure, err := repo.GetAIRun(ctx, run.CompanyID, run.UserID, run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	wrongTextbox := input
	wrongTextbox.TextboxID = NewUUIDv7String()
	if _, err := repo.AICreateNodeChat(ctx, run, "missing-textbox", wrongTextbox); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing textbox accepted: %v", err)
	}
	other, err := repo.CreateNode(run.CompanyID, "Another owner")
	if err != nil {
		t.Fatal(err)
	}
	wrongOwner := input
	wrongOwner.NodeID = other.NodeID
	if _, err := repo.AICreateNodeChat(ctx, run, "wrong-owner", wrongOwner); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another owner's textbox accepted: %v", err)
	}
	afterFailure, err := repo.GetAIRun(ctx, run.CompanyID, run.UserID, run.RunID)
	if err != nil || len(beforeFailure.History) != len(afterFailure.History) {
		t.Fatalf("failed chat wrote history: %+v %v", afterFailure, err)
	}
	// Failure after the chat writer must roll back chat, outbox, and receipt.
	if _, err := repo.AppendAIHistoryEvent(ctx, run.CompanyID, run.UserID, run.RunID, AIHistoryEvent{
		ID: "action:mango_create_node_chat:rollback", Type: "fixture-conflict", CreatedAt: time.Now().UTC(), Data: json.RawMessage(`{}`),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AICreateNodeChat(ctx, run, "rollback", input); !errors.Is(err, ErrConflict) {
		t.Fatalf("history conflict did not abort chat: %v", err)
	}
	assertChats(1)
	if memory, ok := repo.(*MemoryRepo); ok {
		if _, exists := memory.aiActions[aiScopeKey(run.CompanyID, run.UserID, run.RunID)][aiActionKey{"mango_create_node_chat", "rollback"}]; exists {
			t.Fatal("failed chat retained a receipt")
		}
	}
	deny := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: run.CompanyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &deny, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("ai-receipt-owner", run.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AICreateNodeChat(ctx, run, "first-chat", input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked permission exposed receipt: %v", err)
	}
	if _, err := repo.AICreateNodeChat(ctx, run, "new-denied-chat", input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked permission allowed chat: %v", err)
	}
	assertChats(1)
}
