package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"miraeopus/backend/internal/store"
)

func decodeNodeV2Cursor(raw string) (*store.NodeV2Cursor, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}
	var cursor store.NodeV2Cursor
	decoder := json.NewDecoder(bytes.NewReader(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cursor); err != nil || cursor.Version != 1 || strings.TrimSpace(cursor.Kind) == "" || strings.TrimSpace(cursor.ID) == "" {
		return nil, errors.New("invalid cursor")
	}
	return &cursor, nil
}

func decodeNodeV2CursorFor(raw, kind string) (*store.NodeV2Cursor, error) {
	cursor, err := decodeNodeV2Cursor(raw)
	if err != nil || (cursor != nil && cursor.Kind != kind) {
		return nil, errors.New("invalid cursor")
	}
	return cursor, nil
}

func nodeV2Limit(r *http.Request) int {
	value, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	return value
}

func (s *Server) nodeV2RequestActor(w http.ResponseWriter, r *http.Request, nodeID string, edit bool) (string, string, bool) {
	companyID := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if companyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return "", "", false
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return "", "", false
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return "", "", false
	}
	var allowed bool
	if edit {
		allowed = s.requireEntityEdit(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found")
	} else {
		allowed = s.requireEntityView(w, r, companyID, store.EntityTypeNode, nodeID, "node_not_found")
	}
	if !allowed {
		return "", "", false
	}
	return companyID, strings.TrimSpace(actor.User.UserID), true
}

func writeNodeV2StoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_node_v2_request")
	case errors.Is(err, store.ErrVersionConflict), errors.Is(err, store.ErrAlreadyExists):
		writeError(w, http.StatusConflict, "node_v2_sync_required")
	case errors.Is(err, store.ErrNodeV2Inactive):
		writeError(w, http.StatusConflict, "node_v2_workspace_inactive")
	case errors.Is(err, store.ErrNodeV2UntrustedCheckpoint):
		writeError(w, http.StatusForbidden, "node_v2_checkpoint_service_only")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "node_v2_resource_not_found")
	default:
		log.Printf("node v2 store failure: %v", err)
		writeError(w, http.StatusInternalServerError, "node_v2_request_failed")
	}
}

func (s *Server) handleNodeV2(w http.ResponseWriter, r *http.Request, nodeID string, parts []string) {
	if len(parts) == 1 && parts[0] == "availability" {
		s.handleNodeV2Availability(w, r, nodeID)
		return
	}
	if len(parts) == 1 && parts[0] == "workspace" {
		s.handleNodeV2Workspace(w, r, nodeID)
		return
	}
	if len(parts) == 1 && parts[0] == "timeline" {
		s.handleNodeV2Timeline(w, r, nodeID)
		return
	}
	if len(parts) == 1 && parts[0] == "textboxes" {
		s.handleNodeV2Textboxes(w, r, nodeID)
		return
	}
	if len(parts) == 1 && parts[0] == "textbox-move" {
		s.handleNodeV2TextboxMove(w, r, nodeID)
		return
	}
	if len(parts) >= 2 && parts[0] == "textboxes" {
		textboxID := parts[1]
		switch {
		case len(parts) == 2:
			s.handleNodeV2Textbox(w, r, nodeID, textboxID)
		case len(parts) == 3 && parts[2] == "sync":
			s.handleNodeV2TextboxSync(w, r, nodeID, textboxID)
		case len(parts) == 3 && parts[2] == "updates":
			s.handleNodeV2TextboxUpdate(w, r, nodeID, textboxID)
		case len(parts) == 3 && parts[2] == "checkpoints":
			s.handleNodeV2TextboxCheckpoint(w, r, nodeID, textboxID)
		case len(parts) == 3 && parts[2] == "comments":
			s.handleNodeV2Comments(w, r, nodeID, textboxID)
		case len(parts) == 5 && parts[2] == "comments" && parts[4] == "replies":
			s.handleNodeV2CommentReply(w, r, nodeID, textboxID, parts[3])
		case len(parts) == 3 && parts[2] == "attachments":
			s.handleNodeV2TextboxAttachment(w, r, nodeID, textboxID)
		case len(parts) == 3 && parts[2] == "email-links":
			s.handleNodeV2TextboxEmailLink(w, r, nodeID, textboxID)
		default:
			writeError(w, http.StatusNotFound, "not_found")
		}
		return
	}
	if len(parts) == 1 && parts[0] == "attachments" {
		s.handleNodeV2Attachments(w, r, nodeID)
		return
	}
	if len(parts) == 1 && parts[0] == "emails" {
		s.handleNodeV2Emails(w, r, nodeID)
		return
	}
	if len(parts) == 3 && parts[0] == "emails" && parts[2] == "messages" {
		s.handleNodeV2EmailMessages(w, r, nodeID, parts[1])
		return
	}
	writeError(w, http.StatusNotFound, "not_found")
}

