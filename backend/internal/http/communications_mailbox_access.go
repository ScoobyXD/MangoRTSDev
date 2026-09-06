package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

var errMailboxDisabled = errors.New("mailbox_disabled")

func mailboxDisabledForRequest(r *http.Request) bool {
	actor, ok := authenticatedActor(r)
	return ok && !actor.User.MailboxEnabled
}

func requireMailboxAccess(w http.ResponseWriter, r *http.Request) bool {
	if mailboxDisabledForRequest(r) {
		writeError(w, http.StatusForbidden, "mailbox_disabled")
		return false
	}
	return true
}

func isMailboxInformation(kind, information string) bool {
	if strings.EqualFold(strings.TrimSpace(kind), "Attached email") {
		return true
	}
	var payload struct {
		SelectionSource string `json:"selection_source"`
		EnsureEmailLink bool   `json:"ensure_email_textbox_link_on_send"`
	}
	_ = json.Unmarshal([]byte(information), &payload)
	return payload.SelectionSource == "email" || payload.EnsureEmailLink
}

func requireMailboxInformationAccess(w http.ResponseWriter, r *http.Request, kind, information string) bool {
	return !isMailboxInformation(kind, information) || requireMailboxAccess(w, r)
}

func withoutMailboxTextboxLinks(kind, information string) string {
	if !strings.EqualFold(strings.TrimSpace(kind), "Text box") {
		return information
	}
	const prefix = "<!-- mango-node-text-block-v1 -->"
	raw := strings.TrimSpace(information)
	marker := ""
	if strings.HasPrefix(raw, prefix) {
		marker = prefix
		raw = strings.TrimSpace(strings.TrimPrefix(raw, prefix))
	}
	var payload map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &payload) != nil || payload == nil {
		return information
	}
	_, hasMessage := payload["email_message_id"]
	_, hasMessages := payload["email_message_ids"]
	if !hasMessage && !hasMessages {
		return information
	}
	delete(payload, "email_message_id")
	delete(payload, "email_message_ids")
	cleaned, err := json.Marshal(payload)
	if err != nil {
		return information
	}
	return marker + string(cleaned)
}

func withoutNodeMailboxInformation(items []domain.NodeInformation) []domain.NodeInformation {
	result := make([]domain.NodeInformation, 0, len(items))
	for _, item := range items {
		if !isMailboxInformation(item.Type, item.Information) {
			item.Information = withoutMailboxTextboxLinks(item.Type, item.Information)
			result = append(result, item)
		}
	}
	return result
}

func withoutNodeMailboxProjections(items []domain.NodeProjection) []domain.NodeProjection {
	result := make([]domain.NodeProjection, 0, len(items))
	for _, item := range items {
		if !isMailboxInformation(item.Type, item.Information) {
			item.Information = withoutMailboxTextboxLinks(item.Type, item.Information)
			result = append(result, item)
		}
	}
	return result
}

func withoutProjectMailboxInformation(items []domain.ProjectInformation) []domain.ProjectInformation {
	result := make([]domain.ProjectInformation, 0, len(items))
	for _, item := range items {
		if !isMailboxInformation(item.Type, item.Information) {
			item.Information = withoutMailboxTextboxLinks(item.Type, item.Information)
			result = append(result, item)
		}
	}
	return result
}

func withoutProjectMailboxProjections(items []domain.ProjectProjection) []domain.ProjectProjection {
	result := make([]domain.ProjectProjection, 0, len(items))
	for _, item := range items {
		if !isMailboxInformation(item.Type, item.Information) {
			item.Information = withoutMailboxTextboxLinks(item.Type, item.Information)
			result = append(result, item)
		}
	}
	return result
}

// Shared connections belong to the company. Their background ingestion does not
// depend on the mailbox eligibility of the person who originally connected them.
func (s *Server) checkPersonalMailboxConnection(ctx context.Context, connection domain.UserEmailConnection) error {
	if strings.TrimSpace(connection.Scope) == "shared" {
		return nil
	}
	user, err := s.repo.GetAuthUserByIDContext(ctx, connection.UserID)
	if errors.Is(err, store.ErrNotFound) {
		return errMailboxDisabled
	}
	if err != nil {
		return err
	}
	if !user.MailboxEnabled {
		return errMailboxDisabled
	}
	return nil
}
