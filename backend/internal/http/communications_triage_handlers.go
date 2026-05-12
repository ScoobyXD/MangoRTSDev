package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) handleCommunicationsTriage(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.requireConnectedEmail(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := s.repo.ListCommunicationsTriageItems(connection.UserID)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "user_id_required")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_triage_items")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"items": items})
	case http.MethodPost:
		var req struct {
			MessageID  string   `json:"message_id"`
			MessageIDs []string `json:"message_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		messageIDs := cleanStringList(append(req.MessageIDs, strings.TrimSpace(req.MessageID)))
		if len(messageIDs) == 0 {
			writeError(w, http.StatusBadRequest, "message_id_required")
			return
		}
		if len(messageIDs) > store.CommunicationsTriageBatchMaxItems {
			messageIDs = messageIDs[:store.CommunicationsTriageBatchMaxItems]
		}

		items := make([]domain.CommunicationsTriageItem, 0, len(messageIDs))
		for _, messageID := range messageIDs {
			message, err := s.communicationsMessage(r.Context(), connection, messageID)
			if err != nil {
				s.writeNylasError(w, r, connection, err)
				return
			}
			item, err := s.repo.UpsertCommunicationsTriageItem(connection.UserID, emailMessageSnapshotFromNylas(message))
			if errors.Is(err, store.ErrInvalid) {
				writeError(w, http.StatusBadRequest, "invalid_triage_message")
				return
			}
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "user_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "failed_to_upsert_triage_item")
				return
			}
			items = append(items, item)
		}
		s.publishCommunicationsEvent(connection.UserID, "triage_changed", "triage.upserted", strings.Join(messageIDs, ","))
		writeJSON(w, http.StatusCreated, map[string]any{"items": items})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCommunicationsTriageByID(w http.ResponseWriter, r *http.Request) {
	messageID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/communications/triage/"), "/")
	if messageID == "" || strings.Contains(messageID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	connection, ok := s.requireConnectedEmail(w, r)
	if !ok {
		return
	}
	if err := s.repo.DeleteCommunicationsTriageItem(connection.UserID, messageID); errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "message_id_required")
		return
	} else if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "triage_item_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_triage_item")
		return
	}
	s.publishCommunicationsEvent(connection.UserID, "triage_changed", "triage.deleted", messageID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

func (s *Server) handleCommunicationsTriageConvert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	connection, ok := s.requireConnectedEmail(w, r)
	if !ok {
		return
	}
	var req struct {
		CompanyID   string   `json:"company_id"`
		LogicGateID string   `json:"logic_gate_id"`
		MessageIDs  []string `json:"message_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.LogicGateID = strings.TrimSpace(req.LogicGateID)
	req.MessageIDs = cleanStringList(req.MessageIDs)
	if req.CompanyID == "" || req.LogicGateID == "" || len(req.MessageIDs) == 0 {
		writeError(w, http.StatusBadRequest, "company_logic_gate_and_messages_required")
		return
	}
	if !requireCompanyAccess(w, r, req.CompanyID) {
		return
	}

	result, err := s.repo.ConvertCommunicationsTriageItems(store.CommunicationsTriageConversionInput{
		UserID:      connection.UserID,
		CompanyID:   req.CompanyID,
		LogicGateID: req.LogicGateID,
		MessageIDs:  req.MessageIDs,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_triage_conversion")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "triage_item_or_logic_gate_not_found")
		return
	}
	if err != nil {
		log.Printf("failed to convert communications triage items user_id=%s company_id=%s logic_gate_id=%s message_count=%d: %v", connection.UserID, req.CompanyID, req.LogicGateID, len(req.MessageIDs), err)
		writeError(w, http.StatusInternalServerError, "failed_to_convert_triage_items")
		return
	}
	for _, node := range result.Nodes {
		s.publishWorkspaceEvent(req.CompanyID, "node_created", map[string]any{"node_id": node.NodeID, "node": node})
		s.publishKanbanDerivedNodeUpdate(req.CompanyID, node.NodeID)
	}
	for _, card := range result.Cards {
		s.publishWorkspaceEvent(req.CompanyID, "kanban_card_upserted", map[string]any{
			"board_id": card.BoardID,
			"card_id":  card.CardID,
			"card":     card,
		})
	}
	s.publishCommunicationsEvent(connection.UserID, "triage_changed", "triage.converted", strings.Join(result.DeletedMessageIDs, ","))
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleCommunicationsTriageRevert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	connection, ok := s.requireConnectedEmail(w, r)
	if !ok {
		return
	}
	var req struct {
		CompanyID string `json:"company_id"`
		BoardID   string `json:"board_id"`
		CardID    string `json:"card_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.BoardID = strings.TrimSpace(req.BoardID)
	req.CardID = strings.TrimSpace(req.CardID)
	if req.CompanyID == "" || req.BoardID == "" || req.CardID == "" {
		writeError(w, http.StatusBadRequest, "company_board_and_card_required")
		return
	}
	if !requireCompanyAccess(w, r, req.CompanyID) {
		return
	}
	result, err := s.repo.RevertCommunicationsTriageNode(store.CommunicationsTriageRevertInput{
		UserID:    connection.UserID,
		CompanyID: req.CompanyID,
		BoardID:   req.BoardID,
		CardID:    req.CardID,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_triage_revert")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "triage_card_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_revert_triage_card")
		return
	}
	s.publishWorkspaceEvent(req.CompanyID, "kanban_card_deleted", map[string]any{
		"board_id": result.BoardID,
		"card_id":  result.DeletedCardID,
	})
	s.publishWorkspaceEvent(req.CompanyID, "node_deleted", map[string]any{"node_id": result.DeletedNodeID})
	s.publishCommunicationsEvent(connection.UserID, "triage_changed", "triage.reverted", result.TriageItem.MessageID)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleCommunicationsMyLogicGates(w http.ResponseWriter, r *http.Request) {
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
		if !requireCompanyAccess(w, r, companyID) {
			return
		}
		items, err := s.repo.ListUserLogicGateShortcuts(actor.User.UserID, companyID)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "company_id_required")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_list_my_logic_gates")
			return
		}
		writeJSONMaybeNotModified(w, r, http.StatusOK, map[string]any{"shortcuts": items})
	case http.MethodPost:
		var req struct {
			CompanyID    string   `json:"company_id"`
			LogicGateID  string   `json:"logic_gate_id"`
			LogicGateIDs []string `json:"logic_gate_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return
		}
		req.CompanyID = strings.TrimSpace(req.CompanyID)
		logicGateIDs := cleanStringList(append(req.LogicGateIDs, strings.TrimSpace(req.LogicGateID)))
		if req.CompanyID == "" || len(logicGateIDs) == 0 {
			writeError(w, http.StatusBadRequest, "company_id_and_logic_gate_ids_required")
			return
		}
		if !requireCompanyAccess(w, r, req.CompanyID) {
			return
		}
		items, err := s.repo.UpsertUserLogicGateShortcuts(actor.User.UserID, req.CompanyID, logicGateIDs)
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_my_logic_gate_request")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "logic_gate_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_upsert_my_logic_gates")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"shortcuts": items})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

func (s *Server) handleCommunicationsMyLogicGateByID(w http.ResponseWriter, r *http.Request) {
	logicGateID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/communications/my-logic-gates/"), "/")
	if logicGateID == "" || strings.Contains(logicGateID, "/") {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if !requireCompanyAccess(w, r, companyID) {
		return
	}
	if err := s.repo.DeleteUserLogicGateShortcut(actor.User.UserID, companyID, logicGateID); errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "company_id_and_logic_gate_id_required")
		return
	} else if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "my_logic_gate_not_found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_delete_my_logic_gate")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

func emailMessageSnapshotFromNylas(message NylasMessage) domain.EmailMessageSnapshot {
	return domain.EmailMessageSnapshot{
		ID:        strings.TrimSpace(message.ID),
		ThreadID:  strings.TrimSpace(message.ThreadID),
		Subject:   strings.TrimSpace(message.Subject),
		Snippet:   strings.TrimSpace(message.Snippet),
		Body:      strings.TrimSpace(message.Body),
		Date:      message.Date,
		Unread:    message.Unread,
		Starred:   message.Starred,
		From:      emailAddressSnapshotsFromNylas(message.From),
		To:        emailAddressSnapshotsFromNylas(message.To),
		Cc:        emailAddressSnapshotsFromNylas(message.Cc),
		Bcc:       emailAddressSnapshotsFromNylas(message.Bcc),
		ReplyTo:   emailAddressSnapshotsFromNylas(message.ReplyTo),
		Folders:   cleanStringList(message.Folders),
		FolderIDs: cleanStringList(message.FolderIDs),
	}
}

func emailAddressSnapshotsFromNylas(addresses []NylasEmailAddress) []domain.EmailAddressSnapshot {
	out := make([]domain.EmailAddressSnapshot, 0, len(addresses))
	seen := map[string]bool{}
	for _, address := range addresses {
		email := normalizeEmailForCompare(address.Email)
		if email == "" || seen[email] {
			continue
		}
		seen[email] = true
		out = append(out, domain.EmailAddressSnapshot{
			Name:  strings.TrimSpace(address.Name),
			Email: email,
		})
	}
	return out
}
