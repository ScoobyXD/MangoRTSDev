package httpapi

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"time"
)

var (
	errChatCommentNotFound     = errors.New("chat comment not found")
	errChatCommentAuthorDenied = errors.New("chat comment author denied")
	errChatCommentInvalid      = errors.New("chat comment invalid")
)

type chatCommentEntityLink struct {
	Start      int    `json:"start"`
	End        int    `json:"end"`
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id"`
	Label      string `json:"label"`
}

type chatCommentEditRequest struct {
	CompanyID         string                   `json:"company_id"`
	Message           *string                  `json:"message"`
	EntityLinks       *[]chatCommentEntityLink `json:"entity_links"`
	MentionedUserIDs  []string                 `json:"mentioned_user_ids"`
	MentionedGroupIDs []string                 `json:"mentioned_group_ids"`
}

func uniqueChatCommentIDs(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func cleanChatCommentEntityLinks(values []chatCommentEntityLink) []chatCommentEntityLink {
	result := make([]chatCommentEntityLink, 0, len(values))
	for _, value := range values {
		value.EntityType = strings.TrimSpace(value.EntityType)
		value.EntityID = strings.TrimSpace(value.EntityID)
		value.Label = strings.TrimSpace(value.Label)
		if value.Start < 0 || value.End <= value.Start || value.EntityID == "" || value.Label == "" {
			continue
		}
		switch value.EntityType {
		case "node", "logic_gate", "project", "entity":
		default:
			continue
		}
		result = append(result, value)
	}
	return result
}

func chatCommentPayloadAuthorID(information string) string {
	var payload struct {
		AuthorID string `json:"author_id"`
	}
	if json.Unmarshal([]byte(information), &payload) != nil {
		return ""
	}
	return strings.TrimSpace(payload.AuthorID)
}

func chatCommentOwnedBy(information, actorUserID string) bool {
	authorUserID := chatCommentPayloadAuthorID(information)
	actorUserID = strings.TrimSpace(actorUserID)
	return authorUserID != "" && actorUserID != "" && authorUserID == actorUserID
}

func editChatCommentInformation(
	infoType string,
	information string,
	actorUserID string,
	message *string,
	entityLinks *[]chatCommentEntityLink,
	mentionedUserIDs []string,
	mentionedGroupIDs []string,
) (string, string, error) {
	if strings.TrimSpace(infoType) != store.CommunicationsEmailCollaborationChatInformationType || message == nil {
		return "", "", errChatCommentInvalid
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(information), &payload); err != nil || payload == nil {
		return "", "", errChatCommentInvalid
	}
	if !chatCommentOwnedBy(information, actorUserID) {
		return "", "", errChatCommentAuthorDenied
	}
	blockID, _ := payload["block_id"].(string)
	blockID = strings.TrimSpace(blockID)
	if blockID == "" {
		return "", "", errChatCommentInvalid
	}
	cleanMessage := strings.TrimSpace(*message)
	attachments, _ := payload["attachments"].([]any)
	if cleanMessage == "" && len(attachments) == 0 {
		return "", "", errChatCommentInvalid
	}
	payload["message"] = cleanMessage
	if entityLinks != nil {
		payload["entity_links"] = cleanChatCommentEntityLinks(*entityLinks)
	}
	payload["mentioned_user_ids"] = uniqueChatCommentIDs(mentionedUserIDs)
	payload["mentioned_group_ids"] = uniqueChatCommentIDs(mentionedGroupIDs)
	payload["edited_timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)
	updated, err := json.Marshal(payload)
	if err != nil {
		return "", "", errChatCommentInvalid
	}
	return string(updated), blockID, nil
}

func writeChatCommentEditError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, errChatCommentNotFound):
		writeError(w, http.StatusNotFound, "chat_comment_not_found")
	case errors.Is(err, errChatCommentAuthorDenied):
		writeError(w, http.StatusForbidden, "chat_comment_author_required")
	case errors.Is(err, errChatCommentInvalid), errors.Is(err, store.ErrInvalid), errors.Is(err, store.ErrPrincipalNotInCompany):
		writeError(w, http.StatusBadRequest, "invalid_chat_comment_edit")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "chat_comment_not_found")
	default:
		writeError(w, http.StatusInternalServerError, fallback)
	}
}

