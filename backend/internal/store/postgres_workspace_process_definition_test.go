package store

import (
	"errors"
	"reflect"
	"testing"
)

func TestPostgresProcessStepMapAuthoredBatch(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	assertProcessStepMapAuthoredBatch(t, repo)
}

func TestPostgresProcessStepMapAuthoredBatchEventFailureIsAtomic(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Atomic authored Process")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "folder", "Destination")
	if err != nil {
		t.Fatal(err)
	}
	beforePlacements := postgresAutomaticTestPlacements(t, db, company.CompanyID)
	var beforeEvents, beforeOutbox int
	if err := db.QueryRow(`select (select count(*) from domain_events),(select count(*) from realtime_outbox)`).Scan(&beforeEvents, &beforeOutbox); err != nil {
		t.Fatal(err)
	}
	installRealtimeOutboxFailureTrigger(t, db)
	forceRealtimeOutboxEvent(t, db, ProcessWorkChangedEventType, true)
	input := authoredProcessBatch(company.CompanyID, folder.FolderID)
	if _, err := repo.CreateWorkspaceEntityBatch(input); err == nil {
		t.Fatal("authored save succeeded despite failed work outbox")
	}
	if _, err := repo.GetLogicGate(company.CompanyID, input.ProcessDefinition.LogicGateID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed authored save leaked Process: %v", err)
	}
	if after := postgresAutomaticTestPlacements(t, db, company.CompanyID); !reflect.DeepEqual(beforePlacements, after) {
		t.Fatal("failed authored save changed company map")
	}
	var steps, edges, layouts, items, policies, events, outbox int
	if err := db.QueryRow(`select
 (select count(*) from process_steps where logic_gate_id=$1::uuid),
 (select count(*) from resource_operational_relationships where source_resource_id=$2::uuid),
 (select count(*) from process_step_map_layouts where logic_gate_id=$1::uuid),
 (select count(*) from company_explorer_items where target_type='logic_gate' and target_id=$1::uuid),
 (select count(*) from resource_permission_settings where resource_type='logic_gate' and resource_id=$1::uuid),
 (select count(*) from domain_events),(select count(*) from realtime_outbox)`, input.ProcessDefinition.LogicGateID, input.ProcessDefinition.Steps[0].ProcessStepID).Scan(&steps, &edges, &layouts, &items, &policies, &events, &outbox); err != nil {
		t.Fatal(err)
	}
	if steps+edges+layouts+items+policies != 0 || events != beforeEvents || outbox != beforeOutbox {
		t.Fatalf("failed save leaked rows: steps=%d edges=%d layouts=%d items=%d policies=%d events=%d/%d outbox=%d/%d", steps, edges, layouts, items, policies, events, beforeEvents, outbox, beforeOutbox)
	}
}
