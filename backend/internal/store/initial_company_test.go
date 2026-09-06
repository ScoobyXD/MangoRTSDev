package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestInitialCompanyMembershipContract(t *testing.T) {
	for _, test := range []struct {
		name string
		open func(*testing.T) Repository
	}{
		{"memory", func(*testing.T) Repository { return NewMemoryRepo() }},
		{"postgres", func(t *testing.T) Repository { _, repo := openPostgresProcessMapIntegration(t); return repo }},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo := test.open(t)
			ctx := context.Background()
			otherCompany, err := repo.CreateCompany("Existing Company")
			if err != nil {
				t.Fatal(err)
			}
			user, err := repo.UpsertAuthUser("initial-company-user", "initial@example.test", "Initial User")
			if err != nil {
				t.Fatal(err)
			}
			if user.MailboxEnabled {
				t.Fatal("new user has mailbox access")
			}
			type result struct {
				created bool
				err     error
			}
			start := make(chan struct{})
			results := make(chan result, 2)
			for range 2 {
				go func() {
					<-start
					_, created, err := repo.EnsureInitialCompanyContext(ctx, user.CognitoSubject)
					results <- result{created, err}
				}()
			}
			close(start)
			createdCount := 0
			for range 2 {
				result := <-results
				if result.err != nil {
					t.Fatal(result.err)
				}
				if result.created {
					createdCount++
				}
			}
			if createdCount != 1 {
				t.Fatalf("concurrent creations = %d, want 1", createdCount)
			}
			memberships, err := repo.ListUserMemberships(user.UserID)
			if err != nil {
				t.Fatal(err)
			}
			if len(memberships) != 1 || memberships[0].Role != domain.RoleCompanyAdmin || memberships[0].CompanyName != "My Company" {
				t.Fatalf("initial memberships = %+v", memberships)
			}
			membership := memberships[0]
			if _, created, err := repo.EnsureInitialCompanyContext(ctx, user.CognitoSubject); err != nil || created {
				t.Fatalf("retry created=%t err=%v", created, err)
			}
			companies, err := repo.ListCompanies("", 10)
			if err != nil || len(companies) != 2 {
				t.Fatalf("companies = %+v, err=%v", companies, err)
			}
			entityTypes, err := repo.ListEntityTypes(membership.CompanyID)
			if err != nil || len(entityTypes) == 0 {
				t.Fatalf("company has no default entity types: %+v err=%v", entityTypes, err)
			}
			if access, err := repo.UserHasCompanyAccess(user.CognitoSubject, otherCompany.CompanyID); err != nil || access {
				t.Fatalf("initial company grants unrelated access=%t err=%v", access, err)
			}
			stored, err := repo.GetAuthUserByIDContext(ctx, user.UserID)
			if err != nil || stored.MailboxEnabled || stored.UserID != user.UserID {
				t.Fatalf("initial user = %+v err=%v", stored, err)
			}

			if _, err := repo.DeleteCompanyUser(membership.CompanyID, user.UserID, false); !errors.Is(err, ErrLastCompanyMembership) {
				t.Fatalf("last membership removal error = %v", err)
			}
			if _, err := repo.GetCompanyUser(membership.CompanyID, user.UserID); err != nil {
				t.Fatalf("rejected removal changed membership: %v", err)
			}
			if _, err := repo.AddCompanyMembership(user.CognitoSubject, otherCompany.CompanyID, domain.RoleCompanyUser); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.DeleteCompanyUser(membership.CompanyID, user.UserID, false); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.GetAuthUser(user.CognitoSubject); err != nil {
				t.Fatalf("membership removal deleted identity: %v", err)
			}
			if _, created, err := repo.EnsureInitialCompanyContext(ctx, user.CognitoSubject); err != nil || created {
				t.Fatalf("existing member created company: %t %v", created, err)
			}
			if _, err := repo.DeleteCompanyUser(otherCompany.CompanyID, user.UserID, true); err != nil {
				t.Fatalf("explicit identity deletion: %v", err)
			}
			if _, err := repo.GetAuthUser(user.CognitoSubject); !errors.Is(err, ErrNotFound) {
				t.Fatalf("deleted identity error = %v", err)
			}
		})
	}
}

func TestMemoryInitialCompanyFailureRollsBackAndRetries(t *testing.T) {
	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("initial-company-rollback", "rollback@example.test", "Rollback")
	if err != nil {
		t.Fatal(err)
	}
	forced := errors.New("membership event failed")
	repo.domainEventAppendErr = forced
	if _, created, err := repo.EnsureInitialCompanyContext(context.Background(), user.CognitoSubject); !errors.Is(err, forced) || created {
		t.Fatalf("failed creation = %t %v", created, err)
	}
	if len(repo.companies) != 0 || len(repo.memberships) != 0 || len(repo.entityTypes) != 0 || len(repo.entityFieldTypes) != 0 || len(repo.processMapPlacements) != 0 || len(repo.domainEvents) != 0 {
		t.Fatal("failed initial company left company data behind")
	}
	repo.domainEventAppendErr = nil
	other := repo.EnsureCompany("18181818-1818-4818-8818-181818181818", "Unrelated")
	resetMemoryMembershipEventState(repo)
	membership, created, err := repo.EnsureInitialCompanyContext(context.Background(), user.CognitoSubject)
	if err != nil || !created {
		t.Fatalf("retry = %t %v", created, err)
	}
	if companies := memoryMembershipEventCompanies(repo, CompanyMembershipSavedEventType); !slices.Equal(companies, []string{membership.CompanyID}) {
		t.Fatalf("initial membership events = %v", companies)
	}
	if version := repo.workspaceReadVersions[workspaceReadVersionMemoryKey(other.CompanyID, "policy-group-membership", "")]; version != 0 {
		t.Fatalf("unrelated policy version changed to %d", version)
	}
}

