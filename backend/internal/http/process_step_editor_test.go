package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestProcessStepEditorHTTPAndRealtimeUseOwningProcessEditAccess(t *testing.T) {
	repo := store.NewMemoryRepo()
	const companyID = "56565656-5656-4656-8656-565656565656"
	const otherCompanyID = "57575757-5757-4757-8757-575757575757"
	repo.EnsureCompany(companyID, "Step instructions")
	repo.EnsureCompany(otherCompanyID, "Other company")
	admin := mustRealtimeAuthUser(t, repo, companyID, "step-sop-admin", domain.RoleCompanyAdmin)
	editor := mustRealtimeAuthUser(t, repo, companyID, "step-sop-editor", domain.RoleCompanyUser)
	denied := mustRealtimeAuthUser(t, repo, companyID, "step-sop-denied", domain.RoleCompanyUser)
	gate, err := repo.CreateLogicGate(companyID, "Invoice")
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Review", ActorUserID: admin.UserID})
	if err != nil {
		t.Fatal(err)
	}
	stepID := created.Step.ProcessStepID
	setAccess := func(allowEditor bool) {
		t.Helper()
		permissions := []store.EntityPermissionInput{}
		if allowEditor {
			permissions = append(permissions, store.EntityPermissionInput{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit})
		}
		if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID: companyID, EntityType: store.EntityTypeLogicGate, EntityID: gate.LogicGateID,
			DefaultAccess: store.EntityPermissionNoAccess, DefaultAccessSet: true, Permissions: permissions, ActorUserID: admin.UserID,
		}); err != nil {
			t.Fatal(err)
		}
	}
	setAccess(true)
	server := NewServer(repo)
	defer server.Close()
	path := "/v1/editor-json/process_step/" + stepID + "/documents/" + stepID
	document := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Check the invoice","marks":[{"type":"bold"}]}]}]}}`)
	payload := map[string]any{"operation_id": "step-sop-save", "client_id": "step-sop-client", "base_revision": 0, "schema_version": 1, "document": document, "annotations": []any{}}
	request := func(method, target string, body map[string]any, user domain.User) *httptest.ResponseRecorder {
		t.Helper()
		req := logicGateWorkV2Request(t, method, target, body, user, companyID)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		return rec
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		if rec := request(method, path+"?company_id="+companyID, payload, denied); rec.Code != http.StatusForbidden {
			t.Fatalf("denied %s status=%d body=%s", method, rec.Code, rec.Body)
		}
	}
	if rec := request(http.MethodPost, path+"?company_id="+companyID, payload, editor); rec.Code != http.StatusOK {
		t.Fatalf("save status=%d body=%s", rec.Code, rec.Body)
	}
	read := request(http.MethodGet, path+"?company_id="+companyID, nil, editor)
	var snapshot store.EditorJSONSnapshot
	if read.Code != http.StatusOK || json.Unmarshal(read.Body.Bytes(), &snapshot) != nil || snapshot.Revision != 1 || !strings.Contains(string(snapshot.JSONDocument), "Check the invoice") {
		t.Fatalf("read status=%d body=%s", read.Code, read.Body)
	}
	if rec := request(http.MethodGet, path+"/versions?company_id="+companyID, nil, editor); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Check the invoice") {
		t.Fatalf("versions status=%d body=%s", rec.Code, rec.Body)
	}
	for _, target := range []string{
		"/v1/editor-json/process_step/" + stepID + "/documents/" + gate.LogicGateID + "?company_id=" + companyID,
		path + "?company_id=" + otherCompanyID,
		"/v1/editor-json/process_step/58585858-5858-4858-8858-585858585858/documents/58585858-5858-4858-8858-585858585858?company_id=" + companyID,
	} {
		if rec := request(http.MethodGet, target, nil, editor); rec.Code != http.StatusNotFound {
			t.Fatalf("wrong identity status=%d body=%s", rec.Code, rec.Body)
		}
	}
	actor := func(user domain.User) ActorContext {
		return ActorContext{User: user, Memberships: []domain.CompanyMembership{{CompanyID: companyID, UserID: user.UserID, Role: domain.RoleCompanyUser}}}
	}
	ref := store.EditorJSONDocumentRef{CompanyID: companyID, ResourceType: store.EntityTypeProcessStep, ResourceID: stepID, DocumentID: stepID}
	scope := store.EditorJSONRealtimeScope(ref)
	allowed, reason, err := server.authorizeRealtimeSubscription(context.Background(), actor(editor), companyID, scope)
	if err != nil || !allowed || reason != "" {
		t.Fatalf("editor subscription allowed=%v reason=%q err=%v", allowed, reason, err)
	}
	allowed, reason, err = server.authorizeRealtimeSubscription(context.Background(), actor(denied), companyID, scope)
	if err != nil || allowed || reason != "access_denied" {
		t.Fatalf("denied subscription allowed=%v reason=%q err=%v", allowed, reason, err)
	}
	subscribeRecordingRealtimeConnection(t, server, "step-editor", companyID, editor.UserID, scope)
	subscribeRecordingRealtimeConnection(t, server, "step-denied", companyID, denied.UserID, scope)
	audience, err := server.resolveRealtimeEntityAudienceWithContextUnlocked(context.Background(), companyID, scope, ref.ResourceType, stepID, store.EntityPermissionEdit)
	if err != nil || len(audience) != 1 {
		t.Fatalf("publication audience=%v err=%v", audience, err)
	}
	if _, ok := audience[editor.UserID]; !ok {
		t.Fatalf("editor missing from publication audience=%v", audience)
	}
	setAccess(false)
	audience, err = server.resolveRealtimeEntityAudienceWithContextUnlocked(context.Background(), companyID, scope, ref.ResourceType, stepID, store.EntityPermissionEdit)
	if err != nil || len(audience) != 0 {
		t.Fatalf("revoked publication audience=%v err=%v", audience, err)
	}
	if rec := request(http.MethodPost, path+"?company_id="+companyID, payload, editor); rec.Code != http.StatusForbidden {
		t.Fatalf("revoked save status=%d body=%s", rec.Code, rec.Body)
	}
	if _, err := repo.DeleteProcessStep(store.ProcessStepDeleteInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, ProcessStepID: stepID, ActorUserID: admin.UserID}); err != nil {
		t.Fatal(err)
	}
	if rec := request(http.MethodGet, path+"?company_id="+companyID, nil, editor); rec.Code != http.StatusNotFound {
		t.Fatalf("deleted step status=%d body=%s", rec.Code, rec.Body)
	}
	allowed, reason, err = server.authorizeRealtimeSubscription(context.Background(), actor(editor), companyID, scope)
	if err != nil || allowed || reason != "resource_not_found" {
		t.Fatalf("deleted subscription allowed=%v reason=%q err=%v", allowed, reason, err)
	}
}

