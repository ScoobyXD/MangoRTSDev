package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

var (
	errCalendarInviteNotFound = errors.New("calendar invite not found")
	errCalendarEventNotFound  = errors.New("calendar event not found")
	errCalendarEventAmbiguous = errors.New("calendar event ambiguous")
)

type calendarInviteEventPayload struct {
	ID            string                  `json:"id"`
	CalendarID    string                  `json:"calendar_id,omitempty"`
	ICalUID       string                  `json:"ical_uid,omitempty"`
	Title         string                  `json:"title,omitempty"`
	Status        string                  `json:"status,omitempty"`
	Description   string                  `json:"description,omitempty"`
	Location      string                  `json:"location,omitempty"`
	HTMLLink      string                  `json:"html_link,omitempty"`
	ConferenceURL string                  `json:"conference_url,omitempty"`
	Busy          bool                    `json:"busy,omitempty"`
	ReadOnly      bool                    `json:"read_only,omitempty"`
	Organizer     NylasEmailAddress       `json:"organizer,omitempty"`
	Participants  []NylasEventParticipant `json:"participants,omitempty"`
	When          NylasEventWhen          `json:"when,omitempty"`
	RSVPStatus    string                  `json:"rsvp_status,omitempty"`
}

func (s *Server) handleCommunicationsCalendarInviteEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	sharedInboxID := strings.TrimSpace(r.URL.Query().Get("shared_inbox_id"))
	messageID := strings.TrimSpace(r.URL.Query().Get("message_id"))
	if messageID == "" {
		writeError(w, http.StatusBadRequest, "email_message_id_required")
		return
	}
	if companyID != "" && !requireCompanyAccess(w, r, companyID) {
		return
	}
	connection, ok := s.requireCommunicationsConnection(w, r, actor, companyID, sharedInboxID, store.EntityPermissionEdit)
	if !ok {
		return
	}
	calendarClient, ok := s.nylasClient.(NylasCalendarClient)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "calendar_provider_unavailable")
		return
	}
	event, err := s.resolveCalendarInviteEvent(r.Context(), connection, calendarClient, messageID)
	if err != nil {
		s.writeCalendarInviteResolutionError(w, r, connection, err)
		return
	}
	payload := calendarInviteEventPayload{
		ID:           event.ID,
		CalendarID:   event.CalendarID,
		ICalUID:      event.ICalUID,
		Title:        event.Title,
		Status:       event.Status,
		Description:  event.Description,
		Location:     event.Location,
		HTMLLink:     event.HTMLLink,
		Busy:         event.Busy,
		ReadOnly:     event.ReadOnly,
		Organizer:    event.Organizer,
		Participants: event.Participants,
		When:         event.When,
		RSVPStatus:   calendarInviteParticipantStatus(event.Participants, connection.AccountEmail),
	}
	if event.Conferencing != nil {
		payload.ConferenceURL = strings.TrimSpace(event.Conferencing.Details.URL)
	}
	writeJSON(w, http.StatusOK, map[string]any{"event": payload})
}

func (s *Server) handleCommunicationsCalendarInviteResponse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	sharedInboxID := strings.TrimSpace(r.URL.Query().Get("shared_inbox_id"))
	if companyID != "" && !requireCompanyAccess(w, r, companyID) {
		return
	}
	connection, ok := s.requireCommunicationsConnection(w, r, actor, companyID, sharedInboxID, store.EntityPermissionEdit)
	if !ok {
		return
	}
	calendarClient, ok := s.nylasClient.(NylasCalendarClient)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "calendar_provider_unavailable")
		return
	}
	var request struct {
		MessageID string `json:"message_id"`
		Status    string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	messageID := strings.TrimSpace(request.MessageID)
	status := normalizeCalendarRSVPStatus(request.Status)
	if messageID == "" {
		writeError(w, http.StatusBadRequest, "email_message_id_required")
		return
	}
	if status == "" {
		writeError(w, http.StatusBadRequest, "invalid_calendar_rsvp_status")
		return
	}

	event, err := s.resolveCalendarInviteEvent(r.Context(), connection, calendarClient, messageID)
	if err == nil {
		err = s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
			return calendarClient.SendEventRSVP(ctx, connection.GrantID, event.ID, event.CalendarID, status)
		})
	}
	if err != nil {
		s.writeCalendarInviteResolutionError(w, r, connection, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "responded",
		"rsvp_status": status,
		"event_id":    event.ID,
		"calendar_id": event.CalendarID,
	})
}

