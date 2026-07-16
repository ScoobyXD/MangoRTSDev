package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type fakeCalendarNylasClient struct {
	*fakeNylasClient
	events         []NylasEvent
	listGrantID    string
	listICalUID    string
	rsvpGrantID    string
	rsvpEventID    string
	rsvpCalendarID string
	rsvpStatus     string
}

func (f *fakeCalendarNylasClient) ListEventsByICalUID(_ context.Context, grantID, iCalUID string) ([]NylasEvent, error) {
	f.listGrantID = grantID
	f.listICalUID = iCalUID
	return append([]NylasEvent(nil), f.events...), nil
}

func (f *fakeCalendarNylasClient) SendEventRSVP(_ context.Context, grantID, eventID, calendarID, status string) error {
	f.rsvpGrantID = grantID
	f.rsvpEventID = eventID
	f.rsvpCalendarID = calendarID
	f.rsvpStatus = status
	return nil
}

func rawCalendarMessage(calendar string) string {
	return "MIME-Version: 1.0\r\n" +
		"Content-Type: text/calendar; charset=utf-8\r\n" +
		"\r\n" + calendar
}

func TestCalendarInviteUIDFromRawMIME(t *testing.T) {
	raw := rawCalendarMessage("BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID;VALUE=TEXT:invite-123@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
	if got := calendarInviteUIDFromRawMIME(raw); got != "invite-123@example.com" {
		t.Fatalf("calendarInviteUIDFromRawMIME() = %q", got)
	}
}

func TestCalendarInviteUIDFromRawMIMEUnfoldsUID(t *testing.T) {
	raw := rawCalendarMessage("BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:folded-\r\n value\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
	if got := calendarInviteUIDFromRawMIME(raw); got != "folded-value" {
		t.Fatalf("calendarInviteUIDFromRawMIME() = %q", got)
	}
}

func TestCalendarInviteUIDFromRawMIMERejectsNonRequestOrAmbiguousInvite(t *testing.T) {
	cancelled := rawCalendarMessage("BEGIN:VCALENDAR\r\nMETHOD:CANCEL\r\nBEGIN:VEVENT\r\nUID:cancelled\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
	if got := calendarInviteUIDFromRawMIME(cancelled); got != "" {
		t.Fatalf("cancelled invite UID = %q", got)
	}
	multiple := rawCalendarMessage("BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:first\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:second\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
	if got := calendarInviteUIDFromRawMIME(multiple); got != "" {
		t.Fatalf("multi-event invite UID = %q", got)
	}
}

func TestNormalizeCalendarRSVPStatus(t *testing.T) {
	for input, want := range map[string]string{
		"yes":       "yes",
		"Accept":    "yes",
		"tentative": "maybe",
		"Decline":   "no",
		"later":     "",
	} {
		if got := normalizeCalendarRSVPStatus(input); got != want {
			t.Errorf("normalizeCalendarRSVPStatus(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDefaultMicrosoftScopesIncludeCalendarWrite(t *testing.T) {
	if scopes := (NylasConfig{}).ScopesForProvider("microsoft"); !slices.Contains(scopes, "Calendars.ReadWrite") {
		t.Fatalf("Microsoft scopes = %v, missing Calendars.ReadWrite", scopes)
	}
}

func TestRawMIMECalendarAttachmentMergesAlongsideProviderAttachment(t *testing.T) {
	existing := []NylasAttachment{{ID: "provider-file", Filename: "agenda.pdf", ContentType: "application/pdf"}}
	recovered := []NylasAttachment{{ID: "raw-mime-2", Filename: "invite.ics", ContentType: "text/calendar", Content: "QkVHSU46VkNBTEVOREFS"}}
	merged, changed := mergeRawMIMEAttachments(existing, recovered, nil)
	if !changed || len(merged) != 2 || merged[1].Filename != "invite.ics" {
		t.Fatalf("merged calendar attachments = %+v changed=%t", merged, changed)
	}
	message := NylasMessage{ID: "message-1", Attachments: existing}
	if messageNeedsRawMIMEAttachmentRecovery(message) {
		t.Fatal("ordinary provider attachment should not trigger synchronous raw MIME recovery")
	}
	message.Body = "<img src=\"cid:missing-inline\">"
	if !messageNeedsRawMIMEAttachmentRecovery(message) {
		t.Fatal("unresolved inline content should still trigger raw MIME recovery")
	}
}

func TestCalendarInviteResponseUsesAuthenticatedPersonalGrant(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333301"
	repo.EnsureCompany(companyID, "Calendar Company")
	user, err := repo.UpsertAuthUser("calendar-user", "person@example.com", "Calendar User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(store.UserEmailConnectionInput{
		UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "personal-calendar-grant", Status: "connected",
	}); err != nil {
		t.Fatal(err)
	}
	client := &fakeCalendarNylasClient{
		fakeNylasClient: &fakeNylasClient{rawMIME: rawCalendarMessage("BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:invite-1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")},
		events:          []NylasEvent{{ID: "event-1", CalendarID: "primary", ICalUID: "invite-1"}},
	}
	handler := NewServerWithOptions(repo, ServerOptions{NylasConfig: testNylasConfig(), NylasClient: client}).Routes()
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/calendar-invites/respond?company_id="+companyID, strings.NewReader(`{"message_id":"message-1","status":"maybe"}`))
	req = requestWithActorForTest(req, user, companyID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("calendar response status = %d body=%s", rec.Code, rec.Body.String())
	}
	if client.listGrantID != "personal-calendar-grant" || client.listICalUID != "invite-1" || client.rsvpGrantID != "personal-calendar-grant" || client.rsvpEventID != "event-1" || client.rsvpStatus != "maybe" {
		t.Fatalf("calendar calls = %+v", client)
	}
}

func TestCalendarInviteResponseRejectsSharedNoAccess(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333302"
	repo.EnsureCompany(companyID, "Shared Calendar Company")
	user, err := repo.UpsertAuthUser("shared-calendar-viewer", "viewer@example.com", "Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
		CompanyID: companyID, Provider: "google", AccountEmail: "support@example.com", GrantID: "shared-calendar-grant", Status: "connected", ConnectedByUserID: user.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Support", "support@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: store.EntityTypeSharedInbox, EntityID: folder.FolderID,
		Permissions: []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: store.EntityPermissionNoAccess}},
	}); err != nil {
		t.Fatal(err)
	}
	client := &fakeCalendarNylasClient{fakeNylasClient: &fakeNylasClient{}}
	handler := NewServerWithOptions(repo, ServerOptions{NylasConfig: testNylasConfig(), NylasClient: client}).Routes()
	req := httptest.NewRequest(http.MethodPost, "/v1/communications/calendar-invites/respond?company_id="+companyID+"&shared_inbox_id="+folder.FolderID, strings.NewReader(`{"message_id":"message-1","status":"yes"}`))
	req = sharedInboxRequestWithActor(req, user, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("shared no-access calendar response status = %d body=%s", rec.Code, rec.Body.String())
	}
	if client.lastRawMIMEMessageID != "" || client.rsvpEventID != "" {
		t.Fatalf("no-access request reached provider: %+v", client)
	}
}
