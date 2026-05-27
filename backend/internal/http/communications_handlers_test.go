package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeNylasClient struct {
	mu                sync.Mutex
	grant             NylasGrant
	deletedGrants     []string
	folders           []NylasFolder
	messages          []NylasMessage
	messagesByID      map[string]NylasMessage
	message           NylasMessage
	sent              NylasSendMessageRequest
	update            NylasMessageUpdate
	updateCalls       []fakeNylasUpdateCall
	updateErrByID     map[string]error
	lastQuery         NylasMessageQuery
	lastFolderGrantID string
	lastSendGrantID   string
	folderCalls       int
	messageCalls      int
	detailCalls       int
	listErr           error
	exchangeErr       error
}

type fakeNylasUpdateCall struct {
	MessageID string
	Update    NylasMessageUpdate
}

func (f *fakeNylasClient) ExchangeCode(_ context.Context, _, _ string) (NylasGrant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.exchangeErr != nil {
		return NylasGrant{}, f.exchangeErr
	}
	return f.grant, nil
}

func (f *fakeNylasClient) DeleteGrant(_ context.Context, grantID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deletedGrants = append(f.deletedGrants, grantID)
	return nil
}

func (f *fakeNylasClient) ListFolders(_ context.Context, grantID string) ([]NylasFolder, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.folderCalls++
	f.lastFolderGrantID = grantID
	return f.folders, nil
}

func (f *fakeNylasClient) ListMessages(_ context.Context, _ string, query NylasMessageQuery) (NylasMessagePage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.messageCalls++
	f.lastQuery = query
	if f.listErr != nil {
		return NylasMessagePage{}, f.listErr
	}
	return NylasMessagePage{Messages: f.messages, NextPageToken: "next-token"}, nil
}

func (f *fakeNylasClient) GetMessage(_ context.Context, _, messageID string) (NylasMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.detailCalls++
	if f.messagesByID != nil {
		if message, ok := f.messagesByID[messageID]; ok {
			return message, nil
		}
	}
	return f.message, nil
}

func (f *fakeNylasClient) UpdateMessage(_ context.Context, _, messageID string, update NylasMessageUpdate) (NylasMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.updateErrByID != nil && f.updateErrByID[messageID] != nil {
		return NylasMessage{}, f.updateErrByID[messageID]
	}
	f.update = update
	f.updateCalls = append(f.updateCalls, fakeNylasUpdateCall{MessageID: messageID, Update: update})
	message := f.message
	if f.messagesByID != nil {
		if stored, ok := f.messagesByID[messageID]; ok {
			message = stored
		}
	}
	if message.ID == "" {
		message.ID = messageID
	}
	if update.Unread != nil {
		message.Unread = *update.Unread
	}
	if update.Starred != nil {
		message.Starred = *update.Starred
	}
	if update.Folders != nil {
		message.Folders = update.Folders
	}
	return message, nil
}

func (f *fakeNylasClient) DeleteMessage(_ context.Context, _, _ string) error {
	return nil
}

func (f *fakeNylasClient) SendMessage(_ context.Context, grantID string, request NylasSendMessageRequest) (NylasMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastSendGrantID = grantID
	f.sent = request
	return NylasMessage{ID: "sent-message", Subject: request.Subject, To: request.To}, nil
}

