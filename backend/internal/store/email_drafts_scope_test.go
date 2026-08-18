package store

import (
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
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
	if !strings.Contains(listBody, "communicationsEmailDraftSummarySelectColumns()") {
		t.Fatal("ListCommunicationsEmailDrafts must use the body-free summary projection")
	}
	summaryProjection := extractFunctionSourceForTest(t, source, "func communicationsEmailDraftSummarySelectColumns")
	if strings.Contains(summaryProjection, "body_editor_html") {
		t.Fatal("draft list summary projection reads full draft bodies")
	}
	if !strings.Contains(summaryProjection, "scheduled_send_timestamp") {
		t.Fatal("draft list summary projection must include the scheduler timestamp")
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
	if !strings.Contains(getBody, "hydrateCommunicationsEmailDraftReplyTarget") {
		t.Fatal("GetCommunicationsEmailDraft must restore the provider reply target for exact draft reads")
	}
	replyTargetBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) hydrateCommunicationsEmailDraftReplyTarget")
	for _, required := range []string{"message.provider_message_id", "thread.provider_thread_id", "draft.SourceMessageID"} {
		if !strings.Contains(replyTargetBody, required) {
			t.Fatalf("reply target hydration missing %q", required)
		}
	}

	upsertBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) UpsertCommunicationsEmailDraft")
	for _, required := range []string{
		"email_drafts.kind=excluded.kind",
		"email_drafts.source_email_message_id is not distinct from excluded.source_email_message_id",
		"email_drafts.personal_user_id is not distinct from excluded.personal_user_id",
		"email_drafts.personal_account_email is not distinct from excluded.personal_account_email",
		"email_drafts.shared_inbox_id is not distinct from excluded.shared_inbox_id",
	} {
		if !strings.Contains(upsertBody, required) {
			t.Fatalf("UpsertCommunicationsEmailDraft missing immutable scope guard %q", required)
		}
	}
	existingOnlyBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) updateExistingCommunicationsEmailReplyDraft")
	for _, required := range []string{
		"source_email_message_id=$3::uuid",
		"created_by_user_id=$4::uuid",
		"kind='reply'",
		"personal_user_id is not distinct from nullif($6,'')::uuid",
		"personal_account_email is not distinct from nullif($7,'')",
		"shared_inbox_id is not distinct from nullif($16,'')::uuid",
	} {
		if !strings.Contains(existingOnlyBody, required) {
			t.Fatalf("existing-only Reply update missing immutable identity predicate %q", required)
		}
	}
	ensureBody := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) EnsureCommunicationsEmailReplyDraft")
	if !strings.Contains(ensureBody, "on conflict do nothing") || strings.Contains(ensureBody, "for {") {
		t.Fatal("Reply ensure must converge through one conflict-safe insert without a retry loop")
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

func TestPostgresEmailDraftAttachmentAccessRequiresCreatorAndMailboxPermission(t *testing.T) {
	raw, err := os.ReadFile("email_attachment_access.go")
	if err != nil {
		t.Fatal(err)
	}
	body := extractFunctionSourceForTest(t, strings.ReplaceAll(string(raw), "\r\n", "\n"), "func (r *PostgresRepo) GetEmailAttachmentResourceAccess")
	for _, required := range []string{
		"draft.created_by_user_id=$2::uuid",
		"draft.personal_user_id=$2::uuid",
		"mangorts_user_can_access_resource(",
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("email_draft attachment access missing %q", required)
		}
	}
}

func TestPostgresEmailDraftUpsertMapsOnlySemanticUniqueIndexes(t *testing.T) {
	for _, constraint := range []string{
		"idx_email_drafts_active_personal_message_personal_account",
		"idx_email_drafts_active_personal_message_shared_inbox",
	} {
		err := communicationsEmailDraftUpsertError(&pgconn.PgError{Code: "23505", ConstraintName: constraint})
		if !errors.Is(err, ErrEmailDraftIdentityConflict) {
			t.Fatalf("constraint %q error=%v, want ErrEmailDraftIdentityConflict", constraint, err)
		}
	}
	for _, pgErr := range []*pgconn.PgError{
		{Code: "23505", ConstraintName: "email_drafts_pkey"},
		{Code: "23503", ConstraintName: "idx_email_drafts_active_personal_message_personal_account"},
	} {
		if got := communicationsEmailDraftUpsertError(pgErr); got != pgErr {
			t.Fatalf("unrelated PostgreSQL error was remapped: %#v", pgErr)
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

func TestMemoryCommunicationsEmailReplyRequiresStoredSourceMessage(t *testing.T) {
	repo, companyID, owner, _, _, _ := newEmailDraftScopeStoreFixture(t)

	_, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "draft:reply:not-ingested", PersonalUserID: owner.UserID,
		PersonalAccountEmail: "owner-a@example.com", CreatedByUserID: owner.UserID,
		UpdatedByUserID: owner.UserID, Kind: "reply", AccountEmail: "owner-a@example.com",
	})
	if !errors.Is(err, ErrEmailReplySourceNotIngested) {
		t.Fatalf("reply without source error = %v, want ErrEmailReplySourceNotIngested", err)
	}

	_, err = repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "draft:reply:missing-source", PersonalUserID: owner.UserID,
		PersonalAccountEmail: "owner-a@example.com", CreatedByUserID: owner.UserID,
		UpdatedByUserID: owner.UserID, Kind: "reply", AccountEmail: "owner-a@example.com",
		SourceMessageID: "67676767-6767-4767-8767-676767676799",
	})
	if !errors.Is(err, ErrEmailDraftSourceNotFound) {
		t.Fatalf("reply with unknown source error = %v, want ErrEmailDraftSourceNotFound", err)
	}
}

