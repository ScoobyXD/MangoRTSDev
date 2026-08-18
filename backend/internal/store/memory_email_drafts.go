package store

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

func (r *MemoryRepo) ListCommunicationsEmailDrafts(input CommunicationsEmailDraftListInput) ([]domain.CommunicationsEmailDraft, error) {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return nil, ErrInvalid
	}
	kind, sourceMessageIDs, err := normalizeCommunicationsEmailDraftListFilters(input.Kind, input.SourceMessageIDs)
	if err != nil {
		return nil, err
	}
	sourceMessageIDSet := make(map[string]struct{}, len(sourceMessageIDs))
	for _, sourceMessageID := range sourceMessageIDs {
		sourceMessageIDSet[sourceMessageID] = struct{}{}
	}
	companyID := scope.companyID

	r.mu.RLock()
	defer r.mu.RUnlock()

	if _, ok := r.companies[companyID]; !ok {
		return nil, ErrNotFound
	}
	drafts := make([]domain.CommunicationsEmailDraft, 0)
	for _, draft := range r.emailDrafts {
		if draft.CompanyID != companyID || draft.DeletedTimestamp != nil {
			continue
		}
		include := scope.matchesDraft(draft)
		if strings.TrimSpace(input.ParticipantUserID) != "" {
			include = include && draft.CreatedByUserID == strings.TrimSpace(input.ParticipantUserID)
		}
		if kind != "" {
			include = include && draft.Kind == kind
		}
		if len(sourceMessageIDSet) > 0 {
			_, sourceMatches := sourceMessageIDSet[draft.SourceMessageID]
			include = include && sourceMatches
		}
		if include {
			drafts = append(drafts, draft)
		}
	}
	sort.SliceStable(drafts, func(i, j int) bool {
		if drafts[i].UpdatedTimestamp.Equal(drafts[j].UpdatedTimestamp) {
			return drafts[i].DraftID < drafts[j].DraftID
		}
		return drafts[i].UpdatedTimestamp.After(drafts[j].UpdatedTimestamp)
	})
	return drafts, nil
}

