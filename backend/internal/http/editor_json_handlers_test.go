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

func TestEditorJSONHTTPUsesAtomicGateAndRejectsStaleFormats(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "81818181-8181-4181-8181-818181818181"
	repo.EnsureCompany(companyID, "JSON editor")
	user := mustRealtimeAuthUser(t, repo, companyID, "json-editor-admin", domain.RoleCompanyAdmin)
	node, err := repo.CreateNode(companyID, "JSON node")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.SetEditorDataFormatForTests(store.EditorDataFormatGate{
		CompanyID: companyID, EditorFormat: store.EditorFormatTiptapJSON,
		MigrationState: store.EditorMigrationReady, DocumentSchemaVersion: 1,
	}); err != nil {
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
	if legacy.Code != http.StatusConflict || !strings.Contains(legacy.Body.String(), "editor_format_mismatch") {
		t.Fatalf("legacy status=%d body=%s", legacy.Code, legacy.Body.String())
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
	if created.Code != http.StatusOK || !strings.Contains(created.Body.String(), "\"revision\":1") ||
		!strings.Contains(created.Body.String(), "\"annotations\":[{\"id\":\"comment-1\"") {
		t.Fatalf("created status=%d body=%s", created.Code, created.Body.String())
	}
	metadata := doJSON(http.MethodPatch, jsonPath, map[string]any{
		"title": "JSON image", "attachments": []any{},
	})
	if metadata.Code != http.StatusOK || !strings.Contains(metadata.Body.String(), "\"projection_revision\":1") {
		t.Fatalf("metadata status=%d body=%s", metadata.Code, metadata.Body.String())
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil || len(projections) != 1 {
		t.Fatalf("JSON metadata projections=%+v err=%v", projections, err)
	}
	if !strings.Contains(projections[0].Information, "\"title\":\"JSON image\"") ||
		!strings.Contains(projections[0].Information, "\"document\":\"\"") ||
		strings.Contains(projections[0].Information, "safe JSON") {
		t.Fatalf("JSON metadata projection leaked document content: %s", projections[0].Information)
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

func TestEditorJSONHTTPOnlyCreatesUpdatesForNormalAndUrgentMentions(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "85858585-8585-4585-8585-858585858585"
	repo.EnsureCompany(companyID, "JSON mention editor")
	actor := mustRealtimeAuthUser(t, repo, companyID, "json-mention-actor", domain.RoleCompanyAdmin)
	mentioned := mustRealtimeAuthUser(t, repo, companyID, "json-mention-target", domain.RoleCompanyUser)
	node, err := repo.CreateNode(companyID, "JSON mention node")
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
	path := "/v1/editor-json/node/" + node.NodeID + "/documents/86868686-8686-4686-8686-868686868686?company_id=" + companyID
	post := func(operationID string, baseRevision int, content []any) *httptest.ResponseRecorder {
		t.Helper()
		document := map[string]any{
			"format": "mango-tiptap-json", "schema_version": 1,
			"document": map[string]any{
				"type":    "doc",
				"content": []any{map[string]any{"type": "paragraph", "content": content}},
			},
		}
		body, _ := json.Marshal(map[string]any{
			"operation_id": operationID, "client_id": "json-mention-client",
			"base_revision": baseRevision, "schema_version": 1, "document": document,
			"annotations": []any{},
		})
		request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		server.Routes().ServeHTTP(response, request)
		return response
	}

	if response := post("plain-operation", 0, []any{map[string]any{"type": "text", "text": "ordinary typing"}}); response.Code != http.StatusOK {
		t.Fatalf("plain status=%d body=%s", response.Code, response.Body.String())
	}
	items, err := repo.ListNotifications(store.NotificationListInput{UserID: mentioned.UserID, CompanyID: companyID, Limit: 10})
	if err != nil || len(items) != 0 {
		t.Fatalf("ordinary edit notifications=%+v err=%v", items, err)
	}

	mentionContent := func(kind string) []any {
		return []any{
			map[string]any{"type": "text", "text": "Please review "},
			map[string]any{"type": "mention", "attrs": map[string]any{
				"userId": mentioned.UserID, "label": mentioned.DisplayName, "kind": kind,
			}},
		}
	}
	if response := post("regular-operation", 1, mentionContent("normal")); response.Code != http.StatusOK {
		t.Fatalf("regular mention status=%d body=%s", response.Code, response.Body.String())
	}
	if response := post("urgent-operation", 2, mentionContent("urgent")); response.Code != http.StatusOK {
		t.Fatalf("urgent mention status=%d body=%s", response.Code, response.Body.String())
	}
	for attempts := 0; attempts < 100; attempts++ {
		items, err = repo.ListNotifications(store.NotificationListInput{UserID: mentioned.UserID, CompanyID: companyID, Limit: 10})
		if err != nil || len(items) >= 2 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err != nil || len(items) != 2 {
		t.Fatalf("mention notifications=%+v err=%v", items, err)
	}
	seen := map[string]bool{}
	for _, item := range items {
		seen[item.Type] = true
	}
	if !seen["mention.created"] || !seen["mention.urgent_created"] {
		t.Fatalf("mention notification types=%v", seen)
	}
}
func TestEditorJSONHTTPDefaultsToLegacyAndRejectsJSONRoute(t *testing.T) {
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
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "editor_format_mismatch") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
