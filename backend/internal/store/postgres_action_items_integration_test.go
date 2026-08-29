package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestPostgresActionItemSourceEndpointLockOrdersConcurrentPermanentDelete(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	actor, err := repo.UpsertAuthUser("postgres-source-lock-owner", "postgres-source-lock-owner@example.test", "Postgres Source Lock Owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Postgres Source Lock")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(company.CompanyID, "Concurrent source endpoint")
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	input := ActionItemInput{
		CompanyID: company.CompanyID, CreatedByUserID: actor.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: node.NodeID,
	}
	if err := validatePostgresActionItemSourceTx(ctx, tx, input); err != nil {
		t.Fatal(err)
	}
	entityID := newUUIDv7String()
	if _, err := tx.ExecContext(ctx, `insert into entities(company_id,entity_id,entity_type_id,name,created_by_user_id) values($1::uuid,$2::uuid,$3::uuid,'Concurrent Source',$4::uuid)`, company.CompanyID, entityID, ActionItemEntityTypeID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	result, err := tx.ExecContext(ctx, `
insert into entity_fields(company_id,entity_field_id,entity_id,entity_field_type_id,name,field_type,value_jsonb,position)
select $1::uuid,gen_random_uuid(),$2::uuid,entity_field_type_id,name,field_type,$3::jsonb,position
from entity_field_types
where company_id=$1::uuid and entity_field_type_id=$4::uuid`, company.CompanyID, entityID, actionItemSourceValue(EntityTypeNode, node.NodeID), ActionItemSourceFieldTypeID)
	if err != nil {
		t.Fatal(err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		t.Fatalf("Source insert affected=%d err=%v, want 1", affected, err)
	}

	deleteCtx, cancelDelete := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDelete()
	deleteStarted := make(chan struct{})
	deleteDone := make(chan error, 1)
	go func() {
		close(deleteStarted)
		_, deleteErr := db.ExecContext(deleteCtx, `delete from nodes where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, node.NodeID)
		deleteDone <- deleteErr
	}()
	<-deleteStarted
	select {
	case deleteErr := <-deleteDone:
		t.Fatalf("endpoint delete completed before Source transaction committed: %v", deleteErr)
	case <-time.After(150 * time.Millisecond):
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case deleteErr := <-deleteDone:
		if deleteErr != nil {
			t.Fatal(deleteErr)
		}
	case <-deleteCtx.Done():
		t.Fatalf("endpoint delete did not finish after Source commit: %v", deleteCtx.Err())
	}
	if got := countPostgresRows(t, db, `select count(*) from entity_fields where company_id=$1::uuid and entity_id=$2::uuid and entity_field_type_id=$3::uuid and value_jsonb is null`, company.CompanyID, entityID, ActionItemSourceFieldTypeID); got != 1 {
		t.Fatalf("Source cleanup after concurrent permanent delete=%d, want 1", got)
	}
}

func TestPostgresActionItemSourceCreationAndDatabaseGuards(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	owner, err := repo.UpsertAuthUser("postgres-action-item-source-owner", "postgres-action-item-source-owner@example.test", "Postgres Source Owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Postgres Action Item Source")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(owner.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	member, err := repo.UpsertAuthUser("postgres-action-item-source-member", "postgres-action-item-source-member@example.test", "Postgres Source Member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	sourceNode, err := repo.CreateNode(company.CompanyID, "Canonical source node")
	if err != nil {
		t.Fatal(err)
	}

	created, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Created from the source node", CreatedByUserID: member.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: sourceNode.NodeID,
	})
	if err != nil {
		t.Fatalf("CreateActionItem with source: %v", err)
	}
	if len(created.EntityFields) != 7 {
		t.Fatalf("required Action Item field count=%d, want 7", len(created.EntityFields))
	}
	for _, systemKey := range []string{
		ActionItemPersonInChargeSystemKey,
		ActionItemAssignedBySystemKey,
		ActionItemAnalysisDueDateSystemKey,
		ActionItemCompletionDueDateSystemKey,
		ActionItemStatusSystemKey,
		ActionItemColorSystemKey,
		ActionItemSourceSystemKey,
	} {
		found := false
		for _, field := range created.EntityFields {
			if field.SystemKey == systemKey {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("required field %q missing from %+v", systemKey, created.EntityFields)
		}
	}
	assertActionItemFieldValue(t, created, ActionItemAssignedBySystemKey, "null")
	assertActionItemFieldValue(t, created, ActionItemSourceSystemKey, `{"resource_id":"`+sourceNode.NodeID+`","resource_type":"node"}`)
	source, err := repo.GetActionItemSource(company.CompanyID, created.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if source.CompanyID != company.CompanyID || source.EntityID != created.EntityID || source.ResourceType != EntityTypeNode || source.ResourceID != sourceNode.NodeID {
		t.Fatalf("stored source=%+v, want exact company/entity/type/resource", source)
	}
	for _, field := range created.EntityFields {
		if field.SystemKey != ActionItemSourceSystemKey {
			continue
		}
		if _, err := repo.UpdateEntityField(EntityFieldInput{
			CompanyID: company.CompanyID, EntityID: created.EntityID, EntityFieldID: field.EntityFieldID,
			Value: field.Value, ValueSet: true,
		}); !errors.Is(err, ErrConflict) {
			t.Fatalf("same-value Source API update error=%v, want ErrConflict", err)
		}
		break
	}

	direct, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Created directly", CreatedByUserID: member.UserID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetActionItemSource(company.CompanyID, direct.EntityID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("direct Action Item source error=%v, want ErrNotFound", err)
	}

	otherCompany, err := repo.CreateCompany("Other Postgres Action Item Source")
	if err != nil {
		t.Fatal(err)
	}
	otherNode, err := repo.CreateNode(otherCompany.CompanyID, "Other company node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateEntityField(EntityFieldInput{
		CompanyID: company.CompanyID, EntityID: direct.EntityID, Name: "Related work",
		FieldType: EntityFieldTypeResource, Value: actionItemSourceValue(EntityTypeNode, otherNode.NodeID), ValueSet: true,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("generic resource field error=%v, want ErrInvalid", err)
	}
	if _, err := repo.CreateEntityFieldType(EntityFieldTypeInput{
		CompanyID: company.CompanyID, EntityTypeID: ActionItemEntityTypeID,
		Name: "Related work", FieldType: EntityFieldTypeResource,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("generic resource template error=%v, want ErrInvalid", err)
	}
	restrictedNode, err := repo.CreateNode(company.CompanyID, "Restricted source node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID: company.CompanyID, EntityType: EntityTypeNode, EntityID: restrictedNode.NodeID,
		DefaultAccess: EntityPermissionNoAccess, DefaultAccessSet: true, ActorUserID: owner.UserID,
	}); err != nil {
		t.Fatal(err)
	}

	actionItemCount := countPostgresRows(t, db, `select count(*) from entities where company_id=$1::uuid and entity_type_id=$2::uuid`, company.CompanyID, ActionItemEntityTypeID)
	sourceCount := countPostgresRows(t, db, `select count(*) from entity_fields where company_id=$1::uuid and entity_field_type_id=$2::uuid and value_jsonb is not null`, company.CompanyID, ActionItemSourceFieldTypeID)
	assertRejectedAtomically := func(name string, input ActionItemInput, want error) {
		t.Helper()
		if _, err := repo.CreateActionItem(input); !errors.Is(err, want) {
			t.Fatalf("%s error=%v, want %v", name, err, want)
		}
		if got := countPostgresRows(t, db, `select count(*) from entities where company_id=$1::uuid and entity_type_id=$2::uuid`, company.CompanyID, ActionItemEntityTypeID); got != actionItemCount {
			t.Fatalf("%s partially wrote an Entity: count=%d, want %d", name, got, actionItemCount)
		}
		if got := countPostgresRows(t, db, `select count(*) from entity_fields where company_id=$1::uuid and entity_field_type_id=$2::uuid and value_jsonb is not null`, company.CompanyID, ActionItemSourceFieldTypeID); got != sourceCount {
			t.Fatalf("%s partially wrote a Source: count=%d, want %d", name, got, sourceCount)
		}
	}
	assertRejectedAtomically("cross-company endpoint", ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Cross-company source", CreatedByUserID: member.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: otherNode.NodeID,
	}, ErrNotFound)
	assertRejectedAtomically("wrong exact endpoint type", ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Wrong source type", CreatedByUserID: member.UserID,
		SourceResourceType: EntityTypeProject, SourceResourceID: sourceNode.NodeID,
	}, ErrNotFound)
	assertRejectedAtomically("unsupported endpoint type", ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Unsupported source type", CreatedByUserID: member.UserID,
		SourceResourceType: "entity", SourceResourceID: sourceNode.NodeID,
	}, ErrInvalid)
	assertRejectedAtomically("unauthorized endpoint", ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Unauthorized source", CreatedByUserID: member.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: restrictedNode.NodeID,
	}, ErrNotFound)

	if _, err := db.Exec(`insert into entity_field_types(company_id,entity_field_type_id,entity_type_id,name,field_type,config_jsonb,position) values($1::uuid,gen_random_uuid(),$2::uuid,'Custom resource','resource','{}'::jsonb,99)`, company.CompanyID, ActionItemEntityTypeID); err == nil {
		t.Fatal("database accepted a noncanonical resource template")
	}
	if _, err := db.Exec(`insert into entity_fields(company_id,entity_field_id,entity_id,name,field_type,value_jsonb,position) values($1::uuid,gen_random_uuid(),$2::uuid,'Custom resource','resource',jsonb_build_object('resource_type','node','resource_id',$3::text),99)`, company.CompanyID, direct.EntityID, sourceNode.NodeID); err == nil {
		t.Fatal("database accepted a noncanonical resource field")
	}
	if _, err := db.Exec(`update entity_fields set value_jsonb=jsonb_build_object('resource_type','node','resource_id',$3::text) where company_id=$1::uuid and entity_id=$2::uuid and entity_field_type_id=$4::uuid`, company.CompanyID, created.EntityID, restrictedNode.NodeID, ActionItemSourceFieldTypeID); err == nil {
		t.Fatal("database accepted a direct Source update")
	}
	if _, err := db.Exec(`delete from entity_fields where company_id=$1::uuid and entity_id=$2::uuid and entity_field_type_id=$3::uuid`, company.CompanyID, created.EntityID, ActionItemSourceFieldTypeID); err == nil {
		t.Fatal("database accepted a direct Source delete")
	}
	if persisted, err := repo.GetActionItemSource(company.CompanyID, created.EntityID); err != nil || persisted.ResourceType != EntityTypeNode || persisted.ResourceID != sourceNode.NodeID {
		t.Fatalf("immutable Source after rejected writes=%+v err=%v", persisted, err)
	}
}

func TestPostgresActionItemSourceRecycleRestoreAndPermanentDelete(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	actor, err := repo.UpsertAuthUser("postgres-action-item-source-lifecycle", "postgres-action-item-source-lifecycle@example.test", "Postgres Source Lifecycle")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Postgres Action Item Source Lifecycle")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	node, err := repo.CreateNode(company.CompanyID, "Restorable source node")
	if err != nil {
		t.Fatal(err)
	}
	nodeActionItem, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Node source lifecycle", CreatedByUserID: actor.UserID,
		SourceResourceType: EntityTypeNode, SourceResourceID: node.NodeID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCompanyExplorerTargets(company.CompanyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeNode, ID: node.NodeID}}, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if source, err := repo.GetActionItemSource(company.CompanyID, nodeActionItem.EntityID); err != nil || source.ResourceType != EntityTypeNode || source.ResourceID != node.NodeID {
		t.Fatalf("preserved recycled Node Source=%+v err=%v", source, err)
	}
	if got := countPostgresRows(t, db, `select count(*) from entity_fields where company_id=$1::uuid and entity_id=$2::uuid and entity_field_type_id=$3::uuid and value_jsonb is not null`, company.CompanyID, nodeActionItem.EntityID, ActionItemSourceFieldTypeID); got != 1 {
		t.Fatalf("recycled Source field values=%d, want preserved value", got)
	}
	nodeRecycleID := postgresActionItemRecycleID(t, repo, company.CompanyID, actor.UserID, EntityTypeNode, node.NodeID)
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{nodeRecycleID}); err != nil {
		t.Fatal(err)
	}
	if source, err := repo.GetActionItemSource(company.CompanyID, nodeActionItem.EntityID); err != nil || source.ResourceType != EntityTypeNode || source.ResourceID != node.NodeID {
		t.Fatalf("restored Node Source=%+v err=%v", source, err)
	}

	logicGate, err := repo.CreateLogicGate(company.CompanyID, "KPI source owner")
	if err != nil {
		t.Fatal(err)
	}
	kpi, err := repo.CreateKPI(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: logicGate.LogicGateID, Name: "Restorable KPI"})
	if err != nil {
		t.Fatal(err)
	}
	kpiActionItem, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "KPI source lifecycle", CreatedByUserID: actor.UserID,
		SourceResourceType: EntityTypeKPI, SourceResourceID: kpi.KPIID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteKPI(company.CompanyID, kpi.KPIID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if source, err := repo.GetActionItemSource(company.CompanyID, kpiActionItem.EntityID); err != nil || source.ResourceType != EntityTypeKPI || source.ResourceID != kpi.KPIID {
		t.Fatalf("preserved recycled KPI Source=%+v err=%v", source, err)
	}
	kpiRecycleID := postgresActionItemRecycleID(t, repo, company.CompanyID, actor.UserID, EntityTypeKPI, kpi.KPIID)
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{kpiRecycleID}); err != nil {
		t.Fatal(err)
	}
	if source, err := repo.GetActionItemSource(company.CompanyID, kpiActionItem.EntityID); err != nil || source.ResourceType != EntityTypeKPI || source.ResourceID != kpi.KPIID {
		t.Fatalf("restored KPI Source=%+v err=%v", source, err)
	}

	if _, err := repo.DeleteCompanyExplorerTargets(company.CompanyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeNode, ID: node.NodeID}}, actor.UserID); err != nil {
		t.Fatal(err)
	}
	permanentNodeRecycleID := postgresActionItemRecycleID(t, repo, company.CompanyID, actor.UserID, EntityTypeNode, node.NodeID)
	if err := repo.PermanentlyDeleteRecycleBinItems(company.CompanyID, actor.UserID, []string{permanentNodeRecycleID}); err != nil {
		t.Fatal(err)
	}
	if got := countPostgresRows(t, db, `select count(*) from entity_fields where company_id=$1::uuid and entity_id=$2::uuid and entity_field_type_id=$3::uuid and value_jsonb is null`, company.CompanyID, nodeActionItem.EntityID, ActionItemSourceFieldTypeID); got != 1 {
		t.Fatalf("cleared Source fields after permanent endpoint deletion=%d, want 1", got)
	}
	if _, err := repo.GetActionItemSource(company.CompanyID, nodeActionItem.EntityID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Source after permanent endpoint deletion error=%v, want ErrNotFound", err)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{permanentNodeRecycleID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore after permanent deletion error=%v, want ErrNotFound", err)
	}
}

func postgresActionItemRecycleID(t *testing.T, repo *PostgresRepo, companyID, actorID, kind, objectID string) string {
	t.Helper()
	items, err := repo.ListRecycleBinItems(companyID, actorID)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ObjectKind == kind && item.ObjectID == objectID {
			return item.RecycleBinItemID
		}
	}
	t.Fatalf("recycle item %s/%s missing from %+v", kind, objectID, items)
	return ""
}

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
