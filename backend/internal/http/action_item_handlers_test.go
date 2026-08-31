package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
	processListRequest := httptest.NewRequest(http.MethodGet, "/v1/action-items?company_id="+company.CompanyID+"&huddle_logic_gate_id="+process.HuddleLogicGateID, nil)
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
	processListResponse := httptest.NewRecorder()
	handler.ServeHTTP(processListResponse, requestWithActorForTest(processListRequest, user, company.CompanyID))
	if processListResponse.Code != http.StatusOK {
		t.Fatalf("process list status=%d body=%s", processListResponse.Code, processListResponse.Body.String())
	}
	listed.ActionItems = nil
	if err := json.NewDecoder(processListResponse.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.ActionItems) != 1 || listed.ActionItems[0].EntityID != created.ActionItem.EntityID {
		t.Fatalf("direct Process rollup=%+v", listed.ActionItems)
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
	bothScopesRequest := httptest.NewRequest(http.MethodGet, "/v1/action-items?company_id="+company.CompanyID+"&huddle_node_id="+firstNode.HuddleNodeID+"&huddle_logic_gate_id="+process.HuddleLogicGateID, nil)
	bothScopesResponse := httptest.NewRecorder()
	handler.ServeHTTP(bothScopesResponse, requestWithActorForTest(bothScopesRequest, user, company.CompanyID))
	if bothScopesResponse.Code != http.StatusBadRequest {
		t.Fatalf("both Huddle scopes status=%d body=%s", bothScopesResponse.Code, bothScopesResponse.Body.String())
	}
}

func TestHuddleActionItemListsProjectOnlyVisibleSources(t *testing.T) {
	repo := store.NewMemoryRepo()
	owner, err := repo.UpsertAuthUser("huddle-action-item-source-owner", "huddle-source-owner@example.com", "Huddle Source Owner")
	if err != nil {
		t.Fatal(err)
	}
	member, err := repo.UpsertAuthUser("huddle-action-item-source-member", "huddle-source-member@example.com", "Huddle Source Member")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Huddle Action Item Source List")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(owner.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Source projection Process")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.ConvertLogicGateToHuddle(company.CompanyID, gate.LogicGateID, owner.UserID)
	if err != nil {
		t.Fatal(err)
	}
	huddleNode, err := repo.CreateHuddleNode(store.HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: process.HuddleLogicGateID, Name: "Source projection Node", ActorID: owner.UserID})
	if err != nil {
		t.Fatal(err)
	}
	sourceNode, err := repo.CreateNode(company.CompanyID, "Visible source Node")
	if err != nil {
		t.Fatal(err)
	}
	actionItem, err := repo.CreateActionItem(store.ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Action Item with Source", CreatedByUserID: owner.UserID,
		SourceResourceType: store.EntityTypeNode, SourceResourceID: sourceNode.NodeID,
	})
	if err != nil {
		t.Fatal(err)
	}
	textbox, err := repo.CreateHuddleNodeTextbox(store.HuddleNodeTextboxCreateInput{CompanyID: company.CompanyID, HuddleNodeID: huddleNode.HuddleNodeID, Title: "Source projection notes"})
	if err != nil {
		t.Fatal(err)
	}
	commitActionItemHTTPTestDocument(t, repo, store.EditorJSONDocumentRef{
		CompanyID: company.CompanyID, ResourceType: store.EntityTypeHuddleNode, ResourceID: huddleNode.HuddleNodeID, DocumentID: textbox.TextboxID,
	}, owner.UserID, 0, "huddle-source-projection", actionItem.EntityID)

	type listedActionItem struct {
		domain.Entity
		Source *domain.ActionItemSourceView `json:"source"`
	}
	countedRepo := &actionItemSourceBatchCountingRepo{Repository: repo}
	handler := NewServer(countedRepo).Routes()
	get := func(scopeQuery string) ([]listedActionItem, string) {
		t.Helper()
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/v1/action-items?company_id="+company.CompanyID+"&"+scopeQuery, nil)
		handler.ServeHTTP(response, requestWithActorForTest(request, member, company.CompanyID))
		if response.Code != http.StatusOK {
			t.Fatalf("Huddle Action Item list status=%d body=%s", response.Code, response.Body.String())
		}
		var payload struct {
			ActionItems []listedActionItem `json:"action_items"`
		}
		body := response.Body.String()
		if err := json.Unmarshal([]byte(body), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.ActionItems, body
	}

	visibleItems, visibleBody := get("huddle_node_id=" + huddleNode.HuddleNodeID)
	if len(visibleItems) != 1 || visibleItems[0].EntityID != actionItem.EntityID || visibleItems[0].Name != actionItem.Name {
		t.Fatalf("visible Huddle Action Items = %+v", visibleItems)
	}
	visibleSource := visibleItems[0].Source
	if visibleSource == nil || visibleSource.ResourceType != store.EntityTypeNode || visibleSource.ResourceID != sourceNode.NodeID || visibleSource.Name != sourceNode.Title {
		t.Fatalf("visible Huddle Action Item Source = %+v", visibleSource)
	}
	assertHuddleActionItemSourceJSONField(t, visibleBody, true)
	for _, field := range visibleItems[0].EntityFields {
		if field.SystemKey == store.ActionItemSourceSystemKey && string(field.Value) != "null" {
			t.Fatalf("raw Action Item Source field leaked through Huddle list: %s", field.Value)
		}
	}

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: company.CompanyID, EntityType: store.EntityTypeNode, EntityID: sourceNode.NodeID,
		DefaultAccess: store.EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	hiddenItems, hiddenBody := get("huddle_logic_gate_id=" + process.HuddleLogicGateID)
	if len(hiddenItems) != 1 || hiddenItems[0].EntityID != actionItem.EntityID || hiddenItems[0].Source != nil {
		t.Fatalf("hidden-source Huddle Action Items = %+v", hiddenItems)
	}
	if strings.Contains(hiddenBody, sourceNode.NodeID) || strings.Contains(hiddenBody, sourceNode.Title) {
		t.Fatalf("hidden Huddle Action Item Source leaked identity: %s", hiddenBody)
	}
	assertHuddleActionItemSourceJSONField(t, hiddenBody, false)
	if countedRepo.batchCalls != 2 || countedRepo.singleCalls != 0 {
		t.Fatalf("Huddle Source repository calls: batch=%d single=%d, want batch=2 single=0", countedRepo.batchCalls, countedRepo.singleCalls)
	}
}

