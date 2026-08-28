package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func createHTTPHuddleNodeWorkspaceFixture(t *testing.T) (*store.MemoryRepo, domain.User, domain.Company, domain.HuddleNode) {
	t.Helper()
	repo := store.NewMemoryRepo()
	const subject = "huddle-node-workspace-http-owner"
	user, err := repo.UpsertAuthUser(subject, "workspace-http@example.test", "Workspace HTTP Owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("HTTP Huddle Node Workspace")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Daily Huddle")
	if err != nil {
		t.Fatal(err)
	}
	huddle, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(store.HuddleCreateInput{
		CompanyID: company.CompanyID,
		OwnerID:   huddle.HuddleLogicGateID,
		Name:      "Monday",
		ActorID:   user.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return repo, user, company, node
}

func TestHuddleNodeWorkspaceHTTPRoutes(t *testing.T) {
	repo, user, company, node := createHTTPHuddleNodeWorkspaceFixture(t)
	handler := NewServer(repo).Routes()
	serve := func(method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var requestBody *bytes.Reader
		if body == nil {
			requestBody = bytes.NewReader(nil)
		} else {
			encoded, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			requestBody = bytes.NewReader(encoded)
		}
		request := requestWithActorForTest(httptest.NewRequest(method, path, requestBody), user, company.CompanyID)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	workspacePath := "/v1/huddle-nodes/" + node.HuddleNodeID + "/workspace?company_id=" + company.CompanyID
	response := serve(http.MethodGet, workspacePath, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("empty workspace status=%d body=%s", response.Code, response.Body.String())
	}
	var workspace store.HuddleNodeWorkspace
	if err := json.NewDecoder(response.Body).Decode(&workspace); err != nil {
		t.Fatal(err)
	}
	if workspace.Textboxes == nil || workspace.Chats == nil || len(workspace.Textboxes) != 0 || len(workspace.Chats) != 0 {
		t.Fatalf("empty workspace=%+v", workspace)
	}

	const textboxID = "30000000-0000-4000-8000-000000000001"
	response = serve(http.MethodPost, "/v1/huddle-nodes/"+node.HuddleNodeID+"/textboxes", map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxID, "title": "Risks",
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("create textbox status=%d body=%s", response.Code, response.Body.String())
	}
	var createdTextbox struct {
		Textbox store.HuddleNodeTextbox `json:"textbox"`
	}
	if err := json.NewDecoder(response.Body).Decode(&createdTextbox); err != nil {
		t.Fatal(err)
	}
	if createdTextbox.Textbox.TextboxID != textboxID || createdTextbox.Textbox.Title != "Risks" {
		t.Fatalf("created textbox=%+v", createdTextbox.Textbox)
	}

	response = serve(http.MethodPost, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats", map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxID,
		"message": "Please investigate", "entity_links": []any{},
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("create chat status=%d body=%s", response.Code, response.Body.String())
	}
	var createdChat struct {
		Chat store.HuddleNodeTextboxChat `json:"chat"`
	}
	if err := json.NewDecoder(response.Body).Decode(&createdChat); err != nil {
		t.Fatal(err)
	}
	chatID := createdChat.Chat.ChatID
	if chatID == "" || createdChat.Chat.Revision != 1 || createdChat.Chat.AuthorUserID != user.UserID || createdChat.Chat.AuthorDisplayName != user.DisplayName {
		t.Fatalf("created chat=%+v", createdChat.Chat)
	}

	response = serve(http.MethodPost, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats", map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxID, "chat_id": chatID,
		"message": "Attempted overwrite", "entity_links": []any{},
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("caller-selected chat ID status=%d body=%s", response.Code, response.Body.String())
	}
	response = serve(http.MethodPost, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats", map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxID,
		"message": "Create must not use a revision", "entity_links": []any{}, "base_revision": 0,
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("create with revision status=%d body=%s", response.Code, response.Body.String())
	}

	response = serve(http.MethodPut, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats/50000000-0000-4000-8000-000000000001", map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxID,
		"message": "Must already exist", "entity_links": []any{}, "base_revision": 0,
	})
	if response.Code != http.StatusNotFound {
		t.Fatalf("update missing chat status=%d body=%s", response.Code, response.Body.String())
	}
	response = serve(http.MethodPut, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats/"+chatID, map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxID,
		"message": "Missing revision", "entity_links": []any{},
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("update missing revision status=%d body=%s", response.Code, response.Body.String())
	}
	response = serve(http.MethodPut, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats/"+chatID, map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxID,
		"message": "Negative revision", "entity_links": []any{}, "base_revision": -1,
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("update negative revision status=%d body=%s", response.Code, response.Body.String())
	}

	response = serve(http.MethodPut, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats/"+chatID, map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxID,
		"message": "Operations is investigating", "entity_links": []any{}, "base_revision": 1,
	})
	if response.Code != http.StatusOK {
		t.Fatalf("update chat status=%d body=%s", response.Code, response.Body.String())
	}
	var updatedChat struct {
		Chat store.HuddleNodeTextboxChat `json:"chat"`
	}
	if err := json.NewDecoder(response.Body).Decode(&updatedChat); err != nil {
		t.Fatal(err)
	}
	if updatedChat.Chat.Revision != 2 || updatedChat.Chat.Message != "Operations is investigating" || updatedChat.Chat.EditedTimestamp == nil {
		t.Fatalf("updated chat=%+v", updatedChat.Chat)
	}

	for _, revisionQuery := range []string{"", "&revision=-1", "&revision=not-a-number"} {
		response = serve(http.MethodDelete, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats/"+chatID+"?company_id="+company.CompanyID+revisionQuery, nil)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid delete revision %q status=%d body=%s", revisionQuery, response.Code, response.Body.String())
		}
	}

	response = serve(http.MethodDelete, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats/"+chatID+"?company_id="+company.CompanyID+"&revision=1", nil)
	if response.Code != http.StatusConflict {
		t.Fatalf("stale delete status=%d body=%s", response.Code, response.Body.String())
	}
	response = serve(http.MethodDelete, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats/"+chatID+"?company_id="+company.CompanyID+"&revision=2", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("delete chat status=%d body=%s", response.Code, response.Body.String())
	}

	response = serve(http.MethodGet, workspacePath, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("final workspace status=%d body=%s", response.Code, response.Body.String())
	}
	workspace = store.HuddleNodeWorkspace{}
	if err := json.NewDecoder(response.Body).Decode(&workspace); err != nil {
		t.Fatal(err)
	}
	if len(workspace.Textboxes) != 1 || len(workspace.Chats) != 0 {
		t.Fatalf("final workspace=%+v", workspace)
	}

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodPost, path: workspacePath, want: http.StatusMethodNotAllowed},
		{method: http.MethodGet, path: "/v1/huddle-nodes/" + node.HuddleNodeID + "/textboxes", want: http.StatusMethodNotAllowed},
		{method: http.MethodGet, path: "/v1/huddle-nodes/" + node.HuddleNodeID + "/chats", want: http.StatusMethodNotAllowed},
		{method: http.MethodGet, path: "/v1/huddle-nodes/" + node.HuddleNodeID + "/chats/" + chatID + "/extra", want: http.StatusNotFound},
	} {
		response = serve(test.method, test.path, nil)
		if response.Code != test.want {
			t.Fatalf("%s %s status=%d body=%s, want %d", test.method, test.path, response.Code, response.Body.String(), test.want)
		}
	}
}

