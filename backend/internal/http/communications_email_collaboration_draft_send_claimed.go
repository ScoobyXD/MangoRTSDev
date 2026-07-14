package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"time"
)

// Leave enough of Nylas's fixed idempotency lifetime for the outbound request
// itself. A recovered send that enters this margin remains uncertain and must
// be inspected/discarded instead of riskily replayed across key expiry.
const communicationsEmailDraftRecoveredSendSafetyMargin = nylasOutboundRequestTimeout

func communicationsEmailDraftRecoveredSendWindowExhausted(claim store.CommunicationsEmailDraftSendClaim, now time.Time) bool {
	if !claim.Recovered {
		return false
	}
	origin := claim.Draft.SendIdempotencyTimestamp
	if origin == nil {
		origin = claim.Draft.SendClaimedTimestamp
	}
	if origin == nil {
		return true
	}
	deadline := origin.Add(store.CommunicationsEmailDraftSendRecoveryWindow)
	return !now.UTC().Add(communicationsEmailDraftRecoveredSendSafetyMargin).Before(deadline)
}

func (s *Server) handleCommunicationsEmailCollaborationDraftSend(w http.ResponseWriter, r *http.Request, actor ActorContext, companyID, collaborationID, draftID string) {
	var req struct {
		ExpectedRevision int64 `json:"expected_revision"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	companyID = strings.TrimSpace(companyID)
	collaborationID = strings.TrimSpace(collaborationID)
	draftID = strings.TrimSpace(draftID)
	if companyID == "" || collaborationID == "" || draftID == "" || req.ExpectedRevision <= 0 {
		writeError(w, http.StatusBadRequest, "company_id_draft_id_and_expected_revision_required")
		return
	}
	if actorRoleForCompany(actor, companyID) == "" {
		writeError(w, http.StatusForbidden, "company_access_denied")
		return
	}
	if s.nylasClient == nil || !s.nylasConfig.IsConfigured() {
		writeError(w, http.StatusServiceUnavailable, "nylas_not_configured")
		return
	}
	collaboration, err := s.repo.GetCommunicationsEmailCollaboration(companyID, collaborationID, actor.User.UserID)
	if err != nil {
		s.writeEmailCollaborationStoreError(w, err, "failed_to_load_email_collaboration")
		return
	}
	connection, ok := s.emailCollaborationSourceConnection(w, collaboration, actor.User.UserID)
	if !ok {
		return
	}
	claim, err := s.repo.ClaimCommunicationsEmailDraftSend(store.CommunicationsEmailDraftSendClaimInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaborationID,
		ParticipantUserID: actor.User.UserID, ExpectedRevision: req.ExpectedRevision, ProviderGrantID: connection.GrantID,
	})
	if err != nil {
		s.writeCommunicationsEmailDraftSendClaimError(w, err, req.ExpectedRevision, companyID, draftID, actor.User.UserID)
		return
	}
	claimObservedAt := time.Now()
	releaseClaim := func() {
		_ = s.repo.ReleaseCommunicationsEmailDraftSend(store.CommunicationsEmailDraftSendReleaseInput{
			CompanyID: companyID, DraftID: draftID, ClaimToken: claim.ClaimToken,
		})
	}
	releaseFreshPreProviderClaim := func() {
		if !claim.Recovered {
			releaseClaim()
		}
	}
	draft := claim.Draft
	if draft.Kind != "reply" || strings.TrimSpace(draft.SourceMessageID) == "" {
		releaseFreshPreProviderClaim()
		writeError(w, http.StatusConflict, "shared_email_draft_reply_source_required")
		return
	}
	if draft.ScheduledSendTimestamp != nil {
		releaseFreshPreProviderClaim()
		writeError(w, http.StatusConflict, "shared_email_draft_scheduled_send_not_supported")
		return
	}

	var sourceMessage NylasMessage
	err = s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
		var fetchErr error
		sourceMessage, fetchErr = s.nylasClient.GetMessage(ctx, connection.GrantID, draft.SourceMessageID)
		return fetchErr
	})
	if err != nil {
		// A first-attempt source read failure is safe to release. A recovered
		// claim already represents an uncertain earlier provider outcome, so its
		// exact key/grant/origin must remain durable for later reconciliation.
		releaseFreshPreProviderClaim()
		s.writeNylasError(w, r, connection, err)
		return
	}
	if strings.TrimSpace(sourceMessage.ID) != strings.TrimSpace(draft.SourceMessageID) ||
		(strings.TrimSpace(collaboration.ProviderThreadID) != "" &&
			strings.TrimSpace(sourceMessage.ThreadID) != strings.TrimSpace(collaboration.ProviderThreadID)) {
		releaseFreshPreProviderClaim()
		writeError(w, http.StatusConflict, "shared_email_draft_source_mismatch")
		return
	}
	providerSource := emailMessageSnapshotFromNylas(sourceMessage)
	toRecipients, ccRecipients := store.CanonicalCommunicationsEmailReplyAllEnvelope(providerSource, collaboration.AccountEmail)
	sendReq := NylasSendMessageRequest{
		To: draftRecipientAddresses(toRecipients), Cc: draftRecipientAddresses(ccRecipients),
		Subject: strings.TrimSpace(draft.Subject), Body: strings.TrimSpace(draft.BodyEditorHTML),
		ReplyToMessageID: strings.TrimSpace(draft.SourceMessageID), IdempotencyKey: claim.IdempotencyKey,
	}
	if len(sendReq.To) == 0 && len(sendReq.Cc) == 0 {
		releaseFreshPreProviderClaim()
		writeError(w, http.StatusConflict, "shared_email_draft_reply_all_envelope_empty")
		return
	}
	links, err := s.repo.ListResourceAttachments(companyID, "email_draft", communicationsEmailDraftResourceID(draft))
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		releaseFreshPreProviderClaim()
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_draft_attachments")
		return
	}
	for _, link := range links {
		item := NylasAttachment{AttachmentID: link.AttachmentID}
		if link.Attachment != nil {
			item.Filename = link.Attachment.OriginalFilename
			item.ContentType = link.Attachment.MimeType
			item.Size = link.Attachment.ByteSize
		}
		sendReq.Attachments = append(sendReq.Attachments, item)
	}
	if strings.TrimSpace(sendReq.Subject) == "" && strings.TrimSpace(sendReq.Body) == "" && len(sendReq.Attachments) == 0 {
		releaseFreshPreProviderClaim()
		writeError(w, http.StatusBadRequest, "email_draft_content_required")
		return
	}
	sendReq.Body, sendReq.Attachments = prepareCommunicationsInlineImageAttachments(sendReq.Body, sendReq.Attachments)
	attachments, outbound, attachmentsOK := s.resolveCommunicationsSendAttachments(w, r, companyID, sendReq.Attachments)
	if !attachmentsOK {
		releaseFreshPreProviderClaim()
		return
	}
	sendReq.Attachments, sendReq.OutboundAttachments = attachments, outbound
	sendReq.TrackingOptions = defaultCommunicationsTrackingOptions()
	recoveryCheckNow := time.Now().UTC()
	if claim.Draft.SendClaimedTimestamp != nil {
		// Repository tests may supply a deterministic clock. Advancing the
		// durable claim timestamp by actual handler elapsed time keeps that clock
		// coherent while still charging all preflight work against the deadline.
		recoveryCheckNow = claim.Draft.SendClaimedTimestamp.UTC().Add(time.Since(claimObservedAt))
	}
	if communicationsEmailDraftRecoveredSendWindowExhausted(claim, recoveryCheckNow) {
		s.writeCommunicationsEmailDraftSendRecoveryBlocked(
			w, companyID, draftID, actor.User.UserID, draft.Revision,
			"email_draft_send_recovery_window_expired", false,
		)
		return
	}

	var message NylasMessage
	err = s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
		var sendErr error
		message, sendErr = s.nylasClient.SendMessage(ctx, connection.GrantID, sendReq)
		return sendErr
	})
	if err != nil {
		// A transport failure, 5xx, or concurrent-idempotency response can arrive
		// after Nylas accepted the message. Keep that claim recoverable so the
		// same logical send is replayed with the same key. Only an explicit
		// non-409 4xx proves this request was rejected before delivery.
		var apiErr NylasAPIError
		if errors.As(err, &apiErr) && apiErr.StatusCode >= 400 && apiErr.StatusCode < 500 && apiErr.StatusCode != http.StatusConflict {
			releaseClaim()
		}
		s.writeNylasError(w, r, connection, err)
		return
	}
	message = communicationsSendResponseWithLocalContent(message, sendReq)
	if strings.TrimSpace(message.ThreadID) == "" {
		message.ThreadID = strings.TrimSpace(sourceMessage.ThreadID)
	}
	sentSnapshot := emailMessageSnapshotFromNylas(message)
	if strings.TrimSpace(sentSnapshot.ID) == "" {
		writeError(w, http.StatusBadGateway, "email_provider_send_response_missing_message_id")
		return
	}
	if err := s.repo.CompleteCommunicationsEmailDraftSend(store.CommunicationsEmailDraftSendCompleteInput{
		CompanyID: companyID, DraftID: draftID, CollaborationID: collaborationID,
		ClaimToken: claim.ClaimToken, UpdatedByUserID: actor.User.UserID, Message: sentSnapshot,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_complete_sent_email_draft")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"message": message, "collaboration_id": collaborationID, "draft_id": draftID,
		"draft_deleted": true, "revision": req.ExpectedRevision + 1,
	})
}

func (s *Server) writeCommunicationsEmailDraftSendClaimError(w http.ResponseWriter, err error, expectedRevision int64, companyID, draftID, participantUserID string) {
	var conflict *store.VersionConflictError
	switch {
	case errors.As(err, &conflict):
		s.writeCommunicationsEmailDraftRevisionConflict(w, companyID, draftID, participantUserID, conflict.CurrentRevision)
	case errors.Is(err, store.ErrSendInProgress):
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "email_draft_send_in_progress", "current_revision": expectedRevision,
		})
	case errors.Is(err, store.ErrSendRecoveryExpired):
		s.writeCommunicationsEmailDraftSendRecoveryBlocked(w, companyID, draftID, participantUserID, expectedRevision, "email_draft_send_recovery_window_expired", true)
	case errors.Is(err, store.ErrSendRecoverySourceChanged):
		s.writeCommunicationsEmailDraftSendRecoveryBlocked(w, companyID, draftID, participantUserID, expectedRevision, "email_draft_send_recovery_source_changed", true)
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "email_draft_not_found")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_email_draft_send")
	default:
		writeError(w, http.StatusInternalServerError, "failed_to_claim_email_draft_send")
	}
}

func (s *Server) writeCommunicationsEmailDraftSendRecoveryBlocked(w http.ResponseWriter, companyID, draftID, participantUserID string, currentRevision int64, errorCode string, canDiscard bool) {
	payload := map[string]any{
		"error":            errorCode,
		"current_revision": currentRevision,
		"can_discard":      canDiscard,
		"recovery_action":  "inspect_thread_then_discard",
	}
	current, err := s.repo.GetCommunicationsEmailDraft(store.CommunicationsEmailDraftGetInput{
		CompanyID: companyID, DraftID: draftID, ParticipantUserID: participantUserID,
	})
	if err == nil && current.IsShared {
		payload["current_revision"] = current.Revision
		payload["draft"] = s.communicationsEmailDraftResponse(current)
	}
	writeJSON(w, http.StatusConflict, payload)
}
