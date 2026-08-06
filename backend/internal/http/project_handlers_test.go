package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestProjectScopedNodeCreateRequiresInitialAssignmentLogicGateEditAccess(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666421"
	repo.EnsureCompany(companyID, "Project Scoped Node Create Guard Co")
	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "project-scoped-node-editor")
	projectResult, err := repo.CreateProject(store.ProjectInput{
		CompanyID: companyID,
		Name:      "Guarded Project",
		Status:    store.ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Guarded Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions gate no access: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()
	projectID := projectResult.Project.ProjectID

	payload := map[string]any{
		"company_id": companyID,
		"title":      "Blocked project node",
		"initial_assignment": map[string]any{
			"logic_gate_id": logicGate.LogicGateID,
			"status":        store.LogicGateWorkStatusPending,
			"priority":      2,
		},
	}
	req := logicGateWorkV2Request(t, http.MethodPost, "/v1/projects/"+projectID+"/nodes", payload, editor, companyID)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("POST project node without gate edit status = %d body=%s, want 404", rr.Code, rr.Body.String())
	}
	relationships, err := repo.ListProjectRelationshipProjections(companyID, projectID)
	if err != nil {
		t.Fatalf("ListProjectRelationshipProjections after forbidden create: %v", err)
	}
	if len(relationships) != 0 {
		t.Fatalf("relationships after forbidden create = %+v, want none", relationships)
	}

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   editor.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions gate edit: %v", err)
	}
	payload["title"] = "Allowed project node"
	req = logicGateWorkV2Request(t, http.MethodPost, "/v1/projects/"+projectID+"/nodes", payload, editor, companyID)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("POST project node with gate edit status = %d body=%s, want 201", rr.Code, rr.Body.String())
	}
	relationships, err = repo.ListProjectRelationshipProjections(companyID, projectID)
	if err != nil {
		t.Fatalf("ListProjectRelationshipProjections after allowed create: %v", err)
	}
	if len(relationships) != 2 {
		t.Fatalf("relationships after allowed create = %+v, want node and implicit guarded gate rows", relationships)
	}

	payloadWithoutPriority := map[string]any{
		"company_id": companyID,
		"title":      "Allowed project node default priority",
		"initial_assignment": map[string]any{
			"logic_gate_id": logicGate.LogicGateID,
			"status":        store.LogicGateWorkStatusPending,
		},
	}
	req = logicGateWorkV2Request(t, http.MethodPost, "/v1/projects/"+projectID+"/nodes", payloadWithoutPriority, editor, companyID)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("POST project node without priority status = %d body=%s, want 201", rr.Code, rr.Body.String())
	}
	var createPayload struct {
		Node domain.Node `json:"node"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &createPayload); err != nil {
		t.Fatalf("decode project node create response: %v", err)
	}
	if createPayload.Node.Priority == nil || *createPayload.Node.Priority != store.ProjectScopedNodeDefaultPriority {
		t.Fatalf("created node priority = %+v, want %d", createPayload.Node.Priority, store.ProjectScopedNodeDefaultPriority)
	}
}

func TestProjectRelationshipsPOSTAssociatesExistingLogicGate(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666429"
	repo.EnsureCompany(companyID, "Project Logic Gate Link Co")
	editor := mustLogicGateWorkHTTPUser(t, repo, companyID, "project-logic-gate-link-editor")
	projectResult, err := repo.CreateProject(store.ProjectInput{
		CompanyID: companyID,
		Name:      "Linked Gate Project",
		Status:    store.ProjectDefaultStatus,
	})
	if err != nil || projectResult.Project == nil {
		t.Fatalf("CreateProject = %+v err=%v", projectResult, err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Existing Linked Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions gate no access: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()
	payload := map[string]any{
		"company_id":    companyID,
		"resource_type": store.EntityTypeLogicGate,
		"resource_id":   logicGate.LogicGateID,
	}
	requestPath := "/v1/projects/" + projectResult.Project.ProjectID + "/relationships"
	req := logicGateWorkV2Request(t, http.MethodPost, requestPath, payload, editor, companyID)
	rr := httptest.NewRecorder()
	server.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("POST existing Logic Gate relationship without edit access status = %d body=%s, want 404", rr.Code, rr.Body.String())
	}
	rows, err := repo.ListProjectRelationshipProjections(companyID, projectResult.Project.ProjectID)
	if err != nil || len(rows) != 0 {
		t.Fatalf("project relationships after denied attempt = %+v err=%v, want none", rows, err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeLogicGate,
		EntityID:         logicGate.LogicGateID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   editor.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions gate edit: %v", err)
	}
	req = logicGateWorkV2Request(t, http.MethodPost, requestPath, payload, editor, companyID)
	rr = httptest.NewRecorder()
	server.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("POST existing Logic Gate relationship status = %d body=%s, want 200", rr.Code, rr.Body.String())
	}
	var response struct {
		Relationship *domain.ProjectRelationshipProjection `json:"relationship"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("decode relationship response: %v body=%s", err, rr.Body.String())
	}
	if response.Relationship == nil ||
		response.Relationship.ResourceType != store.EntityTypeLogicGate ||
		response.Relationship.ResourceID != logicGate.LogicGateID {
		t.Fatalf("relationship = %+v, want existing Logic Gate", response.Relationship)
	}
	rows, err = repo.ListProjectRelationshipProjections(companyID, projectResult.Project.ProjectID)
	if err != nil || len(rows) != 1 || rows[0].ResourceID != logicGate.LogicGateID {
		t.Fatalf("project relationships = %+v err=%v, want one Logic Gate", rows, err)
	}
}

