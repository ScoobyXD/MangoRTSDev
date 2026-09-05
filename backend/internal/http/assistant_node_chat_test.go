package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestAssistantNodeChatPiSkillAndMentionArraysRoundTrip(t *testing.T) {
	var calls atomic.Int32
	var nodeID, textboxID string
	var regular, urgent domain.User
	server, repo := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		switch calls.Add(1) {
		case 1:
			assistantProviderComplete(w, assistantProviderCall("skill", "read", `{"path":"skills/mango-node-chat/SKILL.md"}`))
		case 2:
			if !strings.Contains(assistantProcessInputText(body["input"]), "# Chat on a Node") {
				t.Error("native skill read did not enter the model continuation")
			}
			assistantProviderComplete(w, assistantProviderCall("directory", "list_chat_users", `{"query":null}`))
		case 3:
			if input := assistantProcessInputText(body["input"]); !strings.Contains(input, regular.UserID) || !strings.Contains(input, urgent.UserID) {
				t.Error("canonical mention directory did not enter the model continuation")
			}
			arguments, _ := json.Marshal(map[string]any{"node_id": nodeID, "textbox_id": textboxID, "message": "The review is ready.", "mentioned_user_ids": []string{regular.UserID}, "urgent_user_ids": []string{urgent.UserID}})
			assistantProviderComplete(w, assistantProviderCall("send", "send_node_chat", string(arguments)))
		case 4:
			if !strings.Contains(assistantProcessInputText(body["input"]), "The review is ready.") {
				t.Error("saved chat result did not enter the model continuation")
			}
			assistantProviderComplete(w, map[string]any{"type": "message", "id": "chat_sent", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "Posted the chat with both mentions.", "annotations": []any{}}}})
		default:
			t.Error("unexpected extra model call")
			assistantProviderComplete(w)
		}
	})
	actor, _ := repo.GetAuthUser("assistant-user")
	regular = mustRealtimeAuthUser(t, repo, assistantTestCompany, "pi-chat-regular", domain.RoleCompanyUser)
	urgent = mustRealtimeAuthUser(t, repo, assistantTestCompany, "pi-chat-urgent", domain.RoleCompanyUser)
	node, err := repo.CreateNode(assistantTestCompany, "Pi chat target")
	if err != nil {
		t.Fatal(err)
	}
	nodeID, textboxID = node.NodeID, store.NewUUIDv7String()
	r := assistantToolRequest(actor, assistantTestCompany, domain.RoleCompanyAdmin)
	if _, err := server.dispatchAssistantTool(r, "save_textbox", assistantTestArguments(t, "save_textbox", map[string]any{"resource_type": "node", "resource_id": nodeID, "textbox_id": textboxID, "base_revision": 0, "plain_text": "Review results"})); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, assistantChatRequest(store.NewUUIDv7String(), "Post the review-ready chat on the selected Node with the requested normal and urgent mentions."))
	if response.Code != http.StatusOK || calls.Load() != 4 || !strings.Contains(response.Body.String(), `"type":"done"`) || strings.Contains(response.Body.String(), `"type":"error"`) {
		t.Fatalf("Pi chat failed: calls=%d status=%d body=%s", calls.Load(), response.Code, response.Body.String())
	}
	projections, err := repo.ListNodeProjections(assistantTestCompany, nodeID)
	if err != nil {
		t.Fatal(err)
	}
	chats := 0
	for _, projection := range projections {
		if projection.Type == "Text block chat" {
			chats++
			if !strings.Contains(projection.Information, "@"+regular.Email) || !strings.Contains(projection.Information, "!"+urgent.Email) || !strings.Contains(projection.Information, textboxID) {
				t.Fatalf("wrong persisted Pi chat: %+v", projection)
			}
		}
	}
	if chats != 1 {
		t.Fatalf("Pi saved %d chats", chats)
	}
}

