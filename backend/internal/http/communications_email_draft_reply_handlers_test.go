package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestCommunicationsEmailReplyDraftEnsureUpdateAndFilteredSummary(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	sourceMessageID := seedCommunicationsEmailDraftReplySource(t, fixture.repo, fixture.companyID, fixture.owner.UserID, "owner-a@example.com", "", "reply-one")
	otherSourceMessageID := seedCommunicationsEmailDraftReplySource(t, fixture.repo, fixture.companyID, fixture.owner.UserID, "owner-a@example.com", "", "reply-two")

	first := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "kind": "reply",
		"source_message_id": sourceMessageID, "to_recipients": "first@example.com", "cc_recipients": "copy@example.com",
		"bcc_recipients": "blind@example.com", "subject": "Original", "body_editor_html": "<p>Original body</p>",
	}, fixture.owner, domain.RoleCompanyUser)
	createdDraft, created := decodeHTTPReplyDraftEnsure(t, first, http.StatusOK)
	if !created || !strings.HasPrefix(createdDraft.DraftID, "draft:reply:") {
		t.Fatalf("first ensure created=%v draft=%+v", created, createdDraft)
	}
	if createdDraft.AccountEmail != "owner-a@example.com" || createdDraft.SourceMessageID != sourceMessageID || createdDraft.CreatedByUserID != fixture.owner.UserID {
		t.Fatalf("server-owned reply identity=%+v", createdDraft)
	}
	var replyTarget map[string]string
	if err := json.Unmarshal(createdDraft.ReplyToMessage, &replyTarget); err != nil {
		t.Fatal(err)
	}
	if replyTarget["id"] != "provider-message-reply-one" || replyTarget["email_message_id"] != sourceMessageID || replyTarget["thread_id"] != "provider-thread-reply-one" {
		t.Fatalf("hydrated reply target=%v", replyTarget)
	}

	second := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "kind": "reply",
		"source_message_id": sourceMessageID, "to_recipients": "changed@example.com",
		"subject": "Must not replace", "body_editor_html": "<p>Must not replace</p>",
	}, fixture.owner, domain.RoleCompanyUser)
	existingDraft, created := decodeHTTPReplyDraftEnsure(t, second, http.StatusOK)
	if created || existingDraft.DraftID != createdDraft.DraftID || existingDraft.Subject != "Original" || existingDraft.BodyEditorHTML != "<p>Original body</p>" || existingDraft.ToRecipients != "first@example.com" {
		t.Fatalf("repeat ensure changed existing draft: created=%v draft=%+v", created, existingDraft)
	}

	updatedResponse := fixture.request(t, http.MethodPut, "/v1/communications/drafts/"+url.PathEscape(createdDraft.DraftID), map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "kind": "reply",
		"source_message_id": sourceMessageID, "to_recipients": "updated@example.com",
		"subject": "Updated", "body_editor_html": "<p>Updated body</p>",
	}, fixture.owner, domain.RoleCompanyUser)
	if updatedResponse.Code != http.StatusOK {
		t.Fatalf("reply update status=%d body=%s", updatedResponse.Code, updatedResponse.Body.String())
	}
	updated := decodeHTTPDraft(t, updatedResponse)
	if updated.DraftID != createdDraft.DraftID || updated.Subject != "Updated" || updated.BodyEditorHTML != "<p>Updated body</p>" || updated.SourceMessageID != sourceMessageID {
		t.Fatalf("updated reply=%+v", updated)
	}

	fixture.expectStatus(t, http.MethodPut, "/v1/communications/drafts/draft:reply:missing", map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "kind": "reply", "source_message_id": sourceMessageID,
	}, fixture.owner, domain.RoleCompanyUser, http.StatusNotFound)
	fixture.expectStatus(t, http.MethodPut, "/v1/communications/drafts/"+url.PathEscape(createdDraft.DraftID), map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "kind": "reply", "source_message_id": otherSourceMessageID,
	}, fixture.owner, domain.RoleCompanyUser, http.StatusNotFound)

	values := url.Values{"company_id": {fixture.companyID}, "account_email": {"owner-a@example.com"}, "kind": {"reply"}}
	values.Add("source_message_id", sourceMessageID)
	listed := fixture.request(t, http.MethodGet, "/v1/communications/drafts?"+values.Encode(), nil, fixture.owner, domain.RoleCompanyUser)
	if listed.Code != http.StatusOK {
		t.Fatalf("filtered list status=%d body=%s", listed.Code, listed.Body.String())
	}
	var listEnvelope struct {
		Drafts []communicationsEmailDraftResponse `json:"drafts"`
	}
	if err := json.NewDecoder(listed.Body).Decode(&listEnvelope); err != nil {
		t.Fatal(err)
	}
	if len(listEnvelope.Drafts) != 1 || listEnvelope.Drafts[0].DraftID != createdDraft.DraftID || listEnvelope.Drafts[0].BodyEditorHTML != "" || len(listEnvelope.Drafts[0].ReplyToMessage) != 0 || len(listEnvelope.Drafts[0].Attachments) != 0 {
		t.Fatalf("filtered summary=%+v", listEnvelope.Drafts)
	}
}

