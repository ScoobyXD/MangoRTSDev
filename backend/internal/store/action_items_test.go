package store

import (
	"encoding/json"
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryActionItemCreateAndHuddleProcessCollection(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "action-item-owner")

	firstGate, err := repo.CreateLogicGate(company.CompanyID, "Daily Huddle")
	if err != nil {
		t.Fatal(err)
	}
	firstProcess, err := repo.ConvertLogicGateToHuddle(company.CompanyID, firstGate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	firstNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: firstProcess.HuddleLogicGateID, Name: "Monday", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	secondNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: firstProcess.HuddleLogicGateID, Name: "Tuesday", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}

	red := ActionItemColorRed
	created, err := repo.CreateActionItem(ActionItemInput{
		CompanyID: company.CompanyID, BodyText: "Call the supplier\nConfirm the ship date", Color: &red,
		HuddleNodeID: firstNode.HuddleNodeID, CreatedByUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("CreateActionItem: %v", err)
	}
	if created.Name != "Call the supplier" || created.CreatedByUserID != user.UserID || created.EntityTypeID != ActionItemEntityTypeID {
		t.Fatalf("created action item=%+v", created)
	}
	assertActionItemFieldValue(t, created, ActionItemStatusSystemKey, `"in_progress"`)
	assertActionItemFieldValue(t, created, ActionItemColorSystemKey, `"red"`)
	if len(created.EntityFields) != 5 {
		t.Fatalf("field count=%d, want 5", len(created.EntityFields))
	}

	for _, huddleNodeID := range []string{firstNode.HuddleNodeID, secondNode.HuddleNodeID} {
		items, err := repo.ListHuddleNodeActionItems(company.CompanyID, huddleNodeID)
		if err != nil {
			t.Fatal(err)
		}
		if len(items) != 1 || items[0].EntityID != created.EntityID {
			t.Fatalf("huddle node %s items=%+v", huddleNodeID, items)
		}
	}

	secondGate, err := repo.CreateLogicGate(company.CompanyID, "Weekly Huddle")
	if err != nil {
		t.Fatal(err)
	}
	secondProcess, err := repo.ConvertLogicGateToHuddle(company.CompanyID, secondGate.LogicGateID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	otherNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: secondProcess.HuddleLogicGateID, Name: "Weekly", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListHuddleNodeActionItems(company.CompanyID, otherNode.HuddleNodeID)
	if err != nil || len(items) != 0 {
		t.Fatalf("unrelated huddle items=%+v err=%v", items, err)
	}

	if _, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Invalid color", Color: actionItemTestStringPointer("blue"), CreatedByUserID: user.UserID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid color error=%v, want ErrInvalid", err)
	}

	if err := repo.DeleteHuddleNode(company.CompanyID, firstNode.HuddleNodeID, user.UserID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleNode(company.CompanyID, secondNode.HuddleNodeID, user.UserID); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleLogicGate(company.CompanyID, firstProcess.HuddleLogicGateID, user.UserID); err != nil {
		t.Fatal(err)
	}
	if len(repo.actionItemHuddleRelationships) != 0 {
		t.Fatalf("live relationships after Huddle Process recycle=%+v, want none", repo.actionItemHuddleRelationships)
	}
	recycleItems, err := repo.ListRecycleBinItems(company.CompanyID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	var processRecycleID string
	for _, recycleItem := range recycleItems {
		if recycleItem.ObjectKind == "huddle_logic_gate" && recycleItem.ObjectID == firstProcess.HuddleLogicGateID {
			processRecycleID = recycleItem.RecycleBinItemID
			break
		}
	}
	if processRecycleID == "" {
		t.Fatalf("Huddle Process recycle item missing from %+v", recycleItems)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, user.UserID, []string{processRecycleID}); err != nil {
		t.Fatal(err)
	}
	restoredNode, err := repo.CreateHuddleNode(HuddleCreateInput{CompanyID: company.CompanyID, OwnerID: firstProcess.HuddleLogicGateID, Name: "Restored", ActorID: user.UserID})
	if err != nil {
		t.Fatal(err)
	}
	restoredItems, err := repo.ListHuddleNodeActionItems(company.CompanyID, restoredNode.HuddleNodeID)
	if err != nil || len(restoredItems) != 1 || restoredItems[0].EntityID != created.EntityID {
		t.Fatalf("restored Huddle Process action items=%+v err=%v", restoredItems, err)
	}
}

func TestActionItemDefaultsAndLiveTemplateConfig(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "action-item-defaults")

	generic, err := repo.CreateEntity(EntityInput{
		CompanyID: company.CompanyID, EntityTypeID: ActionItemEntityTypeID, Name: "Created from Entities",
		CreatedByUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("generic CreateEntity action item: %v", err)
	}
	assertActionItemFieldValue(t, generic, ActionItemStatusSystemKey, `"in_progress"`)
	assertActionItemFieldValue(t, generic, ActionItemColorSystemKey, "null")
	if err := repo.DeleteEntity(company.CompanyID, generic.EntityID); !errors.Is(err, ErrConflict) {
		t.Fatalf("Action Item hard delete error=%v, want ErrConflict", err)
	}
	if _, err := repo.GetEntity(company.CompanyID, generic.EntityID); err != nil {
		t.Fatalf("Action Item changed after rejected hard delete: %v", err)
	}

	statusTemplate, ok := actionItemTemplateBySystemKey(t, repo, company.CompanyID, ActionItemStatusSystemKey)
	if !ok {
		t.Fatal("status template missing")
	}
	invalidStatusConfig := json.RawMessage(`{"default":"in_progress","options":[{"key":"in_progress","label":"In progress"},{"key":"pending","label":"Pending"}]}`)
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityFieldTypeID: statusTemplate.EntityFieldTypeID, Config: invalidStatusConfig, ConfigSet: true}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("removing required status key error=%v, want ErrInvalid", err)
	}
	extraStatusConfig := json.RawMessage(`{"default":"in_progress","options":[{"key":"in_progress","label":"In progress"},{"key":"pending","label":"Pending"},{"key":"done","label":"Done"},{"key":"blocked","label":"Blocked"}]}`)
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityFieldTypeID: statusTemplate.EntityFieldTypeID, Config: extraStatusConfig, ConfigSet: true}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("extra required status key error=%v, want ErrInvalid", err)
	}
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityFieldTypeID: statusTemplate.EntityFieldTypeID, Name: "State", NameSet: true}); !errors.Is(err, ErrConflict) {
		t.Fatalf("required label update error=%v, want ErrConflict", err)
	}
	actionFolder, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: company.CompanyID, EntityTypeID: ActionItemEntityTypeID, Name: "Escalations"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityTypeID: ActionItemEntityTypeID, EntityFolderID: &actionFolder.EntityFolderID, Name: "status", FieldType: EntityFieldTypeText}); !errors.Is(err, ErrConflict) {
		t.Fatalf("shadowed required field create error=%v, want ErrConflict", err)
	}
	actionCustomTemplate, err := repo.CreateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityTypeID: ActionItemEntityTypeID, EntityFolderID: &actionFolder.EntityFolderID, Name: "Escalation note", FieldType: EntityFieldTypeText})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityFieldTypeID: actionCustomTemplate.EntityFieldTypeID, Name: "Color", NameSet: true}); !errors.Is(err, ErrConflict) {
		t.Fatalf("shadowed required field update error=%v, want ErrConflict", err)
	}

	customType, err := repo.CreateEntityType(EntityTypeInput{CompanyID: company.CompanyID, Name: "Decision"})
	if err != nil {
		t.Fatal(err)
	}
	choiceTemplate, err := repo.CreateEntityFieldType(EntityFieldTypeInput{
		CompanyID: company.CompanyID, EntityTypeID: customType.EntityTypeID, Name: "Outcome", FieldType: EntityFieldTypeChoice,
		Config: json.RawMessage(`{"default":"open","options":[{"key":"open","label":"Open"},{"key":"closed","label":"Closed"}]}`), ConfigSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	decision, err := repo.CreateEntity(EntityInput{CompanyID: company.CompanyID, EntityTypeID: customType.EntityTypeID, Name: "Choose"})
	if err != nil {
		t.Fatal(err)
	}
	if len(decision.EntityFields) != 1 || string(decision.EntityFields[0].Value) != `"open"` {
		t.Fatalf("choice default fields=%+v", decision.EntityFields)
	}
	if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: company.CompanyID, EntityID: decision.EntityID, EntityFieldID: decision.EntityFields[0].EntityFieldID, Value: json.RawMessage(`"closed"`), ValueSet: true}); err != nil {
		t.Fatal(err)
	}
	updatedTemplate, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{
		CompanyID: company.CompanyID, EntityFieldTypeID: choiceTemplate.EntityFieldTypeID,
		Config: json.RawMessage(`{"default":"open","options":[{"key":"open","label":"Still open"}]}`), ConfigSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	current, err := repo.GetEntity(company.CompanyID, decision.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if string(current.EntityFields[0].Value) != `"open"` || string(current.EntityFields[0].Config) != string(updatedTemplate.Config) {
		t.Fatalf("live choice field=%+v template=%+v", current.EntityFields[0], updatedTemplate)
	}
	secondDecision, err := repo.CreateEntity(EntityInput{CompanyID: company.CompanyID, EntityTypeID: customType.EntityTypeID, Name: "Choose again"})
	if err != nil {
		t.Fatal(err)
	}
	retypedField, err := repo.UpdateEntityField(EntityFieldInput{
		CompanyID: company.CompanyID, EntityID: secondDecision.EntityID, EntityFieldID: secondDecision.EntityFields[0].EntityFieldID,
		FieldType: EntityFieldTypeText, FieldTypeSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if retypedField.EntityFieldTypeID != nil || retypedField.SystemKey != "" || string(retypedField.Config) != `{}` {
		t.Fatalf("retyped copied field retained template link: %+v", retypedField)
	}
	if _, err := repo.UpdateEntityFieldType(EntityFieldTypeInput{
		CompanyID: company.CompanyID, EntityFieldTypeID: choiceTemplate.EntityFieldTypeID,
		FieldType: EntityFieldTypeText, FieldTypeSet: true, Config: json.RawMessage(`{}`), ConfigSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	current, err = repo.GetEntity(company.CompanyID, decision.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if current.EntityFields[0].EntityFieldTypeID != nil || current.EntityFields[0].FieldType != EntityFieldTypeChoice || string(current.EntityFields[0].Value) != `"open"` || string(current.EntityFields[0].Config) != `{}` {
		t.Fatalf("template retype changed copied field instead of detaching it: %+v", current.EntityFields[0])
	}
	if _, err := repo.CreateEntityFieldType(EntityFieldTypeInput{CompanyID: company.CompanyID, EntityTypeID: customType.EntityTypeID, Name: "Status", FieldType: EntityFieldTypeText}); err != nil {
		t.Fatalf("ordinary Entity Type reserved-looking field: %v", err)
	}
}

func TestMemoryEnsureCompanyProvisionsActionItemDefaults(t *testing.T) {
	repo := NewMemoryRepo()
	company := repo.EnsureCompany("71717171-7171-4171-8171-717171717171", "Bootstrap")
	if company.CompanyID == "" {
		t.Fatal("EnsureCompany failed")
	}
	if current, exists := repo.entityTypes[key(company.CompanyID, ActionItemEntityTypeID)]; !exists || current.SystemKey != ActionItemEntityTypeSystemKey {
		t.Fatalf("EnsureCompany Action Item type=%+v exists=%v", current, exists)
	}
	if err := repo.verifyActionItemDefaultsLocked(company.CompanyID); err != nil {
		t.Fatalf("EnsureCompany Action Item defaults: %v", err)
	}
	user, err := repo.UpsertAuthUser("bootstrap-action-item", "bootstrap@example.com", "Bootstrap")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("bootstrap-action-item", company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateActionItem(ActionItemInput{CompanyID: company.CompanyID, BodyText: "Bootstrapped action", CreatedByUserID: user.UserID}); err != nil {
		t.Fatalf("CreateActionItem after EnsureCompany: %v", err)
	}
}

func TestMemoryMembershipDeletionClearsActionItemPersonAndCreatorAtomically(t *testing.T) {
	repo := NewMemoryRepo()
	companyA := repo.EnsureCompany("81818181-8181-4181-8181-818181818181", "Company A")
	companyB := repo.EnsureCompany("82828282-8282-4282-8282-828282828282", "Company B")
	user, err := repo.UpsertAuthUser("action-item-member-cleanup", "cleanup@example.com", "Cleanup")
	if err != nil {
		t.Fatal(err)
	}
	for _, company := range []domain.Company{companyA, companyB} {
		if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
	}
	personValue, _ := json.Marshal(user.UserID)
	createAssigned := func(companyID string) domain.Entity {
		item, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, BodyText: "Assigned work", CreatedByUserID: user.UserID})
		if err != nil {
			t.Fatal(err)
		}
		for _, field := range item.EntityFields {
			if field.SystemKey != ActionItemPersonInChargeSystemKey {
				continue
			}
			if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: companyID, EntityID: item.EntityID, EntityFieldID: field.EntityFieldID, Value: personValue, ValueSet: true}); err != nil {
				t.Fatal(err)
			}
			current, err := repo.GetEntity(companyID, item.EntityID)
			if err != nil {
				t.Fatal(err)
			}
			return current
		}
		t.Fatal("Person in charge field missing")
		return domain.Entity{}
	}
	itemA := createAssigned(companyA.CompanyID)
	itemB := createAssigned(companyB.CompanyID)

	forced := errors.New("forced membership cleanup rollback")
	repo.domainEventAppendErr = forced
	if _, err := repo.DeleteCompanyUser(companyA.CompanyID, user.UserID, false); !errors.Is(err, forced) {
		t.Fatalf("failed membership deletion error=%v, want %v", err, forced)
	}
	repo.domainEventAppendErr = nil
	rolledBack, err := repo.GetEntity(companyA.CompanyID, itemA.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if rolledBack.CreatedByUserID != user.UserID {
		t.Fatalf("rolled-back creator=%q, want %q", rolledBack.CreatedByUserID, user.UserID)
	}
	assertActionItemFieldValue(t, rolledBack, ActionItemPersonInChargeSystemKey, `"`+user.UserID+`"`)

	if _, err := repo.DeleteCompanyUser(companyA.CompanyID, user.UserID, false); err != nil {
		t.Fatal(err)
	}
	cleared, err := repo.GetEntity(companyA.CompanyID, itemA.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if cleared.CreatedByUserID != "" {
		t.Fatalf("deleted-company creator=%q, want empty", cleared.CreatedByUserID)
	}
	assertActionItemFieldValue(t, cleared, ActionItemPersonInChargeSystemKey, "null")
	untouched, err := repo.GetEntity(companyB.CompanyID, itemB.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	if untouched.CreatedByUserID != user.UserID {
		t.Fatalf("other-company creator=%q, want %q", untouched.CreatedByUserID, user.UserID)
	}
	assertActionItemFieldValue(t, untouched, ActionItemPersonInChargeSystemKey, `"`+user.UserID+`"`)
}

func createActionItemTestCompany(t *testing.T, repo *MemoryRepo, subject string) (domain.User, domain.Company) {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Action Item Test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	return user, company
}

func assertActionItemFieldValue(t *testing.T, entity domain.Entity, systemKey, expected string) {
	t.Helper()
	for _, field := range entity.EntityFields {
		if field.SystemKey == systemKey {
			actual := string(field.Value)
			if actual == "" {
				actual = "null"
			}
			if actual != expected {
				t.Fatalf("field %s value=%s, want %s", systemKey, actual, expected)
			}
			return
		}
	}
	t.Fatalf("field %s missing from %+v", systemKey, entity.EntityFields)
}

func actionItemTemplateBySystemKey(t *testing.T, repo *MemoryRepo, companyID, systemKey string) (domain.EntityFieldType, bool) {
	t.Helper()
	items, err := repo.ListEntityFieldTypes(companyID, ActionItemEntityTypeID)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.SystemKey == systemKey {
			return item, true
		}
	}
	return domain.EntityFieldType{}, false
}

func actionItemTestStringPointer(value string) *string { return &value }
