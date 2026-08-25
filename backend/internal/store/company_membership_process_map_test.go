package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"slices"
	"testing"
)

func resetMemoryMembershipEventState(repo *MemoryRepo) {
	repo.domainEvents = map[string]domain.DomainEvent{}
	repo.workspaceReadVersions = map[string]int64{}
	repo.realtimeOutbox = map[string]RealtimeOutboxEvent{}
	repo.realtimeOutboxSequence = 0
}

func memoryMembershipEventCompanies(repo *MemoryRepo, eventType string) []string {
	companyIDs := []string{}
	for _, event := range repo.domainEvents {
		if event.Type == eventType {
			companyIDs = append(companyIDs, event.CompanyID)
		}
	}
	slices.Sort(companyIDs)
	return companyIDs
}

func TestMemoryCompanyMembershipSavesAtomicallyInvalidateAffectedProcessMaps(t *testing.T) {
	repo := NewMemoryRepo()
	companyA := repo.EnsureCompany("91919191-9191-4191-8191-919191919191", "Membership A")
	companyB := repo.EnsureCompany("92929292-9292-4292-8292-929292929292", "Membership B")
	user, err := repo.UpsertAuthUser("membership-save-user", "membership-save@example.com", "Membership Save")
	if err != nil {
		t.Fatal(err)
	}

	created, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleCompanyUser)
	if err != nil {
		t.Fatal(err)
	}
	if got := memoryMembershipEventCompanies(repo, CompanyMembershipSavedEventType); !slices.Equal(got, []string{companyA.CompanyID}) {
		t.Fatalf("membership add event companies = %v", got)
	}
	if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyA.CompanyID, "process-map", "")]; got != 1 {
		t.Fatalf("membership add Process Map version = %d, want 1", got)
	}
	if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyA.CompanyID, "policy-group-membership", "")]; got != 1 {
		t.Fatalf("membership add policy/group version = %d, want 1", got)
	}

	if retry, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	} else if !retry.UpdatedTimestamp.Equal(created.UpdatedTimestamp) {
		t.Fatalf("same-role retry changed timestamp: %s != %s", retry.UpdatedTimestamp, created.UpdatedTimestamp)
	}
	if len(repo.domainEvents) != 1 || len(repo.realtimeOutbox) != 1 {
		t.Fatalf("same-role retry created events/outbox = %d/%d, want 1/1", len(repo.domainEvents), len(repo.realtimeOutbox))
	}

	resetMemoryMembershipEventState(repo)
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if got := memoryMembershipEventCompanies(repo, CompanyMembershipSavedEventType); !slices.Equal(got, []string{companyA.CompanyID, companyB.CompanyID}) {
		t.Fatalf("global dev-admin grant event companies = %v", got)
	}
	for _, companyID := range []string{companyA.CompanyID, companyB.CompanyID} {
		if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "process-map", "")]; got != 1 {
			t.Fatalf("global dev-admin grant Process Map version for %s = %d", companyID, got)
		}
		if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "policy-group-membership", "")]; got != 1 {
			t.Fatalf("global dev-admin grant policy/group version for %s = %d", companyID, got)
		}
	}

	resetMemoryMembershipEventState(repo)
	forced := errors.New("forced membership event failure")
	repo.domainEventAppendErr = forced
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleCompanyManager); !errors.Is(err, forced) {
		t.Fatalf("role change error = %v, want %v", err, forced)
	}
	repo.domainEventAppendErr = nil
	if membership, ok := repo.memberships[membershipKey(companyA.CompanyID, user.UserID)]; !ok || membership.Role != domain.RoleDevAdmin {
		t.Fatalf("failed role-change event did not restore membership: %+v", membership)
	}
}

func TestMemoryCompanyMembershipDeletionNotifiesRevokedUserAndRollsBackAtomically(t *testing.T) {
	repo := NewMemoryRepo()
	companyA := repo.EnsureCompany("93939393-9393-4393-8393-939393939393", "Membership Delete A")
	companyB := repo.EnsureCompany("94949494-9494-4494-8494-949494949494", "Membership Delete B")
	user, err := repo.UpsertAuthUser("membership-delete-user", "membership-delete@example.com", "Membership Delete")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyB.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	resetMemoryMembershipEventState(repo)
	forced := errors.New("forced membership delete event failure")
	repo.domainEventAppendErr = forced
	if _, err := repo.DeleteCompanyUser(companyA.CompanyID, user.UserID, false); !errors.Is(err, forced) {
		t.Fatalf("membership delete error = %v, want %v", err, forced)
	}
	repo.domainEventAppendErr = nil
	if _, err := repo.GetCompanyUser(companyA.CompanyID, user.UserID); err != nil {
		t.Fatalf("failed delete event did not restore membership: %v", err)
	}

	resetMemoryMembershipEventState(repo)
	if _, err := repo.DeleteCompanyUser(companyA.CompanyID, user.UserID, false); err != nil {
		t.Fatal(err)
	}
	if got := memoryMembershipEventCompanies(repo, CompanyMembershipDeletedEventType); !slices.Equal(got, []string{companyA.CompanyID}) {
		t.Fatalf("single membership deletion event companies = %v", got)
	}
	if len(repo.realtimeOutbox) != 1 {
		t.Fatalf("single membership deletion outbox rows = %d, want 1", len(repo.realtimeOutbox))
	}
	if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyA.CompanyID, "policy-group-membership", "")]; got != 1 {
		t.Fatalf("membership deletion policy/group version = %d, want 1", got)
	}
	for _, event := range repo.realtimeOutbox {
		if !slices.Contains(event.AllowedUserIDs, user.UserID) {
			t.Fatalf("revoked user missing from compact invalidation audience: %+v", event.AllowedUserIDs)
		}
	}
}

