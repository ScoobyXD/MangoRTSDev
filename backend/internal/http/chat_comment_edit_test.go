package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEditChatCommentInformationPreservesCommentContext(t *testing.T) {
	authorID := "11111111-1111-4111-8111-111111111111"
	original, err := json.Marshal(map[string]any{
		"block_id":            "22222222-2222-4222-8222-222222222222",
		"parent_id":           "33333333-3333-4333-8333-333333333333",
		"selection_quote":     "important source",
		"selection_start":     4,
		"selection_end":       20,
		"author_id":           authorID,
		"author_name":         "Ada",
		"message":             "Original",
		"created_timestamp":   "2026-07-22T12:00:00Z",
		"attachments":         []any{map[string]any{"attachment_id": "attachment-1"}},
		"mentioned_user_ids":  []string{"old-user"},
		"mentioned_group_ids": []string{"old-group"},
	})
	if err != nil {
		t.Fatal(err)
	}
	message := "  Edited comment  "
	updated, blockID, err := editChatCommentInformation(
		"Text block chat",
		string(original),
		authorID,
		&message,
		&[]chatCommentEntityLink{{Start: 0, End: 6, EntityType: "node", EntityID: "node-1", Label: "Node"}},
		[]string{"new-user", "new-user", ""},
		[]string{"new-group"},
	)
	if err != nil {
		t.Fatalf("editChatCommentInformation: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(updated), &payload); err != nil {
		t.Fatal(err)
	}
	if blockID != "22222222-2222-4222-8222-222222222222" || payload["message"] != "Edited comment" {
		t.Fatalf("edited payload=%+v block_id=%q", payload, blockID)
	}
	for _, key := range []string{"parent_id", "selection_quote", "selection_start", "selection_end", "author_id", "author_name", "created_timestamp", "attachments"} {
		if _, exists := payload[key]; !exists {
			t.Fatalf("edit removed immutable comment field %q: %+v", key, payload)
		}
	}
	if payload["edited_timestamp"] == "" {
		t.Fatalf("edit omitted edited_timestamp: %+v", payload)
	}
	if got := payload["mentioned_user_ids"].([]any); len(got) != 1 || got[0] != "new-user" {
		t.Fatalf("mentioned_user_ids=%+v", got)
	}
	if got := payload["mentioned_group_ids"].([]any); len(got) != 1 || got[0] != "new-group" {
		t.Fatalf("mentioned_group_ids=%+v", got)
	}
	if got := payload["entity_links"].([]any); len(got) != 1 {
		t.Fatalf("entity_links=%+v", got)
	}
}

func TestEditChatCommentInformationRequiresOriginalAuthor(t *testing.T) {
	original := `{"block_id":"block-1","author_id":"author-1","message":"Original","attachments":[]}`
	message := "Edited"
	_, _, err := editChatCommentInformation("Text block chat", original, "other-user", &message, nil, nil, nil)
	if !errors.Is(err, errChatCommentAuthorDenied) {
		t.Fatalf("other-author edit error=%v, want author denied", err)
	}
	empty := " "
	_, _, err = editChatCommentInformation("Text block chat", original, "author-1", &empty, nil, nil, nil)
	if !errors.Is(err, errChatCommentInvalid) {
		t.Fatalf("empty edit error=%v, want invalid", err)
	}
}

func TestProjectChatCommentPatchRequiresAuthorAndUpdatesProjection(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "77777777-7777-4777-8777-777777777701"
	repo.EnsureCompany(companyID, "Chat edit company")
	author := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "project-chat-author", "author@example.com", domain.RoleCompanyUser)
	other := mustHTTPEmailCollaborationGuardUser(t, repo, companyID, "project-chat-other", "other@example.com", domain.RoleCompanyUser)
	created, err := repo.CreateProject(store.ProjectInput{CompanyID: companyID, Name: "Chat edit project", Status: store.ProjectDefaultStatus})
	if err != nil {
		t.Fatal(err)
	}
	projectID := created.Project.ProjectID
	informationID := store.NewUUIDv7String()
	original, _ := json.Marshal(map[string]any{
		"block_id": store.NewUUIDv7String(), "author_id": author.UserID, "author_name": "Author",
		"message": "Original", "created_timestamp": "2026-07-22T12:00:00Z", "attachments": []any{},
	})
	if _, err := repo.AddProjectInformation(store.ProjectInformationInput{
		CompanyID: companyID, ProjectID: projectID, InformationID: informationID,
		Type: "Text block chat", Information: string(original), ActorUserID: author.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{}).Routes()
	requestEdit := func(user domain.User, message string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]any{"company_id": companyID, "message": message})
		req := httptest.NewRequest(http.MethodPatch, "/v1/projects/"+projectID+"/projection/"+informationID, bytes.NewReader(body))
		req = attachmentRequestWithActor(req, user, companyID, domain.RoleCompanyUser)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	if rec := requestEdit(other, "Hijacked"); rec.Code != http.StatusForbidden {
		t.Fatalf("other-author edit status=%d body=%s, want 403", rec.Code, rec.Body.String())
	}
	overwriteBody, _ := json.Marshal(map[string]any{
		"company_id": companyID, "information_id": informationID, "type": "Note", "information": "disguised overwrite",
	})
	overwriteReq := httptest.NewRequest(http.MethodPost, "/v1/projects/"+projectID+"/information", bytes.NewReader(overwriteBody))
	overwriteReq = attachmentRequestWithActor(overwriteReq, author, companyID, domain.RoleCompanyUser)
	overwriteRec := httptest.NewRecorder()
	handler.ServeHTTP(overwriteRec, overwriteReq)
	if overwriteRec.Code != http.StatusConflict {
		t.Fatalf("disguised chat overwrite status=%d body=%s, want 409", overwriteRec.Code, overwriteRec.Body.String())
	}
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/projects/"+projectID+"/projection/"+informationID+"?company_id="+companyID, nil)
	deleteReq = attachmentRequestWithActor(deleteReq, other, companyID, domain.RoleCompanyUser)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusForbidden {
		t.Fatalf("other-author delete status=%d body=%s, want 403", deleteRec.Code, deleteRec.Body.String())
	}
	if rec := requestEdit(author, "Edited by author"); rec.Code != http.StatusOK {
		t.Fatalf("author edit status=%d body=%s, want 200", rec.Code, rec.Body.String())
	}
	projections, err := repo.ListProjectProjections(companyID, projectID)
	if err != nil {
		t.Fatal(err)
	}
	projection, found := findProjectChatComment(projections, informationID)
	if !found {
		t.Fatalf("edited projection missing: %+v", projections)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(projection.Information), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["message"] != "Edited by author" || payload["edited_timestamp"] == "" {
		t.Fatalf("edited projection payload=%+v", payload)
	}
}