func TestNylasOAuthStateRoundTripAndExpiry(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 8, 12, 0, 0, 0, time.UTC)
	state, err := signNylasOAuthState("secret", nylasOAuthStatePayload{
		UserID:   "user-1",
		Email:    "USER@example.COM",
		Provider: "gmail",
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := parseNylasOAuthState("secret", state, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if payload.UserID != "user-1" || payload.Email != "user@example.com" || payload.Provider != "google" {
		t.Fatalf("payload = %+v, want normalized user/email/provider", payload)
	}
	if _, err := parseNylasOAuthState("secret", state, now.Add(nylasOAuthStateTTL+time.Second)); !errors.Is(err, errExpiredNylasState) {
		t.Fatalf("expired state error = %v, want %v", err, errExpiredNylasState)
	}
	if _, err := parseNylasOAuthState("wrong-secret", state, now); !errors.Is(err, errInvalidNylasState) {
		t.Fatalf("wrong secret error = %v, want %v", err, errInvalidNylasState)
	}
}

func TestCommunicationsAuthURLIncludesSignedState(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/auth-url?provider=google", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, "user@example.com"))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		AuthURL string `json:"auth_url"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(payload.AuthURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("client_id") != "client-id" || parsed.Query().Get("provider") != "google" {
		t.Fatalf("auth url query = %s", parsed.RawQuery)
	}
	if parsed.Query().Get("login_hint") != "user@example.com" {
		t.Fatalf("login_hint = %q, want user@example.com", parsed.Query().Get("login_hint"))
	}
	if scope := parsed.Query().Get("scope"); !strings.Contains(scope, "https://www.googleapis.com/auth/userinfo.email") || strings.Contains(scope, " userinfo.email ") {
		t.Fatalf("scope = %q, want fully-qualified Google scopes", scope)
	}
	state, err := parseNylasOAuthState("state-secret", parsed.Query().Get("state"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if state.UserID != user.UserID || state.Email != "user@example.com" || state.Provider != "google" {
		t.Fatalf("state = %+v, want user-bound google state", state)
	}
}

func TestNylasGoogleScopesNormalizeShorthandEnvValues(t *testing.T) {
	t.Parallel()

	config := NylasConfig{
		GoogleScopes: []string{"openid", "userinfo.email", "gmail.modify", "gmail.send", "gmail.labels", "calendar", "gmail.send"},
	}
	scopes := strings.Join(config.ScopesForProvider("google"), " ")
	if strings.Contains(scopes, "openid") || strings.Contains(scopes, " userinfo.email ") {
		t.Fatalf("scopes = %q, want unsupported shorthand scopes removed or normalized", scopes)
	}
	for _, want := range []string{
		"https://www.googleapis.com/auth/userinfo.email",
		"https://www.googleapis.com/auth/gmail.modify",
		"https://www.googleapis.com/auth/gmail.send",
		"https://www.googleapis.com/auth/gmail.labels",
		"https://www.googleapis.com/auth/calendar",
	} {
		if !strings.Contains(scopes, want) {
			t.Fatalf("scopes = %q, missing %q", scopes, want)
		}
	}
	if strings.Count(scopes, "https://www.googleapis.com/auth/gmail.send") != 1 {
		t.Fatalf("scopes = %q, want duplicate scopes removed", scopes)
	}
}

func TestNylasFolderUnmarshalAcceptsBooleanSystemFolder(t *testing.T) {
	t.Parallel()

	var payload struct {
		Data []NylasFolder `json:"data"`
	}
	err := json.Unmarshal([]byte(`{"data":[{"id":"inbox","name":"Inbox","system_folder":"inbox"},{"id":"label-1","name":"Label","system_folder":false}]}`), &payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload.Data) != 2 {
		t.Fatalf("folders = %d, want 2", len(payload.Data))
	}
	if payload.Data[0].SystemFolder != "inbox" {
		t.Fatalf("string system_folder = %q, want inbox", payload.Data[0].SystemFolder)
	}
	if payload.Data[1].SystemFolder != "" {
		t.Fatalf("boolean system_folder = %q, want empty", payload.Data[1].SystemFolder)
	}
}

func TestNylasCallbackStoresGrantAndRejectsEmailMismatch(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	state, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:   user.UserID,
		Email:    user.Email,
		Provider: "microsoft",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-1", Email: user.Email, Provider: "microsoft"}}
	handler := NewServerWithOptions(repo, ServerOptions{
		NylasConfig: config,
		NylasClient: nylas,
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("success callback status = %d, body=%s", rec.Code, rec.Body.String())
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.GrantID != "grant-1" || connection.Provider != "microsoft" || connection.AccountEmail != user.Email {
		t.Fatalf("connection = %+v, want stored grant metadata", connection)
	}

	mismatchRepo := store.NewMemoryRepo()
	mismatchUser, err := mismatchRepo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	mismatchState, err := signNylasOAuthState(config.StateSecret, nylasOAuthStatePayload{
		UserID:   mismatchUser.UserID,
		Email:    mismatchUser.Email,
		Provider: "google",
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	mismatchNylas := &fakeNylasClient{grant: NylasGrant{GrantID: "grant-2", Email: "other@example.com", Provider: "google"}}
	mismatchHandler := NewServerWithOptions(mismatchRepo, ServerOptions{
		NylasConfig: config,
		NylasClient: mismatchNylas,
	}).Routes()
	mismatchReq := httptest.NewRequest(http.MethodGet, "/nylas/oauth/callback?code=abc&state="+url.QueryEscape(mismatchState), nil)
	mismatchRec := httptest.NewRecorder()
	mismatchHandler.ServeHTTP(mismatchRec, mismatchReq)
	if mismatchRec.Code != http.StatusFound {
		t.Fatalf("mismatch callback status = %d", mismatchRec.Code)
	}
	if !strings.Contains(mismatchRec.Header().Get("Location"), "nylas_error=nylas_email_mismatch") {
		t.Fatalf("mismatch redirect = %s", mismatchRec.Header().Get("Location"))
	}
	if _, err := mismatchRepo.GetUserEmailConnection(mismatchUser.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("mismatch connection error = %v, want ErrNotFound", err)
	}
	if len(mismatchNylas.deletedGrants) != 1 || mismatchNylas.deletedGrants[0] != "grant-2" {
		t.Fatalf("deleted grants = %v, want grant cleanup", mismatchNylas.deletedGrants)
	}
}

func TestCommunicationsProxyHandlersUseStoredGrant(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders:  []NylasFolder{{ID: "inbox", Name: "Inbox", Attributes: []string{"\\Inbox"}}},
		messages: []NylasMessage{{ID: "message-1", Subject: "Hello", Unread: true}},
		message:  NylasMessage{ID: "message-1", Subject: "Hello", Body: "Body", Unread: true},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/status", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?limit=5&unread=true", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodPut, "/v1/communications/messages/message-1", `{"unread":false,"folders":["archive"]}`, token, http.StatusOK)
	if nylas.update.Unread == nil || *nylas.update.Unread || len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "archive" {
		t.Fatalf("update = %+v, want unread=false and archive folder", nylas.update)
	}
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/send", `{"to":[{"email":"friend@example.com"}],"subject":"Hi","body":"Body"}`, token, http.StatusCreated)
	if nylas.sent.To[0].Email != "friend@example.com" || nylas.sent.Subject != "Hi" {
		t.Fatalf("sent = %+v, want normalized send request", nylas.sent)
	}
	assertJSONStatus(t, handler, http.MethodDelete, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/disconnect", "", token, http.StatusOK)
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("connection after disconnect error = %v, want ErrNotFound", err)
	}
}

func TestCommunicationsFoldersUseSharedInboxConnection(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-folders"
	repo.EnsureCompany(companyID, "Shared Folders Company")
	actor, err := repo.UpsertAuthUser("actor-subject", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("actor-subject", companyID, "company_user"); err != nil {
		t.Fatal(err)
	}
	sharedUser, err := repo.UpsertAuthUser("shared-subject", "shared@example.com", "Shared")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("shared-subject", companyID, "company_user"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       sharedUser.UserID,
		Provider:     "microsoft",
		AccountEmail: sharedUser.Email,
		GrantID:      "grant-shared",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Support")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCommunicationsSharedInboxAccountEmail(companyID, folder.FolderID, sharedUser.Email); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedTriageFolder,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   actor.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatal(err)
	}
	totalCount := 42
	nylas := &fakeNylasClient{
		folders: []NylasFolder{{ID: "archive", Name: "Archive", Attributes: []string{"\\Archive"}, TotalCount: &totalCount}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)

	path := "/v1/communications/folders?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	assertJSONStatus(t, handler, http.MethodGet, path, "", token, http.StatusOK)
	if nylas.lastFolderGrantID != "grant-shared" {
		t.Fatalf("folder grant = %q, want shared inbox grant", nylas.lastFolderGrantID)
	}
}

func TestCommunicationsSendUsesSharedInboxConnectionAndRequiresEdit(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const companyID = "company-shared-send"
	repo.EnsureCompany(companyID, "Shared Send Company")
	actor, err := repo.UpsertAuthUser("shared-send-actor", "actor@example.com", "Actor")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	sharedUser, err := repo.UpsertAuthUser("shared-send-account", "support@example.com", "Support")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(sharedUser.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       sharedUser.UserID,
		Provider:     "google",
		AccountEmail: sharedUser.Email,
		GrantID:      "grant-support",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Support")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCommunicationsSharedInboxAccountEmail(companyID, folder.FolderID, sharedUser.Email); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedTriageFolder,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   actor.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatal(err)
	}

	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", actor.CognitoSubject, actor.Email)
	path := "/v1/communications/messages/send?company_id=" + url.QueryEscape(companyID) + "&shared_inbox_id=" + url.QueryEscape(folder.FolderID)
	body := `{"to":[{"email":"customer@example.com"}],"subject":"Shared hello","body":"Body"}`
	assertJSONStatus(t, handler, http.MethodPost, path, body, token, http.StatusForbidden)
	if nylas.lastSendGrantID != "" {
		t.Fatalf("send grant after view-only request = %q, want none", nylas.lastSendGrantID)
	}

	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeSharedTriageFolder,
		EntityID:   folder.FolderID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   actor.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := repo.RebuildEffectiveResourceAccessForCompany(companyID); err != nil {
		t.Fatal(err)
	}

	assertJSONStatus(t, handler, http.MethodPost, path, body, token, http.StatusCreated)
	if nylas.lastSendGrantID != "grant-support" {
		t.Fatalf("send grant = %q, want shared inbox grant", nylas.lastSendGrantID)
	}
	if nylas.sent.To[0].Email != "customer@example.com" || nylas.sent.Subject != "Shared hello" {
		t.Fatalf("sent = %+v, want shared inbox send payload", nylas.sent)
	}
}

func TestCommunicationsCacheAvoidsRepeatedNylasReads(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "microsoft",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders:  []NylasFolder{{ID: "inbox", Name: "Inbox", Attributes: []string{"\\Inbox"}}},
		messages: []NylasMessage{{ID: "message-1", Subject: "Hello", Unread: true}},
		message:  NylasMessage{ID: "message-1", Subject: "Hello", Body: "Body", Unread: true},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/folders", "", token, http.StatusOK)
	if nylas.folderCalls != 1 {
		t.Fatalf("folder calls = %d, want 1", nylas.folderCalls)
	}

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	if nylas.folderCalls != 1 {
		t.Fatalf("folder calls after mailbox resolution = %d, want 1", nylas.folderCalls)
	}
	if nylas.messageCalls != 1 {
		t.Fatalf("message list calls = %d, want 1", nylas.messageCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5&refresh=true", "", token, http.StatusOK)
	if nylas.messageCalls != 2 {
		t.Fatalf("message list calls after refresh = %d, want 2", nylas.messageCalls)
	}
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)
	if nylas.messageCalls != 2 {
		t.Fatalf("message list calls after refreshed cache read = %d, want 2", nylas.messageCalls)
	}

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages/message-1", "", token, http.StatusOK)
	if nylas.detailCalls != 1 {
		t.Fatalf("message detail calls = %d, want 1", nylas.detailCalls)
	}
}

func TestCommunicationsCacheEvictsBoundedEntries(t *testing.T) {
	t.Parallel()

	cache := newCommunicationsCache()
	now := time.Unix(1000, 0).UTC()

	for i := 0; i < communicationsMaxMessagePagesPerUser+2; i++ {
		query := NylasMessageQuery{Limit: 5, PageToken: fmt.Sprintf("page-%d", i)}
		page := NylasMessagePage{Messages: []NylasMessage{{ID: fmt.Sprintf("message-%d", i)}}}
		cache.setMessagePage("user-1", query, page, now.Add(time.Duration(i)*time.Second))
	}
	if len(cache.messagePages) != communicationsMaxMessagePagesPerUser {
		t.Fatalf("message page cache size = %d, want %d", len(cache.messagePages), communicationsMaxMessagePagesPerUser)
	}
	if _, ok := cache.getMessagePage("user-1", NylasMessageQuery{Limit: 5, PageToken: "page-0"}, communicationsMaxStaleTTL, now.Add(time.Minute)); ok {
		t.Fatal("oldest message page was not evicted")
	}
	if _, ok := cache.getMessagePage("user-1", NylasMessageQuery{Limit: 5, PageToken: fmt.Sprintf("page-%d", communicationsMaxMessagePagesPerUser+1)}, communicationsMaxStaleTTL, now.Add(time.Minute)); !ok {
		t.Fatal("newest message page was evicted")
	}

	for i := 0; i < communicationsMaxMessageEntries+4; i++ {
		cache.setMessage(fmt.Sprintf("global-user-%d", i), NylasMessage{ID: "message-1", Body: "body"}, now.Add(time.Duration(i)*time.Second))
	}
	if len(cache.messages) != communicationsMaxMessageEntries {
		t.Fatalf("message detail cache size = %d, want %d", len(cache.messages), communicationsMaxMessageEntries)
	}
	if _, ok := cache.getMessage("global-user-0", "message-1", communicationsMaxStaleTTL, now.Add(time.Minute)); ok {
		t.Fatal("oldest message detail was not globally evicted")
	}

	for i := 0; i < communicationsMaxMessageDetailsPerUser+2; i++ {
		cache.setMessage("detail-user", NylasMessage{ID: fmt.Sprintf("detail-%d", i), Body: "body"}, now.Add(time.Duration(i)*time.Second))
	}
	if _, ok := cache.getMessage("detail-user", "detail-0", communicationsMaxStaleTTL, now.Add(time.Minute)); ok {
		t.Fatal("oldest per-user message detail was not evicted")
	}
	if _, ok := cache.getMessage("detail-user", fmt.Sprintf("detail-%d", communicationsMaxMessageDetailsPerUser+1), communicationsMaxStaleTTL, now.Add(time.Minute)); !ok {
		t.Fatal("newest per-user message detail was evicted")
	}
}

func TestNylasWebhookCacheInvalidationIsGranular(t *testing.T) {
	t.Parallel()

	now := time.Unix(1000, 0).UTC()
	query := NylasMessageQuery{Limit: 5, Mailbox: "primary"}

	cache := newCommunicationsCache()
	server := &Server{commCache: cache}
	cache.setFolders("user-1", []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
	cache.setMessagePage("user-1", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	cache.setMessage("user-1", NylasMessage{ID: "message-1", Subject: "Cached"}, now)

	server.applyNylasWebhookCacheInvalidation("user-1", nylasWebhookChange{Trigger: "message.updated", MessageID: "message-1"})

	if _, ok := cache.getFolders("user-1", communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("message webhook invalidated folders; want folder cache preserved")
	}
	if _, ok := cache.getMessagePage("user-1", query, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message webhook preserved message page; want list cache invalidated")
	}
	if _, ok := cache.getMessage("user-1", "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("message webhook preserved detail; want changed message detail invalidated")
	}

	cache = newCommunicationsCache()
	server.commCache = cache
	cache.setFolders("user-1", []NylasFolder{{ID: "inbox", Name: "Inbox"}}, now)
	cache.setMessagePage("user-1", query, NylasMessagePage{Messages: []NylasMessage{{ID: "message-1"}}}, now)
	cache.setMessage("user-1", NylasMessage{ID: "message-1", Subject: "Cached"}, now)

	server.applyNylasWebhookCacheInvalidation("user-1", nylasWebhookChange{Trigger: "folder.updated"})

	if _, ok := cache.getFolders("user-1", communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("folder webhook preserved folders; want folder cache invalidated")
	}
	if _, ok := cache.getMessagePage("user-1", query, communicationsMaxStaleTTL, now.Add(time.Second)); ok {
		t.Fatal("folder webhook preserved message page; want list cache invalidated")
	}
	if _, ok := cache.getMessage("user-1", "message-1", communicationsMaxStaleTTL, now.Add(time.Second)); !ok {
		t.Fatal("folder webhook invalidated message detail; want detail cache preserved")
	}
}

func TestCommunicationsPrimaryMailboxUsesGmailNativeSearch(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&q=from%3Aops%40example.com&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "category:primary in:inbox from:ops@example.com is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil || nylas.lastQuery.FolderID != "" {
		t.Fatalf("query = %+v, want Gmail-native primary search only", nylas.lastQuery)
	}
}

func TestCommunicationsArchiveMailboxUsesGmailNativeSearch(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=archive&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "in:anywhere -in:inbox -in:trash -in:spam -in:sent -in:drafts invoice is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil || nylas.lastQuery.FolderID != "" {
		t.Fatalf("query = %+v, want Gmail-native archive search only", nylas.lastQuery)
	}
}

func TestCommunicationsAllMailboxUsesGmailNativeSearch(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=all&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.SearchQueryNative != "in:anywhere invoice is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil {
		t.Fatalf("query = %+v, want Gmail-native all-mail search only", nylas.lastQuery)
	}
}

func TestCommunicationsStarredMailboxAppliesStarredFilter(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=starred&q=invoice&unread=true", "", token, http.StatusOK)
	if nylas.lastQuery.Starred == nil || !*nylas.lastQuery.Starred {
		t.Fatalf("starred = %v, want true", nylas.lastQuery.Starred)
	}
	if nylas.lastQuery.SearchQueryNative != "invoice is:unread" {
		t.Fatalf("search_query_native = %q", nylas.lastQuery.SearchQueryNative)
	}
	if nylas.lastQuery.Query != "" || nylas.lastQuery.Unread != nil {
		t.Fatalf("query = %+v, want Gmail-native starred search only", nylas.lastQuery)
	}
}

func TestCommunicationsArchiveMessageRemovesGmailInboxLabel(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"INBOX", "UNREAD", "CATEGORY_PERSONAL", "SNOOZED", "CHAT", "STARRED", "Label_123"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/archive", "", token, http.StatusOK)
	if got, want := strings.Join(nylas.update.Folders, ","), "STARRED,Label_123"; got != want {
		t.Fatalf("folders = %q, want %q", got, want)
	}
	raw, err := json.Marshal(NylasMessageUpdate{Folders: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"folders":[]}` {
		t.Fatalf("empty folder update JSON = %s, want explicit folders array", raw)
	}
}

func TestCommunicationsArchiveMessageMovesFolderProvidersToArchiveFolder(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "microsoft",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders: []NylasFolder{
			{ID: "inbox-id", Name: "Inbox"},
			{ID: "archive-id", Name: "Archive"},
		},
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"inbox-id"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/archive", "", token, http.StatusOK)
	if len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "archive-id" {
		t.Fatalf("folders = %+v, want archive-id", nylas.update.Folders)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want archive without message body fetch", nylas.detailCalls)
	}
}

func TestCommunicationsArchiveBatchUsesCachedListFoldersAndReturnsCompactResult(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		messages: []NylasMessage{
			{ID: "message-1", Subject: "One", Folders: []string{"INBOX", "CATEGORY_PERSONAL", "Label_123"}},
			{ID: "message-2", Subject: "Two", Folders: []string{"INBOX", "Label_456"}},
		},
		updateErrByID: map[string]error{
			"message-2": NylasAPIError{StatusCode: http.StatusTooManyRequests, Code: "rate_limited", RetryAfter: "4"},
		},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodGet, "/v1/communications/messages?mailbox=primary&limit=5", "", token, http.StatusOK)

	body := `{"message_ids":["message-1","message-2","message-1"," "]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/messages/archive-batch", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Retry-After"); got != "4" {
		t.Fatalf("Retry-After = %q, want 4", got)
	}
	if strings.Contains(rec.Body.String(), `"message"`) || strings.Contains(rec.Body.String(), "CATEGORY_PERSONAL") {
		t.Fatalf("batch response should be compact, got %s", rec.Body.String())
	}
	var payload struct {
		ArchivedIDs []string `json:"archived_ids"`
		Failed      []struct {
			MessageID string `json:"message_id"`
			Error     string `json:"error"`
		} `json:"failed"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.ArchivedIDs) != 1 || payload.ArchivedIDs[0] != "message-1" {
		t.Fatalf("archived ids = %+v, want message-1", payload.ArchivedIDs)
	}
	if len(payload.Failed) != 1 || payload.Failed[0].MessageID != "message-2" || payload.Failed[0].Error != "nylas_rate_limited" {
		t.Fatalf("failed = %+v, want message-2 rate limit", payload.Failed)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want cached list folder data", nylas.detailCalls)
	}
	if len(nylas.updateCalls) != 1 || nylas.updateCalls[0].MessageID != "message-1" || strings.Join(nylas.updateCalls[0].Update.Folders, ",") != "Label_123" {
		t.Fatalf("update calls = %+v, want compact Gmail archive update", nylas.updateCalls)
	}
}

func TestCommunicationsUnarchiveMessageAddsGmailInboxLabel(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"UNREAD", "CATEGORY_PERSONAL", "Label_123"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/unarchive", "", token, http.StatusOK)
	if got, want := strings.Join(nylas.update.Folders, ","), "Label_123,INBOX"; got != want {
		t.Fatalf("folders = %q, want %q", got, want)
	}
}

func TestCommunicationsUnarchiveMessageMovesFolderProvidersToInboxFolder(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "microsoft",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	nylas := &fakeNylasClient{
		folders: []NylasFolder{
			{ID: "inbox-id", Name: "Inbox"},
			{ID: "archive-id", Name: "Archive"},
		},
		message: NylasMessage{ID: "message-1", Subject: "Hello", Folders: []string{"archive-id"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   nylas,
	}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", subject, user.Email)

	assertJSONStatus(t, handler, http.MethodPost, "/v1/communications/messages/message-1/unarchive", "", token, http.StatusOK)
	if len(nylas.update.Folders) != 1 || nylas.update.Folders[0] != "inbox-id" {
		t.Fatalf("folders = %+v, want inbox-id", nylas.update.Folders)
	}
	if nylas.detailCalls != 0 {
		t.Fatalf("detail calls = %d, want unarchive without message body fetch", nylas.detailCalls)
	}
}

func TestNylasWebhookVerifiesSignatureAndPublishesMailboxEvent(t *testing.T) {
	repo := store.NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject", "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	config := testNylasConfig()
	config.WebhookSecret = "webhook-secret"
	server := NewServerWithOptions(repo, ServerOptions{NylasConfig: config})
	handler := server.Routes()

	ch := server.emailHub.subscribe(user.UserID)
	defer server.emailHub.unsubscribe(user.UserID, ch)

	challengeReq := httptest.NewRequest(http.MethodGet, "/nylas/webhook?challenge=abc123", nil)
	challengeRec := httptest.NewRecorder()
	handler.ServeHTTP(challengeRec, challengeReq)
	if challengeRec.Code != http.StatusOK || challengeRec.Body.String() != "abc123" {
		t.Fatalf("challenge status=%d body=%q", challengeRec.Code, challengeRec.Body.String())
	}

	body := `{"type":"message.created","data":{"object":{"id":"message-1","grant_id":"grant-1"}}}`
	req := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	req.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("webhook status = %d body=%s", rec.Code, rec.Body.String())
	}
	select {
	case raw := <-ch:
		var event communicationsEventEnvelope
		if err := json.Unmarshal(raw, &event); err != nil {
			t.Fatal(err)
		}
		if event.UserID != user.UserID || event.Type != "mailbox_changed" || event.Trigger != "message.created" || event.MessageID != "message-1" {
			t.Fatalf("event = %+v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for mailbox event")
	}

	duplicateReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	duplicateReq.Header.Set("X-Nylas-Signature", signWebhookBody("webhook-secret", body))
	duplicateRec := httptest.NewRecorder()
	handler.ServeHTTP(duplicateRec, duplicateReq)
	if duplicateRec.Code != http.StatusOK {
		t.Fatalf("duplicate webhook status = %d body=%s", duplicateRec.Code, duplicateRec.Body.String())
	}
	select {
	case raw := <-ch:
		t.Fatalf("duplicate webhook published mailbox event: %s", string(raw))
	default:
	}

	badReq := httptest.NewRequest(http.MethodPost, "/nylas/webhook", strings.NewReader(body))
	badReq.Header.Set("X-Nylas-Signature", "bad")
	badRec := httptest.NewRecorder()
	handler.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature status = %d", badRec.Code)
	}
}

func TestCommunicationsNylasAuthErrorMarksReauthRequired(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient:   &fakeNylasClient{listErr: NylasAPIError{StatusCode: http.StatusUnauthorized, Code: "unauthorized"}},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 body=%s", rec.Code, rec.Body.String())
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.Status != "reauth_required" {
		t.Fatalf("connection status = %q, want reauth_required", connection.Status)
	}
}

func TestCommunicationsNylasRateLimitPreservesRetryAfter(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	const subject = "email-user"
	user, err := repo.UpsertAuthUser(subject, "user@example.com", "User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: user.Email,
		GrantID:      "grant-1",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithOptions(repo, ServerOptions{
		AuthValidator: testValidator(t, "kid", key),
		NylasConfig:   testNylasConfig(),
		NylasClient: &fakeNylasClient{listErr: NylasAPIError{
			StatusCode: http.StatusTooManyRequests,
			Code:       "rate_limited",
			RetryAfter: "3",
		}},
	}).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages", nil)
	req.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", subject, user.Email))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Retry-After"); got != "3" {
		t.Fatalf("Retry-After = %q, want 3", got)
	}
	if !strings.Contains(rec.Body.String(), "nylas_rate_limited") {
		t.Fatalf("body = %s, want nylas_rate_limited", rec.Body.String())
	}
}

func TestParseNylasMessageQueryCapsLimitAtProviderFriendlySize(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/v1/communications/messages?limit=100", nil)
	rec := httptest.NewRecorder()

	query, ok := parseNylasMessageQuery(rec, req)
	if !ok {
		t.Fatalf("parseNylasMessageQuery rejected request: status=%d body=%s", rec.Code, rec.Body.String())
	}
	if query.Limit != communicationsNylasMaxMessageLimit {
		t.Fatalf("limit = %d, want %d", query.Limit, communicationsNylasMaxMessageLimit)
	}
}

func signWebhookBody(secret, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(body))
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func assertJSONStatus(t *testing.T, handler http.Handler, method, path, body, authHeader string, want int) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s %s status = %d, want %d body=%s", method, path, rec.Code, want, rec.Body.String())
	}
}

func testNylasConfig() NylasConfig {
	return NylasConfig{
		ClientID:            "client-id",
		APIKey:              "api-key",
		APIBaseURL:          "https://api.us.nylas.com",
		RedirectURI:         "http://api.test/nylas/oauth/callback",
		FrontendRedirectURL: "http://ui.test/home",
		StateSecret:         "state-secret",
	}
}
