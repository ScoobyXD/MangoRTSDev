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
		"company_id": company.CompanyID, "body_text": "Escalate the shipment", "color": "yellow",
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
	if len(listed.ActionItems) != 0 {
		t.Fatalf("company-wide creation unexpectedly attached action items=%+v", listed.ActionItems)
	}
	textbox, err := repo.CreateHuddleNodeTextbox(store.HuddleNodeTextboxCreateInput{CompanyID: company.CompanyID, HuddleNodeID: firstNode.HuddleNodeID, Title: "Meeting notes"})
	if err != nil {
		t.Fatal(err)
	}
	ref := store.EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: store.EntityTypeHuddleNode, ResourceID: firstNode.HuddleNodeID, DocumentID: textbox.TextboxID}
	firstCommit := commitActionItemHTTPTestDocument(t, repo, ref, user.UserID, 0, "http-first-reference", created.ActionItem.EntityID)
	listResponse = httptest.NewRecorder()
	handler.ServeHTTP(listResponse, requestWithActorForTest(listRequest, user, company.CompanyID))
	listed.ActionItems = nil
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.ActionItems) != 1 || listed.ActionItems[0].EntityID != created.ActionItem.EntityID {
		t.Fatalf("saved reference rollup=%+v", listed.ActionItems)
	}
	secondCreateBody, _ := json.Marshal(map[string]any{
		"company_id": company.CompanyID, "body_text": "Confirm the revised ship date", "color": nil,
	})
	secondCreateResponse := httptest.NewRecorder()
	handler.ServeHTTP(secondCreateResponse, requestWithActorForTest(httptest.NewRequest(http.MethodPost, "/v1/action-items", bytes.NewReader(secondCreateBody)), user, company.CompanyID))
	if secondCreateResponse.Code != http.StatusCreated {
		t.Fatalf("second create status=%d body=%s", secondCreateResponse.Code, secondCreateResponse.Body.String())
	}
	var secondCreated struct {
		ActionItem domain.Entity `json:"action_item"`
	}
	if err := json.NewDecoder(secondCreateResponse.Body).Decode(&secondCreated); err != nil {
		t.Fatal(err)
	}
	secondCommit := commitActionItemHTTPTestDocument(t, repo, ref, user.UserID, firstCommit.Revision, "http-two-references", created.ActionItem.EntityID, secondCreated.ActionItem.EntityID, created.ActionItem.EntityID)
	listResponse = httptest.NewRecorder()
	handler.ServeHTTP(listResponse, requestWithActorForTest(listRequest, user, company.CompanyID))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list after sync status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
	listed = struct {
		ActionItems []domain.Entity `json:"action_items"`
	}{}
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.ActionItems) != 2 {
		t.Fatalf("deduped Process rollup after saved editor commit=%+v, want 2", listed.ActionItems)
	}
	commitActionItemHTTPTestDocument(t, repo, ref, user.UserID, secondCommit.Revision, "http-remove-first", secondCreated.ActionItem.EntityID)
	listResponse = httptest.NewRecorder()
	handler.ServeHTTP(listResponse, requestWithActorForTest(listRequest, user, company.CompanyID))
	listed.ActionItems = nil
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.ActionItems) != 1 || listed.ActionItems[0].EntityID != secondCreated.ActionItem.EntityID {
		t.Fatalf("saved reference rollup=%+v", listed.ActionItems)
	}
	retiredSyncBody, _ := json.Marshal(map[string]any{"company_id": company.CompanyID, "action_item_ids": []string{created.ActionItem.EntityID}})
	retiredSyncResponse := httptest.NewRecorder()
	handler.ServeHTTP(retiredSyncResponse, requestWithActorForTest(httptest.NewRequest(http.MethodPut, "/v1/huddle-nodes/"+firstNode.HuddleNodeID+"/action-items", bytes.NewReader(retiredSyncBody)), user, company.CompanyID))
	if retiredSyncResponse.Code != http.StatusNotFound {
		t.Fatalf("retired sync endpoint status=%d body=%s, want 404", retiredSyncResponse.Code, retiredSyncResponse.Body.String())
	}
	unknownFieldBody, _ := json.Marshal(map[string]any{"company_id": company.CompanyID, "body_text": "No implicit attachment", "huddle_node_id": firstNode.HuddleNodeID})
	unknownFieldResponse := httptest.NewRecorder()
	handler.ServeHTTP(unknownFieldResponse, requestWithActorForTest(httptest.NewRequest(http.MethodPost, "/v1/action-items", bytes.NewReader(unknownFieldBody)), user, company.CompanyID))
	if unknownFieldResponse.Code != http.StatusBadRequest {
		t.Fatalf("obsolete Huddle create field status=%d body=%s, want 400", unknownFieldResponse.Code, unknownFieldResponse.Body.String())
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
		"company_id": company.CompanyID, "body_text": "Company-wide action item", "color": "red",
	})
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(createResponse, withActor(httptest.NewRequest(http.MethodPost, "/v1/action-items", bytes.NewReader(createBody))))
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("company-wide create status=%d body=%s, want 201", createResponse.Code, createResponse.Body.String())
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

func commitActionItemHTTPTestDocument(t *testing.T, repo store.Repository, ref store.EditorJSONDocumentRef, actorUserID string, baseRevision int64, operationID string, entityIDs ...string) store.EditorJSONCommit {
	t.Helper()
	content := make([]map[string]any, 0, len(entityIDs))
	for _, entityID := range entityIDs {
		content = append(content, map[string]any{"type": "mangoEntityLink", "attrs": map[string]any{
			"entityType": "entity", "entityId": entityID, "label": "Action Item", "actionItem": true, "actionItemColor": nil,
		}})
	}
	document, err := json.Marshal(map[string]any{
		"format": store.MangoTiptapFormat, "schema_version": store.MangoTiptapSchemaVersion,
		"document": map[string]any{"type": "doc", "content": []map[string]any{{"type": "paragraph", "content": content}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	commit, err := repo.CommitEditorJSONDocument(store.EditorJSONCommitInput{
		Document: ref, OperationID: operationID, ClientID: "action-item-http-test", ActorUserID: actorUserID,
		BaseRevision: baseRevision, SchemaVersion: store.MangoTiptapSchemaVersion, JSONDocument: document,
	})
	if err != nil {
		t.Fatalf("commit %s: %v", operationID, err)
	}
	return commit
}

type actionItemDeniedAccessRepo struct {
	store.Repository
}

func (actionItemDeniedAccessRepo) UserHasEffectiveAccess(_, _, _, _, _ string) (bool, error) {
	return false, nil
}
