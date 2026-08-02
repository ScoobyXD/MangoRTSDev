package httpapi

import (
	"bytes"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestEditorJSONHTTPUsesPermanentFormatAndRetiresLegacyRoute(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "81818181-8181-4181-8181-818181818181"
	repo.EnsureCompany(companyID, "JSON editor")
	user := mustRealtimeAuthUser(t, repo, companyID, "json-editor-admin", domain.RoleCompanyAdmin)
	node, err := repo.CreateNode(companyID, "JSON node")
	if err != nil {
		t.Fatal(err)
	}
	const token = "json-editor-token"
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()

	documentID := "82828282-8282-4282-8282-828282828282"
	jsonPath := "/v1/editor-json/node/" + node.NodeID + "/documents/" + documentID + "?company_id=" + companyID
	legacyPath := "/v1/editor-collaboration/node/" + node.NodeID + "/documents/" + documentID + "?company_id=" + companyID
	doJSON := func(method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var encoded []byte
		if body != nil {
			encoded, _ = json.Marshal(body)
		}
		request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		server.Routes().ServeHTTP(response, request)
		return response
	}

	gate := doJSON(http.MethodGet, "/v1/editor-data-format?company_id="+companyID, nil)
	if gate.Code != http.StatusOK || !strings.Contains(gate.Body.String(), "\"editor_format\":\"tiptap_json\"") {
		t.Fatalf("gate status=%d body=%s", gate.Code, gate.Body.String())
	}
	for _, unsupportedType := range []string{"email_draft", "email_signature"} {
		path := "/v1/editor-json/" + unsupportedType + "/mailbox/documents/body?company_id=" + companyID
		response := doJSON(http.MethodGet, path, nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("unsupported email JSON type %s status=%d body=%s", unsupportedType, response.Code, response.Body.String())
		}
	}
	legacy := doJSON(http.MethodGet, legacyPath, nil)
	if legacy.Code != http.StatusNotFound {
		t.Fatalf("retired legacy status=%d body=%s", legacy.Code, legacy.Body.String())
	}
	document := map[string]any{
		"format": "mango-tiptap-json", "schema_version": 1,
		"document": map[string]any{"type": "doc", "content": []any{
			map[string]any{"type": "paragraph", "content": []any{
				map[string]any{"type": "text", "text": "safe JSON"},
			}},
		}},
	}
	created := doJSON(http.MethodPost, jsonPath, map[string]any{
		"operation_id": "json-operation-1", "client_id": "json-client",
		"base_revision": 0, "schema_version": 1, "document": document,
		"annotations": []any{map[string]any{"id": "comment-1", "kind": "comment", "from": 2, "to": 6}},
	})
	if created.Code != http.StatusOK || !strings.Contains(created.Body.String(), "\"operation_id\":\"json-operation-1\"") ||
		!strings.Contains(created.Body.String(), "\"revision\":1") {
		t.Fatalf("created status=%d body=%s", created.Code, created.Body.String())
	}
	if strings.Contains(created.Body.String(), "\"document\"") || strings.Contains(created.Body.String(), "\"annotations\"") || strings.Contains(created.Body.String(), "\"schema_version\"") {
		t.Fatalf("save acknowledgement returned a complete document: %s", created.Body.String())
	}
	metadata := doJSON(http.MethodPatch, jsonPath, map[string]any{
		"title": "retired title", "attachments": []any{},
	})
	if metadata.Code != http.StatusMethodNotAllowed {
		t.Fatalf("retired Node metadata status=%d body=%s", metadata.Code, metadata.Body.String())
	}
	snapshot, err := repo.GetEditorJSONSnapshot(store.EditorJSONDocumentRef{
		CompanyID: companyID, ResourceType: store.EntityTypeNode,
		ResourceID: node.NodeID, DocumentID: documentID,
	})
	if err != nil {
		t.Fatalf("load JSON textbox snapshot: %v", err)
	}
	body := string(snapshot.JSONDocument)
	if !strings.Contains(body, "safe JSON") || strings.Contains(body, "\"title\"") || strings.Contains(body, "\"attachments\"") {
		t.Fatalf("Node textbox body is not body-only: %s", body)
	}
	stale := doJSON(http.MethodPost, jsonPath, map[string]any{
		"operation_id": "json-operation-2", "client_id": "json-client",
		"base_revision": 0, "schema_version": 1, "document": document,
		"annotations": []any{map[string]any{"id": "comment-1", "kind": "comment", "from": 2, "to": 6}},
	})
	if stale.Code != http.StatusConflict || !strings.Contains(stale.Body.String(), "editor_json_revision_conflict") {
		t.Fatalf("stale status=%d body=%s", stale.Code, stale.Body.String())
	}
	invalid := doJSON(http.MethodPost, jsonPath, map[string]any{
		"operation_id": "json-operation-3", "client_id": "json-client",
		"base_revision": 1, "schema_version": 1,
		"document": map[string]any{
			"format": "mango-tiptap-json", "schema_version": 1,
			"document": map[string]any{"type": "legacyHTML", "content": []any{}},
		},
	})
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "invalid_editor_json_document") {
		t.Fatalf("invalid status=%d body=%s", invalid.Code, invalid.Body.String())
	}
}