func TestCommunicationsEmailReplyDraftRejectsClientIdentityAndSourceKindConflict(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	sourceMessageID := seedCommunicationsEmailDraftReplySource(t, fixture.repo, fixture.companyID, fixture.owner.UserID, "owner-a@example.com", "", "reply-conflict")

	clientReplyTarget := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "kind": "reply",
		"source_message_id": sourceMessageID, "reply_to_message": map[string]any{"id": "client-provider-id"},
	}, fixture.owner, domain.RoleCompanyUser)
	assertHTTPDraftError(t, clientReplyTarget, http.StatusBadRequest, "email_reply_target_not_allowed")

	clientID := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "draft_id": "client-owned", "account_email": "owner-a@example.com",
		"kind": "reply", "source_message_id": sourceMessageID,
	}, fixture.owner, domain.RoleCompanyUser)
	assertHTTPDraftError(t, clientID, http.StatusBadRequest, "email_reply_draft_id_not_allowed")

	unknownSenderField := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "sender_account_email": "spoofed@example.com",
		"kind": "reply", "source_message_id": sourceMessageID,
	}, fixture.owner, domain.RoleCompanyUser)
	if unknownSenderField.Code != http.StatusBadRequest {
		t.Fatalf("removed sender field status=%d body=%s", unknownSenderField.Code, unknownSenderField.Body.String())
	}

	if _, err := fixture.repo.UpsertCommunicationsEmailDraft(store.CommunicationsEmailDraftInput{
		CompanyID: fixture.companyID, DraftID: "draft:forward:conflict", PersonalUserID: fixture.owner.UserID,
		PersonalAccountEmail: "owner-a@example.com", CreatedByUserID: fixture.owner.UserID, UpdatedByUserID: fixture.owner.UserID,
		Kind: "forward", SourceMessageID: sourceMessageID, AccountEmail: "owner-a@example.com",
	}); err != nil {
		t.Fatal(err)
	}
	conflict := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "kind": "reply", "source_message_id": sourceMessageID,
	}, fixture.owner, domain.RoleCompanyUser)
	assertHTTPDraftError(t, conflict, http.StatusConflict, "email_draft_source_kind_conflict")

	invalidKind := fixture.request(t, http.MethodGet, fixture.draftListPath("owner-a@example.com", "")+"&kind=forward", nil, fixture.owner, domain.RoleCompanyUser)
	assertHTTPDraftError(t, invalidKind, http.StatusBadRequest, "invalid_email_draft_kind")
	invalidSource := fixture.request(t, http.MethodGet, fixture.draftListPath("owner-a@example.com", "")+"&kind=reply&source_message_id=provider-id", nil, fixture.owner, domain.RoleCompanyUser)
	assertHTTPDraftError(t, invalidSource, http.StatusBadRequest, "invalid_email_draft_source_message_id")
	tooMany := url.Values{"company_id": {fixture.companyID}, "account_email": {"owner-a@example.com"}, "kind": {"reply"}}
	for index := 0; index <= store.CommunicationsEmailDraftSourceFilterMax; index++ {
		tooMany.Add("source_message_id", sourceMessageID)
	}
	limit := fixture.request(t, http.MethodGet, "/v1/communications/drafts?"+tooMany.Encode(), nil, fixture.owner, domain.RoleCompanyUser)
	assertHTTPDraftError(t, limit, http.StatusBadRequest, "email_draft_source_filter_limit_exceeded")
}

func TestCommunicationsEmailForwardAfterReplyReturnsSourceKindConflict(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	sourceMessageID := seedCommunicationsEmailDraftReplySource(t, fixture.repo, fixture.companyID, fixture.owner.UserID, "owner-a@example.com", "", "reverse-kind-conflict")
	reply, created := decodeHTTPReplyDraftEnsure(t, fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com",
		"kind": "reply", "source_message_id": sourceMessageID,
	}, fixture.owner, domain.RoleCompanyUser), http.StatusOK)
	if !created {
		t.Fatalf("Reply was not created: %+v", reply)
	}
	forward := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "draft_id": "draft:forward:reverse-kind-conflict",
		"account_email": "owner-a@example.com", "kind": "forward", "source_message_id": sourceMessageID,
		"reply_to_message": map[string]any{"id": "provider-message-reverse-kind-conflict"},
	}, fixture.owner, domain.RoleCompanyUser)
	assertHTTPDraftError(t, forward, http.StatusConflict, "email_draft_source_kind_conflict")

	exact := fixture.request(t, http.MethodGet, fixture.draftByIDPath(reply.DraftID, "owner-a@example.com", ""), nil, fixture.owner, domain.RoleCompanyUser)
	if exact.Code != http.StatusOK || decodeHTTPDraft(t, exact).Kind != "reply" {
		t.Fatalf("Reply changed after reverse collision status=%d body=%s", exact.Code, exact.Body.String())
	}
}

