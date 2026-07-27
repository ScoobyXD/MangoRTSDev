package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type inactiveNodeV2Repository struct {
	store.Repository
}

func (inactiveNodeV2Repository) GetNodeV2Availability(_, _ string) (store.NodeV2Availability, error) {
	return store.NodeV2Availability{Active: false, Reason: "workspace_not_converted"}, nil
}

func TestNodeV2APITextBoxDurabilityCommentsAndPagination(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "73737373-7373-4737-8737-737373737373"
	repo.EnsureCompany(companyID, "Node v2 API")
	actor, err := repo.UpsertAuthUser("node-v2-http-actor", "node-v2-http@example.com", "Node V2 HTTP Actor")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Node v2 API node")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(repo).Routes()
	request := func(method, path string, body any) *httptest.ResponseRecorder {
		var encoded []byte
		if body != nil {
			encoded, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(encoded))
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		req = requestWithActorForTest(req, actor, companyID)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}
	root := "/v1/nodes/" + node.NodeID + "/v2"
	companyQuery := "?company_id=" + companyID

	create := request(http.MethodPost, root+"/textboxes"+companyQuery, map[string]any{"idempotency_key": "api-textbox-1"})
	if create.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", create.Code, create.Body.String())
	}
	var created struct {
		Textbox domain.NodeV2TextBox `json:"textbox"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil || created.Textbox.TextboxID == "" {
		t.Fatalf("decode create: %v payload=%+v", err, created)
	}
	replay := request(http.MethodPost, root+"/textboxes"+companyQuery, map[string]any{"idempotency_key": "api-textbox-1"})
	var replayed struct {
		Textbox domain.NodeV2TextBox `json:"textbox"`
	}
	_ = json.Unmarshal(replay.Body.Bytes(), &replayed)
	if replay.Code != http.StatusCreated || replayed.Textbox.TextboxID != created.Textbox.TextboxID {
		t.Fatalf("idempotent create status=%d payload=%+v", replay.Code, replayed)
	}

	updateBytes := []byte{1, 4, 1, 4}
	digest := sha256.Sum256(updateBytes)
	updateBody := map[string]any{
		"collaboration_epoch": created.Textbox.CollaborationEpoch,
		"update_id":           "api-update-1", "update_sha256": hex.EncodeToString(digest[:]), "client_id": "api-tab",
		"payload_base64": base64.StdEncoding.EncodeToString(updateBytes),
	}
	update := request(http.MethodPost, root+"/textboxes/"+created.Textbox.TextboxID+"/updates"+companyQuery, updateBody)
	if update.Code != http.StatusCreated {
		t.Fatalf("append update status=%d body=%s", update.Code, update.Body.String())
	}
	updateRetry := request(http.MethodPost, root+"/textboxes/"+created.Textbox.TextboxID+"/updates"+companyQuery, updateBody)
	if updateRetry.Code != http.StatusCreated || updateRetry.Body.String() != update.Body.String() {
		t.Fatalf("idempotent update status=%d first=%s retry=%s", updateRetry.Code, update.Body.String(), updateRetry.Body.String())
	}

	syncResponse := request(http.MethodGet, root+"/textboxes/"+created.Textbox.TextboxID+"/sync"+companyQuery+"&include_checkpoint=1&limit=10", nil)
	if syncResponse.Code != http.StatusOK {
		t.Fatalf("sync status=%d body=%s", syncResponse.Code, syncResponse.Body.String())
	}
	var syncPage store.NodeV2SyncPage
	_ = json.Unmarshal(syncResponse.Body.Bytes(), &syncPage)
	if syncPage.Checkpoint == nil || len(syncPage.Updates) != 1 {
		t.Fatalf("sync page=%+v", syncPage)
	}

	document := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Durable API text"}]}]}`)
	checkpoint := request(http.MethodPost, root+"/textboxes/"+created.Textbox.TextboxID+"/checkpoints"+companyQuery, map[string]any{
		"checkpoint_id": "api-checkpoint-1", "collaboration_epoch": created.Textbox.CollaborationEpoch,
		"through_update_sequence": 1, "payload_base64": base64.StdEncoding.EncodeToString([]byte{0, 0}),
		"state_vector_base64": base64.StdEncoding.EncodeToString([]byte{0}), "document_json": document,
		"plain_text": "Durable API text", "reason": "test",
	})
	if checkpoint.Code != http.StatusForbidden || !strings.Contains(checkpoint.Body.String(), "node_v2_checkpoint_service_only") {
		t.Fatalf("untrusted checkpoint status=%d body=%s", checkpoint.Code, checkpoint.Body.String())
	}

	comment := request(http.MethodPost, root+"/textboxes/"+created.Textbox.TextboxID+"/comments"+companyQuery, map[string]any{
		"idempotency_key": "api-comment-1", "body_text": "Anchored comment", "selected_quote": "Durable",
		"anchor_before_text": "", "anchor_after_text": " API text", "anchor_status": "anchored",
		"anchor_start_base64": base64.StdEncoding.EncodeToString([]byte{1, 1}), "anchor_end_base64": base64.StdEncoding.EncodeToString([]byte{1, 2}),
		"mentions": []map[string]string{{"principal_type": "user", "principal_id": actor.UserID}},
	})
	if comment.Code != http.StatusCreated {
		t.Fatalf("comment status=%d body=%s", comment.Code, comment.Body.String())
	}
	var thread domain.NodeV2CommentThread
	_ = json.Unmarshal(comment.Body.Bytes(), &thread)
	if thread.AnchorFormat != "yjs_relative_v1" || len(thread.Comments) != 1 || len(thread.Comments[0].Mentions) != 1 {
		t.Fatalf("comment thread=%+v", thread)
	}
	reply := request(http.MethodPost, root+"/textboxes/"+created.Textbox.TextboxID+"/comments/"+thread.ThreadID+"/replies"+companyQuery, map[string]any{"idempotency_key": "api-reply-1", "body_text": "Reply", "parent_comment_id": thread.Comments[0].CommentID})
	if reply.Code != http.StatusCreated {
		t.Fatalf("reply status=%d body=%s", reply.Code, reply.Body.String())
	}

	for index := 2; index <= 36; index++ {
		response := request(http.MethodPost, root+"/textboxes"+companyQuery, map[string]any{"idempotency_key": fmt.Sprintf("api-textbox-%d", index)})
		if response.Code != http.StatusCreated {
			t.Fatalf("create textbox %d status=%d body=%s", index, response.Code, response.Body.String())
		}
	}
	timeline := request(http.MethodGet, root+"/timeline"+companyQuery+"&limit=10", nil)
	var firstTimeline store.NodeV2TimelinePage
	_ = json.Unmarshal(timeline.Body.Bytes(), &firstTimeline)
	if timeline.Code != http.StatusOK || len(firstTimeline.Items) != 10 || firstTimeline.NextCursor == nil {
		t.Fatalf("timeline status=%d page=%+v", timeline.Code, firstTimeline)
	}
	cursorJSON, _ := json.Marshal(firstTimeline.NextCursor)
	cursor := base64.RawURLEncoding.EncodeToString(cursorJSON)
	nextTimeline := request(http.MethodGet, root+"/timeline"+companyQuery+"&limit=10&cursor="+cursor, nil)
	var secondTimeline store.NodeV2TimelinePage
	_ = json.Unmarshal(nextTimeline.Body.Bytes(), &secondTimeline)
	if nextTimeline.Code != http.StatusOK || len(secondTimeline.Items) != 10 || secondTimeline.Items[0].TimelineItemID == firstTimeline.Items[len(firstTimeline.Items)-1].TimelineItemID {
		t.Fatalf("second timeline status=%d page=%+v", nextTimeline.Code, secondTimeline)
	}

	archive := request(http.MethodPatch, root+"/textboxes/"+created.Textbox.TextboxID+companyQuery, map[string]any{"archived": true, "idempotency_key": "http-archive"})
	if archive.Code != http.StatusOK {
		t.Fatalf("archive status=%d body=%s", archive.Code, archive.Body.String())
	}
	restore := request(http.MethodPatch, root+"/textboxes/"+created.Textbox.TextboxID+companyQuery, map[string]any{"archived": false, "idempotency_key": "http-restore"})
	if restore.Code != http.StatusOK {
		t.Fatalf("restore status=%d body=%s", restore.Code, restore.Body.String())
	}
	workspace := request(http.MethodGet, root+"/workspace"+companyQuery+"&limit=10", nil)
	if workspace.Code != http.StatusOK || bytes.Contains(workspace.Body.Bytes(), []byte("document_json")) || bytes.Contains(workspace.Body.Bytes(), []byte("plain_text")) || !bytes.Contains(workspace.Body.Bytes(), []byte("textbox_next_cursor")) {
		t.Fatalf("workspace status=%d body=%s", workspace.Code, workspace.Body.String())
	}
	hydrated := request(http.MethodGet, root+"/textboxes/"+created.Textbox.TextboxID+companyQuery, nil)
	if hydrated.Code != http.StatusOK || !bytes.Contains(hydrated.Body.Bytes(), []byte("document_json")) {
		t.Fatalf("hydrated textbox status=%d body=%s", hydrated.Code, hydrated.Body.String())
	}
}