func TestAssistantNodeChatUsesCanonicalChatAndMentionEvents(t *testing.T) {
	server, repo := assistantTestServer(t, nil)
	actor, _ := repo.GetAuthUser("assistant-user")
	regular := mustRealtimeAuthUser(t, repo, assistantTestCompany, "chat-regular", domain.RoleCompanyUser)
	urgent := mustRealtimeAuthUser(t, repo, assistantTestCompany, "chat-urgent", domain.RoleCompanyUser)
	r := assistantToolRequest(actor, assistantTestCompany, domain.RoleCompanyAdmin)
	node, err := repo.CreateNode(assistantTestCompany, "Chat target")
	if err != nil {
		t.Fatal(err)
	}
	result, err := server.dispatchAssistantTool(r, "save_textbox", assistantTestArguments(t, "save_textbox", map[string]any{"resource_type": "node", "resource_id": node.NodeID, "base_revision": 0, "plain_text": "Existing work"}))
	if err != nil {
		t.Fatal(err)
	}
	var saved struct {
		TextboxID string `json:"textbox_id"`
	}
	if err := json.Unmarshal([]byte(result), &saved); err != nil {
		t.Fatal(err)
	}
	lookup, err := server.dispatchAssistantTool(r, "list_chat_users", assistantTestArguments(t, "list_chat_users", map[string]any{"query": "chat-urgent"}))
	if err != nil || !strings.Contains(lookup, urgent.UserID) || strings.Contains(lookup, regular.UserID) {
		t.Fatalf("directory lookup: %s, %v", lookup, err)
	}
	result, err = server.dispatchAssistantTool(r, "send_node_chat", assistantTestArguments(t, "send_node_chat", map[string]any{
		"node_id": node.NodeID, "textbox_id": saved.TextboxID, "message": "The work is ready.", "mentioned_user_ids": []string{regular.UserID}, "urgent_user_ids": []string{urgent.UserID},
	}))
	if err != nil {
		t.Fatal(err)
	}
	var chat domain.NodeInformation
	if err := json.Unmarshal([]byte(result), &chat); err != nil {
		t.Fatal(err)
	}
	var payload struct {
		BlockID          string   `json:"block_id"`
		AuthorID         string   `json:"author_id"`
		Message          string   `json:"message"`
		MentionedUserIDs []string `json:"mentioned_user_ids"`
	}
	if err := json.Unmarshal([]byte(chat.Information), &payload); err != nil {
		t.Fatal(err)
	}
	if chat.NodeID != node.NodeID || chat.Type != "Text block chat" || payload.BlockID != saved.TextboxID || payload.AuthorID != actor.UserID || payload.Message != "@"+regular.Email+" !"+urgent.Email+" The work is ready." || len(payload.MentionedUserIDs) != 2 {
		t.Fatalf("wrong saved chat: %+v, %+v", chat, payload)
	}
	projections, err := repo.ListNodeProjections(assistantTestCompany, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	chatCount := 0
	for _, projection := range projections {
		if projection.Type == "Text block chat" {
			chatCount++
		}
	}
	if chatCount != 1 {
		t.Fatalf("saved %d chats", chatCount)
	}
	events, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: assistantTestCompany, StreamType: "notification", StreamID: "node:" + node.NodeID, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	mentions := map[string]string{}
	chatEvents := 0
	for _, event := range events {
		if event.Type == store.NodeMentionCreatedEventType {
			var payload struct {
				Kind  string   `json:"mention_kind"`
				Users []string `json:"mentioned_user_ids"`
			}
			raw, _ := json.Marshal(event.Payload)
			if err := json.Unmarshal(raw, &payload); err != nil {
				t.Fatal(err)
			}
			if len(payload.Users) != 1 {
				t.Fatalf("wrong mention event: %+v", event)
			}
			mentions[payload.Users[0]] = payload.Kind
		}
		if event.Type == domain.NotificationEventNodeCommentCreated {
			chatEvents++
		}
	}
	if mentions[regular.UserID] != "regular" || mentions[urgent.UserID] != "urgent" || len(mentions) != 2 || chatEvents != 1 {
		t.Fatalf("canonical events missing: mentions=%v chat=%d", mentions, chatEvents)
	}
}

func TestAssistantNodeChatRejectsInvalidTargetsAndUnselectedMentions(t *testing.T) {
	server, repo := assistantTestServer(t, nil)
	actor, _ := repo.GetAuthUser("assistant-user")
	other := mustRealtimeAuthUser(t, repo, assistantTestCompany, "unselected-chat-user", domain.RoleCompanyUser)
	r := assistantToolRequest(actor, assistantTestCompany, domain.RoleCompanyAdmin)
	node, _ := repo.CreateNode(assistantTestCompany, "Chat target")
	textboxID := store.NewUUIDv7String()
	_, err := server.dispatchAssistantTool(r, "save_textbox", assistantTestArguments(t, "save_textbox", map[string]any{"resource_type": "node", "resource_id": node.NodeID, "textbox_id": textboxID, "base_revision": 0, "plain_text": "Work"}))
	if err != nil {
		t.Fatal(err)
	}
	otherCompany := store.NewUUIDv7String()
	repo.EnsureCompany(otherCompany, "Other")
	foreign := mustRealtimeAuthUser(t, repo, otherCompany, "foreign-chat-user", domain.RoleCompanyUser)
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: assistantTestCompany, EntityType: store.EntityTypeNode, EntityID: node.NodeID, DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, ActorUserID: actor.UserID}); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		name    string
		changes map[string]any
		request *http.Request
	}{
		{"missing textbox", map[string]any{"textbox_id": store.NewUUIDv7String()}, r},
		{"foreign user", map[string]any{"mentioned_user_ids": []string{foreign.UserID}}, r},
		{"invented user", map[string]any{"mentioned_user_ids": []string{store.NewUUIDv7String()}}, r},
		{"typed mention", map[string]any{"message": "@" + other.Email + " please review"}, r},
		{"repeated mention", map[string]any{"message": "@" + other.Email + " please review", "mentioned_user_ids": []string{other.UserID}}, r},
		{"duplicate IDs", map[string]any{"mentioned_user_ids": []string{other.UserID, other.UserID}}, r},
		{"conflicting tone", map[string]any{"mentioned_user_ids": []string{other.UserID}, "urgent_user_ids": []string{other.UserID}}, r},
		{"unauthenticated", nil, httptest.NewRequest(http.MethodPost, "/v1/assistant/chat", nil)},
		{"no Node access", nil, assistantToolRequest(other, assistantTestCompany, domain.RoleCompanyUser)},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			args := map[string]any{"node_id": node.NodeID, "textbox_id": textboxID, "message": "Ready", "mentioned_user_ids": []string{}, "urgent_user_ids": []string{}}
			for key, value := range scenario.changes {
				args[key] = value
			}
			if _, err := server.dispatchAssistantTool(scenario.request, "send_node_chat", assistantTestArguments(t, "send_node_chat", args)); err == nil {
				t.Fatal("invalid chat was accepted")
			}
		})
	}
	projections, _ := repo.ListNodeProjections(assistantTestCompany, node.NodeID)
	for _, projection := range projections {
		if projection.Type == "Text block chat" {
			t.Fatalf("rejected action saved a chat: %+v", projection)
		}
	}
}