func (r *MemoryRepo) GetCommunicationsEmailDraft(input CommunicationsEmailDraftGetInput) (domain.CommunicationsEmailDraft, error) {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	companyID := scope.companyID
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	draft, ok := r.emailDrafts[communicationsEmailDraftKey(companyID, draftID)]
	authorized := ok && scope.matchesDraft(draft)
	if strings.TrimSpace(input.ParticipantUserID) != "" {
		authorized = authorized && draft.CreatedByUserID == strings.TrimSpace(input.ParticipantUserID)
	}
	if !authorized || draft.DeletedTimestamp != nil {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	return draft, nil
}

func (r *MemoryRepo) UpsertCommunicationsEmailDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.validateCommunicationsEmailDraftScopeLocked(draft); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	existing, exists := r.emailDrafts[communicationsEmailDraftKey(draft.CompanyID, draft.DraftID)]
	if input.ExistingOnly {
		if !exists || existing.DeletedTimestamp != nil || !communicationsEmailDraftScopesMatch(existing, draft) ||
			existing.CreatedByUserID != draft.CreatedByUserID || existing.Kind != draft.Kind ||
			existing.SourceMessageID != draft.SourceMessageID {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
		if err := r.prepareCommunicationsEmailDraftSourceLocked(&draft); err != nil {
			return domain.CommunicationsEmailDraft{}, err
		}
		now := time.Now().UTC()
		draft.CreatedTimestamp = existing.CreatedTimestamp
		draft.CreatedByUserID = existing.CreatedByUserID
		draft.UpdatedTimestamp = now
		draft.DeletedTimestamp = nil
		r.emailDrafts[communicationsEmailDraftKey(draft.CompanyID, draft.DraftID)] = draft
		return draft, nil
	}
	if exists && (!communicationsEmailDraftScopesMatch(existing, draft) || existing.CreatedByUserID != draft.CreatedByUserID ||
		existing.Kind != draft.Kind || existing.SourceMessageID != draft.SourceMessageID) {
		return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
	}
	if err := r.prepareCommunicationsEmailDraftSourceLocked(&draft); err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	if draft.SourceMessageID != "" {
		for _, candidate := range r.emailDrafts {
			if candidate.DraftID != draft.DraftID && communicationsEmailDraftSemanticIdentityMatches(candidate, draft) {
				return domain.CommunicationsEmailDraft{}, ErrEmailDraftIdentityConflict
			}
		}
	}
	now := time.Now().UTC()
	if !exists {
		draft.CreatedTimestamp = now
	} else {
		draft.CreatedTimestamp = existing.CreatedTimestamp
		draft.CreatedByUserID = existing.CreatedByUserID
	}
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = nil
	r.emailDrafts[communicationsEmailDraftKey(draft.CompanyID, draft.DraftID)] = draft
	return draft, nil
}

func (r *MemoryRepo) EnsureCommunicationsEmailReplyDraft(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, bool, error) {
	input.DraftID = "draft:reply:" + newUUIDv7String()
	input.Kind = "reply"
	input.ReplyToMessageJSON = "{}"
	draft, err := normalizeCommunicationsEmailDraftInput(input)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	if cleanUUIDText(draft.CreatedByUserID) == "" {
		return domain.CommunicationsEmailDraft{}, false, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.validateCommunicationsEmailDraftScopeLocked(draft); err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	for _, existing := range r.emailDrafts {
		if !communicationsEmailDraftSemanticIdentityMatches(existing, draft) {
			continue
		}
		if existing.Kind != "reply" {
			return domain.CommunicationsEmailDraft{}, false, ErrEmailDraftIdentityConflict
		}
		if err := r.prepareCommunicationsEmailDraftSourceLocked(&existing); err != nil {
			return domain.CommunicationsEmailDraft{}, false, err
		}
		return existing, false, nil
	}
	if err := r.prepareCommunicationsEmailDraftSourceLocked(&draft); err != nil {
		return domain.CommunicationsEmailDraft{}, false, err
	}
	now := time.Now().UTC()
	draft.CreatedTimestamp = now
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = nil
	r.emailDrafts[communicationsEmailDraftKey(draft.CompanyID, draft.DraftID)] = draft
	return draft, true, nil
}

func (r *MemoryRepo) validateCommunicationsEmailDraftScopeLocked(draft domain.CommunicationsEmailDraft) error {
	if _, ok := r.companies[draft.CompanyID]; !ok {
		return ErrNotFound
	}
	if draft.ScopeType == "personal" {
		if _, ok := r.emailConnections[emailConnectionKey(draft.PersonalUserID, draft.PersonalAccountEmail)]; !ok {
			return ErrNotFound
		}
		return nil
	}
	folder, ok := r.folders[key(draft.CompanyID, draft.SharedInboxID)]
	if !ok || CommunicationsSharedInboxResourceType(folder) != EntityTypeSharedInbox {
		return ErrNotFound
	}
	return nil
}

func (r *MemoryRepo) prepareCommunicationsEmailDraftSourceLocked(draft *domain.CommunicationsEmailDraft) error {
	if draft.Kind == "reply" {
		draft.ReplyToMessageJSON = "{}"
	}
	if draft.SourceMessageID == "" {
		return nil
	}
	for _, thread := range r.emailThreads {
		if thread.CompanyID != draft.CompanyID || thread.ScopeType != draft.ScopeType ||
			(draft.ScopeType == "personal" && (thread.PersonalUserID != draft.PersonalUserID || thread.PersonalAccountEmail != draft.PersonalAccountEmail)) ||
			(draft.ScopeType == "shared" && thread.SharedInboxID != draft.SharedInboxID) {
			continue
		}
		for _, message := range thread.Messages {
			if message.EmailMessageID != draft.SourceMessageID {
				continue
			}
			if draft.Kind == "reply" {
				payload, err := json.Marshal(map[string]string{
					"id": message.ProviderMessageID, "email_message_id": message.EmailMessageID,
					"thread_id": thread.ProviderThreadID,
				})
				if err != nil {
					return err
				}
				draft.ReplyToMessageJSON = string(payload)
			}
			return nil
		}
	}
	return ErrEmailDraftSourceNotFound
}

func communicationsEmailDraftSemanticIdentityMatches(left, right domain.CommunicationsEmailDraft) bool {
	return left.DeletedTimestamp == nil && left.CompanyID == right.CompanyID &&
		left.CreatedByUserID == right.CreatedByUserID && left.SourceMessageID == right.SourceMessageID &&
		communicationsEmailDraftScopesMatch(left, right)
}

func (r *MemoryRepo) SoftDeleteCommunicationsEmailDraft(input CommunicationsEmailDraftDeleteInput) error {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return err
	}
	companyID := scope.companyID
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	key := communicationsEmailDraftKey(companyID, draftID)
	draft, ok := r.emailDrafts[key]
	authorized := ok && scope.matchesDraft(draft)
	if strings.TrimSpace(input.ParticipantUserID) != "" {
		authorized = authorized && draft.CreatedByUserID == strings.TrimSpace(input.ParticipantUserID)
	}
	if !authorized || draft.DeletedTimestamp != nil {
		return ErrNotFound
	}
	now := time.Now().UTC()
	draft.UpdatedByUserID = strings.TrimSpace(input.UpdatedByUserID)
	draft.UpdatedTimestamp = now
	draft.DeletedTimestamp = &now
	r.emailDrafts[key] = draft
	return nil
}

func (r *MemoryRepo) GetCommunicationsEmailSignature(input CommunicationsEmailSignatureScopeInput) (domain.CommunicationsEmailSignature, error) {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	var found domain.CommunicationsEmailSignature
	for _, signature := range r.emailSignatures {
		if signature.CompanyID != scope.companyID {
			continue
		}
		if scope.matchesSignature(signature) && (found.SignatureID == "" || signature.UpdatedTimestamp.After(found.UpdatedTimestamp)) {
			found = signature
		}
	}
	if found.SignatureID == "" {
		return domain.CommunicationsEmailSignature{}, ErrNotFound
	}
	return found, nil
}

func (r *MemoryRepo) UpsertCommunicationsEmailSignature(input CommunicationsEmailSignatureInput) (domain.CommunicationsEmailSignature, error) {
	signature, err := normalizeCommunicationsEmailSignatureInput(input)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.companies[signature.CompanyID]; !ok {
		return domain.CommunicationsEmailSignature{}, ErrNotFound
	}
	if signature.ScopeType == "personal" {
		if _, ok := r.emailConnections[emailConnectionKey(signature.PersonalUserID, signature.PersonalAccountEmail)]; !ok {
			return domain.CommunicationsEmailSignature{}, ErrNotFound
		}
	} else if _, ok := r.folders[key(signature.CompanyID, signature.SharedInboxID)]; !ok {
		return domain.CommunicationsEmailSignature{}, ErrNotFound
	}

	now := time.Now().UTC()
	existing := r.emailSignatures[communicationsEmailSignatureKey(signature.CompanyID, signature.SignatureID)]
	if existing.CreatedTimestamp.IsZero() {
		signature.CreatedTimestamp = now
	} else {
		signature.CreatedTimestamp = existing.CreatedTimestamp
		if strings.TrimSpace(signature.CreatedByUserID) == "" {
			signature.CreatedByUserID = existing.CreatedByUserID
		}
	}
	signature.UpdatedTimestamp = now
	r.emailSignatures[communicationsEmailSignatureKey(signature.CompanyID, signature.SignatureID)] = signature
	return signature, nil
}

type communicationsEmailScope struct {
	companyID            string
	scopeType            string
	personalUserID       string
	personalAccountEmail string
	sharedInboxID        string
}

func normalizeCommunicationsEmailDraftInput(input CommunicationsEmailDraftInput) (domain.CommunicationsEmailDraft, error) {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	kind := normalizeCommunicationsEmailDraftKind(input.Kind)
	if kind == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	sourceMessageID := cleanUUIDText(input.SourceMessageID)
	if strings.TrimSpace(input.SourceMessageID) != "" && sourceMessageID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}
	if kind == "reply" && sourceMessageID == "" {
		return domain.CommunicationsEmailDraft{}, ErrEmailReplySourceNotIngested
	}
	replyToJSON := strings.TrimSpace(input.ReplyToMessageJSON)
	if replyToJSON == "" {
		replyToJSON = "{}"
	}
	return domain.CommunicationsEmailDraft{
		CompanyID:              scope.companyID,
		DraftID:                draftID,
		ScopeType:              scope.scopeType,
		PersonalUserID:         scope.personalUserID,
		PersonalAccountEmail:   scope.personalAccountEmail,
		SharedInboxID:          scope.sharedInboxID,
		CreatedByUserID:        strings.TrimSpace(input.CreatedByUserID),
		UpdatedByUserID:        strings.TrimSpace(input.UpdatedByUserID),
		Kind:                   kind,
		SourceMessageID:        sourceMessageID,
		AccountEmail:           normalizeEmail(input.AccountEmail),
		ToRecipients:           input.ToRecipients,
		CcRecipients:           input.CcRecipients,
		BccRecipients:          input.BccRecipients,
		Subject:                input.Subject,
		BodyEditorHTML:         input.BodyEditorHTML,
		ReplyToMessageJSON:     replyToJSON,
		ScheduledSendTimestamp: input.ScheduledSendTimestamp,
	}, nil
}

