package httpapi

import (
	"encoding/json"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
)

func (s *Server) handleHuddleNodeWorkspaceSubresource(w http.ResponseWriter, r *http.Request, huddleNodeID string, parts []string) bool {
	if len(parts) < 2 {
		return false
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	switch parts[1] {
	case "workspace":
		if len(parts) != 2 {
			return false
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return true
		}
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleNode, huddleNodeID, "huddle_node_not_found") {
			return true
		}
		workspace, err := s.repo.GetHuddleNodeWorkspace(companyID, huddleNodeID)
		if err != nil {
			writeHuddleError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, workspace)
		return true
	case "textboxes":
		if len(parts) != 2 {
			return false
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			return true
		}
		var request struct {
			CompanyID string `json:"company_id"`
			TextboxID string `json:"textbox_id"`
			Title     string `json:"title"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return true
		}
		companyID = strings.TrimSpace(request.CompanyID)
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleNode, huddleNodeID, "huddle_node_not_found") {
			return true
		}
		item, err := s.repo.CreateHuddleNodeTextbox(store.HuddleNodeTextboxCreateInput{
			CompanyID: companyID, HuddleNodeID: huddleNodeID,
			TextboxID: request.TextboxID, Title: request.Title,
		})
		if err != nil {
			writeHuddleError(w, err)
			return true
		}
		writeJSON(w, http.StatusCreated, map[string]any{"textbox": item})
		return true
	case "chats":
		if len(parts) != 2 && len(parts) != 3 {
			return false
		}
		return s.handleHuddleNodeTextboxChat(w, r, huddleNodeID, parts)
	default:
		return false
	}
}

func (s *Server) handleHuddleNodeTextboxChat(w http.ResponseWriter, r *http.Request, huddleNodeID string, parts []string) bool {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if len(parts) == 3 && r.Method == http.MethodDelete {
		if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleNode, huddleNodeID, "huddle_node_not_found") {
			return true
		}
		actor, ok := authenticatedActor(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return true
		}
		revision, ok := parseOptionalInt64(r.URL.Query().Get("revision"))
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_request")
			return true
		}
		if err := s.repo.DeleteHuddleNodeTextboxChat(store.HuddleNodeTextboxChatDeleteInput{
			CompanyID: companyID, HuddleNodeID: huddleNodeID,
			ChatID: parts[2], ActorUserID: actor.User.UserID, ExpectedRevision: &revision,
		}); err != nil {
			writeHuddleError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
		return true
	}
	if len(parts) == 2 && r.Method != http.MethodPost || len(parts) == 3 && r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return true
	}
	var request struct {
		CompanyID         string          `json:"company_id"`
		TextboxID         string          `json:"textbox_id"`
		ParentChatID      string          `json:"parent_chat_id"`
		SelectionQuote    string          `json:"selection_quote"`
		SelectionStart    *int            `json:"selection_start"`
		SelectionEnd      *int            `json:"selection_end"`
		Message           string          `json:"message"`
		EntityLinks       json.RawMessage `json:"entity_links"`
		MentionedUserIDs  []string        `json:"mentioned_user_ids"`
		MentionedGroupIDs []string        `json:"mentioned_group_ids"`
		BaseRevision      *int64          `json:"base_revision"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return true
	}
	companyID = strings.TrimSpace(request.CompanyID)
	if !s.requireEntityEdit(w, r, companyID, store.EntityTypeHuddleNode, huddleNodeID, "huddle_node_not_found") {
		return true
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return true
	}
	chatID := ""
	if len(parts) == 3 {
		if request.BaseRevision == nil || *request.BaseRevision < 0 {
			writeError(w, http.StatusBadRequest, "invalid_request")
			return true
		}
		chatID = parts[2]
	} else {
		if request.BaseRevision != nil {
			writeError(w, http.StatusBadRequest, "invalid_request")
			return true
		}
		chatID = store.NewUUIDv7String()
	}
	item, err := s.repo.UpsertHuddleNodeTextboxChat(store.HuddleNodeTextboxChatInput{
		CompanyID: companyID, HuddleNodeID: huddleNodeID, TextboxID: request.TextboxID,
		ChatID: chatID, ParentChatID: request.ParentChatID,
		SelectionQuote: request.SelectionQuote, SelectionStart: request.SelectionStart, SelectionEnd: request.SelectionEnd,
		AuthorUserID: actor.User.UserID, AuthorDisplayName: actor.User.DisplayName, ActorUserID: actor.User.UserID,
		Message: request.Message, EntityLinks: request.EntityLinks,
		MentionedUserIDs: request.MentionedUserIDs, MentionedGroupIDs: request.MentionedGroupIDs,
		ExpectedRevision: request.BaseRevision,
	})
	if err != nil {
		writeHuddleError(w, err)
		return true
	}
	status := http.StatusCreated
	if len(parts) == 3 {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"chat": item})
	return true
}

func parseOptionalInt64(value string) (int64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}
