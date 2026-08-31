package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestMyWorkEndpointDerivesSubjectAndReturnsRequestedTypedSections(t *testing.T) {
	base := store.NewMemoryRepo()
	companyID := "20000000-0000-4000-8000-000000000001"
	base.EnsureCompany(companyID, "My Work HTTP Company")
	user, err := base.UpsertAuthUser("my-work-http-user", "my-work-http@example.com", "My Work HTTP")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := base.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	subject, err := base.UpsertAuthUser("my-work-http-subject", "my-work-http-subject@example.com", "My Work Subject")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := base.AddCompanyMembership(subject.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &recordingMyWorkRepo{Repository: base}
	handler := NewServer(repo).Routes()

	initial := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID, nil)
	request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(initial, request)
	if initial.Code != http.StatusOK {
		t.Fatalf("initial status = %d body=%s", initial.Code, initial.Body.String())
	}
	if repo.query.UserID != user.UserID || repo.query.ViewerUserID != user.UserID || repo.query.Role != "" || repo.query.Limit != store.MyWorkDefaultLimit || repo.query.Section != "" {
		t.Fatalf("initial repository query = %+v", repo.query)
	}
	var initialPayload map[string]json.RawMessage
	if err := json.Unmarshal(initial.Body.Bytes(), &initialPayload); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"company_id", "user_id", "action_items", "nodes", "processes", "projects"} {
		if _, ok := initialPayload[key]; !ok {
			t.Fatalf("initial response missing %q: %s", key, initial.Body.String())
		}
	}

	sectionOnly := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID+"&section=processes&role=consulted&limit=1", nil)
	request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(sectionOnly, request)
	if sectionOnly.Code != http.StatusOK {
		t.Fatalf("section status = %d body=%s", sectionOnly.Code, sectionOnly.Body.String())
	}
	if repo.query.Section != store.MyWorkSectionProcesses || repo.query.Role != domain.RACIRoleConsulted || repo.query.Limit != 1 {
		t.Fatalf("section repository query = %+v", repo.query)
	}
	var sectionPayload map[string]json.RawMessage
	if err := json.Unmarshal(sectionOnly.Body.Bytes(), &sectionPayload); err != nil {
		t.Fatal(err)
	}
	if _, ok := sectionPayload["processes"]; !ok {
		t.Fatalf("section response missing processes: %s", sectionOnly.Body.String())
	}
	for _, absent := range []string{"action_items", "nodes", "projects"} {
		if _, ok := sectionPayload[absent]; ok {
			t.Fatalf("section response unexpectedly contains %q: %s", absent, sectionOnly.Body.String())
		}
	}

	selectedSubject := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID+"&subject_user_id="+subject.UserID+"&section=projects", nil)
	request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(selectedSubject, request)
	if selectedSubject.Code != http.StatusOK {
		t.Fatalf("selected subject status = %d body=%s", selectedSubject.Code, selectedSubject.Body.String())
	}
	if repo.query.UserID != subject.UserID || repo.query.ViewerUserID != user.UserID || repo.query.Section != store.MyWorkSectionProjects {
		t.Fatalf("selected subject repository query = %+v", repo.query)
	}
	var selectedPayload domain.MyWorkResponse
	if err := json.Unmarshal(selectedSubject.Body.Bytes(), &selectedPayload); err != nil {
		t.Fatal(err)
	}
	if selectedPayload.UserID != subject.UserID {
		t.Fatalf("selected subject response user_id = %q, want %q", selectedPayload.UserID, subject.UserID)
	}

	grouped := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID+"&section=nodes&grouping=due_date:desc,priority:asc", nil)
	request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(grouped, request)
	if grouped.Code != http.StatusOK {
		t.Fatalf("grouped status = %d body=%s", grouped.Code, grouped.Body.String())
	}
	if repo.query.Section != store.MyWorkSectionNodes || repo.query.Grouping != "due_date:desc,priority:asc" {
		t.Fatalf("grouped repository query = %+v", repo.query)
	}

	nodeRole := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID+"&section=nodes&role=informed", nil)
	request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(nodeRole, request)
	if nodeRole.Code != http.StatusOK {
		t.Fatalf("Node role status = %d body=%s", nodeRole.Code, nodeRole.Body.String())
	}
	if repo.query.Section != store.MyWorkSectionNodes || repo.query.Role != domain.RACIRoleInformed {
		t.Fatalf("Node role repository query = %+v", repo.query)
	}

	delegated := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID+"&section=action_items&perspective=delegated&grouping=color:asc,person_in_charge:asc,huddle_process:asc&ordering=completion_due_date:desc", nil)
	request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(delegated, request)
	if delegated.Code != http.StatusOK {
		t.Fatalf("Delegated status = %d body=%s", delegated.Code, delegated.Body.String())
	}
	if repo.query.Section != store.MyWorkSectionActionItems || repo.query.Perspective != store.MyWorkActionItemPerspectiveDelegated || repo.query.Grouping != store.MyWorkDefaultDelegatedActionItemGrouping || repo.query.Ordering != "completion_due_date:desc" {
		t.Fatalf("Delegated repository query = %+v", repo.query)
	}

	history := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID+"&section=action_items&history=true", nil)
	request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(history, request)
	if history.Code != http.StatusOK {
		t.Fatalf("history status = %d body=%s", history.Code, history.Body.String())
	}
	if repo.query.Section != store.MyWorkSectionActionItems || !repo.query.History || repo.query.Grouping != "" || repo.query.Ordering != "" {
		t.Fatalf("history repository query = %+v", repo.query)
	}
}

