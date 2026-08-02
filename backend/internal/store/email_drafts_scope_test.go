package store

import (
	"errors"
	"os"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestPostgresCommunicationsEmailDraftQueriesKeepExactImmutableScopePredicates(t *testing.T) {
	raw, err := os.ReadFile("postgres_email_drafts.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_email_drafts.go: %v", err)
	}
	source := strings.ReplaceAll(string(raw), "\r\n", "\n")
	listBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) ListCommunicationsEmailDrafts")
	for _, required := range []string{
		"shared_inbox_id = $2::uuid",
		"personal_user_id = $2::uuid",
		"personal_account_email = $3",
	} {
		if !strings.Contains(listBody, required) {
			t.Fatalf("ListCommunicationsEmailDrafts missing exact scope predicate %q", required)
		}
	}
	if strings.Contains(listBody, "personal_user_id = $2::uuid or shared_inbox_id is not null") {
		t.Fatal("ListCommunicationsEmailDrafts retained broad personal-plus-all-shared predicate")
	}

	getBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) GetCommunicationsEmailDraft")
	for _, required := range []string{
		"shared_inbox_id = $3::uuid",
		"personal_user_id = $3::uuid",
		"personal_account_email = $4",
	} {
		if !strings.Contains(getBody, required) {
			t.Fatalf("GetCommunicationsEmailDraft missing exact scope predicate %q", required)
		}
	}

	upsertBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) UpsertCommunicationsEmailDraft")
	for _, required := range []string{
		"email_drafts.personal_user_id is not distinct from excluded.personal_user_id",
		"email_drafts.personal_account_email is not distinct from excluded.personal_account_email",
		"email_drafts.shared_inbox_id is not distinct from excluded.shared_inbox_id",
	} {
		if !strings.Contains(upsertBody, required) {
			t.Fatalf("UpsertCommunicationsEmailDraft missing immutable scope guard %q", required)
		}
	}

	deleteBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) SoftDeleteCommunicationsEmailDraft")
	for _, required := range []string{
		"personal_user_id is not distinct from nullif($4, '')::uuid",
		"personal_account_email is not distinct from nullif($5, '')",
		"shared_inbox_id is not distinct from nullif($6, '')::uuid",
	} {
		if !strings.Contains(deleteBody, required) {
			t.Fatalf("SoftDeleteCommunicationsEmailDraft missing exact scope predicate %q", required)
		}
	}
}

func TestMemoryCommunicationsEmailDraftPersonalScopeIsExactAndImmutable(t *testing.T) {
	repo, companyID, owner, attacker, _, _ := newEmailDraftScopeStoreFixture(t)
	const draftID = "draft:personal:scope-guard"

	created, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "compose", AccountEmail: "owner-a@example.com", Subject: "owner only",
	})
	if err != nil {
		t.Fatalf("create personal draft: %v", err)
	}
	if created.PersonalUserID != owner.UserID || created.PersonalAccountEmail != "owner-a@example.com" {
		t.Fatalf("created scope = %+v", created)
	}

	ownerA := CommunicationsEmailDraftListInput{CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com"}
	ownerB := CommunicationsEmailDraftListInput{CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-b@example.com"}
	attackerScope := CommunicationsEmailDraftListInput{CompanyID: companyID, PersonalUserID: attacker.UserID, PersonalAccountEmail: "attacker@example.com"}
	assertDraftIDs(t, mustListEmailDrafts(t, repo, ownerA), draftID)
	assertDraftIDs(t, mustListEmailDrafts(t, repo, ownerB))
	assertDraftIDs(t, mustListEmailDrafts(t, repo, attackerScope))

	for name, input := range map[string]CommunicationsEmailDraftGetInput{
		"other personal account": {CompanyID: companyID, DraftID: draftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-b@example.com"},
		"other user":             {CompanyID: companyID, DraftID: draftID, PersonalUserID: attacker.UserID, PersonalAccountEmail: "attacker@example.com"},
	} {
		t.Run("get rejects "+name, func(t *testing.T) {
			if _, err := repo.GetCommunicationsEmailDraft(input); !errors.Is(err, ErrNotFound) {
				t.Fatalf("GetCommunicationsEmailDraft error = %v, want ErrNotFound", err)
			}
		})
	}

	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, PersonalUserID: attacker.UserID, PersonalAccountEmail: "attacker@example.com",
		CreatedByUserID: attacker.UserID, UpdatedByUserID: attacker.UserID, Kind: "compose", Subject: "takeover",
	}); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("cross-user upsert error = %v, want ErrAlreadyExists", err)
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-b@example.com",
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "compose", Subject: "account takeover",
	}); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("cross-account upsert error = %v, want ErrAlreadyExists", err)
	}

	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: companyID, DraftID: draftID, PersonalUserID: attacker.UserID, PersonalAccountEmail: "attacker@example.com", UpdatedByUserID: attacker.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-user delete error = %v, want ErrNotFound", err)
	}
	unchanged, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
	})
	if err != nil || unchanged.Subject != "owner only" {
		t.Fatalf("owner draft after attacks = %+v, err=%v", unchanged, err)
	}

	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: companyID, DraftID: draftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com", UpdatedByUserID: owner.UserID,
	}); err != nil {
		t.Fatalf("owner delete: %v", err)
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, PersonalUserID: attacker.UserID, PersonalAccountEmail: "attacker@example.com",
		CreatedByUserID: attacker.UserID, UpdatedByUserID: attacker.UserID, Kind: "compose", Subject: "deleted takeover",
	}); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("soft-deleted cross-user upsert error = %v, want ErrAlreadyExists", err)
	}
}

