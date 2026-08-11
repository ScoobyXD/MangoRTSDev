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

func TestRACITabsDoorbellUsesExistingCompanyScopedLiveConnection(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "89898989-8989-4989-8989-898989898989"
	token := "raci-tabs-realtime-token"
	repo.EnsureCompany(companyID, "RACI Tabs Realtime")
	manager := mustRealtimeAuthUser(t, repo, companyID, "raci-tabs-realtime-manager", domain.RoleCompanyManager)
	member, err := repo.UpsertAuthUser("raci-tabs-realtime-member", "raci-tabs-member@example.com", "RACI Member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Realtime RACI Gate")
	if err != nil {
		t.Fatal(err)
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Realtime RACI Group")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{member.UserID}); err != nil {
		t.Fatal(err)
	}

	server := newRealtimeAuthServerForTest(repo, token, manager)
	defer server.Close()
	client := openRealtimeWebSocketForTest(t, server.Routes(), "/v1/realtime/ws?company_id="+companyID, token)
	defer client.close()
	client.readJSON(t)
	client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": realtimeRACITabsScope})
	if accepted := client.readJSON(t); accepted["type"] != realtimeMessageSubscriptionAccepted || accepted["scope"] != realtimeRACITabsScope {
		t.Fatalf("RACI Tabs subscription = %+v", accepted)
	}

	assertSignal := func(label string) {
		t.Helper()
		message := client.readJSON(t)
		if message["type"] != "raci_tabs.changed" || message["company_id"] != companyID || message["scope"] != realtimeRACITabsScope {
			t.Fatalf("%s signal = %+v", label, message)
		}
	}

	_, events, err := repo.PutResourceRACIPolicy(store.ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeLogicGate, ResourceID: gate.LogicGateID,
		AssignmentMode: store.PolicyModeCustomized, DescendantAction: store.PolicyDescendantActionInheritedOnly,
		Assignments: []store.ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: store.EntityPermissionSubjectUser, PrincipalID: member.UserID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	server.publishCommittedWorkspaceEvents(events)
	assertSignal("direct assignment")

	_, events, err = repo.PutResourceRACIPolicy(store.ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: store.EntityTypeLogicGate, ResourceID: gate.LogicGateID,
		AssignmentMode: store.PolicyModeCustomized, DescendantAction: store.PolicyDescendantActionInheritedOnly,
		Assignments: []store.ResourceRACIAssignmentInput{{Role: domain.RACIRoleConsulted, PrincipalType: store.EntityPermissionSubjectGroup, PrincipalID: group.GroupID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	server.publishCommittedWorkspaceEvents(events)
	assertSignal("group assignment")

	body, _ := json.Marshal(map[string]any{"user_ids": []string{}})
	req := httptest.NewRequest(http.MethodPut, "/v1/companies/"+companyID+"/user-groups/"+group.GroupID+"/members", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("group membership update status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertSignal("group membership")

	event, err := repo.AppendDomainEvent(store.DomainEventInput{
		CompanyID: companyID, StreamType: "workspace", StreamID: companyID, Type: "resource_gvic_policy_updated",
		Payload: map[string]any{"resource_type": store.EntityTypeCompanyExplorerFolder, "resource_id": "90909090-9090-4090-8090-909090909090"},
	})
	if err != nil {
		t.Fatal(err)
	}
	server.publishCommittedWorkspaceEvent(event)
	assertSignal("inherited folder policy")
}