func TestEditorJSONHTTPOnlyCreatesUpdatesForNewMentionsAcrossResources(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "85858585-8585-4585-8585-858585858585"
	repo.EnsureCompany(companyID, "JSON mention editor")
	actor := mustRealtimeAuthUser(t, repo, companyID, "json-mention-actor", domain.RoleCompanyAdmin)
	mentioned := mustRealtimeAuthUser(t, repo, companyID, "json-mention-target", domain.RoleCompanyUser)
	node, err := repo.CreateNode(companyID, "JSON mention node")
	if err != nil {
		t.Fatal(err)
	}
	projectResult, err := repo.CreateProject(store.ProjectInput{CompanyID: companyID, Name: "JSON mention project", ActorUserID: actor.UserID})
	if err != nil || projectResult.Project == nil {
		t.Fatalf("project=%+v err=%v", projectResult, err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "JSON mention logic gate")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.SetEditorDataFormatForTests(store.EditorDataFormatGate{
		CompanyID: companyID, EditorFormat: store.EditorFormatTiptapJSON,
		MigrationState: store.EditorMigrationReady, DocumentSchemaVersion: 1,
	}); err != nil {
		t.Fatal(err)
	}
	const token = "json-mention-token"
	server := newRealtimeAuthServerForTest(repo, token, actor)
	defer server.Close()

	document := func(content []any) map[string]any {
		return map[string]any{
			"format": "mango-tiptap-json", "schema_version": 1,
			"document": map[string]any{
				"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": content}},
			},
		}
	}
	mentionContent := func(kind string, suffix ...string) []any {
		content := []any{
			map[string]any{"type": "text", "text": "Please review "},
			map[string]any{"type": "mention", "attrs": map[string]any{
				"userId": mentioned.UserID, "label": mentioned.DisplayName, "kind": kind,
			}},
		}
		if len(suffix) > 0 && suffix[0] != "" {
			content = append(content, map[string]any{"type": "text", "text": suffix[0]})
		}
		return content
	}
	post := func(path, operationID string, baseRevision int, content []any) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"operation_id": operationID, "client_id": "json-mention-client",
			"base_revision": baseRevision, "schema_version": 1, "document": document(content),
			"annotations": []any{},
		})
		request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		server.Routes().ServeHTTP(response, request)
		return response
	}
	deleteDocument := func(path, operationID string, baseRevision int) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"operation_id": operationID, "client_id": "json-mention-client", "base_revision": baseRevision,
		})
		request := httptest.NewRequest(http.MethodDelete, path, bytes.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		server.Routes().ServeHTTP(response, request)
		return response
	}
	waitNotifications := func(want int) []domain.Notification {
		t.Helper()
		var items []domain.Notification
		for attempts := 0; attempts < 100; attempts++ {
			items, err = repo.ListNotifications(store.NotificationListInput{UserID: mentioned.UserID, CompanyID: companyID, Limit: 50})
			if err != nil || len(items) >= want {
				break
			}
			time.Sleep(5 * time.Millisecond)
		}
		if err != nil || len(items) != want {
			t.Fatalf("notifications want=%d items=%+v err=%v", want, items, err)
		}
		return items
	}

	nodePath := "/v1/editor-json/node/" + node.NodeID + "/documents/86868686-8686-4686-8686-868686868686?company_id=" + companyID
	if response := post(nodePath, "plain-operation", 0, []any{map[string]any{"type": "text", "text": "ordinary typing"}}); response.Code != http.StatusOK {
		t.Fatalf("plain status=%d body=%s", response.Code, response.Body.String())
	}
	waitNotifications(0)

	regular := mentionContent("normal")
	if response := post(nodePath, "regular-operation", 1, regular); response.Code != http.StatusOK {
		t.Fatalf("regular status=%d body=%s", response.Code, response.Body.String())
	}
	items := waitNotifications(1)
	if items[0].Type != domain.NotificationEventMentionCreated || items[0].EntityType != store.EntityTypeNode {
		t.Fatalf("regular notification=%+v", items[0])
	}
	if response := post(nodePath, "regular-operation", 1, regular); response.Code != http.StatusOK {
		t.Fatalf("regular retry status=%d body=%s", response.Code, response.Body.String())
	}
	waitNotifications(1)
	if response := post(nodePath, "unrelated-operation", 2, mentionContent("normal", " with unrelated text")); response.Code != http.StatusOK {
		t.Fatalf("unrelated edit status=%d body=%s", response.Code, response.Body.String())
	}
	waitNotifications(1)
	if response := post(nodePath, "remove-operation", 3, []any{map[string]any{"type": "text", "text": "mention removed"}}); response.Code != http.StatusOK {
		t.Fatalf("remove mention status=%d body=%s", response.Code, response.Body.String())
	}
	waitNotifications(1)
	if response := post(nodePath, "readd-operation", 4, regular); response.Code != http.StatusOK {
		t.Fatalf("re-add mention status=%d body=%s", response.Code, response.Body.String())
	}
	waitNotifications(2)
	regularAndUrgent := append(append([]any{}, regular...), mentionContent("urgent")...)
	if response := post(nodePath, "urgent-operation", 5, regularAndUrgent); response.Code != http.StatusOK {
		t.Fatalf("urgent mention status=%d body=%s", response.Code, response.Body.String())
	}
	items = waitNotifications(3)
	seenTypes := map[string]int{}
	for _, item := range items {
		seenTypes[item.Type]++
	}
	if seenTypes[domain.NotificationEventMentionCreated] != 2 || seenTypes[domain.NotificationEventUrgentMentionCreated] != 1 {
		t.Fatalf("notification types=%v", seenTypes)
	}
	if response := post(nodePath, "delete-mentioned-text", 6, []any{map[string]any{"type": "text", "text": "all mentions deleted"}}); response.Code != http.StatusOK {
		t.Fatalf("delete mentioned text status=%d body=%s", response.Code, response.Body.String())
	}
	waitNotifications(3)
	if response := deleteDocument(nodePath, "delete-node-document", 7); response.Code != http.StatusOK {
		t.Fatalf("delete document status=%d body=%s", response.Code, response.Body.String())
	}
	waitNotifications(3)

	seedDocumentID := "87878787-8787-4787-8787-878787878787"
	seedRaw, _ := json.Marshal(document(mentionContent("normal")))
	if _, err := repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{
		Document:    store.EditorJSONDocumentRef{CompanyID: companyID, ResourceType: store.EntityTypeNode, ResourceID: node.NodeID, DocumentID: seedDocumentID},
		OperationID: "direct-seed-operation", ClientID: "direct-seed-client", ActorUserID: actor.UserID,
		BaseRevision: 0, SchemaVersion: 1, JSONDocument: seedRaw,
	}); err != nil {
		t.Fatal(err)
	}
	seedPath := "/v1/editor-json/node/" + node.NodeID + "/documents/" + seedDocumentID + "?company_id=" + companyID
	if response := deleteDocument(seedPath, "delete-seeded-document", 1); response.Code != http.StatusOK {
		t.Fatalf("delete seeded document status=%d body=%s", response.Code, response.Body.String())
	}
	waitNotifications(3)

	projectPath := "/v1/editor-json/project/" + projectResult.Project.ProjectID + "/documents/88888888-8888-4888-8888-888888888888?company_id=" + companyID
	if response := post(projectPath, "project-mention-operation", 0, mentionContent("normal")); response.Code != http.StatusOK {
		t.Fatalf("project mention status=%d body=%s", response.Code, response.Body.String())
	}
	items = waitNotifications(4)
	projectNotifications := 0
	for _, item := range items {
		if item.EntityType == store.EntityTypeProject && item.EntityID == projectResult.Project.ProjectID {
			projectNotifications++
		}
	}
	if projectNotifications != 1 {
		t.Fatalf("project notifications=%d items=%+v", projectNotifications, items)
	}

	logicGatePath := "/v1/editor-json/logic_gate/" + logicGate.LogicGateID + "/documents/89898989-8989-4989-8989-898989898989?company_id=" + companyID
	if response := post(logicGatePath, "logic-gate-urgent-operation", 0, mentionContent("urgent")); response.Code != http.StatusOK {
		t.Fatalf("logic gate mention status=%d body=%s", response.Code, response.Body.String())
	}
	items = waitNotifications(5)
	logicGateNotifications := 0
	for _, item := range items {
		if item.EntityType == store.EntityTypeLogicGate && item.EntityID == logicGate.LogicGateID && item.Type == domain.NotificationEventUrgentMentionCreated {
			logicGateNotifications++
		}
	}
	if logicGateNotifications != 1 {
		t.Fatalf("logic gate urgent notifications=%d items=%+v", logicGateNotifications, items)
	}
}