func TestMyWorkEndpointRejectsSubjectSpoofingAndInvalidSectionInputs(t *testing.T) {
	base := store.NewMemoryRepo()
	companyID := "20000000-0000-4000-8000-000000000002"
	base.EnsureCompany(companyID, "My Work Validation Company")
	user, err := base.UpsertAuthUser("my-work-validation-user", "validation@example.com", "Validation")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := base.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(base).Routes()
	malformedDateCursorPayload, _ := json.Marshal(map[string]any{
		"v": 2, "section": store.MyWorkSectionNodes, "role": domain.RACIRoleResponsible, "grouping": store.MyWorkDefaultNodeGrouping, "group_int": 1, "date": "not-a-date",
		"resource_id": "30000000-0000-4000-8000-000000000001",
	})
	malformedDateCursor := base64.RawURLEncoding.EncodeToString(malformedDateCursorPayload)
	cases := []string{
		"/v1/my-work?company_id=" + companyID + "&user_id=" + user.UserID,
		"/v1/my-work?company_id=" + companyID + "&target_user_id=",
		"/v1/my-work?company_id=" + companyID + "&subject_user_id=",
		"/v1/my-work?company_id=" + companyID + "&subject_user_id=not-a-uuid",
		"/v1/my-work?company_id=" + companyID + "&subject_user_id=" + user.UserID + "&subject_user_id=" + user.UserID,
		"/v1/my-work?company_id=" + companyID + "&section=unknown",
		"/v1/my-work?company_id=" + companyID + "&section=action_items&role=responsible",
		"/v1/my-work?company_id=" + companyID + "&section=nodes&role=unknown",
		"/v1/my-work?company_id=" + companyID + "&perspective=mine",
		"/v1/my-work?company_id=" + companyID + "&section=nodes&perspective=mine",
		"/v1/my-work?company_id=" + companyID + "&section=action_items&perspective=unknown",
		"/v1/my-work?company_id=" + companyID + "&cursor=abc",
		"/v1/my-work?company_id=" + companyID + "&section=nodes&cursor=" + malformedDateCursor,
		"/v1/my-work?company_id=" + companyID + "&grouping=none",
		"/v1/my-work?company_id=" + companyID + "&section=processes&grouping=none",
		"/v1/my-work?company_id=" + companyID + "&section=projects&grouping=none",
		"/v1/my-work?company_id=" + companyID + "&section=nodes&grouping=",
		"/v1/my-work?company_id=" + companyID + "&section=nodes&grouping=priority:up",
		"/v1/my-work?company_id=" + companyID + "&section=nodes&grouping=priority:asc,priority:desc",
		"/v1/my-work?company_id=" + companyID + "&ordering=none",
		"/v1/my-work?company_id=" + companyID + "&section=nodes&ordering=none",
		"/v1/my-work?company_id=" + companyID + "&section=action_items&ordering=",
		"/v1/my-work?company_id=" + companyID + "&section=action_items&ordering=color:up",
		"/v1/my-work?company_id=" + companyID + "&section=action_items&grouping=color:asc&ordering=color:desc",
		"/v1/my-work?company_id=" + companyID + "&history=true",
		"/v1/my-work?company_id=" + companyID + "&section=processes&history=true",
		"/v1/my-work?company_id=" + companyID + "&section=nodes&history=maybe",
		"/v1/my-work?company_id=" + companyID + "&section=nodes&history=true&grouping=due_date:desc",
		"/v1/my-work?company_id=" + companyID + "&section=action_items&history=true&ordering=none",
		"/v1/my-work?company_id=" + companyID + "&unknown=value",
	}
	for _, path := range cases {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("GET %s status = %d, want 400 body=%s", path, recorder.Code, recorder.Body.String())
		}
	}

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID, nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want 401", unauthorized.Code)
	}

	method := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/my-work?company_id="+companyID, nil)
	request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(method, request)
	if method.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", method.Code)
	}
}