func TestAssistantNodeChatFindsAndMentionsGlobalAdministrator(t *testing.T) {
	server, repo := assistantTestServer(t, nil)
	actor, _ := repo.GetAuthUser("assistant-user")
	r := assistantToolRequest(actor, assistantTestCompany, domain.RoleCompanyAdmin)
	adminCompany := store.NewUUIDv7String()
	repo.EnsureCompany(adminCompany, "Administrator home company")
	admin := mustRealtimeAuthUser(t, repo, adminCompany, "global-chat-admin", domain.RoleDevAdmin)
	if _, err := repo.GetCompanyUser(assistantTestCompany, admin.UserID); err == nil {
		t.Fatal("test administrator unexpectedly has a direct membership")
	}
	lookup, err := server.dispatchAssistantTool(r, "list_chat_users", `{"query":"global-chat-admin"}`)
	if err != nil || !strings.Contains(lookup, admin.UserID) {
		t.Fatalf("global administrator absent from mention lookup: %s, %v", lookup, err)
	}
	node, err := repo.CreateNode(assistantTestCompany, "Global administrator chat")
	if err != nil {
		t.Fatal(err)
	}
	textboxID := store.NewUUIDv7String()
	if _, err := server.dispatchAssistantTool(r, "save_textbox", assistantTestArguments(t, "save_textbox", map[string]any{"resource_type": "node", "resource_id": node.NodeID, "textbox_id": textboxID, "base_revision": 0, "plain_text": "Completed work"})); err != nil {
		t.Fatal(err)
	}
	result, err := server.dispatchAssistantTool(r, "send_node_chat", assistantTestArguments(t, "send_node_chat", map[string]any{"node_id": node.NodeID, "textbox_id": textboxID, "message": "Done", "mentioned_user_ids": []string{admin.UserID}, "urgent_user_ids": []string{}}))
	if err != nil || !strings.Contains(result, admin.UserID) || !strings.Contains(result, "@"+admin.Email) {
		t.Fatalf("global administrator mention failed: %s, %v", result, err)
	}
	events, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: assistantTestCompany, StreamType: "notification", StreamID: "node:" + node.NodeID, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	mentions := 0
	for _, event := range events {
		if event.Type == store.NodeMentionCreatedEventType {
			encoded, _ := json.Marshal(event.Payload)
			if !strings.Contains(string(encoded), admin.UserID) {
				t.Fatalf("wrong administrator mention: %+v", event)
			}
			mentions++
		}
	}
	if mentions != 1 {
		t.Fatalf("saved %d administrator mention events", mentions)
	}
}