func TestEditorJSONHTTPDefaultsToPermanentJSONFormat(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "83838383-8383-4383-8383-838383838383"
	repo.EnsureCompany(companyID, "Legacy editor")
	user := mustRealtimeAuthUser(t, repo, companyID, "legacy-editor-admin", domain.RoleCompanyAdmin)
	node, err := repo.CreateNode(companyID, "Legacy node")
	if err != nil {
		t.Fatal(err)
	}
	const token = "legacy-editor-token"
	server := newRealtimeAuthServerForTest(repo, token, user)
	defer server.Close()
	path := "/v1/editor-json/node/" + node.NodeID + "/documents/84848484-8484-4484-8484-848484848484?company_id=" + companyID
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("permanent JSON status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEditorCollaborationTicketIsRetiredAndRevisionedWritesAreAccepted(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "91919191-9191-4191-8191-919191919191"
	repo.EnsureCompany(companyID, "Yjs editor")
	actor := mustRealtimeAuthUser(t, repo, companyID, "yjs-editor-admin", domain.RoleCompanyAdmin)
	projectResult, err := repo.CreateProject(store.ProjectInput{CompanyID: companyID, Name: "Yjs project", ActorUserID: actor.UserID})
	if err != nil || projectResult.Project == nil {
		t.Fatalf("project=%+v err=%v", projectResult, err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Fallback Logic Gate")
	if err != nil {
		t.Fatal(err)
	}

	if err := repo.SetEditorDataFormatForTests(store.EditorDataFormatGate{
		CompanyID: companyID, EditorFormat: store.EditorFormatTiptapJSON,
		MigrationState: store.EditorMigrationReady, DocumentSchemaVersion: 1,
	}); err != nil {
		t.Fatal(err)
	}
	const token = "yjs-editor-token"
	server := newRealtimeAuthServerForTest(repo, token, actor)
	defer server.Close()
	documentID := "project-overview"
	basePath := "/v1/editor-json/project/" + projectResult.Project.ProjectID + "/documents/" + documentID
	body, _ := json.Marshal(map[string]any{"client_id": "browser-tab-1"})
	request := httptest.NewRequest(http.MethodPost, basePath+"/collaboration-ticket?company_id="+companyID, bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "editor_document_route_not_found") {
		t.Fatalf("retired ticket status=%d body=%s", response.Code, response.Body.String())
	}

	wholeDocument, _ := json.Marshal(map[string]any{
		"operation_id": "project-revisioned-fallback", "client_id": "browser-tab-1", "base_revision": 0, "schema_version": 1,
		"document":    map[string]any{"format": "mango-tiptap-json", "schema_version": 1, "document": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}}},
		"annotations": []any{},
	})
	request = httptest.NewRequest(http.MethodPost, basePath+"?company_id="+companyID, bytes.NewReader(wholeDocument))
	request.Header.Set("Authorization", "Bearer "+token)
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":1`) {
		t.Fatalf("project fallback status=%d body=%s", response.Code, response.Body.String())
	}

	logicGateDocument, _ := json.Marshal(map[string]any{
		"operation_id": "logic-gate-revisioned-fallback", "client_id": "browser-tab-1", "base_revision": 0, "schema_version": 1,
		"document":    map[string]any{"format": "mango-tiptap-json", "schema_version": 1, "document": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph"}}}},
		"annotations": []any{},
	})
	logicGatePath := "/v1/editor-json/logic_gate/" + logicGate.LogicGateID + "/documents/logic-gate-overview?company_id=" + companyID
	request = httptest.NewRequest(http.MethodPost, logicGatePath, bytes.NewReader(logicGateDocument))
	request.Header.Set("Authorization", "Bearer "+token)
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":1`) {
		t.Fatalf("logic gate fallback status=%d body=%s", response.Code, response.Body.String())
	}
}
