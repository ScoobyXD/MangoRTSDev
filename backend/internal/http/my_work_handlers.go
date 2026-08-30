package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"miraeopus/backend/internal/store"
)

func (s *Server) handleMyWork(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	queryValues := r.URL.Query()
	if _, exists := queryValues["user_id"]; exists {
		writeError(w, http.StatusBadRequest, "my_work_subject_not_allowed")
		return
	}
	if _, exists := queryValues["target_user_id"]; exists {
		writeError(w, http.StatusBadRequest, "my_work_subject_not_allowed")
		return
	}
	for key := range queryValues {
		switch key {
		case "company_id", "section", "role", "perspective", "grouping", "ordering", "limit", "cursor", "history":
		default:
			writeError(w, http.StatusBadRequest, "unsupported_my_work_query_param")
			return
		}
	}

	companyID := strings.TrimSpace(queryValues.Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !isCanonicalUUID(companyID) {
		writeError(w, http.StatusBadRequest, "invalid_company_id")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok || strings.TrimSpace(actor.User.UserID) == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	roleForCompany, err := s.currentActorRoleForCompanyContext(r.Context(), actor, companyID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_verify_company_access")
		return
	}
	if roleForCompany == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}

	section := strings.ToLower(strings.TrimSpace(queryValues.Get("section")))
	switch section {
	case "", store.MyWorkSectionActionItems, store.MyWorkSectionNodes, store.MyWorkSectionProcesses, store.MyWorkSectionProjects:
	default:
		writeError(w, http.StatusBadRequest, "invalid_my_work_section")
		return
	}
	raciRole := strings.ToLower(strings.TrimSpace(queryValues.Get("role")))
	if raciRole != "" && section != store.MyWorkSectionNodes && section != store.MyWorkSectionProcesses {
		writeError(w, http.StatusBadRequest, "my_work_role_only_valid_for_nodes_or_processes")
		return
	}
	perspective := strings.ToLower(strings.TrimSpace(queryValues.Get("perspective")))
	if perspective != "" && section != store.MyWorkSectionActionItems {
		writeError(w, http.StatusBadRequest, "my_work_perspective_only_valid_for_action_items")
		return
	}
	if perspective != "" && perspective != store.MyWorkActionItemPerspectiveMine && perspective != store.MyWorkActionItemPerspectiveDelegated {
		writeError(w, http.StatusBadRequest, "invalid_my_work_perspective")
		return
	}
	if raciRole != "" {
		if _, valid := store.NormalizeRACIRole(raciRole); !valid {
			writeError(w, http.StatusBadRequest, "invalid_my_work_role")
			return
		}
	}
	groupingValues, groupingSet := queryValues["grouping"]
	if len(groupingValues) > 1 {
		writeError(w, http.StatusBadRequest, "invalid_my_work_grouping")
		return
	}
	grouping := strings.TrimSpace(queryValues.Get("grouping"))
	if groupingSet {
		if grouping == "" || (section != store.MyWorkSectionActionItems && section != store.MyWorkSectionNodes) {
			writeError(w, http.StatusBadRequest, "my_work_grouping_only_valid_for_action_items_or_nodes")
			return
		}
	}
	orderingValues, orderingSet := queryValues["ordering"]
	if len(orderingValues) > 1 {
		writeError(w, http.StatusBadRequest, "invalid_my_work_ordering")
		return
	}
	ordering := strings.TrimSpace(queryValues.Get("ordering"))
	if orderingSet {
		if ordering == "" || section != store.MyWorkSectionActionItems {
			writeError(w, http.StatusBadRequest, "my_work_ordering_only_valid_for_action_items")
			return
		}
	}
	historyValues, historySet := queryValues["history"]
	if len(historyValues) > 1 {
		writeError(w, http.StatusBadRequest, "invalid_my_work_history")
		return
	}
	history := false
	if historySet {
		parsed, err := strconv.ParseBool(strings.TrimSpace(queryValues.Get("history")))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_my_work_history")
			return
		}
		history = parsed
	}
	if history && section != store.MyWorkSectionActionItems && section != store.MyWorkSectionNodes {
		writeError(w, http.StatusBadRequest, "my_work_history_only_valid_for_action_items_or_nodes")
		return
	}
	if history && (groupingSet || orderingSet) {
		writeError(w, http.StatusBadRequest, "my_work_history_cannot_be_grouped_or_ordered")
		return
	}
	limit, ok := parsePositiveLimit(queryValues.Get("limit"), store.MyWorkDefaultLimit, store.MyWorkMaxLimit)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	cursor := strings.TrimSpace(queryValues.Get("cursor"))
	if cursor != "" && section == "" {
		writeError(w, http.StatusBadRequest, "my_work_cursor_requires_section")
		return
	}

	userID := strings.TrimSpace(actor.User.UserID)
	response, err := s.repo.GetMyWork(r.Context(), store.MyWorkQuery{
		CompanyID: companyID, UserID: userID, ViewerUserID: userID,
		Section: section, Role: raciRole, Perspective: perspective, Grouping: grouping, Ordering: ordering, Limit: limit, Cursor: cursor, History: history,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_my_work_query")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_my_work")
		return
	}
	writeJSONMaybeNotModified(w, r, http.StatusOK, response)
}
