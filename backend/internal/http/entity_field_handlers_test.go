package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestEntityFieldHandlersCreateAssignAndList(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "75111111-1111-4111-8111-111111111111"
	projectID := "75222222-2222-4222-8222-222222222222"
	repo.EnsureCompany(companyID, "Entity Field HTTP Co")
	user := mustLogicGateWorkHTTPUser(t, repo, companyID, "entity-field-admin")
	if _, err := repo.CreateProject(store.ProjectInput{
		CompanyID: companyID,
		ProjectID: projectID,
		Name:      "Project with FX",
		Status:    store.ProjectDefaultStatus,
	}); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()
	handler := server.Routes()

	createRequest := entityFieldRequest(t, http.MethodPost, "/v1/entity-fields", map[string]any{
		"company_id": companyID,
		"name":       "FX",
		"color":      "#6366f1",
	}, user, companyID)
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("POST entity field status = %d body=%s, want 201", createResponse.Code, createResponse.Body.String())
	}
	var created struct {
		Field domain.EntityField `json:"field"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatalf("decode create field response: %v", err)
	}
	if created.Field.Name != "FX" || created.Field.FieldID == "" {
		t.Fatalf("created field = %+v, want FX with ID", created.Field)
	}

	assignRequest := entityFieldRequest(t, http.MethodPut, "/v1/entity-fields/assignments", map[string]any{
		"company_id":    companyID,
		"resource_type": store.EntityTypeProject,
		"resource_id":   projectID,
		"field_ids":     []string{created.Field.FieldID},
	}, user, companyID)
	assignResponse := httptest.NewRecorder()
	handler.ServeHTTP(assignResponse, assignRequest)
	if assignResponse.Code != http.StatusOK {
		t.Fatalf("PUT entity field assignments status = %d body=%s, want 200", assignResponse.Code, assignResponse.Body.String())
	}
	project, err := repo.GetProject(companyID, projectID)
	if err != nil {
		t.Fatalf("GetProject after assignment: %v", err)
	}
	if len(project.Fields) != 1 || project.Fields[0].FieldID != created.Field.FieldID {
		t.Fatalf("project fields = %+v, want created field", project.Fields)
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/v1/entity-fields?company_id="+companyID, nil)
	listRequest = requestWithLogicGateWorkActorForTest(listRequest, user, companyID)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("GET entity fields status = %d body=%s, want 200", listResponse.Code, listResponse.Body.String())
	}
	var listed struct {
		Fields []domain.EntityField `json:"fields"`
	}
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatalf("decode list fields response: %v", err)
	}
	if len(listed.Fields) != 1 || listed.Fields[0].AssignmentCount != 1 {
		t.Fatalf("listed fields = %+v, want FX with one assignment", listed.Fields)
	}
}

func TestEntityFieldAssignmentRequiresEditableTarget(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "75333333-3333-4333-8333-333333333333"
	repo.EnsureCompany(companyID, "Entity Field Permission Co")
	user := mustLogicGateWorkHTTPUser(t, repo, companyID, "entity-field-member")
	projectID := "75555555-5555-4555-8555-555555555555"
	if _, err := repo.CreateProject(store.ProjectInput{
		CompanyID: companyID,
		ProjectID: projectID,
		Name:      "Restricted project",
		Status:    store.ProjectDefaultStatus,
	}); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeProject,
		EntityID:         projectID,
		DefaultAccess:    store.ResourceDefaultAccessNoAccess,
		DefaultAccessSet: true,
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}
	field, err := repo.CreateEntityField(store.EntityFieldInput{
		CompanyID: companyID,
		FieldID:   "75444444-4444-4444-8444-444444444444",
		Name:      "AX",
	})
	if err != nil {
		t.Fatalf("CreateEntityField: %v", err)
	}

	server := NewServer(repo)
	defer server.Close()
	request := entityFieldRequest(t, http.MethodPut, "/v1/entity-fields/assignments", map[string]any{
		"company_id":    companyID,
		"resource_type": store.EntityTypeProject,
		"resource_id":   projectID,
		"field_ids":     []string{field.FieldID},
	}, user, companyID)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("PUT assignment for restricted target status = %d body=%s, want 404", response.Code, response.Body.String())
	}
}

func entityFieldRequest(t *testing.T, method, path string, payload any, user domain.User, companyID string) *http.Request {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal entity field payload: %v", err)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	return requestWithLogicGateWorkActorForTest(request, user, companyID)
}
