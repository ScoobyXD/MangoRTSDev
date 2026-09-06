package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func companyUserProfileEventCompaniesForTest(repo *MemoryRepo) []string {
	companyIDs := []string{}
	for _, event := range repo.domainEvents {
		if event.Type == CompanyUserProfileUpdatedEventType {
			companyIDs = append(companyIDs, event.CompanyID)
		}
	}
	slices.Sort(companyIDs)
	return companyIDs
}

func TestMemoryAuthProfileUpdatesAtomicallyInvalidateMembershipCompanyProcessMaps(t *testing.T) {
	repo := NewMemoryRepo()
	companyA := repo.EnsureCompany("70707070-7070-4070-8070-707070707070", "Profile A")
	companyB := repo.EnsureCompany("71717171-7171-4171-8171-717171717171", "Profile B")
	user, err := repo.UpsertAuthUser("profile-process-map-user", "profile@example.com", "Original Name")
	if err != nil {
		t.Fatal(err)
	}
	for _, companyID := range []string{companyA.CompanyID, companyB.CompanyID} {
		if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
	}
	resetMemoryMembershipEventState(repo)

	unchanged, err := repo.UpsertAuthUser(user.CognitoSubject, "PROFILE@example.com", "Original Name")
	if err != nil {
		t.Fatal(err)
	}
	if !unchanged.UpdatedTimestamp.Equal(user.UpdatedTimestamp) {
		t.Fatalf("unchanged auth claims changed timestamp: %s != %s", unchanged.UpdatedTimestamp, user.UpdatedTimestamp)
	}
	if len(repo.domainEvents) != 0 || len(repo.realtimeOutbox) != 0 {
		t.Fatalf("unchanged auth claims emitted events/outbox = %d/%d", len(repo.domainEvents), len(repo.realtimeOutbox))
	}

	updated, err := repo.UpsertAuthUser(user.CognitoSubject, "", "Updated Name")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Email != user.Email || updated.DisplayName != "Updated Name" {
		t.Fatalf("updated user = %+v", updated)
	}
	wantCompanies := []string{companyA.CompanyID, companyB.CompanyID}
	if got := companyUserProfileEventCompaniesForTest(repo); !slices.Equal(got, wantCompanies) {
		t.Fatalf("profile event companies = %v, want %v", got, wantCompanies)
	}
	for _, companyID := range wantCompanies {
		if got := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "process-map", "")]; got != 1 {
			t.Fatalf("profile update Process Map version for %s = %d, want 1", companyID, got)
		}
	}

	resetMemoryMembershipEventState(repo)
	forced := errors.New("forced profile event failure")
	repo.domainEventAppendErr = forced
	if _, err := repo.UpsertAuthUser(user.CognitoSubject, "changed@example.com", ""); !errors.Is(err, forced) {
		t.Fatalf("profile event failure = %v, want %v", err, forced)
	}
	repo.domainEventAppendErr = nil
	stored, err := repo.GetAuthUser(user.CognitoSubject)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Email != updated.Email || stored.DisplayName != updated.DisplayName || !stored.UpdatedTimestamp.Equal(updated.UpdatedTimestamp) {
		t.Fatalf("failed profile event did not restore user: %+v, want %+v", stored, updated)
	}
}

