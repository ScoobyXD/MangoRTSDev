package httpapi

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProcessStepMapHTTPPersistenceConflictAndAuthorization(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666461"
	repo.EnsureCompany(companyID, "Step map HTTP")
	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "map-editor")
	blocked := mustLogicGateWorkHTTPUser(t, repo, companyID, "map-blocked")
	gate, err := repo.CreateLogicGate(companyID, "Process map")
	if err != nil {
		t.Fatal(err)
	}
	step, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Review"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.SetEntityPermissions(store.EntityPermissionUpdateInput{CompanyID: companyID, EntityType: store.EntityTypeLogicGate, EntityID: gate.LogicGateID, DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true, Permissions: []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit}}}); err != nil {
		t.Fatal(err)
	}
	server := NewServer(repo)
	defer server.Close()
	path := "/v2/logic-gates/" + gate.LogicGateID + "/step-map?company_id=" + companyID
	request := func(method string, payload map[string]any, actor domain.User, expected int) *httptest.ResponseRecorder {
		t.Helper()
		req := logicGateWorkV2Request(t, method, path, payload, actor, companyID)
		rec := httptest.NewRecorder()
		server.Routes().ServeHTTP(rec, req)
		if rec.Code != expected {
			t.Fatalf("%s: %d %s, want %d", method, rec.Code, rec.Body, expected)
		}
		return rec
	}
	request(http.MethodGet, nil, blocked, http.StatusNotFound)
	payload := map[string]any{"company_id": companyID, "base_revision": 0, "steps": []domain.ProcessStepMapRectangle{{ProcessStepID: step.Step.ProcessStepID, X: 12, Y: 34, Width: 200, Height: 100}}, "routes": []domain.ProcessStepMapRoute{}}
	request(http.MethodPut, payload, blocked, http.StatusNotFound)
	rec := request(http.MethodPut, payload, editor, http.StatusOK)
	var saved domain.ProcessStepMapLayout
	if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil || saved.Revision <= 0 {
		t.Fatalf("saved: %+v %v", saved, err)
	}
	request(http.MethodPut, payload, editor, http.StatusConflict)
	rec = request(http.MethodGet, nil, editor, http.StatusOK)
	var loaded domain.ProcessStepMapLayout
	if err := json.Unmarshal(rec.Body.Bytes(), &loaded); err != nil || loaded.Revision != saved.Revision || len(loaded.Steps) != 1 || loaded.Steps[0].X != 12 {
		t.Fatalf("reload: %+v %v", loaded, err)
	}
	delete(payload, "base_revision")
	request(http.MethodPut, payload, editor, http.StatusBadRequest)
	work, err := repo.GetLogicGateWork(companyID, gate.LogicGateID, editor.UserID)
	if err != nil || len(work.Nodes) != 0 || len(work.Steps) != 1 {
		t.Fatalf("map created runtime work: %+v %v", work, err)
	}
}
