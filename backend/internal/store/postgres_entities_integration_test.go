package store

import (
	"errors"
	"sync"
	"testing"
)

func TestPostgresEntitiesConcurrentFolderMovesKeepTreeAcyclic(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Entity folder concurrency")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	entityType, err := repo.CreateEntityType(EntityTypeInput{CompanyID: company.CompanyID, Name: "Delivery"})
	if err != nil {
		t.Fatal(err)
	}
	x, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, Name: "X"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, ParentEntityFolderID: &x.EntityFolderID, Name: "B"})
	if err != nil {
		t.Fatal(err)
	}
	a, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, Name: "A"})
	if err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	move := func(folderID, parentID string) {
		defer workers.Done()
		<-start
		_, err := repo.UpdateEntityFolder(EntityFolderInput{
			CompanyID:            company.CompanyID,
			EntityFolderID:       folderID,
			ParentEntityFolderID: &parentID,
			ParentFolderSet:      true,
		})
		results <- err
	}
	workers.Add(2)
	go move(a.EntityFolderID, b.EntityFolderID)
	go move(x.EntityFolderID, a.EntityFolderID)
	close(start)
	workers.Wait()
	close(results)

	successes, conflicts := 0, 0
	for moveErr := range results {
		switch {
		case moveErr == nil:
			successes++
		case errors.Is(moveErr, ErrConflict):
			conflicts++
		default:
			t.Fatalf("concurrent Entity folder move error = %v", moveErr)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent Entity folder moves successes/conflicts = %d/%d, want 1/1", successes, conflicts)
	}
	if _, err := repo.CreateEntity(EntityInput{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, EntityFolderID: &b.EntityFolderID, Name: "Acyclic check"}); err != nil {
		t.Fatalf("create Entity after concurrent folder moves: %v", err)
	}
}

func TestPostgresEntitiesResolveDeepTemplatesIntoOneFieldSnapshot(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Entity template snapshot")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	entityType, err := repo.CreateEntityType(EntityTypeInput{CompanyID: company.CompanyID, Name: "Delivery"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, Name: "Imports"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, ParentEntityFolderID: &parent.EntityFolderID, Name: "Thailand"})
	if err != nil {
		t.Fatal(err)
	}
	grandchild, err := repo.CreateEntityFolder(EntityFolderInput{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, ParentEntityFolderID: &child.EntityFolderID, Name: "Morning"})
	if err != nil {
		t.Fatal(err)
	}
	fieldTypes := []EntityFieldTypeInput{
		{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, Name: "Status", FieldType: EntityFieldTypeText, Position: 0, PositionSet: true},
		{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, EntityFolderID: &parent.EntityFolderID, Name: "status", FieldType: EntityFieldTypeNumber, Position: 0, PositionSet: true},
		{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, EntityFolderID: &child.EntityFolderID, Name: "Due date", FieldType: EntityFieldTypeDate, Position: 0, PositionSet: true},
		{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, EntityFolderID: &grandchild.EntityFolderID, Name: "Confirmed", FieldType: EntityFieldTypeBoolean, Position: 0, PositionSet: true},
	}
	for _, input := range fieldTypes {
		if _, err := repo.CreateEntityFieldType(input); err != nil {
			t.Fatalf("CreateEntityFieldType(%q): %v", input.Name, err)
		}
	}

	entity, err := repo.CreateEntity(EntityInput{CompanyID: company.CompanyID, EntityTypeID: entityType.EntityTypeID, EntityFolderID: &grandchild.EntityFolderID, Name: "Morning shipment"})
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		name      string
		fieldType string
	}{
		{name: "status", fieldType: EntityFieldTypeNumber},
		{name: "Due date", fieldType: EntityFieldTypeDate},
		{name: "Confirmed", fieldType: EntityFieldTypeBoolean},
	}
	if len(entity.EntityFields) != len(want) {
		t.Fatalf("Entity field snapshot = %+v, want %d fields", entity.EntityFields, len(want))
	}
	for index, expected := range want {
		field := entity.EntityFields[index]
		if field.Name != expected.name || field.FieldType != expected.fieldType || field.Position != index {
			t.Fatalf("Entity field %d = %+v, want name=%q type=%q position=%d", index, field, expected.name, expected.fieldType, index)
		}
	}
}
