package store

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

const (
	CommunicationsEmailCollaborationScopePersonal = "personal"
	CommunicationsEmailCollaborationScopeShared   = "shared"

	CommunicationsEmailCollaborationParticipantCreator = "creator"
	CommunicationsEmailCollaborationParticipantUser    = "user"
	CommunicationsEmailCollaborationParticipantGroup   = "group"

	CommunicationsEmailCollaborationChatInformationType = "Text block chat"
)

// ErrNotEmailCollaboration lets node handlers fall back to the ordinary node
// write path without conflating a normal node with a missing collaboration
// participant or another authorization failure.
var ErrNotEmailCollaboration = errors.New("not an email collaboration")

type CommunicationsEmailCollaborationEnsureInput struct {
	CompanyID            string
	PersonalUserID       string
	PersonalAccountEmail string
	SharedInboxID        string
	AccountEmail         string
	Provider             string
	CreatedByUserID      string
	Priority             *int
	Message              domain.EmailMessageSnapshot
}

type CommunicationsEmailCollaborationEnsureResult struct {
	Collaboration domain.CommunicationsEmailCollaboration `json:"collaboration"`
	Created       bool                                    `json:"created"`
}

type CommunicationsEmailCollaborationResolveInput struct {
	CompanyID            string
	ParticipantUserID    string
	PersonalUserID       string
	PersonalAccountEmail string
	SharedInboxID        string
	MessageID            string
	ThreadID             string
}

type CommunicationsEmailCollaborationParticipantInput struct {
	CompanyID         string
	CollaborationID   string
	ActorUserID       string
	MentionedUserIDs  []string
	MentionedGroupIDs []string
}

type CommunicationsEmailCollaborationNodeParticipantInput struct {
	CompanyID         string
	NodeID            string
	ActorUserID       string
	MentionedUserIDs  []string
	MentionedGroupIDs []string
}

type CommunicationsEmailCollaborationParticipantResult struct {
	CollaborationID  string                                               `json:"collaboration_id"`
	NodeID           string                                               `json:"node_id"`
	Participants     []domain.CommunicationsEmailCollaborationParticipant `json:"participants"`
	MentionedUserIDs []string                                             `json:"mentioned_user_ids"`
}

// CommunicationsEmailCollaborationInformationWriteResult is returned by the
// atomic append-only chat path. Participant snapshots and their durable edit
// grants commit in the same transaction/lock as Information.
type CommunicationsEmailCollaborationInformationWriteResult struct {
	Information      domain.NodeInformation `json:"information"`
	CollaborationID  string                 `json:"collaboration_id"`
	MentionedUserIDs []string               `json:"mentioned_user_ids"`
}

// CommunicationsEmailCollaborationProjectionWriteResult is the projection
// equivalent of CommunicationsEmailCollaborationInformationWriteResult.
type CommunicationsEmailCollaborationProjectionWriteResult struct {
	Projection       domain.NodeProjection `json:"projection"`
	CollaborationID  string                `json:"collaboration_id"`
	MentionedUserIDs []string              `json:"mentioned_user_ids"`
}

type communicationsEmailCollaborationScope struct {
	scopeType            string
	personalUserID       string
	personalAccountEmail string
	sharedInboxID        string
	accountEmail         string
}

func communicationsEmailCollaborationScopeLockKey(companyID string, scope communicationsEmailCollaborationScope) string {
	if scope.scopeType == CommunicationsEmailCollaborationScopePersonal {
		return strings.Join([]string{"communications-email-collaboration", companyID, scope.scopeType, scope.personalUserID, scope.personalAccountEmail}, "\x1f")
	}
	return strings.Join([]string{"communications-email-collaboration", companyID, scope.scopeType, scope.sharedInboxID}, "\x1f")
}

func normalizeCommunicationsEmailCollaborationScope(companyID, personalUserID, personalAccountEmail, sharedInboxID, accountEmail string) (string, communicationsEmailCollaborationScope, error) {
	companyID = cleanUUIDText(companyID)
	personalUserID = cleanUUIDText(personalUserID)
	personalAccountEmail = normalizeEmail(personalAccountEmail)
	sharedInboxID = cleanUUIDText(sharedInboxID)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" {
		return "", communicationsEmailCollaborationScope{}, ErrInvalid
	}
	if personalUserID != "" && personalAccountEmail != "" && sharedInboxID == "" {
		if accountEmail == "" {
			accountEmail = personalAccountEmail
		}
		return companyID, communicationsEmailCollaborationScope{
			scopeType:            CommunicationsEmailCollaborationScopePersonal,
			personalUserID:       personalUserID,
			personalAccountEmail: personalAccountEmail,
			accountEmail:         accountEmail,
		}, nil
	}
	if personalUserID == "" && personalAccountEmail == "" && sharedInboxID != "" && accountEmail != "" {
		return companyID, communicationsEmailCollaborationScope{
			scopeType:     CommunicationsEmailCollaborationScopeShared,
			sharedInboxID: sharedInboxID,
			accountEmail:  accountEmail,
		}, nil
	}
	return "", communicationsEmailCollaborationScope{}, ErrInvalid
}

