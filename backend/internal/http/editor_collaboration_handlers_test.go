package httpapi

import (
	"bytes"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEditorCollaborationHTTPAuthorizesExactResourceAcknowledgesCommitAndRecoversByETag(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "51515151-5151-4151-8151-515151515151"
	repo.EnsureCompany(companyID, "Editor HTTP collaboration")
	user := mustRealtimeAuthUser(t, repo, companyID, "editor-http-user", domain.RoleCompanyUser)
	denied := mustRealtimeAuthUser(t, repo, companyID, "editor-http-denied", domain.RoleCompanyUser)
	node, err := repo.CreateNode(companyID, "HTTP collaboration node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: store.EntityTypeNode, EntityID: node.NodeID,
		DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}

	const allowedToken = "editor-http-allowed-token"
	server := newRealtimeAuthServerForTest(repo, allowedToken, user)
	defer server.Close()
	documentID := "52525252-5252-4252-8252-525252525252"
	path := "/v1/editor-collaboration/node/" + node.NodeID + "/documents/" + documentID + "?company_id=" + companyID

	doJSON := func(method, token string, body any, etag string) *httptest.ResponseRecorder {
		t.Helper()
		var encoded []byte
		if body != nil {
			encoded, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(encoded))
		req.Header.Set("Authorization", "Bearer "+token)
		if etag != "" {
			req.Header.Set("If-None-Match", etag)
		}
		response := httptest.NewRecorder()
		server.Routes().ServeHTTP(response, req)
		return response
	}

	requestBody := map[string]any{
		"operation_id": "http-operation-1", "client_id": "http-client", "base_revision": 0,
		"patch": map[string]any{"start_utf8": 0, "delete_utf8": 0, "insert": "A"},
	}
	created := doJSON(http.MethodPost, allowedToken, requestBody, "")
	if created.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", created.Code, created.Body.String())
	}
	var first store.EditorCollaborationCommit
	if err := json.Unmarshal(created.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.Revision != 1 || first.Deduplicated || first.Patch.Insert != "A" || created.Header().Get("ETag") != "" {
		t.Fatalf("unexpected committed acknowledgement: %+v etag=%q", first, created.Header().Get("ETag"))
	}

	retried := doJSON(http.MethodPost, allowedToken, requestBody, "")
	if retried.Code != http.StatusOK {
		t.Fatalf("retry status=%d body=%s", retried.Code, retried.Body.String())
	}
	var duplicate store.EditorCollaborationCommit
	if err := json.Unmarshal(retried.Body.Bytes(), &duplicate); err != nil {
		t.Fatal(err)
	}
	if !duplicate.Deduplicated || duplicate.Revision != first.Revision || duplicate.EventID != first.EventID {
		t.Fatalf("lost-ack retry was not idempotent: first=%+v retry=%+v", first, duplicate)
	}

	// An older valid base is integrated instead of becoming an end-user whole-document conflict.
	concurrent := doJSON(http.MethodPost, allowedToken, map[string]any{
		"operation_id": "http-operation-2", "client_id": "other-client", "base_revision": 0,
		"patch": map[string]any{"start_utf8": 0, "delete_utf8": 0, "insert": "B"},
	}, "")
	if concurrent.Code != http.StatusOK {
		t.Fatalf("concurrent old-base status=%d body=%s", concurrent.Code, concurrent.Body.String())
	}
	var second store.EditorCollaborationCommit
	if err := json.Unmarshal(concurrent.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if second.Revision != 2 {
		t.Fatalf("concurrent revision=%d, want 2", second.Revision)
	}

	snapshot := doJSON(http.MethodGet, allowedToken, nil, "")
	if snapshot.Code != http.StatusOK || snapshot.Header().Get("ETag") == "" {
		t.Fatalf("snapshot status=%d etag=%q body=%s", snapshot.Code, snapshot.Header().Get("ETag"), snapshot.Body.String())
	}
	var beforeMetadataSnapshot store.EditorCollaborationSnapshot
	if err := json.Unmarshal(snapshot.Body.Bytes(), &beforeMetadataSnapshot); err != nil {
		t.Fatal(err)
	}
	validated := doJSON(http.MethodGet, allowedToken, nil, snapshot.Header().Get("ETag"))
	if validated.Code != http.StatusNotModified {
		t.Fatalf("conditional snapshot status=%d, want 304", validated.Code)
	}

	metadata := doJSON(http.MethodPatch, allowedToken, map[string]any{
		"title": "Block title",
		"attachments": []map[string]any{{
			"id": "53535353-5353-4353-8353-535353535353", "attachment_id": "53535353-5353-4353-8353-535353535353",
			"name": "image.png", "filename": "image.png", "type": "image/png", "mime_type": "image/png", "size": 12, "byte_size": 12,
		}},
	}, "")
	if metadata.Code != http.StatusOK {
		t.Fatalf("metadata status=%d body=%s", metadata.Code, metadata.Body.String())
	}
	bodyInjection := doJSON(http.MethodPatch, allowedToken, map[string]any{"title": "bad", "attachments": []any{}, "document": "stale overwrite"}, "")
	if bodyInjection.Code != http.StatusBadRequest {
		t.Fatalf("metadata body injection status=%d body=%s", bodyInjection.Code, bodyInjection.Body.String())
	}
	afterMetadata := doJSON(http.MethodGet, allowedToken, nil, "")
	var afterMetadataSnapshot store.EditorCollaborationSnapshot
	if err := json.Unmarshal(afterMetadata.Body.Bytes(), &afterMetadataSnapshot); err != nil {
		t.Fatal(err)
	}
	if afterMetadataSnapshot.HTML != beforeMetadataSnapshot.HTML || afterMetadataSnapshot.Revision != second.Revision {
		t.Fatalf("metadata changed canonical document: before=%+v after=%+v", beforeMetadataSnapshot, afterMetadataSnapshot)
	}

	// Causal gaps are machine recovery signals, not user merge workflows.
	gap := doJSON(http.MethodPost, allowedToken, map[string]any{
		"operation_id": "http-operation-gap", "client_id": "http-client", "base_revision": 2,
		"patch": map[string]any{"start_utf8": 999, "delete_utf8": 0, "insert": "!"},
	}, "")
	if gap.Code != http.StatusConflict || !bytes.Contains(gap.Body.Bytes(), []byte("collaboration_snapshot_required")) {
		t.Fatalf("gap status=%d body=%s", gap.Code, gap.Body.String())
	}

	deniedServer := newRealtimeAuthServerForTest(repo, "editor-http-denied-token", denied)
	defer deniedServer.Close()
	deniedReq := httptest.NewRequest(http.MethodGet, path, nil)
	deniedReq.Header.Set("Authorization", "Bearer editor-http-denied-token")
	deniedResponse := httptest.NewRecorder()
	deniedServer.Routes().ServeHTTP(deniedResponse, deniedReq)
	if deniedResponse.Code != http.StatusForbidden {
		t.Fatalf("denied exact-resource status=%d body=%s", deniedResponse.Code, deniedResponse.Body.String())
	}
}
