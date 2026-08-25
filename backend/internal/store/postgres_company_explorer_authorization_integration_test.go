package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestPostgresPermissionValidationFenceSerializesRevocations(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	company, err := repo.CreateCompany("Permission fence")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("postgres-fence-admin", "postgres-fence-admin@example.com", "Fence Admin")
	if err != nil {
		t.Fatal(err)
	}
	member, err := repo.UpsertAuthUser("postgres-fence-member", "postgres-fence-member@example.com", "Fence Member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Fence folder")
	if err != nil {
		t.Fatal(err)
	}
	group, err := repo.CreateCompanyUserGroup(company.CompanyID, "", "Fence group")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(company.CompanyID, group.GroupID, []string{member.UserID}); err != nil {
		t.Fatal(err)
	}

	assertBlockedUntilRelease := func(name string, acquire func(context.Context, *sql.Tx) error, mutation func() error) {
		t.Helper()
		ctx := context.Background()
		validationTx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := acquire(ctx, validationTx); err != nil {
			_ = validationTx.Rollback()
			t.Fatal(err)
		}
		started := make(chan struct{})
		done := make(chan error, 1)
		go func() {
			close(started)
			done <- mutation()
		}()
		<-started
		timer := time.NewTimer(150 * time.Millisecond)
		select {
		case mutationErr := <-done:
			timer.Stop()
			_ = validationTx.Rollback()
			t.Fatalf("%s completed before the validation transaction released its shared fence: %v", name, mutationErr)
		case <-timer.C:
		}
		if err := validationTx.Commit(); err != nil {
			t.Fatalf("release %s fence: %v", name, err)
		}
		select {
		case mutationErr := <-done:
			if mutationErr != nil {
				t.Fatalf("%s after fence release: %v", name, mutationErr)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("%s remained blocked after the validation transaction committed", name)
		}
	}

	policyValidationLock := func(ctx context.Context, tx *sql.Tx) error {
		return lockPostgresPolicyGroupMembershipVersionTx(ctx, tx, company.CompanyID, false)
	}
	assertBlockedUntilRelease("direct permission revoke", policyValidationLock, func() error {
		deny := ResourceDefaultAccessNoAccess
		_, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
			CompanyID: company.CompanyID, ResourceType: EntityTypeCompanyExplorerFolder, ResourceID: folder.FolderID,
			PermissionMode: PolicyModeCustomized, DefaultAccess: &deny,
			DescendantAction: PolicyDescendantActionInheritedOnly, ActorUserID: admin.UserID,
		})
		return err
	})
	assertBlockedUntilRelease("company role change", policyValidationLock, func() error {
		_, err := repo.AddCompanyMembership(member.CognitoSubject, company.CompanyID, domain.RoleCompanyManager)
		return err
	})
	assertBlockedUntilRelease("group member removal", policyValidationLock, func() error {
		_, err := repo.SetCompanyUserGroupMembers(company.CompanyID, group.GroupID, nil)
		return err
	})
	companySetLock := func(ctx context.Context, tx *sql.Tx) error {
		return lockPostgresCompanyMembershipCompanySetTx(ctx, tx)
	}
	var concurrentlyCreated domain.Company
	assertBlockedUntilRelease("company creation", companySetLock, func() error {
		var err error
		concurrentlyCreated, err = repo.CreateCompany("Concurrent company-set member")
		return err
	})
	assertBlockedUntilRelease("global role fanout", companySetLock, func() error {
		_, err := repo.AddCompanyMembership(member.CognitoSubject, company.CompanyID, domain.RoleDevAdmin)
		return err
	})
	if got := postgresPolicyGroupVersionForTest(t, repo, concurrentlyCreated.CompanyID); got == 0 {
		t.Fatal("global role fanout missed the company created under the shared company-set lock")
	}
}