func normalizeCommunicationsEmailDraftListFilters(kindInput string, sourceMessageIDInputs []string) (string, []string, error) {
	kind := strings.ToLower(strings.TrimSpace(kindInput))
	if kind != "" {
		kind = normalizeCommunicationsEmailDraftKind(kind)
		if kind == "" {
			return "", nil, ErrInvalid
		}
	}
	if len(sourceMessageIDInputs) > CommunicationsEmailDraftSourceFilterMax {
		return "", nil, ErrInvalid
	}
	sourceMessageIDs := make([]string, 0, len(sourceMessageIDInputs))
	seen := make(map[string]struct{}, len(sourceMessageIDInputs))
	for _, sourceMessageIDInput := range sourceMessageIDInputs {
		sourceMessageID := cleanUUIDText(sourceMessageIDInput)
		if sourceMessageID == "" {
			return "", nil, ErrInvalid
		}
		if _, exists := seen[sourceMessageID]; exists {
			continue
		}
		seen[sourceMessageID] = struct{}{}
		sourceMessageIDs = append(sourceMessageIDs, sourceMessageID)
	}
	return kind, sourceMessageIDs, nil
}

func normalizeCommunicationsEmailSignatureInput(input CommunicationsEmailSignatureInput) (domain.CommunicationsEmailSignature, error) {
	scope, err := normalizeCommunicationsEmailScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailSignature{}, err
	}
	signatureID := strings.TrimSpace(input.SignatureID)
	if signatureID == "" {
		signatureID = communicationsEmailSignatureID(scope)
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "Default"
	}
	return domain.CommunicationsEmailSignature{
		CompanyID:            scope.companyID,
		SignatureID:          signatureID,
		ScopeType:            scope.scopeType,
		PersonalUserID:       scope.personalUserID,
		PersonalAccountEmail: scope.personalAccountEmail,
		SharedInboxID:        scope.sharedInboxID,
		Name:                 name,
		BodyEditorHTML:       input.BodyEditorHTML,
		IsDefault:            input.IsDefault,
		CreatedByUserID:      strings.TrimSpace(input.CreatedByUserID),
		UpdatedByUserID:      strings.TrimSpace(input.UpdatedByUserID),
	}, nil
}

