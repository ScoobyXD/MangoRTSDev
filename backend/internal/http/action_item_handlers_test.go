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

func TestActionItemHandlersCreateAndListByHuddleProcess(t *testing.T) {
	repo := store.NewMemoryRepo()
	const subject = "action-item-http-owner"
	user, err := repo.UpsertAuthUser(subject, "owner@example.com", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("HTTP Action Items")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Daily")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	firstNode, err := repo.CreateHuddleNode(store.HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: process.HuddleLogicGateID, Name: "First", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	secondNode, err := repo.CreateHuddleNode(store.HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: process.HuddleLogicGateID, Name: "Second", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(repo).Routes()

	createBody, _ := json.Marshal(map[string]any{
		"company_id": company.CompanyID, "body_text": "Escalate the shipment", "color": "yellow", "huddle_node_id": firstNode.HuddleNodeID,
	})
	createRequest := httptest.NewRequest(http.MethodPost, "/v1/action-items", bytes.NewReader(createBody))
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(createResponse, requestWithActorForTest(createRequest, user, company.CompanyID))
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", createResponse.Code, createResponse.Body.String())
	}
	var created struct {
		ActionItem domain.Entity `json:"action_item"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.ActionItem.CreatedByUserID != user.UserID || created.ActionItem.Name != "Escalate the shipment" {
		t.Fatalf("created action item=%+v", created.ActionItem)
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/v1/action-items?company_id="+company.CompanyID+"&huddle_node_id="+secondNode.HuddleNodeID, nil)
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, requestWithActorForTest(listRequest, user, company.CompanyID))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
	var listed struct {
		ActionItems []domain.Entity `json:"action_items"`
	}
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.ActionItems) != 1 || listed.ActionItems[0].EntityID != created.ActionItem.EntityID {
		t.Fatalf("listed action items=%+v", listed.ActionItems)
	}

	missingNodeRequest := httptest.NewRequest(http.MethodGet, "/v1/action-items?company_id="+company.CompanyID, nil)
	missingNodeResponse := httptest.NewRecorder()
	handler.ServeHTTP(missingNodeResponse, requestWithActorForTest(missingNodeRequest, user, company.CompanyID))
	if missingNodeResponse.Code != http.StatusBadRequest {
		t.Fatalf("missing huddle node status=%d body=%s", missingNodeResponse.Code, missingNodeResponse.Body.String())
	}
}

func TestActionItemHandlersRequireExactHuddleNodeAccess(t *testing.T) {
	repo := store.NewMemoryRepo()
	owner, err := repo.UpsertAuthUser("action-item-access-owner", "owner-access@example.com", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	member, err := repo.UpsertAuthUser("action-item-access-member", "member-access@example.com", "Member")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Action Item Access")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("action-item-access-owner", company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("action-item-access-member", company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Restricted")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, owner.UserID)
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(store.HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: process.HuddleLogicGateID, Name: "Restricted", ActorID: owner.UserID})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(actionItemDeniedAccessRepo{Repository: repo}).Routes()
	actor := ActorContext{
		User:        member,
		Memberships: []domain.CompanyMembership{{CompanyID: company.CompanyID, UserID: member.UserID, Role: domain.RoleCompanyUser}},
		CompanyID:   company.CompanyID, CompanyRole: domain.RoleCompanyUser,
	}
	withActor := func(request *http.Request) *http.Request {
		return request.WithContext(context.WithValue(request.Context(), actorContextKey{}, actor))
	}

	createBody, _ := json.Marshal(map[string]any{
		"company_id": company.CompanyID, "body_text": "Must stay private", "color": "red", "huddle_node_id": node.HuddleNodeID,
	})
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(createResponse, withActor(httptest.NewRequest(http.MethodPost, "/v1/action-items", bytes.NewReader(createBody))))
	if createResponse.Code != http.StatusNotFound {
		t.Fatalf("restricted create status=%d body=%s, want 404", createResponse.Code, createResponse.Body.String())
	}

	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, withActor(httptest.NewRequest(http.MethodGet, "/v1/action-items?company_id="+company.CompanyID+"&huddle_node_id="+node.HuddleNodeID, nil)))
	if listResponse.Code != http.StatusNotFound {
		t.Fatalf("restricted list status=%d body=%s, want 404", listResponse.Code, listResponse.Body.String())
	}
	items, err := repo.ListHuddleNodeActionItems(company.CompanyID, node.HuddleNodeID)
	if err != nil || len(items) != 0 {
		t.Fatalf("restricted request created Action Items=%+v err=%v", items, err)
	}
}

type actionItemDeniedAccessRepo struct {
	store.Repository
}

func (actionItemDeniedAccessRepo) UserHasEffectiveAccess(_, _, _, _, _ string) (bool, error) {
	return false, nil
}
