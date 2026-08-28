package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestEntityHandlersCRUDAndExplicitRootMoves(t *testing.T) {
	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("entities-test-user", "entities@example.com", "Entities Test")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Entities Test")
	if err != nil {
		t.Fatal(err)
	}
	companyID := company.CompanyID
	if _, err := repo.AddCompanyMembership("entities-test-user", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	handler := NewServer(repo).Routes()

	typeResponse := entitiesHTTPJSON(t, handler, user, companyID, http.MethodPost, "/v1/entity-types", map[string]any{
		"company_id": companyID,
		"name":       "Delivery",
	})
	if typeResponse.Code != http.StatusCreated {
		t.Fatalf("create type status=%d body=%s", typeResponse.Code, typeResponse.Body.String())
	}
	var createdType struct {
		EntityType domain.EntityType `json:"entity_type"`
	}
	decodeEntitiesHTTPResponse(t, typeResponse, &createdType)
	for _, invalidKey := range []string{"Open", "open state", "open-state"} {
		invalidOptionResponse := entitiesHTTPJSON(t, handler, user, companyID, http.MethodPost, "/v1/entity-field-types", map[string]any{
			"company_id":     companyID,
			"entity_type_id": createdType.EntityType.EntityTypeID,
			"name":           "Invalid option",
			"field_type":     "choice",
			"config": map[string]any{
				"options": []map[string]string{{"key": invalidKey, "label": "Open"}},
			},
		})
		if invalidOptionResponse.Code != http.StatusBadRequest {
			t.Fatalf("invalid option key %q status=%d body=%s, want 400", invalidKey, invalidOptionResponse.Code, invalidOptionResponse.Body.String())
		}
	}

	folderResponse := entitiesHTTPJSON(t, handler, user, companyID, http.MethodPost, "/v1/entity-folders", map[string]any{
		"company_id":              companyID,
		"entity_type_id":          createdType.EntityType.EntityTypeID,
		"name":                    "Imports",
		"position":                7,
		"parent_entity_folder_id": nil,
	})
	if folderResponse.Code != http.StatusCreated {
		t.Fatalf("create folder status=%d body=%s", folderResponse.Code, folderResponse.Body.String())
	}
	var createdFolder struct {
		EntityFolder domain.EntityFolder `json:"entity_folder"`
	}
	decodeEntitiesHTTPResponse(t, folderResponse, &createdFolder)
	if createdFolder.EntityFolder.Position != 7 {
		t.Fatalf("folder position=%d, want 7", createdFolder.EntityFolder.Position)
	}

	fieldTypeResponse := entitiesHTTPJSON(t, handler, user, companyID, http.MethodPost, "/v1/entity-field-types", map[string]any{
		"company_id":       companyID,
		"entity_type_id":   createdType.EntityType.EntityTypeID,
		"entity_folder_id": createdFolder.EntityFolder.EntityFolderID,
		"name":             "Status",
		"field_type":       "text",
		"position":         3,
	})
	if fieldTypeResponse.Code != http.StatusCreated {
		t.Fatalf("create field type status=%d body=%s", fieldTypeResponse.Code, fieldTypeResponse.Body.String())
	}
	var createdFieldType struct {
		EntityFieldType domain.EntityFieldType `json:"entity_field_type"`
	}
	decodeEntitiesHTTPResponse(t, fieldTypeResponse, &createdFieldType)

	entityResponse := entitiesHTTPJSON(t, handler, user, companyID, http.MethodPost, "/v1/entities", map[string]any{
		"company_id":       companyID,
		"entity_type_id":   createdType.EntityType.EntityTypeID,
		"entity_folder_id": createdFolder.EntityFolder.EntityFolderID,
		"name":             "Thailand shipment",
		"position":         9,
	})
	if entityResponse.Code != http.StatusCreated {
		t.Fatalf("create entity status=%d body=%s", entityResponse.Code, entityResponse.Body.String())
	}
	var createdEntity struct {
		Entity domain.Entity `json:"entity"`
	}
	decodeEntitiesHTTPResponse(t, entityResponse, &createdEntity)
	if createdEntity.Entity.Position != 9 || createdEntity.Entity.CreatedByUserID != user.UserID || len(createdEntity.Entity.EntityFields) != 1 || createdEntity.Entity.EntityFields[0].Name != "Status" {
		t.Fatalf("created entity=%+v", createdEntity.Entity)
	}
	blankEntityMove := entitiesHTTPJSON(t, handler, user, companyID, http.MethodPut, "/v1/entities/"+createdEntity.Entity.EntityID, map[string]any{
		"company_id":       companyID,
		"entity_folder_id": "",
	})
	if blankEntityMove.Code != http.StatusBadRequest {
		t.Fatalf("blank Entity folder move status=%d body=%s, want 400", blankEntityMove.Code, blankEntityMove.Body.String())
	}

	folderMove := entitiesHTTPJSON(t, handler, user, companyID, http.MethodPut, "/v1/entity-folders/"+createdFolder.EntityFolder.EntityFolderID, map[string]any{
		"company_id":              companyID,
		"parent_entity_folder_id": nil,
	})
	if folderMove.Code != http.StatusOK {
		t.Fatalf("folder root move status=%d body=%s", folderMove.Code, folderMove.Body.String())
	}
	var movedFolder struct {
		EntityFolder domain.EntityFolder `json:"entity_folder"`
	}
	decodeEntitiesHTTPResponse(t, folderMove, &movedFolder)
	if movedFolder.EntityFolder.ParentEntityFolderID != nil {
		t.Fatalf("folder parent=%v, want root", movedFolder.EntityFolder.ParentEntityFolderID)
	}

	fieldTypeMove := entitiesHTTPJSON(t, handler, user, companyID, http.MethodPut, "/v1/entity-field-types/"+createdFieldType.EntityFieldType.EntityFieldTypeID, map[string]any{
		"company_id":       companyID,
		"entity_folder_id": nil,
	})
	if fieldTypeMove.Code != http.StatusOK {
		t.Fatalf("field type root move status=%d body=%s", fieldTypeMove.Code, fieldTypeMove.Body.String())
	}
	var movedFieldType struct {
		EntityFieldType domain.EntityFieldType `json:"entity_field_type"`
	}
	decodeEntitiesHTTPResponse(t, fieldTypeMove, &movedFieldType)
	if movedFieldType.EntityFieldType.EntityFolderID != nil {
		t.Fatalf("field type folder=%v, want root", movedFieldType.EntityFieldType.EntityFolderID)
	}

	entityMove := entitiesHTTPJSON(t, handler, user, companyID, http.MethodPut, "/v1/entities/"+createdEntity.Entity.EntityID, map[string]any{
		"company_id":       companyID,
		"entity_folder_id": nil,
	})
	if entityMove.Code != http.StatusOK {
		t.Fatalf("entity root move status=%d body=%s", entityMove.Code, entityMove.Body.String())
	}
	var movedEntity struct {
		Entity domain.Entity `json:"entity"`
	}
	decodeEntitiesHTTPResponse(t, entityMove, &movedEntity)
	if movedEntity.Entity.EntityFolderID != nil || len(movedEntity.Entity.EntityFields) != 1 {
		t.Fatalf("moved entity=%+v; root move must preserve copied fields", movedEntity.Entity)
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/v1/entities?company_id="+companyID+"&entity_type_id="+createdType.EntityType.EntityTypeID+"&limit=50&offset=0", nil)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, requestWithActorForTest(listRequest, user, companyID))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list entities status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
	var listed struct {
		Entities []domain.EntitySummary `json:"entities"`
	}
	decodeEntitiesHTTPResponse(t, listResponse, &listed)
	if len(listed.Entities) != 1 || listed.Entities[0].EntityID != createdEntity.Entity.EntityID {
		t.Fatalf("listed entities=%+v", listed.Entities)
	}

	managerListRequest := httptest.NewRequest(http.MethodGet, "/v1/entities?company_id="+companyID+"&entity_type_id="+createdType.EntityType.EntityTypeID+"&all_for_type=true", nil)
	managerListResponse := httptest.NewRecorder()
	handler.ServeHTTP(managerListResponse, requestWithActorForTest(managerListRequest, user, companyID))
	if managerListResponse.Code != http.StatusOK {
		t.Fatalf("exact Entity Type manager list status=%d body=%s", managerListResponse.Code, managerListResponse.Body.String())
	}
	var managerListed struct {
		Entities []domain.EntitySummary `json:"entities"`
	}
	decodeEntitiesHTTPResponse(t, managerListResponse, &managerListed)
	if len(managerListed.Entities) != 1 || managerListed.Entities[0].EntityID != createdEntity.Entity.EntityID {
		t.Fatalf("exact Entity Type manager list=%+v", managerListed.Entities)
	}
	for _, path := range []string{
		"/v1/entities?company_id=" + companyID + "&entity_type_id=" + createdType.EntityType.EntityTypeID + "&all_for_type=false",
		"/v1/entities?company_id=" + companyID + "&all_for_type=true",
	} {
		invalidManagerRequest := httptest.NewRequest(http.MethodGet, path, nil)
		invalidManagerResponse := httptest.NewRecorder()
		handler.ServeHTTP(invalidManagerResponse, requestWithActorForTest(invalidManagerRequest, user, companyID))
		if invalidManagerResponse.Code != http.StatusBadRequest {
			t.Fatalf("invalid Entity manager list %q status=%d body=%s, want 400", path, invalidManagerResponse.Code, invalidManagerResponse.Body.String())
		}
	}

	invalidFilterRequest := httptest.NewRequest(http.MethodGet, "/v1/entities?company_id="+companyID+"&entity_type_id=not-a-uuid", nil)
	invalidFilterResponse := httptest.NewRecorder()
	handler.ServeHTTP(invalidFilterResponse, requestWithActorForTest(invalidFilterRequest, user, companyID))
	if invalidFilterResponse.Code != http.StatusBadRequest {
		t.Fatalf("invalid Entity Type filter status=%d body=%s, want 400", invalidFilterResponse.Code, invalidFilterResponse.Body.String())
	}

	canceledContext, cancel := context.WithCancel(context.Background())
	cancel()
	canceledListRequest := httptest.NewRequest(http.MethodGet, "/v1/entities?company_id="+companyID, nil).WithContext(canceledContext)
	canceledListResponse := httptest.NewRecorder()
	handler.ServeHTTP(canceledListResponse, requestWithActorForTest(canceledListRequest, user, companyID))
	if canceledListResponse.Code == http.StatusOK {
		t.Fatal("canceled Entity list returned 200; request cancellation did not reach the repository")
	}

	otherCompanyID := "99999999-9999-9999-9999-999999999999"
	deniedRequest := httptest.NewRequest(http.MethodGet, "/v1/entities?company_id="+otherCompanyID, nil)
	deniedResponse := httptest.NewRecorder()
	handler.ServeHTTP(deniedResponse, requestWithActorForTest(deniedRequest, user, companyID))
	if deniedResponse.Code != http.StatusForbidden {
		t.Fatalf("cross-company Entity list status=%d body=%s, want 403", deniedResponse.Code, deniedResponse.Body.String())
	}
}

func entitiesHTTPJSON(t *testing.T, handler http.Handler, user domain.User, companyID, method, path string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, requestWithActorForTest(request, user, companyID))
	return response
}

func decodeEntitiesHTTPResponse(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}