func TestMyWorkEndpointRequiresSelectedSubjectInCurrentCompany(t *testing.T) {
	base := store.NewMemoryRepo()
	companyID := "20000000-0000-4000-8000-000000000004"
	otherCompanyID := "20000000-0000-4000-8000-000000000005"
	base.EnsureCompany(companyID, "My Work Subject Company")
	base.EnsureCompany(otherCompanyID, "Other Subject Company")
	viewer, err := base.UpsertAuthUser("my-work-subject-viewer", "subject-viewer@example.com", "Subject Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := base.AddCompanyMembership(viewer.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	otherCompanyUser, err := base.UpsertAuthUser("my-work-other-company-subject", "other-subject@example.com", "Other Subject")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := base.AddCompanyMembership(otherCompanyUser.CognitoSubject, otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &recordingMyWorkRepo{Repository: base}
	handler := NewServer(repo).Routes()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID+"&subject_user_id="+otherCompanyUser.UserID, nil)
	request = workItemInboxReadRequestWithActor(request, viewer.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("cross-company subject status = %d, want 404 body=%s", recorder.Code, recorder.Body.String())
	}
	if repo.query.CompanyID != "" || repo.query.UserID != "" || repo.query.ViewerUserID != "" {
		t.Fatalf("repository received rejected subject query = %+v", repo.query)
	}
}

func TestMyWorkEndpointFailsClosedWhenRepositoryFails(t *testing.T) {
	base := store.NewMemoryRepo()
	companyID := "20000000-0000-4000-8000-000000000003"
	base.EnsureCompany(companyID, "My Work Failure Company")
	user, err := base.UpsertAuthUser("my-work-failure-user", "failure@example.com", "Failure")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := base.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	repo := &recordingMyWorkRepo{Repository: base, err: errors.New("permission resolution failed")}
	handler := NewServer(repo).Routes()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/my-work?company_id="+companyID, nil)
	request = workItemInboxReadRequestWithActor(request, user.UserID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 body=%s", recorder.Code, recorder.Body.String())
	}
	if json.Valid(recorder.Body.Bytes()) && containsMyWorkSectionPayload(recorder.Body.Bytes()) {
		t.Fatalf("error response leaked partial My Work sections: %s", recorder.Body.String())
	}
}

type recordingMyWorkRepo struct {
	store.Repository
	query store.MyWorkQuery
	err   error
}

func (r *recordingMyWorkRepo) GetMyWork(ctx context.Context, query store.MyWorkQuery) (domain.MyWorkResponse, error) {
	r.query = query
	if err := ctx.Err(); err != nil {
		return domain.MyWorkResponse{}, err
	}
	if r.err != nil {
		return domain.MyWorkResponse{}, r.err
	}
	response := domain.MyWorkResponse{CompanyID: query.CompanyID, UserID: query.UserID}
	if query.Section == "" || query.Section == store.MyWorkSectionActionItems {
		perspective := query.Perspective
		if perspective == "" {
			perspective = store.MyWorkActionItemPerspectiveMine
		}
		response.ActionItems = &domain.MyWorkActionItemPage{Perspective: perspective, Items: []domain.MyWorkActionItem{}}
	}
	if query.Section == "" || query.Section == store.MyWorkSectionNodes {
		role := query.Role
		if role == "" {
			role = domain.RACIRoleResponsible
		}
		response.Nodes = &domain.MyWorkNodePage{Role: role, Items: []domain.MyWorkNode{}}
	}
	if query.Section == "" || query.Section == store.MyWorkSectionProcesses {
		role := query.Role
		if role == "" {
			role = domain.RACIRoleResponsible
		}
		response.Processes = &domain.MyWorkProcessPage{Role: role, Items: []domain.MyWorkProcess{}}
	}
	if query.Section == "" || query.Section == store.MyWorkSectionProjects {
		response.Projects = &domain.MyWorkProjectPage{Items: []domain.MyWorkProject{}}
	}
	return response, nil
}

func containsMyWorkSectionPayload(raw []byte) bool {
	var payload map[string]json.RawMessage
	if json.Unmarshal(raw, &payload) != nil {
		return false
	}
	for _, key := range []string{"action_items", "nodes", "processes", "projects"} {
		if _, ok := payload[key]; ok {
			return true
		}
	}
	return false
}
