package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPostgresHuddleNodeNameOnlyUpdatePreservesDate(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Postgres Huddle date update")
	if err != nil {
		t.Fatal(err)
	}
	board, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: company.CompanyID, Name: "Daily"})
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(HuddleCreateInput{
		CompanyID: company.CompanyID, OwnerID: board.HuddleLogicGateID, Name: "Original",
		Now: time.Date(2026, time.January, 1, 7, 59, 59, 0, time.UTC),
	})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := repo.UpdateHuddleNode(HuddleUpdateInput{
		CompanyID: company.CompanyID, ResourceID: node.HuddleNodeID, Name: "Renamed",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Renamed" || updated.HuddleDate != node.HuddleDate || updated.HuddleDate != "2025-12-31" {
		t.Fatalf("name-only update = %+v, original = %+v", updated, node)
	}
}

func TestPostgresHuddleDateAndSavedViewMigrationUpgradesLegacyStateTwice(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	if _, err := db.Exec(`
alter table huddle_nodes drop column huddle_date;
alter table saved_views drop constraint saved_views_surface_chk;
alter table saved_views add constraint saved_views_surface_chk check (surface in (
  'updates',
  'logic_gate_kanban',
  'my_work_action_items_mine',
  'my_work_action_items_delegated',
  'huddle_logic_gate_action_items',
  'huddle_node_action_items'
));
drop index idx_saved_views_action_items_user_single;
create unique index idx_saved_views_action_items_user_single
  on saved_views(company_id,surface,principal,principal_id)
  where surface in (
    'my_work_action_items_mine',
    'my_work_action_items_delegated',
    'huddle_logic_gate_action_items',
    'huddle_node_action_items'
  ) and principal='user'`); err != nil {
		t.Fatalf("prepare legacy Huddle schema: %v", err)
	}
	company, err := repo.CreateCompany("Postgres Huddle recycle date backfill")
	if err != nil {
		t.Fatal(err)
	}
	board, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: company.CompanyID, Name: "Daily"})
	if err != nil {
		t.Fatal(err)
	}
	liveNodeID := NewUUIDv7String()
	if _, err := db.Exec(`
insert into huddle_nodes(
  company_id,huddle_node_id,huddle_logic_gate_id,name,created_timestamp,updated_timestamp
) values($1::uuid,$2::uuid,$3::uuid,'Legacy live node','2026-01-01T07:59:59Z','2026-01-01T07:59:59Z')`,
		company.CompanyID, liveNodeID, board.HuddleLogicGateID); err != nil {
		t.Fatalf("insert legacy live Huddle Node: %v", err)
	}
	payload := map[string]any{
		"huddle_nodes": []map[string]any{
			{
				"company_id": company.CompanyID, "huddle_node_id": NewUUIDv7String(),
				"huddle_logic_gate_id": board.HuddleLogicGateID, "name": "Missing date",
				"created_timestamp": "2026-01-01T07:59:59Z", "updated_timestamp": "2026-01-01T07:59:59Z",
			},
			{
				"company_id": company.CompanyID, "huddle_node_id": NewUUIDv7String(),
				"huddle_logic_gate_id": board.HuddleLogicGateID, "name": "Existing date",
				"huddle_date": "2000-01-01", "created_timestamp": "2026-01-01T08:00:00Z",
				"updated_timestamp": "2026-01-01T08:00:00Z",
			},
		},
		"unrelated_table":  []map[string]any{{"keep": "unchanged"}},
		"unrelated_object": map[string]any{"nested": true},
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	recycleID := NewUUIDv7String()
	if _, err := db.Exec(`
insert into recycle_bin_items(company_id,recycle_bin_item_id,object_kind,object_id,object_label,restore_payload)
values($1::uuid,$2::uuid,'huddle_node',$3,'Archived Huddle Node',$4::jsonb)`, company.CompanyID, recycleID, NewUUIDv7String(), string(rawPayload)); err != nil {
		t.Fatal(err)
	}
	legacySavedViewID := NewUUIDv7String()
	viewUserID := NewUUIDv7String()
	if _, err := db.Exec(`
insert into saved_views(company_id,saved_view_id,surface,principal,principal_id,name)
values($1::uuid,$2::uuid,'huddle_node_action_items','user',$3::uuid,'Legacy Huddle Node view')`,
		company.CompanyID, legacySavedViewID, viewUserID); err != nil {
		t.Fatalf("insert legacy Huddle saved view: %v", err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260831_huddle_node_dates_and_action_item_views.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= 2; attempt++ {
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(string(migration)); err != nil {
			_ = tx.Rollback()
			t.Fatalf("apply Huddle date migration attempt %d: %v", attempt, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit Huddle date migration attempt %d: %v", attempt, err)
		}
	}

	var liveDate string
	if err := db.QueryRow(`
select huddle_date::text from huddle_nodes
where company_id=$1::uuid and huddle_node_id=$2::uuid`, company.CompanyID, liveNodeID).Scan(&liveDate); err != nil {
		t.Fatal(err)
	}
	if liveDate != "2025-12-31" {
		t.Fatalf("legacy live Huddle date = %q, want 2025-12-31", liveDate)
	}
	var updatedRaw []byte
	if err := db.QueryRow(`select restore_payload from recycle_bin_items where company_id=$1::uuid and recycle_bin_item_id=$2::uuid`, company.CompanyID, recycleID).Scan(&updatedRaw); err != nil {
		t.Fatal(err)
	}
	var updated struct {
		HuddleNodes    []map[string]any `json:"huddle_nodes"`
		UnrelatedTable []map[string]any `json:"unrelated_table"`
		Unrelated      map[string]any   `json:"unrelated_object"`
	}
	if err := json.Unmarshal(updatedRaw, &updated); err != nil {
		t.Fatal(err)
	}
	if len(updated.HuddleNodes) != 2 || updated.HuddleNodes[0]["huddle_date"] != "2025-12-31" || updated.HuddleNodes[1]["huddle_date"] != "2000-01-01" {
		t.Fatalf("backfilled Huddle Node payload = %s", updatedRaw)
	}
	if len(updated.UnrelatedTable) != 1 || updated.UnrelatedTable[0]["keep"] != "unchanged" || updated.Unrelated["nested"] != true {
		t.Fatalf("migration changed unrelated restore payload keys: %s", updatedRaw)
	}

	var nullable, defaultExpression string
	if err := db.QueryRow(`
select is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name='huddle_nodes' and column_name='huddle_date'`).Scan(&nullable, &defaultExpression); err != nil {
		t.Fatal(err)
	}
	normalizedDefault := strings.ToLower(defaultExpression)
	if nullable != "NO" || !strings.Contains(normalizedDefault, "statement_timestamp") || !strings.Contains(normalizedDefault, "america/los_angeles") {
		t.Fatalf("Huddle date column nullable/default = %q/%q", nullable, defaultExpression)
	}
	defaultedNodeID := NewUUIDv7String()
	var defaultedDate, currentBusinessDate string
	if err := db.QueryRow(`
with inserted as (
  insert into huddle_nodes(company_id,huddle_node_id,huddle_logic_gate_id,name)
  values($1::uuid,$2::uuid,$3::uuid,'Defaulted node')
  returning huddle_date
)
select huddle_date::text,((statement_timestamp() at time zone 'America/Los_Angeles')::date)::text
from inserted`, company.CompanyID, defaultedNodeID, board.HuddleLogicGateID).Scan(&defaultedDate, &currentBusinessDate); err != nil {
		t.Fatal(err)
	}
	if defaultedDate != currentBusinessDate {
		t.Fatalf("defaulted Huddle date = %q, want current Los Angeles date %q", defaultedDate, currentBusinessDate)
	}
	if _, err := db.Exec(`
insert into huddle_nodes(company_id,huddle_node_id,huddle_logic_gate_id,name,huddle_date)
values($1::uuid,$2::uuid,$3::uuid,'Null date',null)`, company.CompanyID, NewUUIDv7String(), board.HuddleLogicGateID); err == nil {
		t.Fatal("Huddle date accepted an explicit NULL after migration")
	}

	var legacyViewRows int
	if err := db.QueryRow(`select count(*) from saved_views where company_id=$1::uuid and saved_view_id=$2::uuid`, company.CompanyID, legacySavedViewID).Scan(&legacyViewRows); err != nil {
		t.Fatal(err)
	}
	if legacyViewRows != 0 {
		t.Fatalf("legacy Huddle Node saved view rows = %d, want 0", legacyViewRows)
	}
	if _, err := db.Exec(`
insert into saved_views(company_id,saved_view_id,surface,principal,principal_id,name) values
  ($1::uuid,$2::uuid,'huddle_node_created_action_items','user',$4::uuid,'Created view'),
  ($1::uuid,$3::uuid,'huddle_node_due_action_items','user',$4::uuid,'Due view')`,
		company.CompanyID, NewUUIDv7String(), NewUUIDv7String(), viewUserID); err != nil {
		t.Fatalf("insert independent Huddle Node saved views: %v", err)
	}
	if _, err := db.Exec(`
insert into saved_views(company_id,saved_view_id,surface,principal,principal_id,name)
values($1::uuid,$2::uuid,'huddle_node_created_action_items','user',$3::uuid,'Duplicate created view')`,
		company.CompanyID, NewUUIDv7String(), viewUserID); err == nil {
		t.Fatal("Huddle Node created surface accepted a second user singleton")
	}
	if _, err := db.Exec(`
insert into saved_views(company_id,saved_view_id,surface,principal,principal_id,name)
values($1::uuid,$2::uuid,'huddle_node_action_items','user',$3::uuid,'Retired view')`,
		company.CompanyID, NewUUIDv7String(), viewUserID); err == nil {
		t.Fatal("saved_views still accepts the retired Huddle Node surface")
	}
	var surfaceConstraint, singletonIndex string
	if err := db.QueryRow(`
select pg_get_constraintdef(oid)
from pg_constraint
where conrelid='public.saved_views'::regclass and conname='saved_views_surface_chk'`).Scan(&surfaceConstraint); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select pg_get_indexdef('public.idx_saved_views_action_items_user_single'::regclass)`).Scan(&singletonIndex); err != nil {
		t.Fatal(err)
	}
	for label, definition := range map[string]string{"surface constraint": surfaceConstraint, "singleton index": singletonIndex} {
		for _, required := range []string{"huddle_node_created_action_items", "huddle_node_due_action_items"} {
			if !strings.Contains(definition, required) {
				t.Fatalf("%s missing %q: %s", label, required, definition)
			}
		}
		if strings.Contains(definition, "huddle_node_action_items") {
			t.Fatalf("%s retains retired Huddle Node surface: %s", label, definition)
		}
	}
}
