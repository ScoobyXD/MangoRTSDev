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

func TestLogicGateGVICAddRemoveCommandAPI(t *testing.T) {
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
		"gvic_assignments": []map[string]string{
			{"role": domain.GVICRoleGenerated, "principal_type": store.EntityPermissionSubjectUser, "principal_id": responsible.UserID},
			{"role": domain.GVICRoleGenerated, "principal_type": store.EntityPermissionSubjectUser, "principal_id": responsible.UserID},
		},
	}
	add := postResourceGVICCommandForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, store.GVICAssignmentCommandAdd, addBody)
	if add.Code != http.StatusOK {
		t.Fatalf("POST GVIC add status = %d body=%s", add.Code, add.Body.String())
	}
	addPayload := decodeResourceGVICCommandPayloadForTest(t, add)
	if !addPayload.Changed || addPayload.Operation != store.GVICAssignmentCommandAdd || len(addPayload.Assignments) != 1 || len(addPayload.EffectiveAssignments) != 1 {
		t.Fatalf("add payload = %+v, want changed single assignment", addPayload)
	}
	assertHTTPGVICEventRowCount(t, repo, companyID, 1)

	duplicateAdd := postResourceGVICCommandForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, store.GVICAssignmentCommandAdd, addBody)
	if duplicateAdd.Code != http.StatusOK {
		t.Fatalf("duplicate POST GVIC add status = %d body=%s", duplicateAdd.Code, duplicateAdd.Body.String())
	}
	duplicateAddPayload := decodeResourceGVICCommandPayloadForTest(t, duplicateAdd)
	if duplicateAddPayload.Changed || len(duplicateAddPayload.Assignments) != 1 {
		t.Fatalf("duplicate add payload = %+v, want no-op with existing assignment", duplicateAddPayload)
	}
	assertHTTPGVICEventRowCount(t, repo, companyID, 1)

	removeBody := map[string]any{
		"company_id": companyID,
		"gvic_assignments": []map[string]string{{
			"role":           domain.GVICRoleGenerated,
			"principal_type": store.EntityPermissionSubjectUser,
			"principal_id":   responsible.UserID,
		}},
	}
	removed := postResourceGVICCommandForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, store.GVICAssignmentCommandRemove, removeBody)
	if removed.Code != http.StatusOK {
		t.Fatalf("POST GVIC remove status = %d body=%s", removed.Code, removed.Body.String())
	}
	removedPayload := decodeResourceGVICCommandPayloadForTest(t, removed)
	if !removedPayload.Changed || removedPayload.Operation != store.GVICAssignmentCommandRemove || len(removedPayload.Assignments) != 0 || len(removedPayload.EffectiveAssignments) != 0 {
		t.Fatalf("remove payload = %+v, want changed empty assignments", removedPayload)
	}
	assertHTTPGVICEventRowCount(t, repo, companyID, 2)

	missingRemove := postResourceGVICCommandForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, store.GVICAssignmentCommandRemove, removeBody)
	if missingRemove.Code != http.StatusOK {
		t.Fatalf("missing POST GVIC remove status = %d body=%s", missingRemove.Code, missingRemove.Body.String())
	}
	missingRemovePayload := decodeResourceGVICCommandPayloadForTest(t, missingRemove)
	if missingRemovePayload.Changed || len(missingRemovePayload.Assignments) != 0 {
		t.Fatalf("missing remove payload = %+v, want intentional no-op", missingRemovePayload)
	}
	assertHTTPGVICEventRowCount(t, repo, companyID, 2)

	fullReplaceBody, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"gvic_assignments": []map[string]string{
			{"role": domain.GVICRoleVerified, "principal_type": store.EntityPermissionSubjectUser, "principal_id": accountable.UserID},
		},
	})
	fullReplaceReq := httptest.NewRequest(http.MethodPut, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/gvic", bytes.NewReader(fullReplaceBody))
	fullReplaceReq.Header.Set("Content-Type", "application/json")
	fullReplaceRec := httptest.NewRecorder()
	handler.ServeHTTP(fullReplaceRec, fullReplaceReq)
	if fullReplaceRec.Code != http.StatusOK {
		t.Fatalf("PUT GVIC full replace status = %d body=%s", fullReplaceRec.Code, fullReplaceRec.Body.String())
	}
	fullReplacePayload := decodeResourceGVICCommandPayloadForTest(t, fullReplaceRec)
	if len(fullReplacePayload.Assignments) != 1 || fullReplacePayload.Assignments[0].Role != domain.GVICRoleVerified {
		t.Fatalf("full replace payload = %+v, want accountable assignment", fullReplacePayload.Assignments)
	}
	assertHTTPGVICEventRowCount(t, repo, companyID, 3)

	invalidRole := postResourceGVICCommandForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, store.GVICAssignmentCommandAdd, map[string]any{
		"company_id": companyID,
		"gvic_assignments": []map[string]string{{
			"role":           "owner",
			"principal_type": store.EntityPermissionSubjectUser,
			"principal_id":   responsible.UserID,
		}},
	})
	if invalidRole.Code != http.StatusBadRequest || !strings.Contains(invalidRole.Body.String(), "invalid_gvic_assignments") {
		t.Fatalf("invalid role status = %d body=%s, want invalid_gvic_assignments", invalidRole.Code, invalidRole.Body.String())
	}
	legacyRole := postResourceGVICCommandForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, store.GVICAssignmentCommandAdd, map[string]any{
		"company_id": companyID,
		"gvic_assignments": []map[string]string{{
			"role":           "responsible",
			"principal_type": store.EntityPermissionSubjectUser,
			"principal_id":   responsible.UserID,
		}},
	})
	if legacyRole.Code != http.StatusBadRequest || !strings.Contains(legacyRole.Body.String(), "invalid_gvic_assignments") {
		t.Fatalf("legacy role status = %d body=%s, want invalid_gvic_assignments", legacyRole.Code, legacyRole.Body.String())
	}
	outsiderAdd := postResourceGVICCommandForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, store.GVICAssignmentCommandAdd, map[string]any{
		"company_id": companyID,
		"gvic_assignments": []map[string]string{{
			"role":           domain.GVICRoleGenerated,
			"principal_type": store.EntityPermissionSubjectUser,
			"principal_id":   outsider.UserID,
		}},
	})
	if outsiderAdd.Code != http.StatusBadRequest || !strings.Contains(outsiderAdd.Body.String(), "gvic_principal_not_in_company") {
		t.Fatalf("outsider add status = %d body=%s, want gvic_principal_not_in_company", outsiderAdd.Code, outsiderAdd.Body.String())
	}
	assertHTTPGVICEventRowCount(t, repo, companyID, 3)
}

