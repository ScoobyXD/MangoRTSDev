package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestLogicGateRaciAddRemoveCommandAPI(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	repo := backing
	server := NewServer(repo)
	companyID := "company-raci-command-api"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	otherCompanyID := "company-raci-command-api-other"
	repo.EnsureCompany(companyID, "RACI Command API Company")
	repo.EnsureCompany(otherCompanyID, "Other RACI Command API Company")
	logicGate, err := repo.CreateLogicGate(companyID, "API Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	responsible, err := repo.UpsertAuthUser("raci-command-api-responsible", "responsible-command-api@example.com", "Responsible API")
	if err != nil {
		t.Fatalf("UpsertAuthUser responsible: %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-command-api-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership responsible: %v", err)
	}
	accountable, err := repo.UpsertAuthUser("raci-command-api-accountable", "accountable-command-api@example.com", "Accountable API")
	if err != nil {
		t.Fatalf("UpsertAuthUser accountable: %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-command-api-accountable", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership accountable: %v", err)
	}
	outsider, err := repo.UpsertAuthUser("raci-command-api-outsider", "outsider-command-api@example.com", "Outsider API")
	if err != nil {
		t.Fatalf("UpsertAuthUser outsider: %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-command-api-outsider", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership outsider: %v", err)
	}

	addBody := map[string]any{
		"company_id": companyID,
		"assignments": []map[string]string{
			{"role": domain.LogicGateRaciRoleResponsible, "user_id": responsible.UserID},
			{"role": domain.LogicGateRaciRoleResponsible, "user_id": responsible.UserID},
		},
	}
	add := postLogicGateRaciCommandForTest(t, handler, logicGate.LogicGateID, store.LogicGateRaciCommandAdd, addBody)
	if add.Code != http.StatusOK {
		t.Fatalf("POST raci add status = %d body=%s", add.Code, add.Body.String())
	}
	addPayload := decodeLogicGateRaciCommandPayloadForTest(t, add)
	if !addPayload.Changed || addPayload.Operation != store.LogicGateRaciCommandAdd || len(addPayload.Assignments) != 1 {
		t.Fatalf("add payload = %+v, want changed single assignment", addPayload)
	}
	assertHTTPRaciWorkspaceEventCount(t, repo, companyID, 1)
	assertHTTPWorkspaceReadVersion(t, repo, companyID, "logic-gates", 1)
	responsibleNotifications, err := repo.ListNotifications(store.NotificationListInput{UserID: responsible.UserID, CompanyID: companyID, Limit: 10})
	if err != nil {
		t.Fatalf("ListNotifications responsible: %v", err)
	}
	if len(responsibleNotifications) != 1 || responsibleNotifications[0].Type != domain.NotificationEventLogicGateRaciUpdated || responsibleNotifications[0].Role != domain.LogicGateRaciRoleResponsible {
		t.Fatalf("responsible notifications after add = %+v, want one projected RACI notification", responsibleNotifications)
	}

	duplicateAdd := postLogicGateRaciCommandForTest(t, handler, logicGate.LogicGateID, store.LogicGateRaciCommandAdd, addBody)
	if duplicateAdd.Code != http.StatusOK {
		t.Fatalf("duplicate POST raci add status = %d body=%s", duplicateAdd.Code, duplicateAdd.Body.String())
	}
	duplicateAddPayload := decodeLogicGateRaciCommandPayloadForTest(t, duplicateAdd)
	if duplicateAddPayload.Changed || len(duplicateAddPayload.Assignments) != 1 {
		t.Fatalf("duplicate add payload = %+v, want no-op with existing assignment", duplicateAddPayload)
	}
	assertHTTPRaciWorkspaceEventCount(t, repo, companyID, 1)
	assertHTTPWorkspaceReadVersion(t, repo, companyID, "logic-gates", 1)
	responsibleNotifications, err = repo.ListNotifications(store.NotificationListInput{UserID: responsible.UserID, CompanyID: companyID, Limit: 10})
	if err != nil {
		t.Fatalf("ListNotifications responsible after duplicate: %v", err)
	}
	if len(responsibleNotifications) != 1 {
		t.Fatalf("responsible notifications after duplicate add = %+v, want no duplicate", responsibleNotifications)
	}

	removeBody := map[string]any{
		"company_id": companyID,
		"role":       domain.LogicGateRaciRoleResponsible,
		"user_id":    responsible.UserID,
	}
	removed := postLogicGateRaciCommandForTest(t, handler, logicGate.LogicGateID, store.LogicGateRaciCommandRemove, removeBody)
	if removed.Code != http.StatusOK {
		t.Fatalf("POST raci remove status = %d body=%s", removed.Code, removed.Body.String())
	}
	removedPayload := decodeLogicGateRaciCommandPayloadForTest(t, removed)
	if !removedPayload.Changed || removedPayload.Operation != store.LogicGateRaciCommandRemove || len(removedPayload.Assignments) != 0 {
		t.Fatalf("remove payload = %+v, want changed empty assignments", removedPayload)
	}
	assertHTTPRaciWorkspaceEventCount(t, repo, companyID, 2)
	assertHTTPWorkspaceReadVersion(t, repo, companyID, "logic-gates", 2)

	missingRemove := postLogicGateRaciCommandForTest(t, handler, logicGate.LogicGateID, store.LogicGateRaciCommandRemove, removeBody)
	if missingRemove.Code != http.StatusOK {
		t.Fatalf("missing POST raci remove status = %d body=%s", missingRemove.Code, missingRemove.Body.String())
	}
	missingRemovePayload := decodeLogicGateRaciCommandPayloadForTest(t, missingRemove)
	if missingRemovePayload.Changed || len(missingRemovePayload.Assignments) != 0 {
		t.Fatalf("missing remove payload = %+v, want intentional no-op", missingRemovePayload)
	}
	assertHTTPRaciWorkspaceEventCount(t, repo, companyID, 2)
	assertHTTPWorkspaceReadVersion(t, repo, companyID, "logic-gates", 2)

	fullReplaceBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"assignments": []map[string]string{
			{"role": domain.LogicGateRaciRoleAccountable, "user_id": accountable.UserID},
		},
	})
	fullReplaceReq := httptest.NewRequest(http.MethodPut, "/v1/logic-gates/"+logicGate.LogicGateID+"/raci", bytes.NewReader(fullReplaceBody))
	fullReplaceReq.Header.Set("Content-Type", "application/json")
	fullReplaceRec := httptest.NewRecorder()
	handler.ServeHTTP(fullReplaceRec, fullReplaceReq)
	if fullReplaceRec.Code != http.StatusOK {
		t.Fatalf("PUT raci full replace status = %d body=%s", fullReplaceRec.Code, fullReplaceRec.Body.String())
	}
	var fullReplacePayload struct {
		Assignments []domain.LogicGateRaciAssignment `json:"raci_assignments"`
	}
	if err := json.NewDecoder(fullReplaceRec.Body).Decode(&fullReplacePayload); err != nil {
		t.Fatalf("decode full replace payload: %v", err)
	}
	if len(fullReplacePayload.Assignments) != 1 || fullReplacePayload.Assignments[0].Role != domain.LogicGateRaciRoleAccountable {
		t.Fatalf("full replace payload = %+v, want accountable assignment", fullReplacePayload.Assignments)
	}
	assertHTTPRaciWorkspaceEventCount(t, repo, companyID, 3)
	assertHTTPWorkspaceReadVersion(t, repo, companyID, "logic-gates", 3)

	invalidRole := postLogicGateRaciCommandForTest(t, handler, logicGate.LogicGateID, store.LogicGateRaciCommandAdd, map[string]any{
		"company_id": companyID,
		"role":       "owner",
		"user_id":    responsible.UserID,
	})
	if invalidRole.Code != http.StatusBadRequest || !strings.Contains(invalidRole.Body.String(), "invalid_raci_assignments") {
		t.Fatalf("invalid role status = %d body=%s, want invalid_raci_assignments", invalidRole.Code, invalidRole.Body.String())
	}
	outsiderAdd := postLogicGateRaciCommandForTest(t, handler, logicGate.LogicGateID, store.LogicGateRaciCommandAdd, map[string]any{
		"company_id": companyID,
		"role":       domain.LogicGateRaciRoleResponsible,
		"user_id":    outsider.UserID,
	})
	if outsiderAdd.Code != http.StatusBadRequest || !strings.Contains(outsiderAdd.Body.String(), "raci_user_not_in_company") {
		t.Fatalf("outsider add status = %d body=%s, want raci_user_not_in_company", outsiderAdd.Code, outsiderAdd.Body.String())
	}
	assertHTTPRaciWorkspaceEventCount(t, repo, companyID, 3)
}

type logicGateRaciCommandPayloadForTest struct {
	Operation   string                           `json:"operation"`
	Changed     bool                             `json:"changed"`
	Assignments []domain.LogicGateRaciAssignment `json:"raci_assignments"`
}

func postLogicGateRaciCommandForTest(t *testing.T, handler http.Handler, logicGateID, operation string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/v1/logic-gates/"+logicGateID+"/raci/"+operation, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decodeLogicGateRaciCommandPayloadForTest(t *testing.T, rec *httptest.ResponseRecorder) logicGateRaciCommandPayloadForTest {
	t.Helper()
	var payload logicGateRaciCommandPayloadForTest
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode command payload: %v", err)
	}
	if payload.Assignments == nil {
		payload.Assignments = []domain.LogicGateRaciAssignment{}
	}
	return payload
}

func assertHTTPRaciWorkspaceEventCount(t *testing.T, repo store.Repository, companyID string, want int) {
	t.Helper()
	events, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 20})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(events) != want {
		t.Fatalf("workspace events len = %d, want %d: %+v", len(events), want, events)
	}
}

func assertHTTPWorkspaceReadVersion(t *testing.T, repo store.Repository, companyID, scope string, want int64) {
	t.Helper()
	version, found, err := repo.CurrentWorkspaceReadVersion(store.WorkspaceReadVersionQuery{CompanyID: companyID, Scope: scope})
	if err != nil {
		t.Fatalf("CurrentWorkspaceReadVersion: %v", err)
	}
	if !found || version != want {
		t.Fatalf("workspace read version %s = %d found=%v, want %d found=true", scope, version, found, want)
	}
}