func (s *Server) handleNodeV2Availability(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, _, ok := s.nodeV2RequestActor(w, r, nodeID, false)
	if !ok {
		return
	}
	item, err := s.repo.GetNodeV2Availability(companyID, nodeID)
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleNodeV2Workspace(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, _, ok := s.nodeV2RequestActor(w, r, nodeID, false)
	if !ok {
		return
	}
	cursor, err := decodeNodeV2CursorFor(r.URL.Query().Get("cursor"), "node_v2_timeline")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	item, err := s.repo.GetNodeV2Workspace(store.NodeV2WorkspaceQuery{CompanyID: companyID, NodeID: nodeID, TimelineLimit: nodeV2Limit(r), TimelineCursor: cursor, AggregateLimit: nodeV2Limit(r)})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleNodeV2Timeline(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, _, ok := s.nodeV2RequestActor(w, r, nodeID, false)
	if !ok {
		return
	}
	cursor, err := decodeNodeV2CursorFor(r.URL.Query().Get("cursor"), "node_v2_timeline")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	page, err := s.repo.ListNodeV2Timeline(store.NodeV2TimelineQuery{CompanyID: companyID, NodeID: nodeID, Limit: nodeV2Limit(r), Cursor: cursor})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

type nodeV2CreateTextboxRequest struct {
	IdempotencyKey string `json:"idempotency_key"`
}

func (s *Server) handleNodeV2Textboxes(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method == http.MethodGet {
		companyID, _, ok := s.nodeV2RequestActor(w, r, nodeID, false)
		if !ok {
			return
		}
		archived := r.URL.Query().Get("archived") == "1"
		kind := "node_v2_textboxes_active"
		if archived {
			kind = "node_v2_textboxes_archived"
		}
		cursor, err := decodeNodeV2CursorFor(r.URL.Query().Get("cursor"), kind)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_cursor")
			return
		}
		page, err := s.repo.ListNodeV2TextBoxes(store.NodeV2TextBoxPageQuery{CompanyID: companyID, NodeID: nodeID, Archived: archived, Limit: nodeV2Limit(r), Cursor: cursor})
		if err != nil {
			writeNodeV2StoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, actorID, ok := s.nodeV2RequestActor(w, r, nodeID, true)
	if !ok {
		return
	}
	var request nodeV2CreateTextboxRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	result, err := s.repo.CreateNodeV2TextBox(store.NodeV2CreateTextBoxInput{CompanyID: companyID, NodeID: nodeID, ActorUserID: actorID, IdempotencyKey: request.IdempotencyKey})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	writeJSON(w, http.StatusCreated, result)
}

type nodeV2MoveRequest struct {
	TextboxID      string `json:"textbox_id"`
	ReferenceID    string `json:"reference_textbox_id"`
	Placement      string `json:"placement"`
	IdempotencyKey string `json:"idempotency_key"`
}

func (s *Server) handleNodeV2TextboxMove(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, actorID, ok := s.nodeV2RequestActor(w, r, nodeID, true)
	if !ok {
		return
	}
	var request nodeV2MoveRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	item, err := s.repo.MoveNodeV2TextBox(store.NodeV2TextBoxMoveInput{CompanyID: companyID, NodeID: nodeID, ActorUserID: actorID, TextboxID: request.TextboxID, ReferenceID: request.ReferenceID, Placement: request.Placement, IdempotencyKey: request.IdempotencyKey})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	writeJSON(w, http.StatusOK, item)
}

type nodeV2ArchiveRequest struct {
	Archived       bool   `json:"archived"`
	IdempotencyKey string `json:"idempotency_key"`
}

func (s *Server) handleNodeV2Textbox(w http.ResponseWriter, r *http.Request, nodeID, textboxID string) {
	companyID, actorID, ok := s.nodeV2RequestActor(w, r, nodeID, r.Method != http.MethodGet)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		item, err := s.repo.GetNodeV2TextBox(companyID, nodeID, textboxID)
		if err != nil {
			writeNodeV2StoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	if r.Method != http.MethodPatch {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var request nodeV2ArchiveRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	item, err := s.repo.SetNodeV2TextBoxArchived(store.NodeV2ArchiveTextBoxInput{CompanyID: companyID, NodeID: nodeID, TextboxID: textboxID, ActorUserID: actorID, Archived: request.Archived, IdempotencyKey: request.IdempotencyKey})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleNodeV2TextboxSync(w http.ResponseWriter, r *http.Request, nodeID, textboxID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, _, ok := s.nodeV2RequestActor(w, r, nodeID, false)
	if !ok {
		return
	}
	after, _ := strconv.ParseInt(r.URL.Query().Get("after_sequence"), 10, 64)
	page, err := s.repo.GetNodeV2TextBoxSync(store.NodeV2SyncQuery{CompanyID: companyID, NodeID: nodeID, TextboxID: textboxID, AfterSequence: after, Limit: nodeV2Limit(r), IncludeCheckpoint: r.URL.Query().Get("include_checkpoint") != "0"})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

type nodeV2UpdateRequest struct {
	CollaborationEpoch string `json:"collaboration_epoch"`
	UpdateID           string `json:"update_id"`
	UpdateSHA256       string `json:"update_sha256"`
	ClientID           string `json:"client_id"`
	PayloadBase64      string `json:"payload_base64"`
}

func (s *Server) handleNodeV2TextboxUpdate(w http.ResponseWriter, r *http.Request, nodeID, textboxID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, actorID, ok := s.nodeV2RequestActor(w, r, nodeID, true)
	if !ok {
		return
	}
	var request nodeV2UpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	payload, err := base64.StdEncoding.DecodeString(request.PayloadBase64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_update_payload")
		return
	}
	item, err := s.repo.AppendNodeV2YjsUpdate(store.NodeV2YjsUpdateInput{CompanyID: companyID, NodeID: nodeID, TextboxID: textboxID, ActorUserID: actorID, CollaborationEpoch: request.CollaborationEpoch, UpdateID: request.UpdateID, UpdateSHA256: request.UpdateSHA256, ClientID: request.ClientID, Payload: payload})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

type nodeV2CheckpointRequest struct {
	CheckpointID       string          `json:"checkpoint_id"`
	CollaborationEpoch string          `json:"collaboration_epoch"`
	ThroughSequence    int64           `json:"through_update_sequence"`
	PayloadBase64      string          `json:"payload_base64"`
	StateVectorBase64  string          `json:"state_vector_base64"`
	DocumentJSON       json.RawMessage `json:"document_json"`
	PlainText          string          `json:"plain_text"`
	Reason             string          `json:"reason"`
}

func (s *Server) handleNodeV2TextboxCheckpoint(w http.ResponseWriter, r *http.Request, nodeID, textboxID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if _, _, ok := s.nodeV2RequestActor(w, r, nodeID, true); !ok {
		return
	}
	writeError(w, http.StatusForbidden, "node_v2_checkpoint_service_only")
}

type nodeV2CommentRequest struct {
	IdempotencyKey    string                     `json:"idempotency_key"`
	BodyText          string                     `json:"body_text"`
	SelectedQuote     string                     `json:"selected_quote"`
	AnchorBeforeText  string                     `json:"anchor_before_text"`
	AnchorAfterText   string                     `json:"anchor_after_text"`
	AnchorStatus      string                     `json:"anchor_status"`
	AnchorStartBase64 string                     `json:"anchor_start_base64"`
	AnchorEndBase64   string                     `json:"anchor_end_base64"`
	ParentCommentID   string                     `json:"parent_comment_id"`
	Mentions          []store.NodeV2MentionInput `json:"mentions"`
}

func (s *Server) handleNodeV2Comments(w http.ResponseWriter, r *http.Request, nodeID, textboxID string) {
	companyID, actorID, ok := s.nodeV2RequestActor(w, r, nodeID, r.Method != http.MethodGet)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		cursor, err := decodeNodeV2CursorFor(r.URL.Query().Get("cursor"), "node_v2_comments")
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_cursor")
			return
		}
		page, err := s.repo.ListNodeV2Comments(store.NodeV2CommentQuery{CompanyID: companyID, NodeID: nodeID, TextboxID: textboxID, Limit: nodeV2Limit(r), Cursor: cursor})
		if err != nil {
			writeNodeV2StoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	var request nodeV2CommentRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	anchorStart, startErr := base64.StdEncoding.DecodeString(request.AnchorStartBase64)
	anchorEnd, endErr := base64.StdEncoding.DecodeString(request.AnchorEndBase64)
	if (request.AnchorStartBase64 != "" && startErr != nil) || (request.AnchorEndBase64 != "" && endErr != nil) {
		writeError(w, http.StatusBadRequest, "invalid_comment_anchor")
		return
	}
	item, err := s.repo.CreateNodeV2CommentThread(store.NodeV2CreateCommentThreadInput{CompanyID: companyID, NodeID: nodeID, TextboxID: textboxID, ActorUserID: actorID, IdempotencyKey: request.IdempotencyKey, BodyText: request.BodyText, SelectedQuote: request.SelectedQuote, AnchorBeforeText: request.AnchorBeforeText, AnchorAfterText: request.AnchorAfterText, AnchorStatus: request.AnchorStatus, AnchorStart: anchorStart, AnchorEnd: anchorEnd, Mentions: request.Mentions})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleNodeV2CommentReply(w http.ResponseWriter, r *http.Request, nodeID, textboxID, threadID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, actorID, ok := s.nodeV2RequestActor(w, r, nodeID, true)
	if !ok {
		return
	}
	var request nodeV2CommentRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	item, err := s.repo.ReplyNodeV2Comment(store.NodeV2ReplyCommentInput{CompanyID: companyID, NodeID: nodeID, TextboxID: textboxID, ThreadID: threadID, ActorUserID: actorID, IdempotencyKey: request.IdempotencyKey, ParentCommentID: request.ParentCommentID, BodyText: request.BodyText, Mentions: request.Mentions})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	writeJSON(w, http.StatusCreated, item)
}

type nodeV2AttachmentRequest struct {
	AttachmentID     string `json:"attachment_id"`
	RelationshipKind string `json:"relationship_kind"`
	Deleted          bool   `json:"deleted"`
	IdempotencyKey   string `json:"idempotency_key"`
}

func (s *Server) handleNodeV2TextboxAttachment(w http.ResponseWriter, r *http.Request, nodeID, textboxID string) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, actorID, ok := s.nodeV2RequestActor(w, r, nodeID, true)
	if !ok {
		return
	}
	var request nodeV2AttachmentRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	item, err := s.repo.SetNodeV2AttachmentLink(store.NodeV2AttachmentLinkInput{CompanyID: companyID, NodeID: nodeID, TextboxID: textboxID, AttachmentID: request.AttachmentID, RelationshipKind: request.RelationshipKind, ActorUserID: actorID, Deleted: request.Deleted || r.Method == http.MethodDelete, IdempotencyKey: request.IdempotencyKey})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleNodeV2Attachments(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, _, ok := s.nodeV2RequestActor(w, r, nodeID, false)
	if !ok {
		return
	}
	cursor, err := decodeNodeV2CursorFor(r.URL.Query().Get("cursor"), "node_v2_attachments")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	page, err := s.repo.ListNodeV2Attachments(store.NodeV2AggregateQuery{CompanyID: companyID, NodeID: nodeID, Limit: nodeV2Limit(r), Cursor: cursor})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

type nodeV2EmailLinkRequest struct {
	EmailThreadID  string `json:"email_thread_id"`
	EmailMessageID string `json:"email_message_id"`
	Deleted        bool   `json:"deleted"`
	IdempotencyKey string `json:"idempotency_key"`
}

func (s *Server) handleNodeV2TextboxEmailLink(w http.ResponseWriter, r *http.Request, nodeID, textboxID string) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, actorID, ok := s.nodeV2RequestActor(w, r, nodeID, true)
	if !ok {
		return
	}
	var request nodeV2EmailLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	err := s.repo.SetNodeV2EmailLink(store.NodeV2EmailLinkInput{CompanyID: companyID, NodeID: nodeID, TextboxID: textboxID, EmailThreadID: request.EmailThreadID, EmailMessageID: request.EmailMessageID, ActorUserID: actorID, Deleted: request.Deleted || r.Method == http.MethodDelete, IdempotencyKey: request.IdempotencyKey})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleNodeV2Emails(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, _, ok := s.nodeV2RequestActor(w, r, nodeID, false)
	if !ok {
		return
	}
	cursor, err := decodeNodeV2CursorFor(r.URL.Query().Get("cursor"), "node_v2_email_threads")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	page, err := s.repo.ListNodeV2EmailThreads(store.NodeV2AggregateQuery{CompanyID: companyID, NodeID: nodeID, Limit: nodeV2Limit(r), Cursor: cursor})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleNodeV2EmailMessages(w http.ResponseWriter, r *http.Request, nodeID, emailThreadID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	companyID, _, ok := s.nodeV2RequestActor(w, r, nodeID, false)
	if !ok {
		return
	}
	cursor, err := decodeNodeV2CursorFor(r.URL.Query().Get("cursor"), "node_v2_email_messages")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	page, err := s.repo.ListNodeV2EmailMessages(store.NodeV2EmailMessageQuery{CompanyID: companyID, NodeID: nodeID, EmailThreadID: emailThreadID, Limit: nodeV2Limit(r), Cursor: cursor, IncludeBody: r.URL.Query().Get("include_body") == "1"})
	if err != nil {
		writeNodeV2StoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