func TestMemoryCommunicationsEmailReplyEnsureConvergesAndExistingOnlyUpdates(t *testing.T) {
	repo, companyID, owner, _, _, _ := newEmailDraftScopeStoreFixture(t)
	thread, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		AccountEmail: "owner-a@example.com", Provider: "google", ProviderThreadID: "provider-thread-ensure",
		SelectedMessageID: "provider-message-ensure",
		Messages:          []domain.EmailMessageSnapshot{{ID: "provider-message-ensure", ThreadID: "provider-thread-ensure", Subject: "Ensure source"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	sourceMessageID := thread.Messages[0].EmailMessageID
	input := CommunicationsEmailDraftInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, SourceMessageID: sourceMessageID,
		AccountEmail: "owner-a@example.com", Subject: "Initial", BodyEditorHTML: "<p>Initial</p>",
	}

	const callers = 8
	start := make(chan struct{})
	results := make([]domain.CommunicationsEmailDraft, callers)
	created := make([]bool, callers)
	errs := make([]error, callers)
	var wait sync.WaitGroup
	wait.Add(callers)
	for index := 0; index < callers; index++ {
		go func(index int) {
			defer wait.Done()
			<-start
			results[index], created[index], errs[index] = repo.EnsureCommunicationsEmailReplyDraft(input)
		}(index)
	}
	close(start)
	wait.Wait()

	createdCount := 0
	for index := range results {
		if errs[index] != nil {
			t.Fatalf("ensure[%d]: %v", index, errs[index])
		}
		if results[index].DraftID != results[0].DraftID {
			t.Fatalf("ensure[%d] draft=%q, want %q", index, results[index].DraftID, results[0].DraftID)
		}
		if created[index] {
			createdCount++
		}
	}
	if createdCount != 1 || !strings.HasPrefix(results[0].DraftID, "draft:reply:") {
		t.Fatalf("created count=%d draft=%+v", createdCount, results[0])
	}

	filtered := mustListEmailDrafts(t, repo, CommunicationsEmailDraftListInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		ParticipantUserID: owner.UserID, Kind: "reply", SourceMessageIDs: []string{sourceMessageID},
	})
	assertDraftIDs(t, filtered, results[0].DraftID)

	updated, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: results[0].DraftID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "reply", SourceMessageID: sourceMessageID,
		AccountEmail: "owner-a@example.com", Subject: "Updated", BodyEditorHTML: "<p>Updated</p>", ExistingOnly: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Subject != "Updated" || updated.BodyEditorHTML != "<p>Updated</p>" || updated.SourceMessageID != sourceMessageID {
		t.Fatalf("existing-only update=%+v", updated)
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "draft:reply:missing", PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "reply", SourceMessageID: sourceMessageID,
		AccountEmail: "owner-a@example.com", ExistingOnly: true,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing existing-only update error=%v, want ErrNotFound", err)
	}
}

func TestMemoryCommunicationsEmailForwardAfterReplyReturnsSourceKindConflict(t *testing.T) {
	repo, companyID, owner, _, _, _ := newEmailDraftScopeStoreFixture(t)
	thread, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		AccountEmail: "owner-a@example.com", Provider: "google", ProviderThreadID: "provider-thread-reverse-conflict",
		SelectedMessageID: "provider-message-reverse-conflict",
		Messages:          []domain.EmailMessageSnapshot{{ID: "provider-message-reverse-conflict", ThreadID: "provider-thread-reverse-conflict"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	sourceMessageID := thread.Messages[0].EmailMessageID
	reply, _, err := repo.EnsureCommunicationsEmailReplyDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, PersonalUserID: owner.UserID, PersonalAccountEmail: "owner-a@example.com",
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, SourceMessageID: sourceMessageID, AccountEmail: "owner-a@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	forward := CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: "draft:forward:reverse-conflict", PersonalUserID: owner.UserID,
		PersonalAccountEmail: "owner-a@example.com", CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID,
		Kind: "forward", SourceMessageID: sourceMessageID, AccountEmail: "owner-a@example.com",
	}
	if _, err := repo.UpsertCommunicationsEmailDraft(forward); !errors.Is(err, ErrEmailDraftIdentityConflict) {
		t.Fatalf("Forward after Reply error=%v, want ErrEmailDraftIdentityConflict", err)
	}
	forward.DraftID = reply.DraftID
	if _, err := repo.UpsertCommunicationsEmailDraft(forward); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("same-draft kind collision error=%v, want ErrAlreadyExists", err)
	}
}

func TestMemoryCommunicationsEmailDraftSharedScopeIsExactAndImmutable(t *testing.T) {
	repo, companyID, owner, _, sharedA, sharedB := newEmailDraftScopeStoreFixture(t)
	const draftID = "draft:shared:scope-guard"

	if _, err := repo.UpsertCommunicationsEmailDraft(CommunicationsEmailDraftInput{
		CompanyID: companyID, DraftID: draftID, SharedInboxID: sharedA.FolderID,
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "compose", AccountEmail: "shared-a@example.com", Subject: "shared A",
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
		CreatedByUserID: owner.UserID, UpdatedByUserID: owner.UserID, Kind: "compose", Subject: "takeover",
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
