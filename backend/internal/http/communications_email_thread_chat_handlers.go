package httpapi

import (
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleCommunicationsEmailThreadChats(w http.ResponseWriter, r *http.Request) {
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
	messageID := strings.TrimSpace(r.URL.Query().Get("message_id"))
	threadID := strings.TrimSpace(r.URL.Query().Get("thread_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}
	if messageID == "" && threadID == "" {
		writeError(w, http.StatusBadRequest, "email_message_or_thread_required")
		return
	}
	scope, ok := s.resolveCommunicationsEmailScope(
		w, actor, companyID, r.URL.Query().Get("shared_inbox_id"),
		r.URL.Query().Get("account_email"), store.EntityPermissionEdit,
	)
	if !ok {
		return
	}
	input := store.CommunicationsEmailCollaborationListInput{
		CompanyID: companyID, ParticipantUserID: actor.User.UserID,
		PersonalUserID: scope.personalUserID, PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID: scope.sharedInboxID, MessageID: messageID, ThreadID: threadID,
	}
	collaborations, err := s.repo.ListCommunicationsEmailCollaborations(input)
	if err != nil {
		s.writeEmailCollaborationStoreError(w, err, "failed_to_load_email_thread_chats")
		return
	}
	groups, err := s.repo.ListCommunicationsEmailThreadChatGroups(input)
	if err != nil {
		s.writeEmailCollaborationStoreError(w, err, "failed_to_load_email_thread_chats")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"collaborations": collaborations,
		"groups":         groups,
	})
}
