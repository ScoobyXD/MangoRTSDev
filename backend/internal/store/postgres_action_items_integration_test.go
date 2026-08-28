package store

import (
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestPostgresActionItemHuddleRelationshipLifecycle(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	actor, err := repo.UpsertAuthUser("postgres-action-item-owner", "postgres-action-item-owner@example.test", "Postgres Action Item Owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Postgres Action Item Huddle")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	firstProcess := createPostgresActionItemHuddleProcess(t, repo, company.CompanyID, actor.UserID, "Daily Huddle")
	firstNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: firstProcess.HuddleLogicGateID, Name: "Monday", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	secondNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: firstProcess.HuddleLogicGateID, Name: "Tuesday", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	red := ActionItemColorRed
	created, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Call the supplier", Color: &red,
		HuddleNodeID: firstNode.HuddleNodeID, CreatedByUserID: actor.UserID,
	})
	if err != nil {
		t.Fatalf("CreateActionItem: %v", err)
	}
	for _, huddleNodeID := range []string{firstNode.HuddleNodeID, secondNode.HuddleNodeID} {
		items, err := repo.ListHuddleNodeActionItems(company.CompanyID, huddleNodeID)
		if err != nil {
			t.Fatal(err)
		}
		if len(items) != 1 || items[0].EntityID != created.EntityID {
			t.Fatalf("Huddle Node %s action items = %+v, want %s", huddleNodeID, items, created.EntityID)
		}
	}

	secondProcess := createPostgresActionItemHuddleProcess(t, repo, company.CompanyID, actor.UserID, "Weekly Huddle")
	for label, huddleLogicGateID := range map[string]string{
		"duplicate edge": firstProcess.HuddleLogicGateID,
		"second owner":   secondProcess.HuddleLogicGateID,
	} {
		if _, err := db.Exec(`insert into action_item_huddle_relationships(company_id,entity_id,huddle_logic_gate_id) values($1::uuid,$2::uuid,$3::uuid)`, company.CompanyID, created.EntityID, huddleLogicGateID); err == nil {
			t.Fatalf("%s insert succeeded; one Action Item must have at most one Huddle Process owner", label)
		}
	}

	otherCompany, err := repo.CreateCompany("Other Postgres Action Item Huddle")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, otherCompany.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	otherProcess := createPostgresActionItemHuddleProcess(t, repo, otherCompany.CompanyID, actor.UserID, "Other Company Huddle")
	otherNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: otherCompany.CompanyID, OwnerID: otherProcess.HuddleLogicGateID, Name: "Other Company Node", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Wrong company", HuddleNodeID: otherNode.HuddleNodeID, CreatedByUserID: actor.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-company Huddle Node error = %v, want ErrNotFound", err)
	}
	unattached, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Unattached", CreatedByUserID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into action_item_huddle_relationships(company_id,entity_id,huddle_logic_gate_id) values($1::uuid,$2::uuid,$3::uuid)`, company.CompanyID, unattached.EntityID, otherProcess.HuddleLogicGateID); err == nil {
		t.Fatal("cross-company Action Item relationship insert succeeded")
	}

	if err := repo.DeleteHuddleNode(company.CompanyID, firstNode.HuddleNodeID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleNode(company.CompanyID, secondNode.HuddleNodeID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleLogicGate(company.CompanyID, firstProcess.HuddleLogicGateID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if got := countPostgresRows(t, db, `select count(*) from action_item_huddle_relationships where company_id=$1::uuid and entity_id=$2::uuid`, company.CompanyID, created.EntityID); got != 0 {
		t.Fatalf("live relationships after Huddle Process recycle = %d, want 0", got)
	}
	recycleItems, err := repo.ListRecycleBinItems(company.CompanyID, actor.UserID)
	if err != nil {
		t.Fatal(err)
	}
	processRecycleID := ""
	for _, recycleItem := range recycleItems {
		if recycleItem.ObjectKind == "huddle_logic_gate" && recycleItem.ObjectID == firstProcess.HuddleLogicGateID {
			processRecycleID = recycleItem.RecycleBinItemID
			break
		}
	}
	if processRecycleID == "" {
		t.Fatalf("Huddle Process recycle item missing from %+v", recycleItems)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{processRecycleID}); err != nil {
		t.Fatal(err)
	}
	if got := countPostgresRows(t, db, `select count(*) from action_item_huddle_relationships where company_id=$1::uuid and entity_id=$2::uuid and huddle_logic_gate_id=$3::uuid`, company.CompanyID, created.EntityID, firstProcess.HuddleLogicGateID); got != 1 {
		t.Fatalf("restored relationships = %d, want 1", got)
	}
	restoredNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: firstProcess.HuddleLogicGateID, Name: "Restored", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	restoredItems, err := repo.ListHuddleNodeActionItems(company.CompanyID, restoredNode.HuddleNodeID)
	if err != nil || len(restoredItems) != 1 || restoredItems[0].EntityID != created.EntityID {
		t.Fatalf("restored Huddle Process action items = %+v, err = %v", restoredItems, err)
	}
}

func createPostgresActionItemHuddleProcess(t *testing.T, repo *PostgresRepo, companyID, actorID, name string) domain.HuddleLogicGate {
	t.Helper()
	gate, err := repo.CreateLogicGate(companyID, name)
	if err != nil {
		t.Fatal(err)
	}
	huddle, err := repo.ConvertLogicGateToHuddle(companyID, gate.LogicGateID, actorID)
	if err != nil {
		t.Fatal(err)
	}
	return huddle
}