func TestAssistantChatDirectoryFiltersBeforeResponseLimit(t *testing.T) {
	server, repo := assistantTestServer(t, nil)
	actor, _ := repo.GetAuthUser("assistant-user")
	r := assistantToolRequest(actor, assistantTestCompany, domain.RoleCompanyAdmin)
	var last domain.User
	for i := 0; i < 300; i++ {
		last = mustRealtimeAuthUser(t, repo, assistantTestCompany, fmt.Sprintf("directory-user-%03d", i), domain.RoleCompanyUser)
	}
	directory, _ := repo.ListMentionableCompanyUsers(assistantTestCompany)
	encoded, _ := json.Marshal(directory)
	if len(encoded) <= assistantToolResultLimit {
		t.Fatal("fixture did not exceed the tool result limit")
	}
	result, err := server.dispatchAssistantTool(r, "list_chat_users", `{"query":"directory-user-299"}`)
	if err != nil || !strings.Contains(result, last.UserID) {
		t.Fatalf("query was bounded before filtering: %s, %v", result, err)
	}
	result, err = server.dispatchAssistantTool(r, "list_chat_users", `{"query":null}`)
	if err != nil {
		t.Fatal(err)
	}
	var page struct {
		Users   []map[string]string `json:"users"`
		HasMore bool                `json:"has_more"`
	}
	if err := json.Unmarshal([]byte(result), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Users) != 50 || !page.HasMore || len(result) > assistantToolResultLimit {
		t.Fatalf("unbounded directory result: count=%d has_more=%t bytes=%d", len(page.Users), page.HasMore, len(result))
	}
}

type assistantNodeChatRaceRepo struct {
	store.Repository
	processID, stepID, actorID string
	raced                      bool
}

func (r *assistantNodeChatRaceRepo) AddNodeInformationWithActor(input store.NodeInformationInput) (domain.NodeInformation, error) {
	if input.Type == "Text block chat" {
		r.raced = true
		if _, err := r.Repository.MoveLogicGateNodeAssignment(store.LogicGateNodeAssignmentMoveInput{CompanyID: input.CompanyID, LogicGateID: r.processID, NodeID: input.NodeID, ProcessStepID: &r.stepID, ProcessStepIDSet: true, ActorUserID: r.actorID}); err != nil {
			return domain.NodeInformation{}, err
		}
	}
	return r.Repository.AddNodeInformationWithActor(input)
}

func TestAssistantProcessNodeChatKeepsBoundNodeAndRejectsConcurrentMove(t *testing.T) {
	for _, race := range []bool{false, true} {
		t.Run(fmt.Sprintf("race=%t", race), func(t *testing.T) {
			server, repo := assistantTestServer(t, nil)
			fixture := seedAssistantProcess(t, repo, "Notify on completion")
			r := assistantToolRequest(fixture.user, assistantTestCompany, domain.RoleCompanyAdmin)
			emit := func(assistantEvent) error { return nil }
			bound, err := server.bindAssistantProcess(r, fixture.process.LogicGateID, emit)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := server.dispatchAssistantProcessTool(r, bound, "list_chat_users", `{"query":null}`, emit); err != nil {
				t.Fatal(err)
			}
			if _, err := server.dispatchAssistantProcessTool(r, bound, "create_process_node", fmt.Sprintf(`{"name":"Tracked work","process_step_id":%q}`, fixture.first.ProcessStepID), emit); err != nil {
				t.Fatal(err)
			}
			result, err := server.dispatchAssistantProcessTool(r, bound, "write_process_node", `{"plain_text":"Completed the work."}`, emit)
			if err != nil {
				t.Fatal(err)
			}
			var document store.EditorJSONSnapshot
			if err := json.Unmarshal([]byte(result), &document); err != nil {
				t.Fatal(err)
			}
			args := map[string]any{"textbox_id": document.Document.DocumentID, "message": "Done", "mentioned_user_ids": []string{}, "urgent_user_ids": []string{}}
			args["node_id"] = store.NewUUIDv7String()
			raw, _ := json.Marshal(args)
			if _, err := server.dispatchAssistantProcessTool(r, bound, "send_process_node_chat", string(raw), emit); err == nil {
				t.Fatal("accepted model-selected Node override")
			}
			delete(args, "node_id")
			tracing := &assistantNodeChatRaceRepo{Repository: repo, processID: fixture.process.LogicGateID, stepID: fixture.last.ProcessStepID, actorID: fixture.user.UserID}
			if race {
				server.repo = tracing
			}
			raw, _ = json.Marshal(args)
			_, err = server.dispatchAssistantProcessTool(r, bound, "send_process_node_chat", string(raw), emit)
			if race && (err == nil || !tracing.raced) {
				t.Fatalf("concurrent move did not reject send: raced=%t, err=%v", tracing.raced, err)
			}
			if !race && err != nil {
				t.Fatal(err)
			}
			projections, _ := repo.ListNodeProjections(assistantTestCompany, bound.nodeID)
			chats := 0
			for _, projection := range projections {
				if projection.Type == "Text block chat" {
					chats++
				}
			}
			if (race && chats != 0) || (!race && chats != 1) {
				t.Fatalf("saved %d chats, race=%t", chats, race)
			}
		})
	}
}