func TestMemoryAuthClaimsWatermarkBlocksOlderClaimVariants(t *testing.T) {
	repo := NewMemoryRepo()
	company := repo.EnsureCompany("72727272-7272-4272-8272-727272727272", "Auth Claims Company")
	user, err := repo.UpsertAuthUser("auth-claims-watermark", "a@example.com", "Profile A")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	resetMemoryMembershipEventState(repo)

	newerUnchangedIssuedAt := time.Unix(user.AuthClaimsIssuedAt.Unix()+20, 0).UTC()
	newerUnchanged, err := repo.ResolveAuthUserContext(context.Background(), user.CognitoSubject, user.Email, user.DisplayName, newerUnchangedIssuedAt)
	if err != nil {
		t.Fatal(err)
	}
	if !newerUnchanged.AuthClaimsIssuedAt.Equal(newerUnchangedIssuedAt) {
		t.Fatalf("watermark = %s, want %s", newerUnchanged.AuthClaimsIssuedAt, newerUnchangedIssuedAt)
	}
	if !newerUnchanged.UpdatedTimestamp.Equal(user.UpdatedTimestamp) || len(repo.domainEvents) != 0 || len(repo.realtimeOutbox) != 0 {
		t.Fatalf("watermark-only resolution changed profile state or emitted events: user=%+v events=%d outbox=%d", newerUnchanged, len(repo.domainEvents), len(repo.realtimeOutbox))
	}

	assertRejected := func(label string, issuedAt time.Time) {
		t.Helper()
		resolved, err := repo.ResolveAuthUserContext(context.Background(), user.CognitoSubject, "b@example.com", "Profile B", issuedAt)
		if err != nil {
			t.Fatal(err)
		}
		if resolved.Email != user.Email || resolved.DisplayName != user.DisplayName || !resolved.AuthClaimsIssuedAt.Equal(newerUnchangedIssuedAt) {
			t.Fatalf("%s claim variant changed the profile: %+v", label, resolved)
		}
	}
	assertRejected("older", time.Unix(user.AuthClaimsIssuedAt.Unix()+10, 0).UTC())
	assertRejected("equal", newerUnchangedIssuedAt)

	newerChangedIssuedAt := newerUnchangedIssuedAt.Add(10 * time.Second)
	newerChanged, err := repo.ResolveAuthUserContext(context.Background(), user.CognitoSubject, "b@example.com", "Profile B", newerChangedIssuedAt)
	if err != nil {
		t.Fatal(err)
	}
	if newerChanged.Email != "b@example.com" || newerChanged.DisplayName != "Profile B" || !newerChanged.AuthClaimsIssuedAt.Equal(newerChangedIssuedAt) {
		t.Fatalf("newer claim variant = %+v", newerChanged)
	}
	if got := companyUserProfileEventCompaniesForTest(repo); !slices.Equal(got, []string{company.CompanyID}) {
		t.Fatalf("profile event companies = %v, want %s", got, company.CompanyID)
	}
}

func TestInvitationAcceptancePreservesExistingDisplayName(t *testing.T) {
	for _, test := range []struct {
		name string
		open func(*testing.T) Repository
	}{
		{"memory", func(*testing.T) Repository { return NewMemoryRepo() }},
		{"postgres", func(t *testing.T) Repository { _, repo := openPostgresProcessMapIntegration(t); return repo }},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo := test.open(t)
			company, err := repo.CreateCompany("Invitation Profile Company")
			if err != nil {
				t.Fatal(err)
			}
			inviter, err := repo.UpsertAuthUser("invitation-profile-inviter", "inviter@example.com", "Inviter")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.AddCompanyMembership(inviter.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
				t.Fatal(err)
			}
			invitation, err := repo.CreateInvitation(CreateInvitationInput{
				CompanyID: company.CompanyID, Email: "invitee@example.com",
				Role: domain.RoleCompanyUser, InvitedByUserID: inviter.UserID,
			})
			if err != nil {
				t.Fatal(err)
			}
			oldIssuedAt := time.Now().UTC().Add(-time.Minute).Truncate(time.Second)
			invitee, err := repo.ResolveAuthUserContext(context.Background(), "invitation-profile-invitee", "invitee@example.com", "Stored Profile Name", oldIssuedAt)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.AcceptInvitation(invitation.Token, invitee.CognitoSubject, invitee.Email, "Invitation Name"); err != nil {
				t.Fatal(err)
			}
			accepted, err := repo.GetAuthUser(invitee.CognitoSubject)
			if err != nil {
				t.Fatal(err)
			}
			if accepted.DisplayName != invitee.DisplayName || !accepted.AuthClaimsIssuedAt.After(oldIssuedAt) {
				t.Fatalf("accepted user = %+v", accepted)
			}
			resolved, err := repo.ResolveAuthUserContext(context.Background(), invitee.CognitoSubject, invitee.Email, "Old Token Name", oldIssuedAt)
			if err != nil {
				t.Fatal(err)
			}
			if resolved.DisplayName != accepted.DisplayName || !resolved.AuthClaimsIssuedAt.Equal(accepted.AuthClaimsIssuedAt) {
				t.Fatalf("older token changed stored profile: before=%+v after=%+v", accepted, resolved)
			}
		})
	}
}

