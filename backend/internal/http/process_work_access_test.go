package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestProcessWorkHTTPNodePermissionChangeInvalidatesCachedWork(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666461"
	repo.EnsureCompany(companyID, "Process work access")
	actor := mustLogicGateWorkHTTPUser(t, repo, companyID, "process-work-access")
	gate, err := repo.CreateLogicGate(companyID, "Visible Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: store.EntityTypeLogicGate, EntityID: gate.LogicGateID,
		DefaultAccess: store.EntityPermissionNoAccess, DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionEdit}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetResourceRACIAssignments(store.ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeLogicGate, ResourceID: gate.LogicGateID,
		Assignments: []store.ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: actor.UserID}},
	}); err != nil {
		t.Fatal(err)
	}
	visibleNode, err := repo.CreateNode(companyID, "Visible waiting Node")
	if err != nil {
		t.Fatal(err)
	}
	hiddenNode, err := repo.CreateNode(companyID, "Private active Node")
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []store.LogicGateNodeAssignmentInput{
		{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: visibleNode.NodeID, Status: "Pending"},
		{CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: hiddenNode.NodeID, Status: "In Progress"},
	} {
		if _, err := repo.AssignNodeToLogicGateStatus(input); err != nil {
			t.Fatal(err)
		}
	}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()
	first, work := requestProcessWorkWithETagForTest(t, handler, companyID, gate.LogicGateID, actor, "", http.StatusOK)
	if len(work.Nodes) != 2 || !work.Permissions.CanEdit {
		t.Fatalf("initial work = %+v, want two visible Nodes and Process edit", work)
	}
	initialETag := first.Header().Get("ETag")
	if initialETag == "" {
		t.Fatal("initial work response has no ETag")
	}
	requestProcessWorkWithETagForTest(t, handler, companyID, gate.LogicGateID, actor, initialETag, http.StatusNotModified)

	defaultAccess := store.EntityPermissionEdit
	if _, _, err := repo.PutResourcePermissionPolicy(store.ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeNode, ResourceID: hiddenNode.NodeID,
		PermissionMode: store.PolicyModeCustomized, DefaultAccess: &defaultAccess,
		Permissions:      []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: actor.UserID, AccessLevel: store.EntityPermissionNoAccess}},
		DescendantAction: store.PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	changed, work := requestProcessWorkWithETagForTest(t, handler, companyID, gate.LogicGateID, actor, initialETag, http.StatusOK)
	if changed.Header().Get("ETag") == initialETag || len(work.Nodes) != 1 || work.Nodes[0].NodeID != visibleNode.NodeID || !work.Permissions.CanEdit {
		t.Fatalf("work after Node denial = %+v ETag=%q, want only visible Node with a new ETag", work, changed.Header().Get("ETag"))
	}
	if strings.Contains(changed.Body.String(), hiddenNode.NodeID) || strings.Contains(changed.Body.String(), hiddenNode.Title) {
		t.Fatalf("hidden Node leaked into refreshed work: %s", changed.Body)
	}
	request := httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID+"&section=processes&role=responsible", nil)
	request = requestWithLogicGateWorkActorForTest(request, actor, companyID)
	counts := httptest.NewRecorder()
	handler.ServeHTTP(counts, request)
	var myWork domain.MyWorkResponse
	if counts.Code != http.StatusOK || json.Unmarshal(counts.Body.Bytes(), &myWork) != nil || myWork.Processes == nil || len(myWork.Processes.Items) != 1 {
		t.Fatalf("Process counts response = %d %s", counts.Code, counts.Body)
	}
	if got := myWork.Processes.Items[0].StatusCounts; got != (domain.MyWorkProcessStatusCounts{Pending: 1}) {
		t.Fatalf("Process counts = %+v, want hidden In Progress Node excluded", got)
	}
}

func TestProcessWorkHTTPStepEditsInvalidateCachedWork(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666462"
	repo.EnsureCompany(companyID, "Process step cache")
	actor := mustLogicGateWorkHTTPUser(t, repo, companyID, "process-step-cache")
	gate, err := repo.CreateLogicGate(companyID, "Step cache Process")
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateProcessStep(store.ProcessStepCreateInput{CompanyID: companyID, LogicGateID: gate.LogicGateID, Name: "Review"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()
	for _, change := range []struct {
		name     string
		payload  map[string]any
		wantName string
		wantPos  int
	}{
		{name: "rename", payload: map[string]any{"name": "Approval"}, wantName: "Approval", wantPos: created.Step.Position},
		{name: "reorder", payload: map[string]any{"position": 500}, wantName: "Approval", wantPos: 500},
	} {
		t.Run(change.name, func(t *testing.T) {
			first, _ := requestProcessWorkWithETagForTest(t, handler, companyID, gate.LogicGateID, actor, "", http.StatusOK)
			etag := first.Header().Get("ETag")
			change.payload["company_id"] = companyID
			request := logicGateWorkV2Request(t, http.MethodPatch, "/v2/logic-gates/"+gate.LogicGateID+"/steps/"+created.Step.ProcessStepID, change.payload, actor, companyID)
			mutation := httptest.NewRecorder()
			handler.ServeHTTP(mutation, request)
			if mutation.Code != http.StatusOK {
				t.Fatalf("step %s = %d %s", change.name, mutation.Code, mutation.Body)
			}
			changed, work := requestProcessWorkWithETagForTest(t, handler, companyID, gate.LogicGateID, actor, etag, http.StatusOK)
			if etag == "" || changed.Header().Get("ETag") == etag || len(work.Steps) != 1 || work.Steps[0].Name != change.wantName || work.Steps[0].Position != change.wantPos {
				t.Fatalf("work after step %s = %+v ETag=%q", change.name, work, changed.Header().Get("ETag"))
			}
		})
	}
}

func requestProcessWorkWithETagForTest(t *testing.T, handler http.Handler, companyID, logicGateID string, actor domain.User, etag string, wantStatus int) (*httptest.ResponseRecorder, domain.LogicGateWorkView) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/v2/logic-gates/"+logicGateID+"/work?company_id="+companyID, nil)
	request = requestWithLogicGateWorkActorForTest(request, actor, companyID)
	if etag != "" {
		request.Header.Set("If-None-Match", etag)
	}
	record := httptest.NewRecorder()
	handler.ServeHTTP(record, request)
	if record.Code != wantStatus {
		t.Fatalf("GET Process work = %d %s, want %d", record.Code, record.Body, wantStatus)
	}
	var work domain.LogicGateWorkView
	if record.Code == http.StatusOK {
		if err := json.Unmarshal(record.Body.Bytes(), &work); err != nil {
			t.Fatal(err)
		}
	}
	return record, work
}
