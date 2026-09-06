package httpapi

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleProjectEmailThread(w http.ResponseWriter, r *http.Request, projectID, emailThreadID string) {
	if !requireMailboxAccess(w, r) {
		return
	}
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
	projectID, emailThreadID = strings.TrimSpace(projectID), strings.TrimSpace(emailThreadID)
	if companyID == "" || projectID == "" || emailThreadID == "" {
		writeError(w, http.StatusBadRequest, "company_project_and_email_thread_required")
		return
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}
	if !s.requireEntityView(w, r, companyID, store.EntityTypeProject, projectID, "project_not_found") {
		return
	}
	messageID := strings.TrimSpace(r.URL.Query().Get("message_id"))
	var item domain.CommunicationsProjectEmailThread
	var err error
	if messageID == "" {
		item, err = s.repo.GetCommunicationsProjectEmailThread(companyID, projectID, emailThreadID)
	} else {
		item, err = s.repo.GetCommunicationsProjectEmailMessage(companyID, projectID, emailThreadID, messageID)
	}
	if errors.Is(err, store.ErrNotFound) {
		if messageID == "" {
			writeError(w, http.StatusNotFound, "project_email_thread_not_found")
		} else {
			writeError(w, http.StatusNotFound, "project_email_message_not_found")
		}
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_project_email_thread")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"project_id": item.ProjectID, "information_id": item.InformationID,
		"email_thread_id": item.EmailThreadID, "selected_message_id": item.SelectedMessageID,
		"thread_id": item.Thread.ProviderThreadID, "messages": storedEmailThreadMessages(item.Thread),
		"history_complete": item.Thread.HistoryComplete, "download_status": item.Thread.DownloadStatus,
		"fetched_at": item.Thread.FetchedAt, "last_download_error": item.Thread.LastDownloadError,
	})
}