func TestProcessStepHTTPCreationAcceptsInstructionsAndPatchCannotBypassEditor(t *testing.T) {
	repo := store.NewMemoryRepo()
	const companyID = "59595959-5959-4959-8959-595959595959"
	repo.EnsureCompany(companyID, "Step initial instructions")
	user := mustLogicGateWorkHTTPUser(t, repo, companyID, "step-initial-editor")
	gate, err := repo.CreateLogicGate(companyID, "Review")
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(repo)
	defer server.Close()
	path := "/v2/logic-gates/" + gate.LogicGateID + "/steps"
	body := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Initial instructions"}]}]}}`)
	req := logicGateWorkV2Request(t, http.MethodPost, path, map[string]any{"company_id": companyID, "name": "Read", "body_json": body}, user, companyID)
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	var result store.ProcessStepMutationResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &result) != nil || result.Step == nil || !strings.Contains(string(result.Step.BodyJSON), "Initial instructions") {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body)
	}
	req = logicGateWorkV2Request(t, http.MethodPatch, path+"/"+result.Step.ProcessStepID, map[string]any{"company_id": companyID, "name": "Changed", "body_json": body}, user, companyID)
	rec = httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_process_step_update") {
		t.Fatalf("patch bypass status=%d body=%s", rec.Code, rec.Body)
	}
	step, err := repo.GetProcessStep(companyID, result.Step.ProcessStepID)
	if err != nil || step.Name != "Read" {
		t.Fatalf("rejected patch changed step=%+v err=%v", step, err)
	}
}
