package store

import (
	"context"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryRealtimeHuddleAndKPIAudienceResolution(t *testing.T) {
	repo := NewMemoryRepo()
	company := repo.EnsureCompany("11111111-1111-4111-8111-111111111111", "Realtime audience")
	user, err := repo.UpsertAuthUser("realtime-audience-user", "realtime-audience@example.test", "Realtime Audience User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("realtime-audience-user", company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	logicGate, err := repo.CreateLogicGate(company.CompanyID, "KPI owner")
	if err != nil {
		t.Fatal(err)
	}
	huddleLogicGateID := "22222222-2222-4222-8222-222222222222"
	huddleNodeID := "33333333-3333-4333-8333-333333333333"
	kpiID := "44444444-4444-4444-8444-444444444444"
	repo.mu.Lock()
	repo.huddleLogicGates[key(company.CompanyID, huddleLogicGateID)] = domain.HuddleLogicGate{CompanyID: company.CompanyID, HuddleLogicGateID: huddleLogicGateID, Header: "Huddle"}
	repo.huddleNodes[key(company.CompanyID, huddleNodeID)] = domain.HuddleNode{CompanyID: company.CompanyID, HuddleNodeID: huddleNodeID, HuddleLogicGateID: huddleLogicGateID, Name: "Huddle Node"}
	repo.kpis[key(company.CompanyID, kpiID)] = domain.KPI{CompanyID: company.CompanyID, KPIID: kpiID, LogicGateID: logicGate.LogicGateID, Name: "KPI"}
	repo.mu.Unlock()

	for _, resource := range []struct {
		resourceType string
		resourceID   string
	}{
		{EntityTypeHuddleLogicGate, huddleLogicGateID},
		{EntityTypeHuddleNode, huddleNodeID},
		{EntityTypeKPI, kpiID},
	} {
		exists, userIDs, err := repo.ResolveEffectiveUsersForResource(
			context.Background(), company.CompanyID, resource.resourceType, resource.resourceID,
			EntityPermissionEdit, []string{user.UserID},
		)
		if err != nil || !exists || len(userIDs) != 1 || userIDs[0] != user.UserID {
			t.Fatalf("%s audience exists=%v userIDs=%v err=%v", resource.resourceType, exists, userIDs, err)
		}
	}
}