func TestProjectRelationshipsGETFiltersTargetsForViewer(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "66666666-6666-4666-8666-666666666422"
	repo.EnsureCompany(companyID, "Project Relationship HTTP Filter Co")
	viewer := mustLogicGateWorkHTTPUser(t, repo, companyID, "project-relationship-viewer")
	projectResult, err := repo.CreateProject(store.ProjectInput{
		CompanyID: companyID,
		Name:      "Relationship Filter Project",
		Status:    store.ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	visibleNode, err := repo.CreateNode(companyID, "Visible Project Node")
	if err != nil {
		t.Fatalf("CreateNode visible: %v", err)
	}
	hiddenNode, err := repo.CreateNode(companyID, "Hidden Project Node")
	if err != nil {
		t.Fatalf("CreateNode hidden: %v", err)
	}
	visibleGate, err := repo.CreateLogicGate(companyID, "Visible Project Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate visible: %v", err)
	}
	hiddenGate, err := repo.CreateLogicGate(companyID, "Hidden Project Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate hidden: %v", err)
	}
	priority := 1
	for _, assignment := range []struct {
		nodeID string
		gateID string
	}{
		{nodeID: visibleNode.NodeID, gateID: visibleGate.LogicGateID},
		{nodeID: hiddenNode.NodeID, gateID: hiddenGate.LogicGateID},
	} {
		if _, err := repo.AssignNodeToLogicGateStatus(store.LogicGateNodeAssignmentInput{
			CompanyID: companyID, LogicGateID: assignment.gateID, NodeID: assignment.nodeID,
			Priority: &priority, PrioritySet: true,
		}); err != nil {
			t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
		}
	}
	projectID := projectResult.Project.ProjectID
	upsertProjectRelationshipForHTTPTest(t, repo, companyID, projectID, store.EntityTypeNode, visibleNode.NodeID)
	upsertProjectRelationshipForHTTPTest(t, repo, companyID, projectID, store.EntityTypeNode, hiddenNode.NodeID)
	hideProjectRelationshipTargetForHTTPTest(t, repo, companyID, store.EntityTypeNode, hiddenNode.NodeID)
	hideProjectRelationshipTargetForHTTPTest(t, repo, companyID, store.EntityTypeLogicGate, hiddenGate.LogicGateID)

	server := NewServer(repo)
	defer server.Close()
	req := httptest.NewRequest(http.MethodGet, "/v1/projects/"+projectID+"/relationships?company_id="+companyID, nil)
	req = requestWithLogicGateWorkActorForTest(req, viewer, companyID)
	rr := httptest.NewRecorder()
	server.Routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET project relationships status = %d body=%s, want 200", rr.Code, rr.Body.String())
	}
	var payload struct {
		ProjectID     string                                 `json:"project_id"`
		Relationships []domain.ProjectRelationshipProjection `json:"relationships"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode relationships response: %v body=%s", err, rr.Body.String())
	}
	if payload.ProjectID != projectID {
		t.Fatalf("response project_id = %q, want %q", payload.ProjectID, projectID)
	}
	assertProjectRelationshipResourcesForHTTPTest(t, payload.Relationships, []string{visibleNode.NodeID, visibleGate.LogicGateID})
}

func upsertProjectRelationshipForHTTPTest(t *testing.T, repo *store.MemoryRepo, companyID, projectID, resourceType, resourceID string) {
	t.Helper()
	if _, err := repo.UpsertProjectRelationship(store.ProjectRelationshipInput{
		CompanyID:    companyID,
		ProjectID:    projectID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship %s %s: %v", resourceType, resourceID, err)
	}
}

func hideProjectRelationshipTargetForHTTPTest(t *testing.T, repo *store.MemoryRepo, companyID, entityType, entityID string) {
	t.Helper()
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       entityType,
		EntityID:         entityID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions hide %s %s: %v", entityType, entityID, err)
	}
}

func assertProjectRelationshipResourcesForHTTPTest(t *testing.T, relationships []domain.ProjectRelationshipProjection, wantResourceIDs []string) {
	t.Helper()
	got := make(map[string]bool, len(relationships))
	for _, relationship := range relationships {
		got[relationship.ResourceID] = true
	}
	if len(got) != len(wantResourceIDs) {
		t.Fatalf("relationship resource IDs = %+v from %+v, want %v", got, relationships, wantResourceIDs)
	}
	for _, resourceID := range wantResourceIDs {
		if !got[resourceID] {
			t.Fatalf("relationship resource IDs = %+v from %+v, missing %s", got, relationships, resourceID)
		}
	}
}

func TestWriteProjectMutationErrorReportsNodeAlreadyInAnotherProject(t *testing.T) {
	server := &Server{}
	rr := httptest.NewRecorder()
	server.writeProjectMutationError(rr, store.ErrProjectNodeInAnotherProject, "failed_to_save_project_relationship")

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s, want 409", rr.Code, rr.Body.String())
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v body=%s", err, rr.Body.String())
	}
	if payload.Error != "project_node_already_in_another_project" {
		t.Fatalf("error = %q, want project_node_already_in_another_project", payload.Error)
	}
}
