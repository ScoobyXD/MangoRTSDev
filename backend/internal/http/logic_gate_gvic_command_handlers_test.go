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

func TestLogicGateRACIAddRemoveCommandAPI(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	repo := backing
	server := NewServer(repo)
	companyID := "company-RACI-command-api"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)
	otherCompanyID := "company-RACI-command-api-other"
	repo.EnsureCompany(companyID, "RACI Command API Company")
	repo.EnsureCompany(otherCompanyID, "Other RACI Command API Company")
	logicGate, err := repo.CreateLogicGate(companyID, "API Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	responsible, err := repo.UpsertAuthUser("RACI-command-api-responsible", "responsible-command-api@example.com", "Responsible API")
	if err != nil {
		t.Fatalf("UpsertAuthUser responsible: %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-command-api-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership responsible: %v", err)
	}
	accountable, err := repo.UpsertAuthUser("RACI-command-api-accountable", "accountable-command-api@example.com", "Accountable API")
	if err != nil {
		t.Fatalf("UpsertAuthUser accountable: %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-command-api-accountable", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership accountable: %v", err)
	}
	outsider, err := repo.UpsertAuthUser("RACI-command-api-outsider", "outsider-command-api@example.com", "Outsider API")
	if err != nil {
		t.Fatalf("UpsertAuthUser outsider: %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-command-api-outsider", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership outsider: %v", err)
	}

	removedWriterBody := map[string]any{
		"company_id":       companyID,
		"assignment_mode":  store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{{"role": domain.RACIRoleResponsible, "principal_type": store.EntityPermissionSubjectUser, "principal_id": responsible.UserID}},
	}
	for _, operation := range []string{store.RACIAssignmentCommandAdd, store.RACIAssignmentCommandRemove} {
		response := postResourceRACICommandForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, operation, removedWriterBody)
		if response.Code != http.StatusNotFound {
			t.Fatalf("POST removed RACI %s writer status = %d body=%s, want 404", operation, response.Code, response.Body.String())
		}
	}

	addBody := map[string]any{
		"company_id":      companyID,
		"assignment_mode": store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{
			{"role": domain.RACIRoleResponsible, "principal_type": store.EntityPermissionSubjectUser, "principal_id": responsible.UserID},
			{"role": domain.RACIRoleResponsible, "principal_type": store.EntityPermissionSubjectUser, "principal_id": responsible.UserID},
		},
		"idempotency_key": "canonical-add-normalization",
	}
	add := putResourceRACIPolicyForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, addBody)
	if add.Code != http.StatusOK {
		t.Fatalf("canonical add replacement status = %d body=%s", add.Code, add.Body.String())
	}
	addPayload := decodeResourceRACICommandPayloadForTest(t, add)
	if len(addPayload.Assignments) != 1 || len(addPayload.EffectiveAssignments) != 1 {
		t.Fatalf("canonical add replacement payload = %+v, want one deduplicated assignment", addPayload)
	}
	duplicateAdd := putResourceRACIPolicyForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, addBody)
	duplicateAddPayload := decodeResourceRACICommandPayloadForTest(t, duplicateAdd)
	if duplicateAdd.Code != http.StatusOK || duplicateAddPayload.Revision != addPayload.Revision || len(duplicateAddPayload.Assignments) != 1 {
		t.Fatalf("idempotent canonical add = %+v status=%d, want unchanged revision", duplicateAddPayload, duplicateAdd.Code)
	}

	removeBody := map[string]any{"company_id": companyID, "assignment_mode": store.PolicyModeCustomized, "gvic_assignments": []map[string]string{}, "idempotency_key": "canonical-empty-replacement"}
	removed := putResourceRACIPolicyForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, removeBody)
	removedPayload := decodeResourceRACICommandPayloadForTest(t, removed)
	if removed.Code != http.StatusOK || len(removedPayload.Assignments) != 0 || len(removedPayload.EffectiveAssignments) != 0 {
		t.Fatalf("canonical empty replacement = %+v status=%d", removedPayload, removed.Code)
	}
	missingRemove := putResourceRACIPolicyForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, removeBody)
	missingRemovePayload := decodeResourceRACICommandPayloadForTest(t, missingRemove)
	if missingRemove.Code != http.StatusOK || missingRemovePayload.Revision != removedPayload.Revision || len(missingRemovePayload.Assignments) != 0 {
		t.Fatalf("idempotent empty replacement = %+v status=%d, want unchanged revision", missingRemovePayload, missingRemove.Code)
	}

	for _, role := range []string{"owner", "generated", "verified", "verifier"} {
		invalidRole := putResourceRACIPolicyForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, map[string]any{
			"company_id": companyID, "assignment_mode": store.PolicyModeCustomized,
			"gvic_assignments": []map[string]string{{"role": role, "principal_type": store.EntityPermissionSubjectUser, "principal_id": responsible.UserID}},
		})
		if invalidRole.Code != http.StatusBadRequest || !strings.Contains(invalidRole.Body.String(), "invalid_policy") {
			t.Fatalf("invalid role %q status = %d body=%s, want invalid_policy", role, invalidRole.Code, invalidRole.Body.String())
		}
	}

	fullReplace := putResourceRACIPolicyForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, map[string]any{
		"company_id": companyID, "assignment_mode": store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{{"role": domain.RACIRoleAccountable, "principal_type": store.EntityPermissionSubjectUser, "principal_id": accountable.UserID}},
	})
	fullReplacePayload := decodeResourceRACICommandPayloadForTest(t, fullReplace)
	if fullReplace.Code != http.StatusOK || len(fullReplacePayload.Assignments) != 1 || fullReplacePayload.Assignments[0].Role != domain.RACIRoleAccountable {
		t.Fatalf("full replacement status=%d payload=%+v, want Accountable assignment", fullReplace.Code, fullReplacePayload)
	}

	outsiderAdd := putResourceRACIPolicyForTest(t, handler, store.EntityTypeLogicGate, logicGate.LogicGateID, map[string]any{
		"company_id":      companyID,
		"assignment_mode": store.PolicyModeCustomized,
		"gvic_assignments": []map[string]string{{
			"role":           domain.RACIRoleResponsible,
			"principal_type": store.EntityPermissionSubjectUser,
			"principal_id":   outsider.UserID,
		}},
	})
	if outsiderAdd.Code != http.StatusBadRequest || !strings.Contains(outsiderAdd.Body.String(), "policy_principal_not_in_company") {
		t.Fatalf("outsider replacement status = %d body=%s, want policy_principal_not_in_company", outsiderAdd.Code, outsiderAdd.Body.String())
	}
}

