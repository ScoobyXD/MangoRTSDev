package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestHuddleLogicGateRelationshipRoutesCreateAndReadTypedCards(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "78787878-7878-4787-8787-787878787878"
	admin := mustCreateUserPinUser(t, repo, "huddle-relationship-admin", companyID, "huddle-relationship-admin@example.com", domain.RoleCompanyAdmin)
	huddleID := createHuddleLogicGateForHTTPTest(t, repo, companyID)
	logicGate, err := repo.CreateLogicGate(companyID, "Customer Health")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateKPI(store.HuddleCreateInput{CompanyID: companyID, OwnerID: logicGate.LogicGateID, Name: "Renewal rate"}); err != nil {
		t.Fatal(err)
	}

	path := "/v1/huddle-logic-gates/" + huddleID + "/logic-gates/" + logicGate.LogicGateID
	req := httptest.NewRequest(http.MethodPut, path, bytes.NewBufferString(fmt.Sprintf(`{"company_id":%q}`, companyID)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, userPinRequestWithActor(req, admin, companyID, domain.RoleCompanyAdmin))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT relationship status = %d, body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/huddle-logic-gates/"+huddleID+"/logic-gates?company_id="+companyID, nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, userPinRequestWithActor(req, admin, companyID, domain.RoleCompanyAdmin))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET relationship cards status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		LogicGates []domain.HuddleLogicGateCard `json:"logic_gates"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.LogicGates) != 1 || payload.LogicGates[0].LogicGateID != logicGate.LogicGateID || len(payload.LogicGates[0].KPIs) != 1 {
		t.Fatalf("relationship cards = %+v", payload.LogicGates)
	}

	reversePath := "/v1/logic-gates/" + logicGate.LogicGateID + "/huddle-logic-gates"
	req = httptest.NewRequest(http.MethodGet, reversePath+"?company_id="+companyID, nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, userPinRequestWithActor(req, admin, companyID, domain.RoleCompanyAdmin))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET reverse relationships status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var reversePayload struct {
		HuddleLogicGates []domain.HuddleLogicGate `json:"huddle_logic_gates"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &reversePayload); err != nil {
		t.Fatal(err)
	}
	if len(reversePayload.HuddleLogicGates) != 1 || reversePayload.HuddleLogicGates[0].HuddleLogicGateID != huddleID {
		t.Fatalf("reverse relationship cards = %+v", reversePayload.HuddleLogicGates)
	}

	req = httptest.NewRequest(http.MethodPut, reversePath+"/"+huddleID, bytes.NewBufferString(fmt.Sprintf(`{"company_id":%q}`, companyID)))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, userPinRequestWithActor(req, admin, companyID, domain.RoleCompanyAdmin))
	if rec.Code != http.StatusOK {
		t.Fatalf("idempotent reverse PUT relationship status = %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestHuddleExplorerItemMutationsRequireHuddleLogicGateEditAccess(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "67676767-6767-4767-8767-676767676767"
	editor := mustCreateUserPinUser(t, repo, "huddle-explorer-editor", companyID, "huddle-editor@example.com", domain.RoleCompanyUser)
	denied := mustCreateUserPinUser(t, repo, "huddle-explorer-denied", companyID, "huddle-denied@example.com", domain.RoleCompanyUser)
	manager := mustCreateUserPinUser(t, repo, "huddle-explorer-manager", companyID, "huddle-manager@example.com", domain.RoleCompanyManager)
	admin := mustCreateUserPinUser(t, repo, "huddle-explorer-admin", companyID, "huddle-admin@example.com", domain.RoleCompanyAdmin)
	folder, err := repo.CreateHuddleExplorerFolder(store.HuddleCreateInput{CompanyID: companyID, Name: "Moved"})
	if err != nil {
		t.Fatalf("CreateHuddleExplorerFolder: %v", err)
	}

	actors := []struct {
		name       string
		user       domain.User
		role       string
		wantStatus int
	}{
		{name: "member_without_edit", user: denied, role: domain.RoleCompanyUser, wantStatus: http.StatusNotFound},
		{name: "allowed_editor", user: editor, role: domain.RoleCompanyUser, wantStatus: http.StatusOK},
		{name: "company_manager_without_edit", user: manager, role: domain.RoleCompanyManager, wantStatus: http.StatusNotFound},
		{name: "company_admin", user: admin, role: domain.RoleCompanyAdmin, wantStatus: http.StatusOK},
	}
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		for _, actor := range actors {
			t.Run(strings.ToLower(method)+"_"+actor.name, func(t *testing.T) {
				resourceID := createHuddleLogicGateForHTTPTest(t, repo, companyID)
				if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
					CompanyID:        companyID,
					EntityType:       store.EntityTypeHuddleLogicGate,
					EntityID:         resourceID,
					DefaultAccess:    store.EntityPermissionNoAccess,
					DefaultAccessSet: true,
					Permissions: []store.EntityPermissionInput{{
						SubjectType: store.EntityPermissionSubjectUser,
						SubjectID:   editor.UserID,
						AccessLevel: store.EntityPermissionEdit,
					}},
					ActorUserID: manager.UserID,
				}); err != nil {
					t.Fatalf("SetEntityPermissions: %v", err)
				}
				item := huddleExplorerItemForResource(t, repo, companyID, store.EntityTypeHuddleLogicGate, resourceID)
				var req *http.Request
				if method == http.MethodPut {
					body := fmt.Sprintf(`{"company_id":%q,"parent_folder_id":%q}`, companyID, folder.FolderID)
					req = httptest.NewRequest(method, "/v1/huddle-explorer/items/"+item.ItemID, bytes.NewBufferString(body))
				} else {
					req = httptest.NewRequest(method, "/v1/huddle-explorer/items/"+item.ItemID+"?company_id="+companyID, nil)
				}
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, userPinRequestWithActor(req, actor.user, companyID, actor.role))
				if rec.Code != actor.wantStatus {
					t.Fatalf("status = %d, want %d, body=%s", rec.Code, actor.wantStatus, rec.Body.String())
				}

				explorer, err := repo.ListHuddleExplorer(companyID)
				if err != nil {
					t.Fatalf("ListHuddleExplorer: %v", err)
				}
				stored, exists := findHuddleExplorerItem(explorer.Items, item.ItemID)
				allowed := actor.wantStatus == http.StatusOK
				if method == http.MethodPut {
					if !exists {
						t.Fatal("move removed the Explorer placement")
					}
					if allowed && (stored.ParentFolderID == nil || *stored.ParentFolderID != folder.FolderID) {
						t.Fatalf("allowed move parent = %v, want %s", stored.ParentFolderID, folder.FolderID)
					}
					if !allowed && stored.ParentFolderID != nil {
						t.Fatalf("denied move changed parent to %v", *stored.ParentFolderID)
					}
				} else if allowed == exists {
					t.Fatalf("delete placement exists=%v, allowed=%v", exists, allowed)
				}
				if _, err := repo.GetHuddleLogicGate(companyID, resourceID); err != nil {
					t.Fatalf("Explorer mutation changed underlying Huddle Logic Gate: %v", err)
				}
			})
		}
	}
}

func createHuddleLogicGateForHTTPTest(t *testing.T, repo *store.MemoryRepo, companyID string) string {
	t.Helper()
	logicGate, err := repo.CreateLogicGate(companyID, "Huddle owner")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	huddleLogicGate, err := repo.ConvertLogicGateToHuddle(companyID, logicGate.LogicGateID, "")
	if err != nil {
		t.Fatalf("ConvertLogicGateToHuddle: %v", err)
	}
	return huddleLogicGate.HuddleLogicGateID
}

func huddleExplorerItemForResource(t *testing.T, repo *store.MemoryRepo, companyID, resourceType, resourceID string) domain.HuddleExplorerItem {
	t.Helper()
	explorer, err := repo.ListHuddleExplorer(companyID)
	if err != nil {
		t.Fatalf("ListHuddleExplorer: %v", err)
	}
	for _, item := range explorer.Items {
		if item.ResourceType == resourceType && item.ResourceID == resourceID {
			return item
		}
	}
	t.Fatalf("placement not found for %s %s", resourceType, resourceID)
	return domain.HuddleExplorerItem{}
}

func findHuddleExplorerItem(items []domain.HuddleExplorerItem, itemID string) (domain.HuddleExplorerItem, bool) {
	for _, item := range items {
		if item.ItemID == itemID {
			return item, true
		}
	}
	return domain.HuddleExplorerItem{}, false
}