func TestMemoryDevAdminBootstrapStopsAfterCanceledLockWait(t *testing.T) {
	repo := NewMemoryRepo()
	const subject = "canceled-memory-bootstrap"
	user, err := repo.UpsertAuthUser(subject, "canceled-memory@example.com", "Canceled Memory")
	if err != nil {
		t.Fatal(err)
	}

	repo.mu.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, _, bootstrapErr := repo.BootstrapDevAdminContext(ctx, subject, "Canceled Memory Bootstrap")
		result <- bootstrapErr
	}()
	cancel()
	repo.mu.Unlock()

	select {
	case bootstrapErr := <-result:
		if !errors.Is(bootstrapErr, context.Canceled) {
			t.Fatalf("canceled bootstrap error = %v, want context.Canceled", bootstrapErr)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled bootstrap did not return")
	}
	companies, err := repo.ListCompanies("", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(companies) != 0 {
		t.Fatalf("companies after canceled bootstrap = %+v, want none", companies)
	}
	memberships, err := repo.ListUserMemberships(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if len(memberships) != 0 {
		t.Fatalf("memberships after canceled bootstrap = %+v, want none", memberships)
	}
}

func TestPostgresProcessMapAuthProfileUpdatesInvalidateMembershipCompanies(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	companyA, err := repo.CreateCompany("Postgres Profile A")
	if err != nil {
		t.Fatal(err)
	}
	companyB, err := repo.CreateCompany("Postgres Profile B")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-profile-process-map-user", "postgres-profile@example.com", "Original Name")
	if err != nil {
		t.Fatal(err)
	}
	for _, companyID := range []string{companyA.CompanyID, companyB.CompanyID} {
		if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
	}
	beforeA := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID)
	beforeB := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID)

	unchanged, err := repo.UpsertAuthUser(user.CognitoSubject, "POSTGRES-PROFILE@example.com", "Original Name")
	if err != nil {
		t.Fatal(err)
	}
	if !unchanged.UpdatedTimestamp.Equal(user.UpdatedTimestamp) {
		t.Fatalf("unchanged auth claims changed timestamp: %s != %s", unchanged.UpdatedTimestamp, user.UpdatedTimestamp)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID); got != beforeA {
		t.Fatalf("unchanged profile Process Map A version = %d, want %d", got, beforeA)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID); got != beforeB {
		t.Fatalf("unchanged profile Process Map B version = %d, want %d", got, beforeB)
	}

	if _, err := db.Exec(`alter table domain_events add constraint reject_profile_update_for_test check (event_type <> 'company_user_profile_updated')`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertAuthUser(user.CognitoSubject, "", "Rejected Name"); err == nil {
		t.Fatal("profile update unexpectedly succeeded when its domain event was rejected")
	}
	stored, err := repo.GetAuthUser(user.CognitoSubject)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Email != user.Email || stored.DisplayName != user.DisplayName || !stored.UpdatedTimestamp.Equal(user.UpdatedTimestamp) {
		t.Fatalf("rejected profile event did not roll back user: %+v, want %+v", stored, user)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID); got != beforeA {
		t.Fatalf("rejected profile Process Map A version = %d, want %d", got, beforeA)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID); got != beforeB {
		t.Fatalf("rejected profile Process Map B version = %d, want %d", got, beforeB)
	}
	if _, err := db.Exec(`alter table domain_events drop constraint reject_profile_update_for_test`); err != nil {
		t.Fatal(err)
	}

	updated, err := repo.UpsertAuthUser(user.CognitoSubject, "", "Updated Name")
	if err != nil {
		t.Fatal(err)
	}
	if updated.DisplayName != "Updated Name" || updated.Email != user.Email {
		t.Fatalf("updated user = %+v", updated)
	}
	afterA := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID)
	afterB := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID)
	if afterA <= beforeA || afterB <= beforeB {
		t.Fatalf("profile versions did not advance: A %d -> %d, B %d -> %d", beforeA, afterA, beforeB, afterB)
	}

	rows, err := db.Query(`
select company_id::text
from domain_events
where event_type=$1 and payload->>'user_id'=$2
order by company_id`, CompanyUserProfileUpdatedEventType, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	gotCompanies := []string{}
	for rows.Next() {
		var companyID string
		if err := rows.Scan(&companyID); err != nil {
			t.Fatal(err)
		}
		gotCompanies = append(gotCompanies, companyID)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	wantCompanies := []string{companyA.CompanyID, companyB.CompanyID}
	slices.Sort(wantCompanies)
	if !slices.Equal(gotCompanies, wantCompanies) {
		t.Fatalf("profile event companies = %v, want %v", gotCompanies, wantCompanies)
	}

	if _, err := repo.UpsertAuthUser(user.CognitoSubject, updated.Email, updated.DisplayName); err != nil {
		t.Fatal(err)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID); got != afterA {
		t.Fatalf("same-profile retry Process Map A version = %d, want %d", got, afterA)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID); got != afterB {
		t.Fatalf("same-profile retry Process Map B version = %d, want %d", got, afterB)
	}
}

func TestProcessMapAuthProfileEventIsShippedInReadInvalidationSQL(t *testing.T) {
	for _, path := range []string{
		filepath.Join("..", "..", "db", "schema.sql"),
		filepath.Join("..", "..", "db", "migrations", "20260826_zzz_process_map_read_invalidation.sql"),
	} {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), "'"+CompanyUserProfileUpdatedEventType+"'") {
			t.Fatalf("%s does not invalidate Process Map reads for %s", path, CompanyUserProfileUpdatedEventType)
		}
	}
}