type resourceRACICommandPayloadForTest struct {
	Operation            string                                   `json:"operation"`
	Changed              bool                                     `json:"changed"`
	Assignments          []domain.ResourceRACIAssignment          `json:"gvic_assignments"`
	EffectiveAssignments []domain.ResourceRACIEffectiveAssignment `json:"effective_assignments"`
	Revision             string                                   `json:"revision"`
}

func postResourceRACICommandForTest(t *testing.T, handler http.Handler, resourceType, resourceID, operation string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/v1/resources/"+resourceType+"/"+resourceID+"/gvic/"+operation, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decodeResourceRACICommandPayloadForTest(t *testing.T, rec *httptest.ResponseRecorder) resourceRACICommandPayloadForTest {
	t.Helper()
	var payload resourceRACICommandPayloadForTest
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode command payload: %v", err)
	}
	if payload.Assignments == nil {
		payload.Assignments = []domain.ResourceRACIAssignment{}
	}
	if payload.EffectiveAssignments == nil {
		payload.EffectiveAssignments = []domain.ResourceRACIEffectiveAssignment{}
	}
	return payload
}
func putResourceRACIPolicyForTest(t *testing.T, handler http.Handler, resourceType, resourceID string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPut, "/v1/resources/"+resourceType+"/"+resourceID+"/gvic", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}