func TestMailboxEligibilitySurvivesAuthProfileRefresh(t *testing.T) {
	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("existing-mailbox-user", "mailbox@example.test", "Existing")
	if err != nil {
		t.Fatal(err)
	}
	user.MailboxEnabled = true
	repo.users[user.CognitoSubject] = user
	updated, err := repo.UpsertAuthUser(user.CognitoSubject, user.Email, "Updated")
	if err != nil || !updated.MailboxEnabled {
		t.Fatalf("updated user = %+v err=%v", updated, err)
	}
	stored, err := repo.GetAuthUserByIDContext(context.Background(), user.UserID)
	if err != nil || !stored.MailboxEnabled {
		t.Fatalf("stored user = %+v err=%v", stored, err)
	}
}

func TestCompanyUserOnboardingRespectsMailboxEligibility(t *testing.T) {
	for _, test := range []struct {
		name       string
		enabled    bool
		connection string
		want       string
	}{
		{"new account", false, "", "disabled"},
		{"disabled connected account", false, "connected", "disabled"},
		{"enabled disconnected account", true, "", "not_connected"},
		{"enabled connected account", true, "connected", "connected"},
		{"enabled expired connection", true, "reauth_required", "reauth_required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo := NewMemoryRepo()
			user, err := repo.UpsertAuthUser("onboarding-user", "onboarding@example.test", "Onboarding")
			if err != nil {
				t.Fatal(err)
			}
			user.MailboxEnabled = test.enabled
			repo.users[user.CognitoSubject] = user
			membership, _, err := repo.EnsureInitialCompanyContext(context.Background(), user.CognitoSubject)
			if err != nil {
				t.Fatal(err)
			}
			if test.connection != "" {
				_, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
					CompanyID: membership.CompanyID, UserID: user.UserID, Provider: "google",
					AccountEmail: user.Email, Scope: "personal", GrantID: "onboarding-grant", Status: test.connection,
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			if _, err := repo.CreateInvitation(CreateInvitationInput{
				CompanyID: membership.CompanyID, Email: "pending@example.test", Role: domain.RoleCompanyUser, InvitedByUserID: user.UserID,
			}); err != nil {
				t.Fatal(err)
			}
			items, err := repo.ListCompanyUserOnboarding(membership.CompanyID)
			if err != nil || len(items) != 2 {
				t.Fatalf("onboarding rows = %+v err=%v", items, err)
			}
			for _, item := range items {
				want := test.want
				if item.UserID == "" {
					want = "disabled"
				}
				if item.GoogleConnectionStatus != want {
					t.Fatalf("%s Google status = %q, want %q", item.Email, item.GoogleConnectionStatus, want)
				}
			}
		})
	}
}

func TestPostgresUserMailboxMigrationPreservesExistingAccounts(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	user, err := repo.UpsertAuthUser("existing-mailbox-user", "existing@example.test", "Existing")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`alter table users drop column mailbox_enabled`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260906_user_mailbox_access.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	existing, err := repo.UpsertAuthUser(user.CognitoSubject, user.Email, "Updated Existing")
	if err != nil || !existing.MailboxEnabled {
		t.Fatalf("existing account = %+v err=%v", existing, err)
	}
	newUser, err := repo.UpsertAuthUser("new-mailbox-user", "new@example.test", "New")
	if err != nil || newUser.MailboxEnabled {
		t.Fatalf("new account = %+v err=%v", newUser, err)
	}
	for _, expected := range []domain.User{existing, newUser} {
		stored, err := repo.GetAuthUserByIDContext(context.Background(), expected.UserID)
		if err != nil || stored.MailboxEnabled != expected.MailboxEnabled {
			t.Fatalf("lookup account = %+v err=%v", stored, err)
		}
		membership, _, err := repo.EnsureInitialCompanyContext(context.Background(), expected.CognitoSubject)
		if err != nil {
			t.Fatal(err)
		}
		items, err := repo.ListCompanyUserOnboarding(membership.CompanyID)
		want := "disabled"
		if expected.MailboxEnabled {
			want = "not_connected"
		}
		if err != nil || len(items) != 1 || items[0].GoogleConnectionStatus != want {
			t.Fatalf("onboarding account = %+v err=%v, want %s", items, err, want)
		}
	}
}