func normalizeCommunicationsEmailScope(companyID, personalUserID, personalAccountEmail, sharedInboxID string) (communicationsEmailScope, error) {
	scope := communicationsEmailScope{
		companyID:            strings.TrimSpace(companyID),
		personalUserID:       strings.TrimSpace(personalUserID),
		personalAccountEmail: normalizeEmail(personalAccountEmail),
		sharedInboxID:        strings.TrimSpace(sharedInboxID),
	}
	if scope.companyID == "" {
		return communicationsEmailScope{}, ErrInvalid
	}
	if scope.sharedInboxID != "" {
		if scope.personalUserID != "" || scope.personalAccountEmail != "" {
			return communicationsEmailScope{}, ErrInvalid
		}
		scope.scopeType = "shared"
		return scope, nil
	}
	if scope.personalUserID == "" || scope.personalAccountEmail == "" {
		return communicationsEmailScope{}, ErrInvalid
	}
	scope.scopeType = "personal"
	return scope, nil
}

func (scope communicationsEmailScope) matchesSignature(signature domain.CommunicationsEmailSignature) bool {
	if scope.scopeType == "shared" {
		return signature.ScopeType == "shared" && signature.SharedInboxID == scope.sharedInboxID
	}
	return signature.ScopeType == "personal" && signature.PersonalUserID == scope.personalUserID && signature.PersonalAccountEmail == scope.personalAccountEmail
}

func (scope communicationsEmailScope) matchesDraft(draft domain.CommunicationsEmailDraft) bool {
	if scope.scopeType == "shared" {
		return draft.ScopeType == "shared" && draft.SharedInboxID == scope.sharedInboxID
	}
	return draft.ScopeType == "personal" && draft.PersonalUserID == scope.personalUserID && draft.PersonalAccountEmail == scope.personalAccountEmail
}

func communicationsEmailDraftScopesMatch(left, right domain.CommunicationsEmailDraft) bool {
	return left.CompanyID == right.CompanyID &&
		left.ScopeType == right.ScopeType &&
		left.PersonalUserID == right.PersonalUserID &&
		left.PersonalAccountEmail == right.PersonalAccountEmail &&
		left.SharedInboxID == right.SharedInboxID
}

func normalizeCommunicationsEmailDraftKind(kind string) string {
	switch strings.TrimSpace(strings.ToLower(kind)) {
	case "", "compose":
		return "compose"
	case "reply":
		return "reply"
	case "forward":
		return "forward"
	default:
		return ""
	}
}

func communicationsEmailDraftKey(companyID, draftID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(draftID)
}

func communicationsEmailSignatureKey(companyID, signatureID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(signatureID)
}

func communicationsEmailSignatureID(scope communicationsEmailScope) string {
	if scope.scopeType == "shared" {
		return "shared:" + scope.sharedInboxID
	}
	return "personal:" + scope.personalUserID + ":" + scope.personalAccountEmail
}
