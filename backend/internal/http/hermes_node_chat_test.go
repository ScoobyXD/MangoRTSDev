package httpapi

import (
	"encoding/json"
	"testing"

	"miraeopus/backend/internal/store"
)

func TestMangoCreateNodeChatUsesCanonicalTextboxAndCurrentAuthor(t *testing.T) {
	f := newAIFixture(t)
	if w := f.submit(t); w.Code != 202 {
		t.Fatalf("submit: %d %s", w.Code, w.Body)
	}
	node, err := f.repo.CreateNode(f.route.CompanyID, "Chat owner")
	if err != nil {
		t.Fatal(err)
	}
	textbox := mangoToolRequest(t, f, "mango_create_editor", map[string]any{
		"resource_type": "node", "resource_id": node.NodeID,
		"document": json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`),
	})
	var editor struct {
		Document store.EditorJSONDocumentRef `json:"document_ref"`
	}
	if textbox.Code != 200 || json.Unmarshal(textbox.Body.Bytes(), &editor) != nil {
		t.Fatalf("create textbox: %d %s", textbox.Code, textbox.Body)
	}
	if _, err := f.repo.UpsertAuthUser(f.user.CognitoSubject, f.user.Email, "Current chat author"); err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"node_id": node.NodeID, "textbox_id": editor.Document.DocumentID, "body": "Review this text"}
	created := mangoToolRequest(t, f, "mango_create_node_chat", args)
	var chat struct {
		ChatID string `json:"chat_id"`
	}
	if created.Code != 200 || json.Unmarshal(created.Body.Bytes(), &chat) != nil || !isCanonicalUUID(chat.ChatID) {
		t.Fatalf("create chat: %d %s", created.Code, created.Body)
	}
	replay := mangoToolRequest(t, f, "mango_create_node_chat", args)
	if replay.Code != 200 || replay.Body.String() != created.Body.String() {
		t.Fatalf("replayed chat changed: %d %s", replay.Code, replay.Body)
	}
	notificationEvents, err := f.repo.ListDomainEventsAfter(store.DomainEventReplayQuery{
		CompanyID: f.route.CompanyID, StreamType: "notification", StreamID: "node:" + node.NodeID, Limit: 100,
	})
	if err != nil || len(notificationEvents) != 1 || notificationEvents[0].IdempotencyKey != "node-chat:"+node.NodeID+":"+chat.ChatID {
		t.Fatalf("replay duplicated chat notification: %+v %v", notificationEvents, err)
	}
	projections, err := f.repo.ListNodeProjections(f.route.CompanyID, node.NodeID)
	if err != nil || len(projections) != 1 {
		t.Fatalf("expected one canonical chat: %+v %v", projections, err)
	}
	var payload struct {
		BlockID    string `json:"block_id"`
		AuthorID   string `json:"author_id"`
		AuthorName string `json:"author_name"`
		Message    string `json:"message"`
	}
	if json.Unmarshal([]byte(projections[0].Information), &payload) != nil || payload.BlockID != editor.Document.DocumentID || payload.AuthorID != f.user.UserID || payload.AuthorName != "Current chat author" || payload.Message != "Review this text" {
		t.Fatalf("wrong author or textbox: %+v", projections[0])
	}
	args["author_id"] = store.NewUUIDv7String()
	if rejected := mangoToolRequest(t, f, "mango_create_node_chat", args); rejected.Code != 400 {
		t.Fatalf("model author override accepted: %d %s", rejected.Code, rejected.Body)
	}
	delete(args, "author_id")
	args["textbox_id"] = store.NewUUIDv7String()
	if rejected := mangoToolRequest(t, f, "mango_create_node_chat", args); rejected.Code != 404 {
		t.Fatalf("missing textbox accepted: %d %s", rejected.Code, rejected.Body)
	}
}