func TestHuddleNodeChatHTTPOnlyOriginalAuthorCanUpdateOrDelete(t *testing.T) {
	repo, author, company, node := createHTTPHuddleNodeWorkspaceFixture(t)
	other, err := repo.UpsertAuthUser("huddle-node-workspace-http-other-author", "workspace-other@example.test", "Other Editor")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(repo).Routes()
	serveAs := func(user domain.User, method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var requestBody *bytes.Reader
		if body == nil {
			requestBody = bytes.NewReader(nil)
		} else {
			encoded, encodeErr := json.Marshal(body)
			if encodeErr != nil {
				t.Fatal(encodeErr)
			}
			requestBody = bytes.NewReader(encoded)
		}
		request := requestWithActorForTest(httptest.NewRequest(method, path, requestBody), user, company.CompanyID)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	response := serveAs(author, http.MethodPost, "/v1/huddle-nodes/"+node.HuddleNodeID+"/textboxes", map[string]any{
		"company_id": company.CompanyID, "title": "Ownership",
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("create textbox status=%d body=%s", response.Code, response.Body.String())
	}
	var textboxPayload struct {
		Textbox store.HuddleNodeTextbox `json:"textbox"`
	}
	if err := json.NewDecoder(response.Body).Decode(&textboxPayload); err != nil {
		t.Fatal(err)
	}
	response = serveAs(author, http.MethodPost, "/v1/huddle-nodes/"+node.HuddleNodeID+"/chats", map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxPayload.Textbox.TextboxID,
		"message": "Original message", "entity_links": []any{},
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("create chat status=%d body=%s", response.Code, response.Body.String())
	}
	var chatPayload struct {
		Chat store.HuddleNodeTextboxChat `json:"chat"`
	}
	if err := json.NewDecoder(response.Body).Decode(&chatPayload); err != nil {
		t.Fatal(err)
	}
	chatPath := "/v1/huddle-nodes/" + node.HuddleNodeID + "/chats/" + chatPayload.Chat.ChatID
	response = serveAs(other, http.MethodPut, chatPath, map[string]any{
		"company_id": company.CompanyID, "textbox_id": textboxPayload.Textbox.TextboxID,
		"message": "Unauthorized change", "entity_links": []any{}, "base_revision": 1,
	})
	if response.Code != http.StatusNotFound {
		t.Fatalf("non-author update status=%d body=%s", response.Code, response.Body.String())
	}
	response = serveAs(other, http.MethodDelete, chatPath+"?company_id="+company.CompanyID+"&revision=1", nil)
	if response.Code != http.StatusNotFound {
		t.Fatalf("non-author delete status=%d body=%s", response.Code, response.Body.String())
	}

	workspace, err := repo.GetHuddleNodeWorkspace(company.CompanyID, node.HuddleNodeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.Chats) != 1 || workspace.Chats[0].Message != "Original message" || workspace.Chats[0].Revision != 1 {
		t.Fatalf("non-author mutation changed chat=%+v", workspace.Chats)
	}
}

type huddleNodeWorkspaceDeniedAccessRepo struct {
	store.Repository
}

func (huddleNodeWorkspaceDeniedAccessRepo) UserHasEffectiveAccess(_, _, _, _, _ string) (bool, error) {
	return false, nil
}

func TestHuddleNodeWorkspaceHTTPRequiresExactNodeEditAccess(t *testing.T) {
	repo, owner, company, node := createHTTPHuddleNodeWorkspaceFixture(t)
	member, err := repo.UpsertAuthUser("huddle-node-workspace-http-member", "workspace-member@example.test", "Workspace Member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("huddle-node-workspace-http-member", company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	const textboxID = "30000000-0000-4000-8000-000000000010"
	if _, err := repo.CreateHuddleNodeTextbox(store.HuddleNodeTextboxCreateInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: textboxID, Title: "Private",
	}); err != nil {
		t.Fatal(err)
	}
	const chatID = "40000000-0000-4000-8000-000000000010"
	chat, err := repo.UpsertHuddleNodeTextboxChat(store.HuddleNodeTextboxChatInput{
		CompanyID: company.CompanyID, HuddleNodeID: node.HuddleNodeID, TextboxID: textboxID,
		ChatID: chatID, AuthorUserID: owner.UserID, AuthorDisplayName: owner.DisplayName, ActorUserID: owner.UserID, Message: "Private chat",
	})
	if err != nil {
		t.Fatal(err)
	}

	handler := NewServer(huddleNodeWorkspaceDeniedAccessRepo{Repository: repo}).Routes()
	actor := ActorContext{
		User:        member,
		Memberships: []domain.CompanyMembership{{CompanyID: company.CompanyID, UserID: member.UserID, Role: domain.RoleCompanyUser}},
		CompanyID:   company.CompanyID,
		CompanyRole: domain.RoleCompanyUser,
	}
	serve := func(method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var requestBody *bytes.Reader
		if body == nil {
			requestBody = bytes.NewReader(nil)
		} else {
			encoded, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			requestBody = bytes.NewReader(encoded)
		}
		request := httptest.NewRequest(method, path, requestBody)
		request = request.WithContext(context.WithValue(request.Context(), actorContextKey{}, actor))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	paths := []struct {
		method string
		path   string
		body   any
	}{
		{method: http.MethodGet, path: "/v1/huddle-nodes/" + node.HuddleNodeID + "/workspace?company_id=" + company.CompanyID},
		{method: http.MethodPost, path: "/v1/huddle-nodes/" + node.HuddleNodeID + "/textboxes", body: map[string]any{
			"company_id": company.CompanyID, "title": "Must not be created",
		}},
		{method: http.MethodPost, path: "/v1/huddle-nodes/" + node.HuddleNodeID + "/chats", body: map[string]any{
			"company_id": company.CompanyID, "textbox_id": textboxID, "message": "Must not be created", "entity_links": []any{},
		}},
		{method: http.MethodPut, path: "/v1/huddle-nodes/" + node.HuddleNodeID + "/chats/" + chatID, body: map[string]any{
			"company_id": company.CompanyID, "textbox_id": textboxID, "message": "Must not be changed", "entity_links": []any{}, "base_revision": 1,
		}},
		{method: http.MethodDelete, path: "/v1/huddle-nodes/" + node.HuddleNodeID + "/chats/" + chatID + "?company_id=" + company.CompanyID + "&revision=1"},
	}
	for _, test := range paths {
		response := serve(test.method, test.path, test.body)
		if response.Code != http.StatusNotFound {
			t.Fatalf("denied %s %s status=%d body=%s, want 404", test.method, test.path, response.Code, response.Body.String())
		}
	}

	workspace, err := repo.GetHuddleNodeWorkspace(company.CompanyID, node.HuddleNodeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.Textboxes) != 1 || len(workspace.Chats) != 1 || workspace.Chats[0].ChatID != chatID || workspace.Chats[0].Revision != chat.Revision || workspace.Chats[0].Message != chat.Message {
		t.Fatalf("denied requests changed workspace=%+v", workspace)
	}
}
