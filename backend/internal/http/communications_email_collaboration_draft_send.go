package httpapi

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/mail"
	"strings"
)

func (s *Server) emailCollaborationSourceConnection(w http.ResponseWriter, collaboration domain.CommunicationsEmailCollaboration, actorUserID string) (domain.UserEmailConnection, bool) {
	if collaboration.ScopeType == store.CommunicationsEmailCollaborationScopeShared {
		connection, err := s.repo.GetCompanyEmailConnectionByAccountEmail(collaboration.CompanyID, collaboration.AccountEmail)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusConflict, "shared_inbox_email_account_not_connected")
			return domain.UserEmailConnection{}, false
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_load_shared_inbox_email_connection")
			return domain.UserEmailConnection{}, false
		}
		return requireConnectedCompanyEmailStatus(w, connection, actorUserID)
	}
	return s.resolveActorPersonalEmailConnection(w, collaboration.PersonalUserID, collaboration.PersonalAccountEmail)
}

func draftRecipientAddresses(value string) []NylasEmailAddress {
	addresses, err := mail.ParseAddressList(strings.ReplaceAll(value, ";", ","))
	if err != nil {
		return []NylasEmailAddress{}
	}
	out := make([]NylasEmailAddress, 0, len(addresses))
	for _, address := range addresses {
		email := normalizeEmailForCompare(address.Address)
		if email != "" {
			out = append(out, NylasEmailAddress{Name: strings.TrimSpace(address.Name), Email: email})
		}
	}
	return cleanEmailAddresses(out)
}