func TestMemoryFullMembershipDeletionInvalidatesEveryRemovedCompany(t *testing.T) {
	repo := NewMemoryRepo()
	companyA := repo.EnsureCompany("95959595-9595-4595-8595-959595959595", "Membership Full Delete A")
	companyB := repo.EnsureCompany("96969696-9696-4696-8696-969696969696", "Membership Full Delete B")
	companyC := repo.EnsureCompany("97979797-9797-4797-8797-979797979797", "Membership Full Delete C")
	user, err := repo.UpsertAuthUser("membership-full-delete-user", "membership-full-delete@example.com", "Membership Full Delete")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyB.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}

	resetMemoryMembershipEventState(repo)
	if _, err := repo.DeleteCompanyUser(companyA.CompanyID, user.UserID, true); err != nil {
		t.Fatal(err)
	}
	wantCompanies := []string{companyA.CompanyID, companyB.CompanyID, companyC.CompanyID}
	if got := memoryMembershipEventCompanies(repo, CompanyMembershipDeletedEventType); !slices.Equal(got, wantCompanies) {
		t.Fatalf("full dev-admin deletion event companies = %v, want %v", got, wantCompanies)
	}
	for _, companyID := range wantCompanies {
		if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "policy-group-membership", "")]; got != 1 {
			t.Fatalf("full deletion policy/group version for %s = %d, want 1", companyID, got)
		}
	}
	for _, event := range repo.realtimeOutbox {
		if event.Scope != processMapRealtimeScope || !slices.Contains(event.AllowedUserIDs, user.UserID) {
			t.Fatalf("full deletion compact audience = %+v", event)
		}
	}
}

func TestMemoryPendingInvitationDowngradeInvalidatesGlobalDevAdmin(t *testing.T) {
	repo := NewMemoryRepo()
	companyA := repo.EnsureCompany("98989898-9898-4898-8898-989898989898", "Invitation A")
	companyB := repo.EnsureCompany("99999999-9999-4999-8999-999999999999", "Invitation B")
	inviter, err := repo.UpsertAuthUser("invitation-fence-admin", "invitation-fence-admin@example.com", "Invitation Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(inviter.CognitoSubject, companyA.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	invitation, err := repo.CreateInvitation(CreateInvitationInput{
		CompanyID: companyA.CompanyID, Email: "pending-global@example.com",
		Role: domain.RoleCompanyUser, InvitedByUserID: inviter.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	invitee, err := repo.UpsertAuthUser("pending-global-user", "pending-global@example.com", "Pending Global")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(invitee.CognitoSubject, companyA.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}

	resetMemoryMembershipEventState(repo)
	if _, err := repo.AcceptInvitation(invitation.Token, invitee.CognitoSubject, invitee.Email, invitee.DisplayName); err != nil {
		t.Fatal(err)
	}
	membership, err := repo.GetCompanyUser(companyA.CompanyID, invitee.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if membership.Role != domain.RoleCompanyUser {
		t.Fatalf("accepted invitation role = %q, want %q", membership.Role, domain.RoleCompanyUser)
	}
	wantCompanies := []string{companyA.CompanyID, companyB.CompanyID}
	if got := memoryMembershipEventCompanies(repo, CompanyMembershipSavedEventType); !slices.Equal(got, wantCompanies) {
		t.Fatalf("invitation downgrade event companies = %v, want %v", got, wantCompanies)
	}
	for _, companyID := range wantCompanies {
		if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "policy-group-membership", "")]; got != 1 {
			t.Fatalf("invitation downgrade policy/group version for %s = %d, want 1", companyID, got)
		}
		if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "process-map", "")]; got != 1 {
			t.Fatalf("invitation downgrade Process Map version for %s = %d, want 1", companyID, got)
		}
	}
}