func assertHuddleActionItemSourceJSONField(t *testing.T, body string, want bool) {
	t.Helper()
	var payload struct {
		ActionItems []map[string]json.RawMessage `json:"action_items"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.ActionItems) != 1 {
		t.Fatalf("Huddle Action Item JSON items = %d, want 1", len(payload.ActionItems))
	}
	_, got := payload.ActionItems[0]["source"]
	if got != want {
		t.Fatalf("Huddle Action Item top-level Source field present=%v, want %v: %s", got, want, body)
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
	processListResponse := httptest.NewRecorder()
	handler.ServeHTTP(processListResponse, withActor(httptest.NewRequest(http.MethodGet, "/v1/action-items?company_id="+company.CompanyID+"&huddle_logic_gate_id="+process.HuddleLogicGateID, nil)))
	if processListResponse.Code != http.StatusNotFound {
		t.Fatalf("restricted Process list status=%d body=%s, want 404", processListResponse.Code, processListResponse.Body.String())
	}
	items, err := repo.ListHuddleNodeActionItems(company.CompanyID, node.HuddleNodeID)
	if err != nil || len(items) != 0 {
		t.Fatalf("restricted request created Action Items=%+v err=%v", items, err)
	}
}

func TestActionItemSourceHTTPResolvesCurrentNameAndHidesUnavailableIdentity(t *testing.T) {
	repo := store.NewMemoryRepo()
	owner, err := repo.UpsertAuthUser("action-item-source-http-owner", "source-owner@example.com", "Source Owner")
	if err != nil {
		t.Fatal(err)
	}
	member, err := repo.UpsertAuthUser("action-item-source-http-member", "source-member@example.com", "Source Member")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Action Item Source HTTP")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(owner.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	sourceNode, err := repo.CreateNode(company.CompanyID, "Current source name")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(repo).Routes()
	memberActor := ActorContext{
		User:        member,
		Memberships: []domain.CompanyMembership{{CompanyID: company.CompanyID, UserID: member.UserID, Role: domain.RoleCompanyUser}},
		CompanyID:   company.CompanyID, CompanyRole: domain.RoleCompanyUser,
	}
	withMember := func(request *http.Request) *http.Request {
		return request.WithContext(context.WithValue(request.Context(), actorContextKey{}, memberActor))
	}
	post := func(body map[string]any) *httptest.ResponseRecorder {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, withMember(httptest.NewRequest(http.MethodPost, "/v1/action-items", bytes.NewReader(raw))))
		return response
	}
	getSource := func(entityID string) (*domain.ActionItemSourceView, string) {
		t.Helper()
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/v1/action-items/"+entityID+"/source?company_id="+company.CompanyID, nil)
		handler.ServeHTTP(response, withMember(request))
		if response.Code != http.StatusOK {
			t.Fatalf("source GET status=%d body=%s", response.Code, response.Body.String())
		}
		var payload struct {
			Source *domain.ActionItemSourceView `json:"source"`
		}
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return payload.Source, response.Body.String()
	}
	listActionItems := func() []domain.EntitySummary {
		t.Helper()
		items, err := repo.ListEntities(context.Background(), store.EntityListQuery{
			CompanyID: company.CompanyID, EntityTypeID: store.ActionItemEntityTypeID, AllForType: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		return items
	}

	createdResponse := post(map[string]any{
		"company_id": company.CompanyID,
		"body_text":  "Created from highlighted source",
		"color":      "yellow",
		"source": map[string]any{
			"resource_type": store.EntityTypeNode,
			"resource_id":   sourceNode.NodeID,
		},
	})
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("source create status=%d body=%s", createdResponse.Code, createdResponse.Body.String())
	}
	createdBody := createdResponse.Body.String()
	if strings.Contains(createdBody, sourceNode.NodeID) {
		t.Fatalf("Action Item creation response leaked raw Source identity: %s", createdBody)
	}
	var created struct {
		ActionItem domain.Entity `json:"action_item"`
	}
	if err := json.Unmarshal([]byte(createdBody), &created); err != nil {
		t.Fatal(err)
	}
	sourceFieldFound := false
	for _, field := range created.ActionItem.EntityFields {
		if field.SystemKey == store.ActionItemSourceSystemKey {
			sourceFieldFound = true
			if string(field.Value) != "null" {
				t.Fatalf("creation response Source value=%s, want redacted null", field.Value)
			}
		}
	}
	if !sourceFieldFound {
		t.Fatal("creation response omitted the declared Source field")
	}
	getEntityBody := func() string {
		t.Helper()
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/v1/entities/"+created.ActionItem.EntityID+"?company_id="+company.CompanyID, nil)
		handler.ServeHTTP(response, withMember(request))
		if response.Code != http.StatusOK {
			t.Fatalf("Entity GET status=%d body=%s", response.Code, response.Body.String())
		}
		return response.Body.String()
	}
	if body := getEntityBody(); strings.Contains(body, sourceNode.NodeID) {
		t.Fatalf("ordinary authorized Entity GET leaked raw Source identity: %s", body)
	}
	view, _ := getSource(created.ActionItem.EntityID)
	if view == nil || view.ResourceType != store.EntityTypeNode || view.ResourceID != sourceNode.NodeID || view.Name != "Current source name" {
		t.Fatalf("source view = %+v", view)
	}
	if _, err := repo.UpdateNode(store.UpdateNodeInput{CompanyID: company.CompanyID, NodeID: sourceNode.NodeID, Title: "Renamed source", TitleSet: true}); err != nil {
		t.Fatal(err)
	}
	view, _ = getSource(created.ActionItem.EntityID)
	if view == nil || view.Name != "Renamed source" {
		t.Fatalf("renamed source view = %+v", view)
	}

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: company.CompanyID, EntityType: store.EntityTypeNode, EntityID: sourceNode.NodeID,
		DefaultAccess: store.EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	hidden, hiddenBody := getSource(created.ActionItem.EntityID)
	if hidden != nil || strings.Contains(hiddenBody, sourceNode.NodeID) || strings.Contains(hiddenBody, "Renamed source") {
		t.Fatalf("inaccessible source leaked identity: source=%+v body=%s", hidden, hiddenBody)
	}
	if body := getEntityBody(); strings.Contains(body, sourceNode.NodeID) {
		t.Fatalf("ordinary inaccessible Entity GET leaked raw Source identity: %s", body)
	}
	beforeRejected := len(listActionItems())
	rejected := post(map[string]any{
		"company_id": company.CompanyID, "body_text": "Unauthorized source", "color": "red",
		"source": map[string]any{"resource_type": store.EntityTypeNode, "resource_id": sourceNode.NodeID},
	})
	if rejected.Code != http.StatusNotFound {
		t.Fatalf("unauthorized source create status=%d body=%s, want 404", rejected.Code, rejected.Body.String())
	}
	if afterRejected := len(listActionItems()); afterRejected != beforeRejected {
		t.Fatalf("unauthorized source create partially wrote Action Item: %d -> %d", beforeRejected, afterRejected)
	}

	otherCompany := repo.EnsureCompany("93939393-9393-4393-8393-939393939393", "Other HTTP source company")
	otherNode, err := repo.CreateNode(otherCompany.CompanyID, "Hidden other-company source")
	if err != nil {
		t.Fatal(err)
	}
	crossCompany := post(map[string]any{
		"company_id": company.CompanyID, "body_text": "Cross-company source", "color": "red",
		"source": map[string]any{"resource_type": store.EntityTypeNode, "resource_id": otherNode.NodeID},
	})
	if crossCompany.Code != http.StatusNotFound || strings.Contains(crossCompany.Body.String(), otherNode.NodeID) {
		t.Fatalf("cross-company source response status=%d body=%s", crossCompany.Code, crossCompany.Body.String())
	}

	if _, err := repo.DeleteCompanyExplorerTargets(company.CompanyID, []store.CompanyExplorerDeleteTargetInput{{Kind: store.EntityTypeNode, ID: sourceNode.NodeID}}, owner.UserID); err != nil {
		t.Fatal(err)
	}
	if persisted, err := repo.GetActionItemSource(company.CompanyID, created.ActionItem.EntityID); err != nil || persisted.ResourceID != sourceNode.NodeID {
		t.Fatalf("recycled Source storage=%+v err=%v, want preserved exact identity", persisted, err)
	}
	unavailable, unavailableBody := getSource(created.ActionItem.EntityID)
	if unavailable != nil || strings.Contains(unavailableBody, sourceNode.NodeID) || strings.Contains(unavailableBody, "Renamed source") {
		t.Fatalf("removed source leaked identity: source=%+v body=%s", unavailable, unavailableBody)
	}
	if body := getEntityBody(); strings.Contains(body, sourceNode.NodeID) {
		t.Fatalf("ordinary recycled Entity GET leaked raw Source identity: %s", body)
	}

	directResponse := post(map[string]any{"company_id": company.CompanyID, "body_text": "Direct source unset", "color": nil})
	if directResponse.Code != http.StatusCreated {
		t.Fatalf("direct create status=%d body=%s", directResponse.Code, directResponse.Body.String())
	}
	created = struct {
		ActionItem domain.Entity `json:"action_item"`
	}{}
	if err := json.NewDecoder(directResponse.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	directSource, _ := getSource(created.ActionItem.EntityID)
	if directSource != nil {
		t.Fatalf("direct Action Item source = %+v, want unset", directSource)
	}
	methodResponse := httptest.NewRecorder()
	methodRequest := httptest.NewRequest(http.MethodPut, "/v1/action-items/"+created.ActionItem.EntityID+"/source?company_id="+company.CompanyID, bytes.NewReader([]byte(`{}`)))
	handler.ServeHTTP(methodResponse, withMember(methodRequest))
	if methodResponse.Code != http.StatusMethodNotAllowed {
		t.Fatalf("source mutation status=%d body=%s, want 405", methodResponse.Code, methodResponse.Body.String())
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

type actionItemSourceBatchCountingRepo struct {
	store.Repository
	batchCalls  int
	singleCalls int
}

func (r *actionItemSourceBatchCountingRepo) ListVisibleActionItemSources(companyID, viewerUserID string, entityIDs []string) (map[string]domain.ActionItemSourceView, error) {
	r.batchCalls++
	return r.Repository.ListVisibleActionItemSources(companyID, viewerUserID, entityIDs)
}

func (r *actionItemSourceBatchCountingRepo) GetActionItemSource(companyID, entityID string) (domain.ActionItemSource, error) {
	r.singleCalls++
	return r.Repository.GetActionItemSource(companyID, entityID)
}