func normalizeCommunicationsEmailCollaborationEnsureInput(input CommunicationsEmailCollaborationEnsureInput) (CommunicationsEmailCollaborationEnsureInput, communicationsEmailCollaborationScope, error) {
	companyID, scope, err := normalizeCommunicationsEmailCollaborationScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID, input.AccountEmail)
	if err != nil {
		return CommunicationsEmailCollaborationEnsureInput{}, communicationsEmailCollaborationScope{}, err
	}
	message := normalizeEmailMessageSnapshot(input.Message)
	creatorID := cleanUUIDText(input.CreatedByUserID)
	if creatorID == "" || message.ID == "" {
		return CommunicationsEmailCollaborationEnsureInput{}, communicationsEmailCollaborationScope{}, ErrInvalid
	}
	if input.Priority != nil && (*input.Priority < 1 || *input.Priority > 5) {
		return CommunicationsEmailCollaborationEnsureInput{}, communicationsEmailCollaborationScope{}, ErrInvalid
	}
	input.CompanyID = companyID
	input.PersonalUserID = scope.personalUserID
	input.PersonalAccountEmail = scope.personalAccountEmail
	input.SharedInboxID = scope.sharedInboxID
	input.AccountEmail = scope.accountEmail
	input.Provider = normalizeEmailProvider(input.Provider)
	if input.Provider == "" {
		return CommunicationsEmailCollaborationEnsureInput{}, communicationsEmailCollaborationScope{}, ErrInvalid
	}
	input.CreatedByUserID = creatorID
	input.Message = message
	return input, scope, nil
}

func normalizeCommunicationsEmailCollaborationResolveInput(input CommunicationsEmailCollaborationResolveInput) (CommunicationsEmailCollaborationResolveInput, communicationsEmailCollaborationScope, error) {
	accountEmail := input.PersonalAccountEmail
	if strings.TrimSpace(input.SharedInboxID) != "" {
		// Shared resolution is keyed by the immutable shared inbox id; its
		// account address is not needed to find the existing record.
		accountEmail = "shared@scope.invalid"
	}
	companyID, scope, err := normalizeCommunicationsEmailCollaborationScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID, accountEmail)
	if err != nil {
		return CommunicationsEmailCollaborationResolveInput{}, communicationsEmailCollaborationScope{}, err
	}
	input.CompanyID = companyID
	input.PersonalUserID = scope.personalUserID
	input.PersonalAccountEmail = scope.personalAccountEmail
	input.SharedInboxID = scope.sharedInboxID
	input.ParticipantUserID = cleanUUIDText(input.ParticipantUserID)
	input.MessageID = strings.TrimSpace(input.MessageID)
	input.ThreadID = strings.TrimSpace(input.ThreadID)
	if input.ParticipantUserID == "" || (input.MessageID == "" && input.ThreadID == "") {
		return CommunicationsEmailCollaborationResolveInput{}, communicationsEmailCollaborationScope{}, ErrInvalid
	}
	return input, scope, nil
}

