package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"miraeopus/backend/internal/store"
)

var (
	errCalendarInviteNotFound = errors.New("calendar invite not found")
	errCalendarEventNotFound  = errors.New("calendar event not found")
	errCalendarEventAmbiguous = errors.New("calendar event ambiguous")
)

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

	var rawMIME string
	err := s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
		var err error
		rawMIME, err = s.nylasClient.GetMessageRawMIME(ctx, connection.GrantID, messageID)
		return err
	})
	iCalUID := ""
	if err == nil {
		iCalUID = calendarInviteUIDFromRawMIME(rawMIME)
		if iCalUID == "" {
			err = errCalendarInviteNotFound
		}
	}
	var events []NylasEvent
	if err == nil {
		err = s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
			var listErr error
			events, listErr = calendarClient.ListEventsByICalUID(ctx, connection.GrantID, iCalUID)
			return listErr
		})
	}
	var event NylasEvent
	if err == nil {
		matchingEvents := make([]NylasEvent, 0, len(events))
		for _, candidate := range events {
			if strings.EqualFold(strings.TrimSpace(candidate.Status), "cancelled") {
				continue
			}
			if candidate.ICalUID != "" && strings.TrimSpace(candidate.ICalUID) != iCalUID {
				continue
			}
			matchingEvents = append(matchingEvents, candidate)
		}
		if len(matchingEvents) == 0 || strings.TrimSpace(matchingEvents[0].ID) == "" {
			err = errCalendarEventNotFound
		} else if len(matchingEvents) > 1 {
			err = errCalendarEventAmbiguous
		} else {
			event = matchingEvents[0]
		}
	}
	if err == nil {
		err = s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
			return calendarClient.SendEventRSVP(ctx, connection.GrantID, event.ID, event.CalendarID, status)
		})
	}
	if errors.Is(err, errCalendarInviteNotFound) {
		writeError(w, http.StatusUnprocessableEntity, "calendar_invite_not_found")
		return
	}
	if errors.Is(err, errCalendarEventNotFound) {
		writeError(w, http.StatusNotFound, "calendar_event_not_found")
		return
	}
	if errors.Is(err, errCalendarEventAmbiguous) {
		writeError(w, http.StatusConflict, "calendar_event_ambiguous")
		return
	}
	if err != nil {
		s.writeNylasError(w, r, connection, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "responded",
		"rsvp_status": status,
		"event_id":    event.ID,
		"calendar_id": event.CalendarID,
	})
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
