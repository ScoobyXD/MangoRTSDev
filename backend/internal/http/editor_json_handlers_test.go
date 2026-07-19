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
	for _, resource := range []struct {
		resourceType string
		resourceID   string
	}{
		{resourceType: "email_draft", resourceID: "personal:another-user:owner%40example.test:draft-1"},
		{resourceType: "email_signature", resourceID: "personal:another-user:owner%40example.test"},
	} {
		path := "/v1/editor-json/" + resource.resourceType + "/" + resource.resourceID + "/documents/body?company_id=" + companyID
		response := doJSON(http.MethodGet, path, nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("cross-mailbox %s status=%d body=%s", resource.resourceType, response.Code, response.Body.String())
		}
	}
	allowed, rejectCode, err := server.authorizeEditorJSONRealtime(ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID, UserID: user.UserID, Role: domain.RoleCompanyAdmin,
		}},
	}, store.EditorJSONDocumentRef{
		CompanyID: companyID, ResourceType: "email_signature",
		ResourceID: "personal:another-user:owner%40example.test", DocumentID: "body",
	})
	if err != nil || allowed || rejectCode != "resource_not_found" {
		t.Fatalf("cross-mailbox realtime allowed=%t reject=%q err=%v", allowed, rejectCode, err)
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
	})
	if created.Code != http.StatusOK || !strings.Contains(created.Body.String(), "\"revision\":1") {
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
