package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"time"
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
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

func (s *Server) handleCommunicationsTriageConvert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req struct {
		CompanyID          string                                     `json:"company_id"`
		SharedInboxID      string                                     `json:"shared_inbox_id"`
		LogicGateID        string                                     `json:"logic_gate_id"`
		NodeID             string                                     `json:"node_id"`
		NewLogicGateHeader string                                     `json:"new_logic_gate_header"`
		Target             store.CommunicationsTriageConversionTarget `json:"target"`
		Status             string                                     `json:"status"`
		ColumnID           string                                     `json:"column_id"`
		Priority           *int                                       `json:"priority"`
		MessageIDs         []string                                   `json:"message_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	sharedInboxID := strings.TrimSpace(req.SharedInboxID)
	connection, ok := s.requireCommunicationsConnection(w, r, actor, req.CompanyID, sharedInboxID, store.EntityPermissionEdit)
	if !ok {
		return
	}
	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	permissionUserID := s.entityPermissionActorUserID(r, req.CompanyID)
	conversionInput, err := store.NormalizeCommunicationsTriageConversionInput(store.CommunicationsTriageConversionInput{
		UserID:             connection.UserID,
		CompanyID:          req.CompanyID,
		SharedInboxID:      sharedInboxID,
		AccountEmail:       connection.AccountEmail,
		ActorUserID:        actorUserID,
		PermissionUserID:   permissionUserID,
		IdempotencyKey:     idempotencyKey,
		LogicGateID:        req.LogicGateID,
		NodeID:             req.NodeID,
		NewLogicGateHeader: req.NewLogicGateHeader,
		Target:             req.Target,
		Status:             req.Status,
		ColumnID:           req.ColumnID,
		Priority:           req.Priority,
		PrioritySet:        req.Priority != nil,
		MessageIDs:         req.MessageIDs,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "company_target_and_messages_required")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_triage_conversion")
		return
	}
	if !requireCompanyAccess(w, r, conversionInput.CompanyID) {
		return
	}
	if conversionInput.Target.Mode == store.CommunicationsEmailConversionTargetExistingLogicGate ||
		(conversionInput.Target.Mode == store.CommunicationsEmailConversionTargetExistingNode && conversionInput.LogicGateID != "") {
		if !s.requireKanbanLogicGateEffectiveAccess(w, conversionInput.CompanyID, permissionUserID, conversionInput.LogicGateID, store.EntityPermissionEdit) {
			return
		}
	}
	if conversionInput.Target.Mode == store.CommunicationsEmailConversionTargetExistingNode &&
		!s.requireEntityEdit(w, r, conversionInput.CompanyID, store.EntityTypeNode, conversionInput.NodeID, "node_not_found") {
		return
	}
	if strings.TrimSpace(conversionInput.Target.ProjectID) != "" &&
		!s.requireEntityEdit(w, r, conversionInput.CompanyID, store.EntityTypeProject, conversionInput.Target.ProjectID, "project_not_found") {
		return
	}
	sourceMessagesByID := make(map[string]NylasMessage, len(conversionInput.MessageIDs))
	for _, messageID := range conversionInput.MessageIDs {
		message, err := s.communicationsMessage(r.Context(), connection, messageID)
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
		sourceMessagesByID[messageID] = message
		if _, err := s.repo.UpsertCommunicationsTriageItem(connection.UserID, emailMessageSnapshotFromNylas(message)); errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_triage_message")
			return
		} else if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "user_not_found")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_upsert_triage_item")
			return
		}
	}

	result, err := s.repo.ConvertCommunicationsTriageItems(conversionInput)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_triage_conversion")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "triage_item_or_logic_gate_not_found")
		return
	}
	if err != nil {
		log.Printf("failed to convert communications triage items user_id=%s company_id=%s target_mode=%s logic_gate_id=%s message_count=%d: %v", connection.UserID, conversionInput.CompanyID, conversionInput.Target.Mode, conversionInput.LogicGateID, len(conversionInput.MessageIDs), err)
		writeError(w, http.StatusInternalServerError, "failed_to_convert_triage_items")
		return
	}
	result.UnstarredMessageIDs = s.unstarConvertedCommunicationsMessages(r.Context(), connection, sourceMessagesByID, conversionInput.MessageIDs)
	s.publishCommittedWorkspaceEvents(result.Events)
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) unstarConvertedCommunicationsMessages(ctx context.Context, connection domain.UserEmailConnection, sourceMessagesByID map[string]NylasMessage, messageIDs []string) []string {
	ids := cleanStringList(messageIDs)
	if len(ids) == 0 {
		return nil
	}
	unstarred := false
	unstarredIDs := make([]string, 0, len(ids))
	cacheScope := communicationsConnectionCacheScope(connection)
	now := time.Now().UTC()
	for _, messageID := range ids {
		var updated NylasMessage
		err := s.withCommunicationsNylasGate(ctx, connection, func(ctx context.Context) error {
			var updateErr error
			updated, updateErr = s.nylasClient.UpdateMessage(ctx, connection.GrantID, messageID, NylasMessageUpdate{Starred: &unstarred})
			return updateErr
		})
		if err != nil {
			log.Printf("communications_triage_convert_unstar_failed user_id=%s scope=%s message_id=%s grant=%s error=%v", connection.UserID, connection.Scope, messageID, grantIDLogValue(connection.GrantID), err)
			continue
		}
		if updated.ID == "" {
			updated = sourceMessagesByID[messageID]
			updated.ID = messageID
		}
		updated.Starred = false
		if s.commCache != nil {
			s.commCache.patchMessagePages(connection.UserID, cacheScope, updated, now)
			s.commCache.patchMessageMetadata(connection.UserID, cacheScope, messageID, NylasMessageUpdate{Starred: &unstarred}, updated)
		}
		unstarredIDs = append(unstarredIDs, messageID)
	}
	if len(unstarredIDs) > 0 {
		s.invalidateCommunicationsMessageMutations(connection.UserID, cacheScope, unstarredIDs, false)
	}
	return unstarredIDs
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
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleCommunicationsEmailNodeTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if _, ok := authenticatedActor(r); !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req struct {
		CompanyID     string `json:"company_id"`
		SourceBoardID string `json:"source_board_id"`
		SourceCardID  string `json:"source_card_id"`
		TargetBoardID string `json:"target_board_id"`
		TargetCardID  string `json:"target_card_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	input, err := store.NormalizeCommunicationsEmailNodeTransferInput(store.CommunicationsEmailNodeTransferInput{
		CompanyID:      req.CompanyID,
		SourceBoardID:  req.SourceBoardID,
		SourceCardID:   req.SourceCardID,
		TargetBoardID:  req.TargetBoardID,
		TargetCardID:   req.TargetCardID,
		ActorUserID:    actorUserID,
		IdempotencyKey: idempotencyKey,
	})
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "company_source_and_target_cards_required")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_email_node_transfer")
		return
	}
	if !requireCompanyAccess(w, r, input.CompanyID) {
		return
	}
	sourceCard, err := s.repo.GetKanbanCard(input.CompanyID, input.SourceBoardID, input.SourceCardID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_source_card")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "source_email_card_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_source_card")
		return
	}
	targetCard, err := s.repo.GetKanbanCard(input.CompanyID, input.TargetBoardID, input.TargetCardID)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_target_card")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "target_card_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_target_card")
		return
	}
	if sourceCard.NodeID == targetCard.NodeID {
		writeError(w, http.StatusBadRequest, "source_and_target_must_differ")
		return
	}
	permissionUserID := s.entityPermissionActorUserID(r, input.CompanyID)
	if sourceCard.LogicGateID != nil && strings.TrimSpace(*sourceCard.LogicGateID) != "" &&
		!s.requireKanbanLogicGateEffectiveAccess(w, input.CompanyID, permissionUserID, strings.TrimSpace(*sourceCard.LogicGateID), store.EntityPermissionEdit) {
		return
	}
	if targetCard.LogicGateID != nil && strings.TrimSpace(*targetCard.LogicGateID) != "" &&
		!s.requireKanbanLogicGateEffectiveAccess(w, input.CompanyID, permissionUserID, strings.TrimSpace(*targetCard.LogicGateID), store.EntityPermissionEdit) {
		return
	}
	if !s.requireEntityEdit(w, r, input.CompanyID, store.EntityTypeNode, sourceCard.NodeID, "source_node_not_found") {
		return
	}
	if !s.requireEntityEdit(w, r, input.CompanyID, store.EntityTypeNode, targetCard.NodeID, "target_node_not_found") {
		return
	}

	result, err := s.repo.TransferCommunicationsEmailNode(input)
	if errors.Is(err, store.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_email_node_transfer")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "source_email_card_or_target_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_transfer_email_node")
		return
	}
	s.publishWorkspaceEvent(input.CompanyID, "kanban_card_deleted", map[string]any{
		"board_id": result.SourceBoardID,
		"card_id":  result.DeletedCardID,
	})
	s.publishWorkspaceEvent(input.CompanyID, "node_deleted", map[string]any{"node_id": result.DeletedNodeID})
	s.publishWorkspaceEvent(input.CompanyID, "node_updated", map[string]any{"node_id": result.TargetNodeID})
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