func (s *Server) resolveCalendarInviteEvent(ctx context.Context, connection domain.UserEmailConnection, calendarClient NylasCalendarClient, messageID string) (NylasEvent, error) {
	var rawMIME string
	err := s.withCommunicationsNylasGate(ctx, connection, func(providerContext context.Context) error {
		var rawErr error
		rawMIME, rawErr = s.nylasClient.GetMessageRawMIME(providerContext, connection.GrantID, messageID)
		return rawErr
	})
	if err != nil {
		return NylasEvent{}, err
	}
	iCalUID := calendarInviteUIDFromRawMIME(rawMIME)
	if iCalUID == "" {
		return NylasEvent{}, errCalendarInviteNotFound
	}
	var events []NylasEvent
	err = s.withCommunicationsNylasGate(ctx, connection, func(providerContext context.Context) error {
		var listErr error
		events, listErr = calendarClient.ListEventsByICalUID(providerContext, connection.GrantID, iCalUID)
		return listErr
	})
	if err != nil {
		return NylasEvent{}, err
	}
	matchingEvents := make([]NylasEvent, 0, len(events))
	for _, candidate := range events {
		if strings.EqualFold(strings.TrimSpace(candidate.Status), "cancelled") {
			continue
		}
		if candidate.ICalUID != "" && !strings.EqualFold(strings.TrimSpace(candidate.ICalUID), iCalUID) {
			continue
		}
		matchingEvents = append(matchingEvents, candidate)
	}
	if len(matchingEvents) == 0 || strings.TrimSpace(matchingEvents[0].ID) == "" {
		return NylasEvent{}, errCalendarEventNotFound
	}
	if len(matchingEvents) > 1 {
		return NylasEvent{}, errCalendarEventAmbiguous
	}
	return matchingEvents[0], nil
}

func (s *Server) writeCalendarInviteResolutionError(w http.ResponseWriter, r *http.Request, connection domain.UserEmailConnection, err error) {
	switch {
	case errors.Is(err, errCalendarInviteNotFound):
		writeError(w, http.StatusUnprocessableEntity, "calendar_invite_not_found")
	case errors.Is(err, errCalendarEventNotFound):
		writeError(w, http.StatusNotFound, "calendar_event_not_found")
	case errors.Is(err, errCalendarEventAmbiguous):
		writeError(w, http.StatusConflict, "calendar_event_ambiguous")
	default:
		s.writeNylasError(w, r, connection, err)
	}
}

func calendarInviteParticipantStatus(participants []NylasEventParticipant, accountEmail string) string {
	for _, participant := range participants {
		if strings.EqualFold(strings.TrimSpace(participant.Email), strings.TrimSpace(accountEmail)) {
			return normalizeCalendarRSVPStatus(participant.Status)
		}
	}
	return ""
}

func normalizeCalendarRSVPStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "yes", "accept", "accepted":
		return "yes"
	case "maybe", "tentative":
		return "maybe"
	case "no", "decline", "declined":
		return "no"
	default:
		return ""
	}
}

func calendarInviteUIDFromRawMIME(rawMIME string) string {
	for _, attachment := range nylasAttachmentsFromRawMIME(rawMIME) {
		contentType := strings.ToLower(strings.TrimSpace(strings.Split(attachment.ContentType, ";")[0]))
		if contentType != "text/calendar" && !strings.HasSuffix(strings.ToLower(strings.TrimSpace(attachment.Filename)), ".ics") {
			continue
		}
		content, err := base64.StdEncoding.DecodeString(strings.TrimSpace(attachment.Content))
		if err != nil {
			continue
		}
		calendarDocument := string(content)
		if !strings.EqualFold(iCalendarProperty(calendarDocument, "METHOD"), "REQUEST") {
			continue
		}
		if strings.Count(strings.ToUpper(calendarDocument), "BEGIN:VEVENT") != 1 {
			continue
		}
		if uid := iCalendarProperty(calendarDocument, "UID"); uid != "" {
			return uid
		}
	}
	return ""
}

func iCalendarProperty(document, property string) string {
	document = strings.ReplaceAll(document, "\r\n", "\n")
	document = strings.ReplaceAll(document, "\r", "\n")
	rawLines := strings.Split(document, "\n")
	lines := make([]string, 0, len(rawLines))
	for _, rawLine := range rawLines {
		if len(lines) > 0 && (strings.HasPrefix(rawLine, " ") || strings.HasPrefix(rawLine, "\t")) {
			lines[len(lines)-1] += strings.TrimLeft(rawLine, " \t")
			continue
		}
		lines = append(lines, rawLine)
	}
	target := strings.ToUpper(strings.TrimSpace(property))
	for _, line := range lines {
		nameAndParameters, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		name, _, _ := strings.Cut(nameAndParameters, ";")
		if strings.ToUpper(strings.TrimSpace(name)) != target {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) > 2048 {
			return ""
		}
		return value
	}
	return ""
}