func TestPostgresCompanyExplorerMutationsAuthorizeExactSourceAndDestination(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Explorer authorization")
	if err != nil {
		t.Fatal(err)
	}
	otherCompany, err := repo.CreateCompany("Other explorer company")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("postgres-explorer-auth-admin", "postgres-explorer-auth-admin@example.com", "Explorer Admin")
	if err != nil {
		t.Fatal(err)
	}
	member, err := repo.UpsertAuthUser("postgres-explorer-auth-member", "postgres-explorer-auth-member@example.com", "Explorer Member")
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := repo.UpsertAuthUser("postgres-explorer-auth-outsider", "postgres-explorer-auth-outsider@example.com", "Explorer Outsider")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(member.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	sourceFolder, _ := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Source")
	openFolder, _ := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Open")
	restrictedFolder, _ := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Restricted")
	otherFolder, _ := repo.CreateCompanyExplorerFolder(otherCompany.CompanyID, "", "logic_gate", "Other")
	movingFolder, _ := repo.CreateCompanyExplorerFolder(company.CompanyID, sourceFolder.FolderID, "logic_gate", "Moving folder")
	gate, err := repo.CreateLogicGate(company.CompanyID, "Moving process")
	if err != nil {
		t.Fatal(err)
	}
	placed, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID: company.CompanyID, ParentEntityID: sourceFolder.FolderID,
		ChildEntityType: CompanyExplorerV2EntityLogicGate, ChildResourceID: gate.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}

	setDefaultAccess := func(resourceType, resourceID, access string) {
		t.Helper()
		if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
			CompanyID: company.CompanyID, EntityType: resourceType, EntityID: resourceID,
			DefaultAccess: access, DefaultAccessSet: true, ActorUserID: admin.UserID,
		}); err != nil {
			t.Fatalf("SetEntityPermissions(%s/%s, %s): %v", resourceType, resourceID, access, err)
		}
	}
	edgeParent := func(edgeID string) string {
		t.Helper()
		var parentID string
		if err := db.QueryRow(`
select coalesce(parent_folder_id::text,'')
from company_explorer_items
where company_id=$1::uuid and item_id=$2::uuid`, company.CompanyID, edgeID).Scan(&parentID); err != nil {
			t.Fatalf("read edge parent: %v", err)
		}
		return parentID
	}
	setDefaultAccess(EntityTypeCompanyExplorerFolder, restrictedFolder.FolderID, ResourceDefaultAccessNoAccess)

	if _, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: company.CompanyID, EdgeID: placed.EdgeID, ParentEntityID: restrictedFolder.FolderID,
		ActorUserID: member.UserID, PermissionUserID: member.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("move to inaccessible destination error = %v, want ErrNotFound", err)
	}
	if got := edgeParent(placed.EdgeID); got != sourceFolder.FolderID {
		t.Fatalf("denied destination move changed parent to %q", got)
	}
	if _, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: company.CompanyID, EdgeID: placed.EdgeID, ParentEntityID: otherFolder.FolderID,
		ActorUserID: member.UserID, PermissionUserID: member.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-company destination move error = %v, want ErrNotFound", err)
	}
	if _, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: company.CompanyID, EdgeID: placed.EdgeID, ParentEntityID: company.CompanyID,
		ActorUserID: outsider.UserID, PermissionUserID: outsider.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("nonmember root move error = %v, want ErrNotFound", err)
	}
	movedToRoot, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: company.CompanyID, EdgeID: placed.EdgeID, ParentEntityID: company.CompanyID,
		ActorUserID: member.UserID, PermissionUserID: member.UserID,
	})
	if err != nil || movedToRoot.ParentEntityID != "" {
		t.Fatalf("member root move = %+v err=%v", movedToRoot, err)
	}

	setDefaultAccess(EntityTypeLogicGate, gate.LogicGateID, ResourceDefaultAccessNoAccess)
	if _, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: company.CompanyID, EdgeID: movedToRoot.EdgeID, ParentEntityID: openFolder.FolderID,
		ActorUserID: member.UserID, PermissionUserID: member.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("source-denied item move error = %v, want ErrNotFound", err)
	}
	if err := repo.DeleteCompanyExplorerV2Edge(company.CompanyID, movedToRoot.EdgeID, member.UserID, member.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("source-denied detach error = %v, want ErrNotFound", err)
	}
	if got := edgeParent(movedToRoot.EdgeID); got != "" {
		t.Fatalf("source-denied item mutation changed root parent to %q", got)
	}
	setDefaultAccess(EntityTypeLogicGate, gate.LogicGateID, ResourceDefaultAccessEdit)
	if err := repo.DeleteCompanyExplorerV2Edge(company.CompanyID, movedToRoot.EdgeID, member.UserID, member.UserID); err != nil {
		t.Fatalf("authorized detach: %v", err)
	}

	if _, err := repo.MoveCompanyExplorerFolder(company.CompanyID, movingFolder.FolderID, &restrictedFolder.FolderID, 0, member.UserID, member.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("folder move to inaccessible destination error = %v, want ErrNotFound", err)
	}
	if _, err := repo.MoveCompanyExplorerFolder(company.CompanyID, movingFolder.FolderID, &otherFolder.FolderID, 0, member.UserID, member.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("folder cross-company move error = %v, want ErrNotFound", err)
	}
	rootParent := ""
	rootFolder, err := repo.MoveCompanyExplorerFolder(company.CompanyID, movingFolder.FolderID, &rootParent, 0, member.UserID, member.UserID)
	if err != nil || rootFolder.ParentFolderID != nil {
		t.Fatalf("authorized folder root move = %+v err=%v", rootFolder, err)
	}
	setDefaultAccess(EntityTypeCompanyExplorerFolder, movingFolder.FolderID, ResourceDefaultAccessNoAccess)
	if _, err := repo.RenameCompanyExplorerFolder(company.CompanyID, movingFolder.FolderID, "Denied rename", member.UserID, member.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("source-denied folder rename error = %v, want ErrNotFound", err)
	}
	var folderName string
	if err := db.QueryRow(`select name from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid`, company.CompanyID, movingFolder.FolderID).Scan(&folderName); err != nil {
		t.Fatal(err)
	}
	if folderName != "Moving folder" {
		t.Fatalf("denied rename changed folder name to %q", folderName)
	}
	if _, err := repo.MoveCompanyExplorerFolder(company.CompanyID, movingFolder.FolderID, &openFolder.FolderID, 0, member.UserID, member.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("source-denied folder move error = %v, want ErrNotFound", err)
	}
}
