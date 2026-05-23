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

	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return store.WorkItemInboxQuery{}, false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return store.WorkItemInboxQuery{}, false
	}

	userID := strings.TrimSpace(actor.User.UserID)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return store.WorkItemInboxQuery{}, false
	}

	requestedUserID, requestedUserIDSet, requestedUserIDOK := workItemInboxRequestedUserID(r)
	if !requestedUserIDOK {
		writeError(w, http.StatusBadRequest, "invalid_user_id")
		return store.WorkItemInboxQuery{}, false
	}
	if requestedUserIDSet && requestedUserID != userID {
		if !actorCanManageCompany(actor, companyID) {
			writeError(w, http.StatusForbidden, "company_admin_required")
			return store.WorkItemInboxQuery{}, false
		}
		userID = requestedUserID
	}

	limit, ok := parsePositiveLimit(r.URL.Query().Get("limit"), store.WorkItemInboxDefaultLimit, store.WorkItemInboxMaxLimit)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_limit")
		return store.WorkItemInboxQuery{}, false
	}
	return store.WorkItemInboxQuery{CompanyID: companyID, UserID: userID, Limit: limit}, true
}

func workItemInboxRequestedUserID(r *http.Request) (string, bool, bool) {
	userID := strings.TrimSpace(r.URL.Query().Get("user_id"))
	targetUserID := strings.TrimSpace(r.URL.Query().Get("target_user_id"))
	switch {
	case userID != "" && targetUserID != "" && userID != targetUserID:
		return "", true, false
	case targetUserID != "":
		userID = targetUserID
	}
	if userID == "" {
		return "", false, true
	}
	if !isCanonicalUUID(userID) {
		return "", true, false
	}
	return userID, true, true
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
	items, err := s.repo.ListResponsibleInboxNodesContext(r.Context(), query)
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
	items, err := s.repo.ListACIInboxLogicGatesContext(r.Context(), query)
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
	items, err := s.repo.ListMyNodesContext(r.Context(), query)
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
	items, err := s.repo.ListMyLogicGatesContext(r.Context(), query)
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
