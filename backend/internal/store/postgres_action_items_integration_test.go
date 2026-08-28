package store

import (
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestPostgresEntityRelationshipHuddleLifecycle(t *testing.T) {
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
	if workspace, workspaceErr := repo.GetHuddleNodeWorkspace(company.CompanyID, firstNode.HuddleNodeID); workspaceErr != nil || len(workspace.Textboxes) != 1 || workspace.Textboxes[0].Title != "New text box" || workspace.Textboxes[0].DisplayOrder != 0 {
		t.Fatalf("new Postgres Huddle Node workspace=%+v err=%v", workspace, workspaceErr)
	}
	secondNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: firstProcess.HuddleLogicGateID, Name: "Tuesday", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Call the supplier", CreatedByUserID: actor.UserID})
	if err != nil {
		t.Fatalf("CreateActionItem: %v", err)
	}
	assertActionItemFieldValue(t, created, ActionItemColorSystemKey, "null")
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and entity_id=$2::uuid`, company.CompanyID, created.EntityID); got != 0 {
		t.Fatalf("company-wide creation relationship count = %d, want 0", got)
	}

	ordinaryType, err := repo.CreateEntityType(EntityTypeInput{CompanyID: company.CompanyID, Name: "Decision"})
	if err != nil {
		t.Fatal(err)
	}
	ordinary, err := repo.CreateEntity(EntityInput{CompanyID: company.CompanyID, EntityTypeID: ordinaryType.EntityTypeID, Name: "Ordinary Entity"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into entity_relationships(company_id,entity_id,resource_type,resource_id) values($1::uuid,$2::uuid,'huddle_node',$3::uuid)`, company.CompanyID, ordinary.EntityID, firstNode.HuddleNodeID); err != nil {
		t.Fatal(err)
	}

	firstRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, firstNode.HuddleNodeID, "Monday notes")
	firstCommit := commitActionItemEditorTestDocument(t, repo, firstRef, actor.UserID, 0, "postgres-first-reference",
		actionItemEditorReference{EntityID: created.EntityID, ActionItem: true},
		actionItemEditorReference{EntityID: created.EntityID, ActionItem: false},
		actionItemEditorReference{EntityID: ordinary.EntityID, ActionItem: true},
	)
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and entity_id=$2::uuid and resource_id=$3::uuid`, company.CompanyID, created.EntityID, firstNode.HuddleNodeID); got != 1 {
		t.Fatalf("duplicate saved references relationship count = %d, want 1", got)
	}
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and entity_id=$2::uuid and resource_id=$3::uuid`, company.CompanyID, ordinary.EntityID, firstNode.HuddleNodeID); got != 1 {
		t.Fatalf("ordinary Entity relationship count after save = %d, want 1", got)
	}

	siblingRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, firstNode.HuddleNodeID, "More Monday notes")
	siblingCommit := commitActionItemEditorTestDocument(t, repo, siblingRef, actor.UserID, 0, "postgres-sibling-reference", actionItemEditorReference{EntityID: created.EntityID, ActionItem: false})
	firstClear := commitActionItemEditorTestDocument(t, repo, firstRef, actor.UserID, firstCommit.Revision, "postgres-remove-one-reference")
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and entity_id=$2::uuid and resource_id=$3::uuid`, company.CompanyID, created.EntityID, firstNode.HuddleNodeID); got != 1 {
		t.Fatalf("surviving sibling reference relationship count = %d, want 1", got)
	}
	commitActionItemEditorTestDocument(t, repo, siblingRef, actor.UserID, siblingCommit.Revision, "postgres-remove-final-reference")
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and entity_id=$2::uuid and resource_id=$3::uuid`, company.CompanyID, created.EntityID, firstNode.HuddleNodeID); got != 0 {
		t.Fatalf("final reference removal relationship count = %d, want 0", got)
	}
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and entity_id=$2::uuid and resource_id=$3::uuid`, company.CompanyID, ordinary.EntityID, firstNode.HuddleNodeID); got != 1 {
		t.Fatalf("ordinary Entity relationship count after Action Item removal = %d, want 1", got)
	}
	if _, err := repo.GetEntity(company.CompanyID, created.EntityID); err != nil {
		t.Fatalf("final reference removal deleted Action Item: %v", err)
	}

	firstReadd := commitActionItemEditorTestDocument(t, repo, firstRef, actor.UserID, firstClear.Revision, "postgres-readd-first-reference", actionItemEditorReference{EntityID: created.EntityID, ActionItem: false})
	secondRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, secondNode.HuddleNodeID, "Tuesday notes")
	secondCommit := commitActionItemEditorTestDocument(t, repo, secondRef, actor.UserID, 0, "postgres-second-node-reference", actionItemEditorReference{EntityID: created.EntityID, ActionItem: true})
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and entity_id=$2::uuid`, company.CompanyID, created.EntityID); got != 2 {
		t.Fatalf("two exact Huddle Node relationships = %d, want 2", got)
	}
	for _, huddleNodeID := range []string{firstNode.HuddleNodeID, secondNode.HuddleNodeID} {
		items, listErr := repo.ListHuddleNodeActionItems(company.CompanyID, huddleNodeID)
		if listErr != nil || len(items) != 1 || items[0].EntityID != created.EntityID {
			t.Fatalf("deduped first Process items for %s = %+v, err=%v", huddleNodeID, items, listErr)
		}
	}

	secondProcess := createPostgresActionItemHuddleProcess(t, repo, company.CompanyID, actor.UserID, "Weekly Huddle")
	thirdNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: secondProcess.HuddleLogicGateID, Name: "Weekly", ActorID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	thirdRef := createActionItemEditorTestTextbox(t, repo, company.CompanyID, thirdNode.HuddleNodeID, "Weekly notes")
	commitActionItemEditorTestDocument(t, repo, thirdRef, actor.UserID, 0, "postgres-other-process-reference", actionItemEditorReference{EntityID: created.EntityID, ActionItem: true})
	firstSecondClear := commitActionItemEditorTestDocument(t, repo, firstRef, actor.UserID, firstReadd.Revision, "postgres-clear-first-node")
	items, err := repo.ListHuddleNodeActionItems(company.CompanyID, firstNode.HuddleNodeID)
	if err != nil || len(items) != 1 {
		t.Fatalf("remaining same-Process reference items=%+v err=%v", items, err)
	}
	commitActionItemEditorTestDocument(t, repo, secondRef, actor.UserID, secondCommit.Revision, "postgres-clear-second-node")
	items, err = repo.ListHuddleNodeActionItems(company.CompanyID, firstNode.HuddleNodeID)
	if err != nil || len(items) != 0 {
		t.Fatalf("removed final first Process reference items=%+v err=%v", items, err)
	}
	items, err = repo.ListHuddleNodeActionItems(company.CompanyID, thirdNode.HuddleNodeID)
	if err != nil || len(items) != 1 || items[0].EntityID != created.EntityID {
		t.Fatalf("second Process reference items=%+v err=%v", items, err)
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
	if _, err := db.Exec(`insert into entity_relationships(company_id,entity_id,resource_type,resource_id) values($1::uuid,$2::uuid,'huddle_node',$3::uuid)`, company.CompanyID, created.EntityID, otherNode.HuddleNodeID); err == nil {
		t.Fatal("cross-company Action Item relationship insert succeeded")
	}
	if _, err := db.Exec(`insert into entity_relationships(company_id,entity_id,resource_type,resource_id) values($1::uuid,$2::uuid,'logic_gate',$3::uuid)`, company.CompanyID, created.EntityID, firstNode.HuddleNodeID); err == nil {
		t.Fatal("unsupported generic resource type insert succeeded")
	}

	commitActionItemEditorTestDocument(t, repo, firstRef, actor.UserID, firstSecondClear.Revision, "postgres-reference-before-recycle", actionItemEditorReference{EntityID: created.EntityID, ActionItem: false})
	if err := repo.DeleteHuddleNode(company.CompanyID, firstNode.HuddleNodeID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and resource_id=$2::uuid`, company.CompanyID, firstNode.HuddleNodeID); got != 0 {
		t.Fatalf("live relationships after exact Huddle Node recycle = %d, want 0", got)
	}
	recycleItems, err := repo.ListRecycleBinItems(company.CompanyID, actor.UserID)
	if err != nil {
		t.Fatal(err)
	}
	firstNodeRecycleID := ""
	for _, recycleItem := range recycleItems {
		if recycleItem.ObjectKind == "huddle_node" && recycleItem.ObjectID == firstNode.HuddleNodeID {
			firstNodeRecycleID = recycleItem.RecycleBinItemID
			break
		}
	}
	if firstNodeRecycleID == "" {
		t.Fatalf("Huddle Node recycle item missing from %+v", recycleItems)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{firstNodeRecycleID}); err != nil {
		t.Fatal(err)
	}
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and resource_id=$2::uuid`, company.CompanyID, firstNode.HuddleNodeID); got != 2 {
		t.Fatalf("restored exact Node relationships = %d, want 2", got)
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
	recycleItems, err = repo.ListRecycleBinItems(company.CompanyID, actor.UserID)
	if err != nil {
		t.Fatal(err)
	}
	firstNodeRecycleID, processRecycleID := "", ""
	for _, recycleItem := range recycleItems {
		switch {
		case recycleItem.ObjectKind == "huddle_node" && recycleItem.ObjectID == firstNode.HuddleNodeID:
			firstNodeRecycleID = recycleItem.RecycleBinItemID
		case recycleItem.ObjectKind == "huddle_logic_gate" && recycleItem.ObjectID == firstProcess.HuddleLogicGateID:
			processRecycleID = recycleItem.RecycleBinItemID
		}
	}
	if firstNodeRecycleID == "" || processRecycleID == "" {
		t.Fatalf("Huddle Process/Node recycle items missing from %+v", recycleItems)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{processRecycleID, firstNodeRecycleID}); err != nil {
		t.Fatal(err)
	}
	restoredItems, err := repo.ListHuddleNodeActionItems(company.CompanyID, firstNode.HuddleNodeID)
	if err != nil || len(restoredItems) != 1 || restoredItems[0].EntityID != created.EntityID {
		t.Fatalf("restored Huddle Process and Node action items = %+v, err = %v", restoredItems, err)
	}
}

func TestPostgresHuddleLogicGateActionItemRelationshipLifecycle(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	actor, err := repo.UpsertAuthUser("postgres-direct-huddle-action-item", "postgres-direct-huddle-action-item@example.test", "Direct Huddle Owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Postgres Direct Huddle Action Item")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	process := createPostgresActionItemHuddleProcess(t, repo, company.CompanyID, actor.UserID, "Direct Process")
	actionItem, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Direct gate action", CreatedByUserID: actor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	ref := EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeHuddleLogicGate, ResourceID: process.HuddleLogicGateID, DocumentID: process.HuddleLogicGateID}
	commitActionItemEditorTestDocument(t, repo, ref, actor.UserID, 0, "postgres-direct-gate-reference", actionItemEditorReference{EntityID: actionItem.EntityID})
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and entity_id=$2::uuid and resource_type='huddle_logic_gate' and resource_id=$3::uuid`, company.CompanyID, actionItem.EntityID, process.HuddleLogicGateID); got != 1 {
		t.Fatalf("direct Huddle Logic Gate relationship count=%d, want 1", got)
	}
	items, err := repo.ListHuddleLogicGateActionItems(company.CompanyID, process.HuddleLogicGateID)
	if err != nil || len(items) != 1 || items[0].EntityID != actionItem.EntityID {
		t.Fatalf("direct Huddle Logic Gate items=%+v err=%v", items, err)
	}

	otherCompany, err := repo.CreateCompany("Other Direct Huddle Company")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, otherCompany.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	otherProcess := createPostgresActionItemHuddleProcess(t, repo, otherCompany.CompanyID, actor.UserID, "Other Direct Process")
	if _, err := db.Exec(`insert into entity_relationships(company_id,entity_id,resource_type,resource_id) values($1::uuid,$2::uuid,'huddle_logic_gate',$3::uuid)`, company.CompanyID, actionItem.EntityID, otherProcess.HuddleLogicGateID); err == nil {
		t.Fatal("cross-company Huddle Logic Gate relationship insert succeeded")
	}

	if err := repo.DeleteHuddleLogicGate(company.CompanyID, process.HuddleLogicGateID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if got := countPostgresRows(t, db, `select count(*) from entity_relationships where company_id=$1::uuid and resource_type='huddle_logic_gate' and resource_id=$2::uuid`, company.CompanyID, process.HuddleLogicGateID); got != 0 {
		t.Fatalf("direct Huddle Logic Gate relationships after recycle=%d, want 0", got)
	}
	recycleItems, err := repo.ListRecycleBinItems(company.CompanyID, actor.UserID)
	if err != nil {
		t.Fatal(err)
	}
	processRecycleID := ""
	for _, item := range recycleItems {
		if item.ObjectKind == EntityTypeHuddleLogicGate && item.ObjectID == process.HuddleLogicGateID {
			processRecycleID = item.RecycleBinItemID
		}
	}
	if processRecycleID == "" {
		t.Fatalf("direct Huddle Logic Gate recycle item missing from %+v", recycleItems)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{processRecycleID}); err != nil {
		t.Fatal(err)
	}
	items, err = repo.ListHuddleLogicGateActionItems(company.CompanyID, process.HuddleLogicGateID)
	if err != nil || len(items) != 1 || items[0].EntityID != actionItem.EntityID {
		t.Fatalf("restored direct Huddle Logic Gate items=%+v err=%v", items, err)
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
