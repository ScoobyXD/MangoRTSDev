package httpapi

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProcessStepsHTTPExposesRequestResolverPermission(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666452"
	repo.EnsureCompany(companyID, "Request resolvers")
	first := mustLogicGateWorkHTTPUser(t, repo, companyID, "first-resolver")
	second := mustLogicGateWorkHTTPUser(t, repo, companyID, "second-resolver")
	gate, err := repo.CreateLogicGate(companyID, "Requests")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.SetResourceRACIAssignments(store.ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeLogicGate, ResourceID: gate.LogicGateID,
		Assignments: []store.ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleResponsible, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: first.UserID},
			{Role: domain.RACIRoleResponsible, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: second.UserID},
		},
	}); err != nil {
		t.Fatal(err)
	}
	server := NewServer(repo)
	defer server.Close()
	for _, user := range []domain.User{first, second} {
		work := getLogicGateWorkV2ForTest(t, server.Routes(), companyID, gate.LogicGateID, user, http.StatusOK)
		if !work.Permissions.CanEdit || !work.Permissions.CanResolveRequests {
			t.Fatalf("Every Responsible must see request actions: %+v", work.Permissions)
		}
	}
}

func TestProcessStepsHTTPCreateStartFinishAndDelete(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666451"
	repo.EnsureCompany(companyID, "Process Steps HTTP")
	actor := mustLogicGateWorkHTTPUser(t, repo, companyID, "step-editor")
	gate, err := repo.CreateLogicGate(companyID, "Invoice")
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()
	create := func(path string, payload map[string]any) *httptest.ResponseRecorder {
		t.Helper()
		req := logicGateWorkV2Request(t, http.MethodPost, path, payload, actor, companyID)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
			t.Fatalf("POST %s: %d %s", path, rec.Code, rec.Body)
		}
		return rec
	}
	path := "/v2/logic-gates/" + gate.LogicGateID
	rec := create(path+"/steps", map[string]any{"company_id": companyID, "name": "Review"})
	var step store.ProcessStepMutationResult
	if err = json.Unmarshal(rec.Body.Bytes(), &step); err != nil || step.Step == nil {
		t.Fatalf("step: %v %s", err, rec.Body)
	}
	rec = create(path+"/nodes", map[string]any{"company_id": companyID, "create_node_title": "Invoice 42", "status": "In Progress", "process_step_id": step.Step.ProcessStepID})
	assigned := decodeLogicGateWorkMutationPayloadForTest(t, rec)
	if assigned.Assignment.ProcessStepID == nil || *assigned.Assignment.ProcessStepID != step.Step.ProcessStepID {
		t.Fatalf("Assignment must use exact step: %+v", assigned)
	}
	req := logicGateWorkV2Request(t, http.MethodPut, path+"/nodes/"+assigned.Node.NodeID+"/state", map[string]any{"company_id": companyID, "status": "Done"}, actor, companyID)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("Done: %d %s", rec.Code, rec.Body)
	}
	finished := decodeLogicGateWorkMutationPayloadForTest(t, rec)
	if finished.Node.Status == nil || *finished.Node.Status != "Done" || finished.Assignment.ProcessStepID == nil {
		t.Fatal("Finishing must retain step")
	}
	req = httptest.NewRequest(http.MethodDelete, path+"/steps/"+step.Step.ProcessStepID+"?company_id="+companyID, nil)
	req = requestWithLogicGateWorkActorForTest(req, actor, companyID)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("Delete: %d %s", rec.Code, rec.Body)
	}
	work := getLogicGateWorkV2ForTest(t, handler, companyID, gate.LogicGateID, actor, http.StatusOK)
	if len(work.Steps) != 0 || len(work.Nodes) != 1 || work.Nodes[0].Status != "Done" || work.Nodes[0].ProcessStepID != nil {
		t.Fatalf("Deleted step must retain completed Node: %+v", work)
	}
}