func TestMemoryCommunicationsEmailDraftSharedScopeIsExactAndImmutable(t *testing.T) {
	repo, companyID, owner, _, sharedA, sharedB := newEmailDraftScopeStoreFixture(t)
	const draftID = "draft:shared:scope-guard"

	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, SharedInboxID: sharedA.FolderID,
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "reply", AccountEmail: "shared-a@example.com", Subject: "shared A",
	}); err != nil {
		t.Fatalf("create shared draft: %v", err)
	}
	assertDraftIDs(t, mustListEmailDrafts(t, repo, CommunicationsEmailDraftListInput{CompanyID: companyID, SharedInboxID: sharedA.FolderID}), draftID)
	assertDraftIDs(t, mustListEmailDrafts(t, repo, CommunicationsEmailDraftListInput{CompanyID: companyID, SharedInboxID: sharedB.FolderID}))

	if _, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draftID, SharedInboxID: sharedB.FolderID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-inbox get error = %v, want ErrNotFound", err)
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, SharedInboxID: sharedB.FolderID,
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "reply", Subject: "takeover",
	}); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("cross-inbox upsert error = %v, want ErrAlreadyExists", err)
	}
	if err := repo.SoftDeleteCommunicationsEmailDraft(CommunicationsEmailDraftDeleteInput{
		CompanyID: companyID, DraftID: draftID, SharedInboxID: sharedB.FolderID, UpdatedByUserID: owner.UserID,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-inbox delete error = %v, want ErrNotFound", err)
	}
	remaining, err := repo.GetCommunicationsEmailDraft(CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draftID, SharedInboxID: sharedA.FolderID,
	})
	if err != nil || remaining.Subject != "shared A" {
		t.Fatalf("shared A draft after attacks = %+v, err=%v", remaining, err)
	}
}

func newEmailDraftScopeStoreFixture(t *testing.T) (*MemoryRepo, string, domain.User, domain.User, domain.CompanyExplorerFolder, domain.CompanyExplorerFolder) {
	t.Helper()
	repo := NewMemoryRepo()
	const companyID = "65656565-6565-4565-8565-656565656565"
	repo.EnsureCompany(companyID, "Draft Scope Store")
	owner, err := repo.UpsertAuthUser("draft-store-owner", "owner@example.com", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	attacker, err := repo.UpsertAuthUser("draft-store-attacker", "attacker@example.com", "Attacker")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range []domain.User{owner, attacker} {
		if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
			t.Fatal(err)
		}
	}
	for index, input := range []UserEmailConnectionInput{
		{UserID: owner.UserID, Provider: "google", AccountEmail: "owner-a@example.com", GrantID: "owner-a", Status: "connected"},
		{UserID: owner.UserID, Provider: "google", AccountEmail: "owner-b@example.com", GrantID: "owner-b", Status: "connected"},
		{UserID: attacker.UserID, Provider: "google", AccountEmail: "attacker@example.com", GrantID: "attacker", Status: "connected"},
	} {
		if _, err := repo.UpsertUserEmailConnection(input); err != nil {
			t.Fatalf("UpsertUserEmailConnection[%d]: %v", index, err)
		}
	}
	for index, email := range []string{"shared-a@example.com", "shared-b@example.com"} {
		if _, err := repo.UpsertCompanyEmailConnection(CompanyEmailConnectionInput{
			CompanyID: companyID, Provider: "google", AccountEmail: email, GrantID: "shared-grant-" + email, Status: "connected", ConnectedByUserID: owner.UserID,
		}); err != nil {
			t.Fatalf("UpsertCompanyEmailConnection[%d]: %v", index, err)
		}
	}
	sharedA, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Shared A", "shared-a@example.com")
	if err != nil {
		t.Fatal(err)
	}
	sharedB, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Shared B", "shared-b@example.com")
	if err != nil {
		t.Fatal(err)
	}
	return repo, companyID, owner, attacker, sharedA, sharedB
}

func mustListEmailDrafts(t *testing.T, repo *MemoryRepo, input CommunicationsEmailDraftListInput) []domain.CommunicationsEmailDraft {
	t.Helper()
	drafts, err := repo.ListCommunicationsEmailDrafts(input)
	if err != nil {
		t.Fatalf("ListCommunicationsEmailDrafts: %v", err)
	}
	return drafts
}

func assertDraftIDs(t *testing.T, drafts []domain.CommunicationsEmailDraft, want ...string) {
	t.Helper()
	if len(drafts) != len(want) {
		t.Fatalf("draft count = %d (%+v), want %d (%v)", len(drafts), drafts, len(want), want)
	}
	for index := range want {
		if drafts[index].DraftID != want[index] {
			t.Fatalf("draft[%d].DraftID = %q, want %q", index, drafts[index].DraftID, want[index])
		}
	}
}