type resourceGVICCommandPayloadForTest struct {
	Operation            string                                   `json:"operation"`
	Changed              bool                                     `json:"changed"`
	Assignments          []domain.ResourceGVICAssignment          `json:"gvic_assignments"`
	EffectiveAssignments []domain.ResourceGVICEffectiveAssignment `json:"effective_assignments"`
}

func postResourceGVICCommandForTest(t *testing.T, handler http.Handler, resourceType, resourceID, operation string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/v1/resources/"+resourceType+"/"+resourceID+"/gvic/"+operation, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decodeResourceGVICCommandPayloadForTest(t *testing.T, rec *httptest.ResponseRecorder) resourceGVICCommandPayloadForTest {
	t.Helper()
	var payload resourceGVICCommandPayloadForTest
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode command payload: %v", err)
	}
	if payload.Assignments == nil {
		payload.Assignments = []domain.ResourceGVICAssignment{}
	}
	if payload.EffectiveAssignments == nil {
		payload.EffectiveAssignments = []domain.ResourceGVICEffectiveAssignment{}
	}
	return payload
}

func assertHTTPGVICEventRowCount(t *testing.T, repo store.Repository, companyID string, want int) {
	t.Helper()
	rows, err := repo.ListEventRows(companyID, 50)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	got := 0
	for _, row := range rows {
		if row.EventType == store.EventTypeGVICProjectionDelta {
			got++
		}
	}
	if got != want {
		t.Fatalf("GVIC event rows len = %d, want %d: %+v", got, want, rows)
	}
}
