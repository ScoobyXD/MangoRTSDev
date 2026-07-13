package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) ListCommunicationsEmailDrafts(input CommunicationsEmailDraftListInput) ([]domain.CommunicationsEmailDraft, error) {
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if _, ok := r.companies[scope.companyID]; !ok {
		return nil, ErrNotFound
	}
	drafts := make([]domain.CommunicationsEmailDraft, 0)
	for _, draft := range r.emailDrafts {
		if draft.CompanyID != scope.companyID || draft.DeletedTimestamp != nil {
			continue
		}
		if scope.matchesDraft(draft) {
			drafts = append(drafts, draft)
		}
	}
	sort.SliceStable(drafts, func(i, j int) bool {
		return drafts[i].UpdatedTimestamp.After(drafts[j].UpdatedTimestamp)
	})
	return drafts, nil
}

func (r *MemoryRepo) GetCommunicationsEmailDraft(input CommunicationsEmailDraftGetInput) (domain.CommunicationsEmailDraft, error) {
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return domain.CommunicationsEmailDraft{}, err
	}
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return domain.CommunicationsEmailDraft{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	draft, ok := r.emailDrafts[communicationsEmailDraftKey(scope.companyID, draftID)]
	if !ok || draft.DeletedTimestamp != nil || !scope.matchesDraft(draft) {
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

	if _, ok := r.companies[draft.CompanyID]; !ok {
		return domain.CommunicationsEmailDraft{}, ErrNotFound
	}
	if draft.ScopeType == "personal" {
		if _, ok := r.emailConnections[emailConnectionKey(draft.PersonalUserID, draft.PersonalAccountEmail)]; !ok {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
	} else {
		folder, ok := r.folders[key(draft.CompanyID, draft.SharedInboxID)]
		if !ok || CommunicationsSharedInboxResourceType(folder) != EntityTypeSharedInbox {
			return domain.CommunicationsEmailDraft{}, ErrNotFound
		}
	}

	now := time.Now().UTC()
	existing, exists := r.emailDrafts[communicationsEmailDraftKey(draft.CompanyID, draft.DraftID)]
	if exists && !communicationsEmailDraftScopesMatch(existing, draft) {
		return domain.CommunicationsEmailDraft{}, ErrAlreadyExists
	}
	if existing.CreatedTimestamp.IsZero() {
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

func (r *MemoryRepo) SoftDeleteCommunicationsEmailDraft(input CommunicationsEmailDraftDeleteInput) error {
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
	if err != nil {
		return err
	}
	draftID := strings.TrimSpace(input.DraftID)
	if draftID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	key := communicationsEmailDraftKey(scope.companyID, draftID)
	draft, ok := r.emailDrafts[key]
	if !ok || draft.DeletedTimestamp != nil || !scope.matchesDraft(draft) {
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
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
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
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
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
		SourceMessageID:        strings.TrimSpace(input.SourceMessageID),
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

func normalizeCommunicationsEmailSignatureInput(input CommunicationsEmailSignatureInput) (domain.CommunicationsEmailSignature, error) {
	scope, err := normalizeCommunicationsEmailSignatureScope(input.CompanyID, input.PersonalUserID, input.PersonalAccountEmail, input.SharedInboxID)
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

func normalizeCommunicationsEmailSignatureScope(companyID, personalUserID, personalAccountEmail, sharedInboxID string) (communicationsEmailScope, error) {
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
