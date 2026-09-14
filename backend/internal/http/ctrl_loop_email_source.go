package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

// The configured app origin owns source links. Request headers, message text
// and model output cannot choose their destination.
func ctrlLoopAppOrigin(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err == nil && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && !u.ForceQuery && !strings.Contains(raw, "#") && (u.Path == "" || u.Path == "/") {
		host := strings.ToLower(u.Hostname())
		loopback := host == "localhost" || host == "127.0.0.1" || host == "::1"
		if u.Scheme == "https" || (u.Scheme == "http" && loopback) {
			return u, nil
		}
	}
	return nil, errors.New("Configure MANGORTS_APP_URL as this app's HTTPS origin on the API and email worker; HTTP is allowed only for local development.")
}

func (s *Server) ctrlLoopStoredEmailURL(run store.CtrlLoopRun) (string, error) {
	u, err := ctrlLoopAppOrigin(s.appBaseURL)
	if err != nil {
		return "", err
	}
	if !isCanonicalUUID(run.CompanyID) || !isCanonicalUUID(run.EmailThreadID) || !isCanonicalUUID(run.EmailMessageID) {
		return "", errors.New("The exact stored source email is unavailable. No workbook changes were published.")
	}
	u.Path = "/ctrl-loop/email/" + run.CompanyID + "/" + run.EmailThreadID + "/" + run.EmailMessageID
	return u.String(), nil
}

// This view reads one existing durable message under its current personal
// mailbox owner. The URL grants no access and creates no copy or relationship.
func (s *Server) handleCtrlLoopSourceEmail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	_, companyID, userID, ok := s.ctrlLoopOwner(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/ctrl-loop/emails/"), "/")
	if len(parts) != 2 || !isCanonicalUUID(parts[0]) || !isCanonicalUUID(parts[1]) {
		writeError(w, http.StatusNotFound, "Source email is unavailable.")
		return
	}
	thread, err := s.repo.GetCommunicationsEmailThreadContext(r.Context(), companyID, parts[0])
	if err != nil {
		ctrlLoopError(w, err)
		return
	}
	if thread.CompanyID != companyID || thread.EmailThreadID != parts[0] || thread.ScopeType != "personal" || thread.PersonalUserID != userID {
		writeError(w, http.StatusNotFound, "Source email is unavailable.")
		return
	}
	connection, err := s.ctrlLoopConnection(r.Context(), companyID, userID, thread.EmailConnectionID)
	if errors.Is(err, errMailboxDisabled) {
		writeError(w, http.StatusForbidden, "mailbox_disabled")
		return
	}
	if err != nil {
		ctrlLoopError(w, err)
		return
	}
	if normalizeEmailForCompare(thread.PersonalAccountEmail) != normalizeEmailForCompare(connection.AccountEmail) {
		writeError(w, http.StatusNotFound, "Source email is unavailable.")
		return
	}
	for _, stored := range thread.Messages {
		if stored.CompanyID != companyID || stored.EmailThreadID != parts[0] || stored.EmailMessageID != parts[1] {
			continue
		}
		if !stored.Message.DownloadComplete {
			writeError(w, http.StatusConflict, "The source email has not finished downloading.")
			return
		}
		message := stored.Message
		message.EmailThreadID = stored.EmailThreadID
		message.EmailMessageID = stored.EmailMessageID
		message.MessageOrder = &stored.MessageOrder
		writeJSON(w, http.StatusOK, map[string]any{
			"message": struct {
				domain.EmailMessageSnapshot
				DetailFetched bool `json:"detail_fetched"`
			}{message, true},
			"account_email": connection.AccountEmail,
		})
		return
	}
	writeError(w, http.StatusNotFound, "Source email is unavailable.")
}