func TestCommunicationsEmailForwardDraftRetainsRawTargetAndSchedule(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	sourceMessageID := seedCommunicationsEmailDraftReplySource(t, fixture.repo, fixture.companyID, fixture.owner.UserID, "owner-a@example.com", "", "forward-context")
	const draftID = "draft:forward:triage-context"
	const scheduledAt = "2030-03-04T05:06:07Z"
	initialTarget := map[string]any{
		"id": "provider-message-forward-context", "thread_id": "provider-thread-forward-context",
		"subject": "Original forward context", "from": []map[string]string{{"email": "sender@example.com"}},
	}
	created := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "draft_id": draftID, "account_email": "owner-a@example.com",
		"kind": "forward", "source_message_id": sourceMessageID, "reply_to_message": initialTarget,
		"subject": "Fwd: Original", "body_editor_html": "<p>Forward body</p>", "scheduled_send_timestamp": scheduledAt,
	}, fixture.owner, domain.RoleCompanyUser)
	if created.Code != http.StatusOK {
		t.Fatalf("forward create status=%d body=%s", created.Code, created.Body.String())
	}
	createdDraft := decodeHTTPDraft(t, created)
	assertHTTPDraftRawTarget(t, createdDraft, initialTarget)
	if createdDraft.Kind != "forward" || createdDraft.SourceMessageID != sourceMessageID || createdDraft.ScheduledSendTimestamp == nil || createdDraft.ScheduledSendTimestamp.Format("2006-01-02T15:04:05Z07:00") != scheduledAt {
		t.Fatalf("forward identity/schedule=%+v", createdDraft)
	}

	updatedTarget := map[string]any{
		"id": "provider-message-forward-context", "thread_id": "provider-thread-forward-context",
		"subject": "Updated forward context", "from": []map[string]string{{"email": "sender@example.com"}},
	}
	updated := fixture.request(t, http.MethodPut, "/v1/communications/drafts/"+url.PathEscape(draftID), map[string]any{
		"company_id": fixture.companyID, "account_email": "owner-a@example.com", "kind": "forward",
		"source_message_id": sourceMessageID, "reply_to_message": updatedTarget,
		"subject": "Fwd: Updated", "body_editor_html": "<p>Updated forward body</p>", "scheduled_send_timestamp": scheduledAt,
	}, fixture.owner, domain.RoleCompanyUser)
	if updated.Code != http.StatusOK {
		t.Fatalf("forward update status=%d body=%s", updated.Code, updated.Body.String())
	}
	assertHTTPDraftRawTarget(t, decodeHTTPDraft(t, updated), updatedTarget)

	exact := fixture.request(t, http.MethodGet, fixture.draftByIDPath(draftID, "owner-a@example.com", ""), nil, fixture.owner, domain.RoleCompanyUser)
	if exact.Code != http.StatusOK {
		t.Fatalf("forward exact read status=%d body=%s", exact.Code, exact.Body.String())
	}
	exactDraft := decodeHTTPDraft(t, exact)
	assertHTTPDraftRawTarget(t, exactDraft, updatedTarget)
	if exactDraft.Subject != "Fwd: Updated" || exactDraft.ScheduledSendTimestamp == nil {
		t.Fatalf("forward exact read=%+v", exactDraft)
	}
}

func TestCommunicationsGenericDraftStillDefaultsToComposeWithoutKind(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	created := fixture.request(t, http.MethodPost, "/v1/communications/drafts", map[string]any{
		"company_id": fixture.companyID, "draft_id": "draft:reply:prefix-does-not-set-kind",
		"account_email": "owner-a@example.com", "subject": "Ordinary compose",
	}, fixture.owner, domain.RoleCompanyUser)
	if created.Code != http.StatusOK {
		t.Fatalf("generic compose status=%d body=%s", created.Code, created.Body.String())
	}
	draft := decodeHTTPDraft(t, created)
	if draft.Kind != "compose" || draft.SourceMessageID != "" {
		t.Fatalf("generic default kind=%q source=%q", draft.Kind, draft.SourceMessageID)
	}
}

