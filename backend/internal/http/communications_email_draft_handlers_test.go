package httpapi

import (
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"testing"
)

func communicationsEditorPersistenceTestHandler(t *testing.T) (http.Handler, string, string, string, *store.MemoryRepo) {
	t.Helper()
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "communications-editor-persistence-user"
	const companyID = "19191919-1919-4919-8919-191919191919"
	user, err := repo.UpsertAuthUser(subject, "editor@example.com", "Editor")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Communications Editor Persistence")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-editor-persistence",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)
	return handler, token, companyID, user.UserID, repo
}

func TestCommunicationsEmailDraftRejectsInlineFileBytes(t *testing.T) {
	t.Parallel()
	handler, token, companyID, _, _ := communicationsEditorPersistenceTestHandler(t)
	body := fmt.Sprintf("{\"company_id\":%q,\"draft_id\":\"draft:inline-guard\",\"account_email\":\"editor@example.com\",\"body_editor_html\":\"<img src=\\\"data:image/png;base64,aGVsbG8=\\\">\"}", companyID)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/drafts", body, token, http.StatusBadRequest)
}

func TestCommunicationsEmailSignatureRejectsInlineFileBytes(t *testing.T) {
	t.Parallel()
	handler, token, companyID, _, _ := communicationsEditorPersistenceTestHandler(t)
	body := fmt.Sprintf("{\"company_id\":%q,\"account_email\":\"editor@example.com\",\"body_editor_html\":\"<img src=\\\"data:image/png;base64,aGVsbG8=\\\">\"}", companyID)
	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/signature", body, token, http.StatusBadRequest)
}

func TestCommunicationsEmailDraftHonorsAtomicEditorFormatGate(t *testing.T) {
	handler, token, companyID, userID, repo := communicationsEditorPersistenceTestHandler(t)
	legacyBody := fmt.Sprintf("{\"company_id\":%q,\"draft_id\":\"draft:format-gate\",\"account_email\":\"editor@example.com\",\"subject\":\"legacy\",\"body_editor_html\":\"<p>legacy remains untouched</p>\"}", companyID)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/drafts", legacyBody, token, http.StatusOK)
	if err := repo.SetEditorDataFormatForTests(store.EditorDataFormatGate{
		CompanyID: companyID, EditorFormat: store.EditorFormatTiptapJSON,
		MigrationState: store.EditorMigrationReady, DocumentSchemaVersion: store.MangoTiptapSchemaVersion,
	}); err != nil {
		t.Fatal(err)
	}
	staleBody := fmt.Sprintf("{\"company_id\":%q,\"draft_id\":\"draft:format-gate\",\"account_email\":\"editor@example.com\",\"editor_format\":\"legacy_html\",\"subject\":\"stale\",\"body_editor_html\":\"<p>stale</p>\"}", companyID)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/drafts", staleBody, token, http.StatusConflict)
	jsonMetadata := fmt.Sprintf("{\"company_id\":%q,\"draft_id\":\"draft:format-gate\",\"account_email\":\"editor@example.com\",\"editor_format\":\"tiptap_json\",\"subject\":\"json metadata\",\"body_editor_html\":\"\"}", companyID)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/drafts", jsonMetadata, token, http.StatusOK)
	saved, err := repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: "draft:format-gate",
		PersonalUserID: userID, PersonalAccountEmail: "editor@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.BodyEditorHTML != "<p>legacy remains untouched</p>" || saved.Subject != "json metadata" {
		t.Fatalf("saved draft body=%q subject=%q", saved.BodyEditorHTML, saved.Subject)
	}
}
