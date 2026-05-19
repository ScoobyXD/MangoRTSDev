package httpapi

import (
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func isCanonicalUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			if (char < '0' || char > '9') && (char < 'a' || char > 'f') && (char < 'A' || char > 'F') {
				return false
			}
		}
	}
	return true
}

func parseWorkItemInboxReadQuery(w http.ResponseWriter, r *http.Request) (store.WorkItemInboxQuery, bool) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return store.WorkItemInboxQuery{}, false
	}
	if !isCanonicalUUID(companyID) {
		writeError(w, http.StatusBadRequest, "invalid_company_id")
		return store.WorkItemInboxQuery{}, false
	}
	userID := strings.TrimSpace(r.URL.Query().Get("user_id"))
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user_id_required")
		return store.WorkItemInboxQuery{}, false
	}
	if !isCanonicalUUID(userID) {
		writeError(w, http.StatusBadRequest, "invalid_user_id")
		return store.WorkItemInboxQuery{}, false
	}
	limit, ok := parsePositiveLimit(r.URL.Query().Get("limit"), store.WorkItemInboxDefaultLimit, store.WorkItemInboxMaxLimit)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_limit")
		return store.WorkItemInboxQuery{}, false
	}
	return store.WorkItemInboxQuery{CompanyID: companyID, UserID: userID, Limit: limit}, true
}

func (s *Server) handleWorkItemResponsibleInbox(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	query, ok := parseWorkItemInboxReadQuery(w, r)
	if !ok {
		return
	}
	items, err := s.repo.ListResponsibleInboxNodes(query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_responsible_inbox")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"company_id": query.CompanyID,
		"user_id":    query.UserID,
		"limit":      query.Limit,
		"nodes":      items,
	})
}

func (s *Server) handleWorkItemACIInbox(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	query, ok := parseWorkItemInboxReadQuery(w, r)
	if !ok {
		return
	}
	items, err := s.repo.ListACIInboxLogicGates(query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_aci_inbox")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"company_id":  query.CompanyID,
		"user_id":     query.UserID,
		"limit":       query.Limit,
		"logic_gates": items,
	})
}

func (s *Server) handleWorkItemMyNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	query, ok := parseWorkItemInboxReadQuery(w, r)
	if !ok {
		return
	}
	items, err := s.repo.ListMyNodes(query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_my_nodes")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"company_id": query.CompanyID,
		"user_id":    query.UserID,
		"limit":      query.Limit,
		"nodes":      items,
	})
}

func (s *Server) handleWorkItemMyLogicGates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	query, ok := parseWorkItemInboxReadQuery(w, r)
	if !ok {
		return
	}
	items, err := s.repo.ListMyLogicGates(query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_list_my_logic_gates")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{
		"company_id":  query.CompanyID,
		"user_id":     query.UserID,
		"limit":       query.Limit,
		"logic_gates": items,
	})
}