func cleanCollaborationPrincipalIDs(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = cleanUUIDText(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func normalizeCommunicationsEmailCollaborationParticipantInput(input CommunicationsEmailCollaborationParticipantInput) (CommunicationsEmailCollaborationParticipantInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.CollaborationID = cleanUUIDText(input.CollaborationID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.MentionedUserIDs = cleanCollaborationPrincipalIDs(input.MentionedUserIDs)
	input.MentionedGroupIDs = cleanCollaborationPrincipalIDs(input.MentionedGroupIDs)
	if input.CompanyID == "" || input.CollaborationID == "" || input.ActorUserID == "" {
		return CommunicationsEmailCollaborationParticipantInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeCommunicationsEmailCollaborationNodeParticipantInput(input CommunicationsEmailCollaborationNodeParticipantInput) (CommunicationsEmailCollaborationNodeParticipantInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.NodeID = cleanUUIDText(input.NodeID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.MentionedUserIDs = cleanCollaborationPrincipalIDs(input.MentionedUserIDs)
	input.MentionedGroupIDs = cleanCollaborationPrincipalIDs(input.MentionedGroupIDs)
	if input.CompanyID == "" || input.NodeID == "" || input.ActorUserID == "" {
		return CommunicationsEmailCollaborationNodeParticipantInput{}, ErrInvalid
	}
	return input, nil
}

// CommunicationsEmailChatMentionPrincipalIDs reads the explicit principal ids
// embedded in the shared Text block chat JSON. The explicit ids make group
// mention expansion deterministic and avoid relying on mutable display names.
func CommunicationsEmailChatMentionPrincipalIDs(information string) ([]string, []string) {
	var payload struct {
		MentionedUserIDs  []string `json:"mentioned_user_ids"`
		MentionedGroupIDs []string `json:"mentioned_group_ids"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(information)), &payload) != nil {
		return []string{}, []string{}
	}
	return cleanCollaborationPrincipalIDs(payload.MentionedUserIDs), cleanCollaborationPrincipalIDs(payload.MentionedGroupIDs)
}

func communicationsEmailCollaborationTitle(message domain.EmailMessageSnapshot) string {
	title := strings.TrimSpace(message.Subject)
	if title == "" {
		title = "Email conversation"
	}
	return title
}

func communicationsEmailAttachedProjectionPayload(informationID, collaborationID string, input CommunicationsEmailCollaborationEnsureInput) string {
	payload := map[string]any{
		"block_id":           informationID,
		"collaboration_id":   collaborationID,
		"created_from_email": true,
		"message_id":         input.Message.ID,
		"thread_id":          input.Message.ThreadID,
		"shared_inbox_id":    input.SharedInboxID,
		"account_email":      input.AccountEmail,
		"subject":            input.Message.Subject,
		"snippet":            input.Message.Snippet,
		"date":               input.Message.Date,
		"attached_timestamp": "",
	}
	if len(input.Message.From) > 0 {
		payload["from"] = input.Message.From[0].Email
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func communicationsEmailAttachedProjectionPayloadWithThread(informationID, collaborationID, emailThreadID string, input CommunicationsEmailCollaborationEnsureInput) string {
	var payload map[string]any
	_ = json.Unmarshal([]byte(communicationsEmailAttachedProjectionPayload(informationID, collaborationID, input)), &payload)
	payload["email_thread_id"] = strings.TrimSpace(emailThreadID)
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func emailMessageSnapshotHasRenderableContent(message domain.EmailMessageSnapshot) bool {
	return strings.TrimSpace(message.Subject) != "" ||
		strings.TrimSpace(message.Snippet) != "" ||
		strings.TrimSpace(message.Body) != "" ||
		len(message.From) > 0 ||
		len(message.To) > 0 ||
		len(message.Cc) > 0 ||
		len(message.Bcc) > 0 ||
		len(message.ReplyTo) > 0 ||
		len(message.Folders) > 0 ||
		len(message.FolderIDs) > 0
}

func shouldAdvanceEmailCollaborationMessage(existing, incoming domain.EmailMessageSnapshot) bool {
	if strings.TrimSpace(existing.ID) == strings.TrimSpace(incoming.ID) {
		return emailMessageSnapshotHasRenderableContent(incoming)
	}
	return incoming.Date > 0 && incoming.Date >= existing.Date
}

func mergeEmailMessageSnapshot(existing, incoming domain.EmailMessageSnapshot) domain.EmailMessageSnapshot {
	merged := existing
	if strings.TrimSpace(incoming.ID) != "" {
		merged.ID = strings.TrimSpace(incoming.ID)
	}
	if strings.TrimSpace(incoming.ThreadID) != "" {
		merged.ThreadID = strings.TrimSpace(incoming.ThreadID)
	}
	if strings.TrimSpace(incoming.Subject) != "" {
		merged.Subject = incoming.Subject
	}
	if strings.TrimSpace(incoming.Snippet) != "" {
		merged.Snippet = incoming.Snippet
	}
	if strings.TrimSpace(incoming.Body) != "" {
		merged.Body = incoming.Body
	}
	if incoming.Date > 0 {
		merged.Date = incoming.Date
	}
	if len(incoming.From) > 0 {
		merged.From = incoming.From
	}
	if len(incoming.To) > 0 {
		merged.To = incoming.To
	}
	if len(incoming.Cc) > 0 {
		merged.Cc = incoming.Cc
	}
	if len(incoming.Bcc) > 0 {
		merged.Bcc = incoming.Bcc
	}
	if len(incoming.ReplyTo) > 0 {
		merged.ReplyTo = incoming.ReplyTo
	}
	if len(incoming.Attachments) > 0 {
		merged.Attachments = incoming.Attachments
	}
	if len(incoming.Folders) > 0 {
		merged.Folders = incoming.Folders
	}
	if len(incoming.FolderIDs) > 0 {
		merged.FolderIDs = incoming.FolderIDs
	}
	if emailMessageSnapshotHasRenderableContent(incoming) {
		merged.Unread = incoming.Unread
		merged.Starred = incoming.Starred
	}
	merged.DownloadComplete = existing.DownloadComplete || incoming.DownloadComplete
	return merged
}
