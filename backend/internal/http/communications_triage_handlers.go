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

type communicationsTriageAtomicNodeInformationRequest struct {
	Type          string `json:"type"`
	Information   string `json:"information"`
	InformationID string `json:"information_id"`
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
		CompanyID          string                                            `json:"company_id"`
		SharedInboxID      string                                            `json:"shared_inbox_id"`
		LogicGateID        string                                            `json:"logic_gate_id"`
		NodeID             string                                            `json:"node_id"`
		NewLogicGateHeader string                                            `json:"new_logic_gate_header"`
		Target             store.CommunicationsTriageConversionTarget        `json:"target"`
		Status             string                                            `json:"status"`
		ColumnID           string                                            `json:"column_id"`
		Priority           *int                                              `json:"priority"`
		MessageIDs         []string                                          `json:"message_ids"`
		LinkedTextBlock    *communicationsTriageAtomicNodeInformationRequest `json:"linked_text_block"`
		InitialChat        *communicationsTriageAtomicNodeInformationRequest `json:"initial_chat"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	for _, item := range []*communicationsTriageAtomicNodeInformationRequest{req.LinkedTextBlock, req.InitialChat} {
		if item != nil && rejectDurableInlineFileBytes(w, "communications_triage_atomic_node_content", item.Information) {
			return
		}
	}
	nodeActorUserID, nodeActorLabel := nodeChangeActorPayload(r)
	sharedInboxID := strings.TrimSpace(req.SharedInboxID)
	connection, ok := s.requireCommunicationsConnection(w, r, actor, req.CompanyID, sharedInboxID, store.EntityPermissionEdit)
	if !ok {
		return
	}
	actorUserID, idempotencyKey := workItemAssignmentRequestEventMetadata(r)
	permissionUserID := s.entityPermissionActorUserID(r, req.CompanyID)
	toNodeInformationInput := func(item *communicationsTriageAtomicNodeInformationRequest) *store.NodeInformationInput {
		if item == nil {
			return nil
		}
		return &store.NodeInformationInput{
			CompanyID: req.CompanyID, NodeID: req.Target.NodeID, Type: item.Type,
			Information: item.Information, InformationID: item.InformationID,
			ActorUserID: nodeActorUserID, ActorDisplayName: nodeActorLabel,
		}
	}
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
		LinkedTextBlock:    toNodeInformationInput(req.LinkedTextBlock),
		InitialChat:        toNodeInformationInput(req.InitialChat),
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
		snapshot := emailMessageSnapshotFromNylas(message)
		threadInput := store.CommunicationsEmailThreadUpsertInput{
			CompanyID: conversionInput.CompanyID, AccountEmail: connection.AccountEmail, Provider: connection.Provider,
			ProviderThreadID: snapshot.ThreadID, SelectedMessageID: snapshot.ID,
			Messages: []domain.EmailMessageSnapshot{snapshot}, HistoryComplete: snapshot.ThreadID == "",
			FetchedAt: time.Now().UTC(), RequestDownload: true, RequestedByUserID: actor.User.UserID,
		}
		if sharedInboxID != "" {
			threadInput.SharedInboxID = sharedInboxID
		} else {
			threadInput.PersonalUserID = connection.UserID
			threadInput.PersonalAccountEmail = connection.AccountEmail
		}
		conversionInput.EmailThreads = append(conversionInput.EmailThreads, threadInput)
		if _, err := s.repo.UpsertCommunicationsTriageItem(connection.UserID, snapshot); errors.Is(err, store.ErrInvalid) {
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

	result, err := s.repo.ConvertCommunicationsTriageItems(r.Context(), conversionInput)
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
	for _, emailThreadID := range result.EmailThreadIDs {
		_ = s.linkStoredEmailThreadAttachments(r.Context(), conversionInput.CompanyID, emailThreadID, actor.User.UserID)
	}
	if err := s.enqueueCommunicationsEmailIngestionJobsForThreads(r.Context(), conversionInput.CompanyID, result.EmailThreadIDs, store.CommunicationsEmailUserProducerFingerprint(actor.User.UserID)); err != nil {
		writeError(w, http.StatusServiceUnavailable, "failed_to_queue_email_ingestion")
		return
	}
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
	s.publishCommittedWorkspaceEvents(result.Events)
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
	s.publishCommittedWorkspaceEvents(result.Events)
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
		ID:               strings.TrimSpace(message.ID),
		ThreadID:         strings.TrimSpace(message.ThreadID),
		Subject:          strings.TrimSpace(message.Subject),
		Snippet:          strings.TrimSpace(message.Snippet),
		Body:             strings.TrimSpace(message.Body),
		Date:             message.Date,
		Unread:           message.Unread,
		Starred:          message.Starred,
		From:             emailAddressSnapshotsFromNylas(message.From),
		To:               emailAddressSnapshotsFromNylas(message.To),
		Cc:               emailAddressSnapshotsFromNylas(message.Cc),
		Bcc:              emailAddressSnapshotsFromNylas(message.Bcc),
		ReplyTo:          emailAddressSnapshotsFromNylas(message.ReplyTo),
		Attachments:      emailAttachmentSnapshotsFromNylas(message.Attachments),
		Folders:          cleanStringList(message.Folders),
		FolderIDs:        cleanStringList(message.FolderIDs),
		DownloadComplete: len(message.Attachments) == 0 && !messageNeedsRawMIMEAttachmentRecovery(message),
	}
}

func emailAttachmentSnapshotsFromNylas(attachments []NylasAttachment) []domain.EmailAttachmentSnapshot {
	out := make([]domain.EmailAttachmentSnapshot, 0, len(attachments))
	for _, attachment := range attachments {
		id := strings.TrimSpace(attachment.ID)
		attachmentID := strings.TrimSpace(attachment.AttachmentID)
		filename := strings.TrimSpace(attachment.Filename)
		if id == "" && attachmentID == "" && filename == "" {
			continue
		}
		out = append(out, domain.EmailAttachmentSnapshot{
			ID: id, AttachmentID: attachmentID, Filename: filename,
			ContentType:        strings.TrimSpace(attachment.ContentType),
			ContentID:          strings.TrimSpace(attachment.ContentID),
			ContentDisposition: strings.TrimSpace(attachment.ContentDisposition),
			IsInline:           attachment.IsInline, Size: attachment.Size,
		})
	}
	return out
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