func TestCommunicationsSharedInboxReplyDraftIdentityIsPerCreator(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	sourceMessageID := seedCommunicationsEmailDraftReplySource(t, fixture.repo, fixture.companyID, "", "shared-a@example.com", fixture.sharedA.FolderID, "shared-reply")
	body := map[string]any{
		"company_id": fixture.companyID, "shared_inbox_id": fixture.sharedA.FolderID,
		"kind": "reply", "source_message_id": sourceMessageID, "subject": "Shared mailbox, private owner",
	}
	ownerDraft, ownerCreated := decodeHTTPReplyDraftEnsure(t, fixture.request(t, http.MethodPost, "/v1/communications/drafts", body, fixture.owner, domain.RoleCompanyUser), http.StatusOK)
	editorDraft, editorCreated := decodeHTTPReplyDraftEnsure(t, fixture.request(t, http.MethodPost, "/v1/communications/drafts", body, fixture.editor, domain.RoleCompanyUser), http.StatusOK)
	if !ownerCreated || !editorCreated || ownerDraft.DraftID == editorDraft.DraftID || ownerDraft.CreatedByUserID != fixture.owner.UserID || editorDraft.CreatedByUserID != fixture.editor.UserID {
		t.Fatalf("shared per-creator replies owner=%+v editor=%+v", ownerDraft, editorDraft)
	}
	if ownerDraft.AccountEmail != "shared-a@example.com" || editorDraft.AccountEmail != "shared-a@example.com" {
		t.Fatalf("shared sender was not resolved from inbox: owner=%q editor=%q", ownerDraft.AccountEmail, editorDraft.AccountEmail)
	}
	repeatedOwner, created := decodeHTTPReplyDraftEnsure(t, fixture.request(t, http.MethodPost, "/v1/communications/drafts", body, fixture.owner, domain.RoleCompanyUser), http.StatusOK)
	if created || repeatedOwner.DraftID != ownerDraft.DraftID {
		t.Fatalf("owner repeat crossed creator identity: created=%v draft=%+v", created, repeatedOwner)
	}
}

func seedCommunicationsEmailDraftReplySource(t *testing.T, repo *store.MemoryRepo, companyID, personalUserID, accountEmail, sharedInboxID, suffix string) string {
	t.Helper()
	input := store.CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: personalUserID, PersonalAccountEmail: accountEmail,
		SharedInboxID: sharedInboxID, AccountEmail: accountEmail, Provider: "google",
		ProviderThreadID: "provider-thread-" + suffix, SelectedMessageID: "provider-message-" + suffix,
		Messages: []domain.EmailMessageSnapshot{{
			ID: "provider-message-" + suffix, ThreadID: "provider-thread-" + suffix, Subject: "Source " + suffix,
		}},
	}
	if sharedInboxID != "" {
		input.PersonalAccountEmail = ""
	}
	thread, err := repo.UpsertCommunicationsEmailThread(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(thread.Messages) != 1 || thread.Messages[0].EmailMessageID == "" {
		t.Fatalf("stored source thread=%+v", thread)
	}
	return thread.Messages[0].EmailMessageID
}

func decodeHTTPReplyDraftEnsure(t *testing.T, recorder interface {
	Result() *http.Response
}, wantStatus int) (communicationsEmailDraftResponse, bool) {
	t.Helper()
	response := recorder.Result()
	defer response.Body.Close()
	if response.StatusCode != wantStatus {
		var payload any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		t.Fatalf("reply ensure status=%d payload=%v, want=%d", response.StatusCode, payload, wantStatus)
	}
	var envelope struct {
		Draft   communicationsEmailDraftResponse `json:"draft"`
		Created bool                             `json:"created"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Draft, envelope.Created
}

func assertHTTPDraftError(t *testing.T, recorder interface {
	Result() *http.Response
}, wantStatus int, wantCode string) {
	t.Helper()
	response := recorder.Result()
	defer response.Body.Close()
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != wantStatus || payload.Error != wantCode {
		t.Fatalf("status=%d error=%q, want status=%d error=%q", response.StatusCode, payload.Error, wantStatus, wantCode)
	}
}

func assertHTTPDraftRawTarget(t *testing.T, draft communicationsEmailDraftResponse, want map[string]any) {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(draft.ReplyToMessage, &got); err != nil {
		t.Fatal(err)
	}
	wantJSON, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	var normalizedWant map[string]any
	if err := json.Unmarshal(wantJSON, &normalizedWant); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, normalizedWant) {
		t.Fatalf("reply_to_message=%v, want %v", got, normalizedWant)
	}
}
