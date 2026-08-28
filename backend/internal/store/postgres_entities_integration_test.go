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