func TestNodeV2APIRequiresAuthenticatedCompanyMembership(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "74747474-7474-4747-8747-747474747474"
	repo.EnsureCompany(companyID, "Node v2 auth")
	node, _ := repo.CreateNode(companyID, "Protected Node")
	req := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+node.NodeID+"/v2/workspace?company_id="+companyID, nil)
	recorder := httptest.NewRecorder()
	NewServer(repo).Routes().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestNodeV2APIRejectsReadsAndWritesUntilWorkspaceIsActive(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "75757575-7575-4757-8757-757575757575"
	repo.EnsureCompany(companyID, "Node v2 inactive gate")
	actor, err := repo.UpsertAuthUser("node-v2-inactive", "inactive@example.com", "Inactive Gate Actor")
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "Inactive Node")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(inactiveNodeV2Repository{Repository: repo}).Routes()
	request := func(method, suffix string, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/v1/nodes/"+node.NodeID+"/v2"+suffix+"?company_id="+companyID, strings.NewReader(body))
		req = requestWithActorForTest(req, actor, companyID)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}

	availability := request(http.MethodGet, "/availability", "")
	if availability.Code != http.StatusOK || !strings.Contains(availability.Body.String(), "workspace_not_converted") {
		t.Fatalf("availability status=%d body=%s", availability.Code, availability.Body.String())
	}
	workspace := request(http.MethodGet, "/workspace", "")
	if workspace.Code != http.StatusConflict || !strings.Contains(workspace.Body.String(), "node_v2_workspace_inactive") {
		t.Fatalf("workspace status=%d body=%s", workspace.Code, workspace.Body.String())
	}
	create := request(http.MethodPost, "/textboxes", `{"idempotency_key":"must-not-write"}`)
	if create.Code != http.StatusConflict || !strings.Contains(create.Body.String(), "node_v2_workspace_inactive") {
		t.Fatalf("create status=%d body=%s", create.Code, create.Body.String())
	}
	page, err := repo.ListNodeV2TextBoxes(store.NodeV2TextBoxPageQuery{CompanyID: companyID, NodeID: node.NodeID})
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("inactive gate wrote textboxes=%d err=%v", len(page.Items), err)
	}
}