func findNodeChatComment(items []domain.NodeProjection, informationID string) (domain.NodeProjection, bool) {
	informationID = strings.TrimSpace(informationID)
	for _, item := range items {
		if strings.TrimSpace(item.InformationID) == informationID && strings.TrimSpace(item.Type) == store.CommunicationsEmailCollaborationChatInformationType {
			return item, true
		}
	}
	return domain.NodeProjection{}, false
}

func findProjectChatComment(items []domain.ProjectProjection, informationID string) (domain.ProjectProjection, bool) {
	informationID = strings.TrimSpace(informationID)
	for _, item := range items {
		if strings.TrimSpace(item.InformationID) == informationID && strings.TrimSpace(item.Type) == store.CommunicationsEmailCollaborationChatInformationType {
			return item, true
		}
	}
	return domain.ProjectProjection{}, false
}

func (s *Server) handleNodeChatCommentEdit(w http.ResponseWriter, r *http.Request, nodeID, informationID string) {
	var req chatCommentEditRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if req.CompanyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeNode, nodeID, "node_not_found") {
		return
	}
	actorUserID, actorLabel := nodeChangeActorPayload(r)
	projections, err := s.repo.ListNodeProjections(req.CompanyID, nodeID)
	if err != nil {
		writeChatCommentEditError(w, err, "failed_to_load_chat_comment")
		return
	}
	existing, found := findNodeChatComment(projections, informationID)
	if !found {
		writeChatCommentEditError(w, errChatCommentNotFound, "failed_to_load_chat_comment")
		return
	}
	if !requireMailboxInformationAccess(w, r, existing.Type, existing.Information) {
		return
	}
	updatedInformation, _, err := editChatCommentInformation(existing.Type, existing.Information, actorUserID, req.Message, req.EntityLinks, req.MentionedUserIDs, req.MentionedGroupIDs)
	if err != nil {
		writeChatCommentEditError(w, err, "failed_to_edit_chat_comment")
		return
	}
	input := store.NodeInformationInput{
		CompanyID: req.CompanyID, NodeID: nodeID, Type: existing.Type, Information: updatedInformation,
		InformationID: existing.InformationID, ActorUserID: actorUserID, ActorDisplayName: actorLabel,
	}
	projection, err := s.repo.UpsertNodeProjectionWithActor(input)
	if err != nil {
		writeChatCommentEditError(w, err, "failed_to_edit_chat_comment")
		return
	}
	s.wakeAttachmentDeletionCleanup()

	s.recordMentionNotifications(r, req.CompanyID, "node", nodeID, informationID, existing.Type, updatedInformation)
	s.publishWorkspaceEvent(req.CompanyID, "node_chat_comment_updated", map[string]any{"node_id": nodeID, "information_id": informationID})
	writeJSON(w, http.StatusOK, projection)
}

func (s *Server) handleProjectChatCommentEdit(w http.ResponseWriter, r *http.Request, projectID, informationID string) {
	var req chatCommentEditRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	if req.CompanyID == "" {
		writeError(w, http.StatusBadRequest, "company_id_required")
		return
	}
	if !s.requireEntityEdit(w, r, req.CompanyID, store.EntityTypeProject, projectID, "project_not_found") {
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	projections, err := s.repo.ListProjectProjections(req.CompanyID, projectID)
	if err != nil {
		writeChatCommentEditError(w, err, "failed_to_load_chat_comment")
		return
	}
	existing, found := findProjectChatComment(projections, informationID)
	if !found {
		writeChatCommentEditError(w, errChatCommentNotFound, "failed_to_load_chat_comment")
		return
	}
	if !requireMailboxInformationAccess(w, r, existing.Type, existing.Information) {
		return
	}
	updatedInformation, _, err := editChatCommentInformation(existing.Type, existing.Information, actor.User.UserID, req.Message, req.EntityLinks, req.MentionedUserIDs, req.MentionedGroupIDs)
	if err != nil {
		writeChatCommentEditError(w, err, "failed_to_edit_chat_comment")
		return
	}
	item, err := s.repo.AddProjectInformation(store.ProjectInformationInput{
		CompanyID: req.CompanyID, ProjectID: projectID, InformationID: informationID,
		Type: existing.Type, Information: updatedInformation, ActorUserID: actor.User.UserID,
	})
	if err != nil {
		writeChatCommentEditError(w, err, "failed_to_edit_chat_comment")
		return
	}
	s.wakeAttachmentDeletionCleanup()
	s.publishWorkspaceEvent(req.CompanyID, "project_chat_comment_updated", map[string]any{"project_id": projectID, "information_id": informationID})
	writeJSON(w, http.StatusOK, item)
}
