package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"mime"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

const attachmentCompanyContextHeader = "X-Mango-Company-ID"

var attachmentCompletionRecoveryGrace = 30 * time.Second

type attachmentUploadIntentRequest struct {
	ClientRequestID  string `json:"clientRequestId"`
	Filename         string `json:"filename"`
	SizeBytes        int64  `json:"sizeBytes"`
	SHA256           string `json:"sha256"`
	ContentType      string `json:"contentType"`
	ResourceType     string `json:"resourceType"`
	ResourceID       string `json:"resourceId"`
	RelationshipKind string `json:"relationshipKind"`
	SourceKind       string `json:"sourceKind"`
	InformationID    string `json:"informationId"`
	MessageID        string `json:"messageId"`
	EditorSurface    string `json:"editorSurface"`
	SourceProvider   string `json:"sourceProvider"`
	OriginalWidth    *int   `json:"originalWidth"`
	OriginalHeight   *int   `json:"originalHeight"`
}

type attachmentUploadPartSignRequest struct {
	Parts []struct {
		PartNumber        int    `json:"partNumber"`
		ChecksumAlgorithm string `json:"checksumAlgorithm"`
		Checksum          string `json:"checksum"`
	} `json:"parts"`
}

type attachmentUploadDescriptor struct {
	Strategy        string            `json:"strategy"`
	Method          string            `json:"method,omitempty"`
	URL             string            `json:"url,omitempty"`
	RequiredHeaders map[string]string `json:"requiredHeaders,omitempty"`
	ExpiresAt       *time.Time        `json:"expiresAt,omitempty"`
	PartSizeBytes   int64             `json:"partSizeBytes,omitempty"`
	PartCount       int               `json:"partCount,omitempty"`
}

type attachmentUploadIntentResponse struct {
	UploadIntentID string                     `json:"uploadIntentId"`
	AttachmentID   string                     `json:"attachmentId"`
	ExpiresAt      time.Time                  `json:"expiresAt"`
	Upload         attachmentUploadDescriptor `json:"upload"`
}

type attachmentAcceptedPartResponse struct {
	PartNumber int    `json:"partNumber"`
	SizeBytes  int64  `json:"sizeBytes,omitempty"`
	ETag       string `json:"eTag,omitempty"`
	Checksum   string `json:"checksum,omitempty"`
}

func (s *Server) handleAttachmentDirectUploadRoute(w http.ResponseWriter, r *http.Request, trimmed string) bool {
	trimmed = strings.Trim(strings.TrimSpace(trimmed), "/")
	if trimmed == "upload-policy" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		} else {
			s.handleAttachmentUploadPolicy(w, r)
		}
		return true
	}
	if trimmed == "upload-intents" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		} else {
			s.handleAttachmentUploadIntentCreate(w, r)
		}
		return true
	}
	if !strings.HasPrefix(trimmed, "upload-intents/") {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(trimmed, "upload-intents/"), "/")
	if len(parts) == 1 && parts[0] != "" {
		switch r.Method {
		case http.MethodGet:
			s.handleAttachmentUploadIntentStatus(w, r, parts[0])
		case http.MethodDelete:
			s.handleAttachmentUploadIntentAbort(w, r, parts[0])
		default:
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		}
		return true
	}
	if len(parts) == 2 && parts[0] != "" {
		switch parts[1] {
		case "parts":
			if r.Method == http.MethodPost {
				s.handleAttachmentUploadPartSign(w, r, parts[0])
			} else {
				writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			}
		case "complete":
			if r.Method == http.MethodPost {
				s.handleAttachmentUploadIntentComplete(w, r, parts[0])
			} else {
				writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
			}
		default:
			writeError(w, http.StatusNotFound, "not_found")
		}
		return true
	}
	writeError(w, http.StatusNotFound, "not_found")
	return true
}

func (s *Server) handleAttachmentUploadPolicy(w http.ResponseWriter, _ *http.Request) {
	config := s.attachmentDirectUpload.normalized()
	_, storageAvailable := s.attachmentStorage.(AttachmentDirectUploadStorage)
	writeJSON(w, http.StatusOK, map[string]any{
		"directUploadEnabled":   config.Enabled && storageAvailable,
		"maxFileBytes":          config.MaxFileBytes,
		"singlePutMaxBytes":     attachmentSinglePutMaxBytes,
		"multipartPartBytes":    attachmentMultipartPartBytes,
		"maxConcurrentParts":    attachmentMaxConcurrentParts,
		"intentLifetimeSeconds": int64(config.IntentLifetime / time.Second),
	})
}

func (s *Server) handleAttachmentUploadIntentCreate(w http.ResponseWriter, r *http.Request) {
	storage, config, ok := s.directAttachmentUploadStorage(w)
	if !ok {
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok || strings.TrimSpace(actor.User.UserID) == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req attachmentUploadIntentRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.ClientRequestID = strings.TrimSpace(req.ClientRequestID)
	req.Filename = strings.TrimSpace(req.Filename)
	req.SHA256 = strings.TrimSpace(req.SHA256)
	req.ResourceType = strings.TrimSpace(req.ResourceType)
	req.ResourceID = strings.TrimSpace(req.ResourceID)
	req.RelationshipKind = strings.TrimSpace(req.RelationshipKind)
	req.SourceKind = strings.TrimSpace(req.SourceKind)
	req.InformationID = strings.TrimSpace(req.InformationID)
	req.MessageID = strings.TrimSpace(req.MessageID)
	req.EditorSurface = strings.TrimSpace(req.EditorSurface)
	req.SourceProvider = strings.TrimSpace(req.SourceProvider)
	contentType, contentTypeOK := normalizeAttachmentUploadContentType(req.ContentType)
	if !contentTypeOK {
		writeError(w, http.StatusBadRequest, "invalid_attachment_upload_intent")
		return
	}
	req.ContentType = contentType
	if !validAttachmentUploadIntentRequest(req) {
		writeError(w, http.StatusBadRequest, "invalid_attachment_upload_intent")
		return
	}
	if req.SizeBytes > config.MaxFileBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "attachment_file_too_large", "maxFileBytes": config.MaxFileBytes})
		return
	}
	req.ResourceType = store.NormalizeAttachmentResourceType(req.ResourceType)
	req.RelationshipKind = store.NormalizeAttachmentRelationshipKind(req.RelationshipKind)
	req.SourceKind = store.NormalizeAttachmentSourceKind(req.SourceKind)
	if req.ResourceType == "" || req.RelationshipKind == "" || req.SourceKind == "" {
		writeError(w, http.StatusBadRequest, "invalid_attachment_upload_intent")
		return
	}
	companyID, ok := s.resolveAttachmentUploadCompany(w, r, actor, req.ResourceType, strings.TrimSpace(req.ResourceID))
	if !ok {
		return
	}
	actorUserID := strings.TrimSpace(actor.User.UserID)
	if existing, err := s.repo.GetAttachmentUploadIntentByClientRequest(companyID, actorUserID, req.ClientRequestID); err == nil {
		if !attachmentIntentMatchesRequest(existing, req) {
			writeError(w, http.StatusConflict, "attachment_upload_state_conflict")
			return
		}
		if existing.Status == domain.AttachmentUploadStatusExpired || !existing.ExpiresTimestamp.After(time.Now().UTC()) {
			writeError(w, http.StatusGone, "attachment_upload_intent_expired")
			return
		}
		if existing.Status == domain.AttachmentUploadStatusFailed || existing.Status == domain.AttachmentUploadStatusAborted {
			writeError(w, http.StatusConflict, "attachment_upload_state_conflict")
			return
		}
		if existing.Status == domain.AttachmentUploadStatusCompleting {
			// Completion owns the object verification/finalization lease. Issuing
			// another single-PUT URL here could overwrite the object between HEAD
			// verification and the metadata transaction.
			writeError(w, http.StatusConflict, "attachment_upload_state_conflict")
			return
		}
		s.writeAttachmentUploadIntentCreated(w, r, storage, existing)
		return
	} else if !errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "failed_to_load_attachment_upload_intent")
		return
	}

	now := time.Now().UTC()
	uploadIntentID := store.NewUUIDv7String()
	attachmentID := store.NewUUIDv7String()
	strategy := domain.AttachmentUploadStrategySingle
	partSize, partCount := int64(0), 0
	multipartUploadID := ""
	storageKey := attachmentOriginalObjectKey(companyID, attachmentID)
	if req.SizeBytes > attachmentSinglePutMaxBytes {
		strategy = domain.AttachmentUploadStrategyMultipart
		partSize = attachmentMultipartPartBytes
		partCount = int((req.SizeBytes + partSize - 1) / partSize)
		if partCount > attachmentMaxMultipartParts {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "attachment_file_too_large", "maxFileBytes": attachmentMultipartPartBytes * attachmentMaxMultipartParts})
			return
		}
		var err error
		multipartUploadID, err = storage.CreateMultipartUpload(r.Context(), AttachmentCreateMultipartInput{Key: storageKey, ContentType: req.ContentType})
		if err != nil {
			writeAttachmentDirectStorageError(w, err)
			return
		}
	}
	intent, created, err := s.repo.CreateAttachmentUploadIntent(store.AttachmentUploadIntentCreateInput{
		UploadIntentID: uploadIntentID, CompanyID: companyID, ActorUserID: actorUserID, ClientRequestID: req.ClientRequestID,
		AttachmentID: attachmentID, OriginalFilename: req.Filename, MimeType: req.ContentType, SizeBytes: req.SizeBytes,
		SHA256: req.SHA256, ResourceType: req.ResourceType, ResourceID: req.ResourceID, InformationID: req.InformationID,
		MessageID: req.MessageID, EditorSurface: req.EditorSurface, RelationshipKind: req.RelationshipKind,
		SourceKind: req.SourceKind, SourceProvider: req.SourceProvider, OriginalWidth: req.OriginalWidth,
		OriginalHeight: req.OriginalHeight, StorageBucket: storage.Bucket(), StorageKey: storageKey,
		MultipartUploadID: multipartUploadID, Strategy: strategy, PartSizeBytes: partSize, PartCount: partCount,
		ExpiresTimestamp: now.Add(config.IntentLifetime), CreatedTimestamp: now,
	})
	if strategy == domain.AttachmentUploadStrategyMultipart && (!created || err != nil) {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_ = storage.AbortMultipartUpload(cleanupCtx, AttachmentMultipartInput{Key: storageKey, UploadID: multipartUploadID})
		cancel()
	}
	if errors.Is(err, store.ErrUploadPayloadConflict) {
		writeError(w, http.StatusConflict, "attachment_upload_state_conflict")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_create_attachment_upload_intent")
		return
	}
	log.Printf("attachment_direct_upload_job status=created upload_job_id=%s strategy=%s size_bytes=%d", intent.UploadIntentID, intent.Strategy, intent.SizeBytes)
	s.writeAttachmentUploadIntentCreated(w, r, storage, intent)
}

func (s *Server) writeAttachmentUploadIntentCreated(w http.ResponseWriter, r *http.Request, storage AttachmentDirectUploadStorage, intent domain.AttachmentUploadIntent) {
	descriptor := attachmentUploadDescriptor{Strategy: intent.Strategy, PartSizeBytes: intent.PartSizeBytes, PartCount: intent.PartCount}
	if intent.Strategy == domain.AttachmentUploadStrategySingle && intent.Status != domain.AttachmentUploadStatusCompleted {
		urlLifetime, ok := attachmentUploadURLLifetime(intent.ExpiresTimestamp, s.attachmentDirectUpload.normalized().SingleURLLifetime)
		if !ok {
			writeError(w, http.StatusGone, "attachment_upload_intent_expired")
			return
		}
		request, err := storage.PresignPutObject(r.Context(), AttachmentPresignPutInput{Key: intent.StorageKey,
			ContentType: intent.MimeType, ChecksumSHA256: rawSHA256Base64(intent.SHA256), Expires: urlLifetime})
		if err != nil {
			writeAttachmentDirectStorageError(w, err)
			return
		}
		descriptor.Method = request.Method
		descriptor.URL = request.URL
		descriptor.RequiredHeaders = request.RequiredHeaders
		descriptor.ExpiresAt = &request.ExpiresAt
	}
	writeJSON(w, http.StatusCreated, attachmentUploadIntentResponse{UploadIntentID: intent.UploadIntentID,
		AttachmentID: intent.AttachmentID, ExpiresAt: intent.ExpiresTimestamp, Upload: descriptor})
}

func (s *Server) handleAttachmentUploadPartSign(w http.ResponseWriter, r *http.Request, uploadIntentID string) {
	storage, config, ok := s.directAttachmentUploadStorage(w)
	if !ok {
		return
	}
	actor, intent, ok := s.findAttachmentUploadIntentForActor(w, r, uploadIntentID)
	if !ok {
		return
	}
	if intent.Strategy != domain.AttachmentUploadStrategyMultipart {
		writeError(w, http.StatusConflict, "attachment_upload_state_conflict")
		return
	}
	if !s.requireAttachmentResourceEdit(w, r, intent.CompanyID, intent.ResourceType, intent.ResourceID) {
		s.cleanupDeniedAttachmentUpload(r.Context(), storage, actor.User.UserID, intent)
		return
	}
	var req attachmentUploadPartSignRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if len(req.Parts) == 0 || len(req.Parts) > attachmentMaxPartSignBatch {
		writeError(w, http.StatusBadRequest, "attachment_upload_part_invalid")
		return
	}
	seen := map[int]bool{}
	storeParts := make([]domain.AttachmentUploadPart, 0, len(req.Parts))
	for _, part := range req.Parts {
		if seen[part.PartNumber] || part.PartNumber < 1 || part.PartNumber > intent.PartCount || !strings.EqualFold(strings.TrimSpace(part.ChecksumAlgorithm), "SHA256") || !validAttachmentChecksumBase64(part.Checksum) {
			writeError(w, http.StatusBadRequest, "attachment_upload_part_invalid")
			return
		}
		seen[part.PartNumber] = true
		storeParts = append(storeParts, domain.AttachmentUploadPart{PartNumber: part.PartNumber, ChecksumAlgorithm: "SHA256", ExpectedChecksum: strings.TrimSpace(part.Checksum)})
	}
	persistedParts, err := s.repo.UpsertAttachmentUploadParts(store.AttachmentUploadPartsInput{CompanyID: intent.CompanyID,
		ActorUserID: actor.User.UserID, UploadIntentID: intent.UploadIntentID, Parts: storeParts, Now: time.Now().UTC()})
	if err != nil {
		writeAttachmentUploadStoreError(w, err)
		return
	}
	signingAttempts := make(map[int]int, len(persistedParts))
	for _, part := range persistedParts {
		signingAttempts[part.PartNumber] = part.SigningAttemptCount
	}
	type signedPart struct {
		PartNumber      int               `json:"partNumber"`
		Method          string            `json:"method"`
		URL             string            `json:"url"`
		ExpiresAt       time.Time         `json:"expiresAt"`
		RequiredHeaders map[string]string `json:"requiredHeaders"`
	}
	response := make([]signedPart, 0, len(req.Parts))
	urlLifetime, ok := attachmentUploadURLLifetime(intent.ExpiresTimestamp, config.PartURLLifetime)
	if !ok {
		writeError(w, http.StatusGone, "attachment_upload_intent_expired")
		return
	}
	for _, part := range req.Parts {
		presigned, err := storage.PresignUploadPart(r.Context(), AttachmentPresignPartInput{Key: intent.StorageKey,
			UploadID: intent.MultipartUploadID, PartNumber: part.PartNumber, ChecksumSHA256: part.Checksum, Expires: urlLifetime})
		if err != nil {
			writeAttachmentDirectStorageError(w, err)
			return
		}
		response = append(response, signedPart{PartNumber: part.PartNumber, Method: presigned.Method, URL: presigned.URL,
			ExpiresAt: presigned.ExpiresAt, RequiredHeaders: presigned.RequiredHeaders})
		log.Printf("attachment_direct_upload_part status=signed upload_job_id=%s part_number=%d signing_attempt=%d", intent.UploadIntentID, part.PartNumber, signingAttempts[part.PartNumber])
	}
	writeJSON(w, http.StatusOK, map[string]any{"parts": response})
}

func (s *Server) handleAttachmentUploadIntentStatus(w http.ResponseWriter, r *http.Request, uploadIntentID string) {
	storage, _, ok := s.directAttachmentUploadStorage(w)
	if !ok {
		return
	}
	actor, intent, ok := s.findAttachmentUploadIntentForActor(w, r, uploadIntentID)
	if !ok {
		return
	}
	if !s.requireAttachmentResourceEdit(w, r, intent.CompanyID, intent.ResourceType, intent.ResourceID) {
		s.cleanupDeniedAttachmentUpload(r.Context(), storage, actor.User.UserID, intent)
		return
	}
	parts, err := s.repo.ListAttachmentUploadParts(intent.CompanyID, intent.ActorUserID, intent.UploadIntentID)
	if err != nil {
		writeAttachmentUploadStoreError(w, err)
		return
	}
	if intent.Strategy == domain.AttachmentUploadStrategyMultipart && !uploadIntentTerminal(intent.Status) {
		if observed, listErr := storage.ListMultipartParts(r.Context(), AttachmentMultipartInput{Key: intent.StorageKey, UploadID: intent.MultipartUploadID}); listErr == nil {
			parts, err = s.persistObservedAttachmentParts(intent, observed)
			if err != nil {
				writeAttachmentUploadStoreError(w, err)
				return
			}
		} else if !errors.Is(listErr, ErrAttachmentObjectNotFound) {
			writeAttachmentDirectStorageError(w, listErr)
			return
		}
	}
	accepted := acceptedAttachmentParts(parts)
	writeJSON(w, http.StatusOK, map[string]any{"uploadIntentId": intent.UploadIntentID, "attachmentId": intent.AttachmentID,
		"status": intent.Status, "strategy": intent.Strategy, "sizeBytes": intent.SizeBytes, "sha256": intent.SHA256,
		"expiresAt": intent.ExpiresTimestamp, "partSizeBytes": intent.PartSizeBytes, "partCount": intent.PartCount,
		"failureCode": intent.FailureCode, "acceptedParts": accepted})
}

func (s *Server) handleAttachmentUploadIntentComplete(w http.ResponseWriter, r *http.Request, uploadIntentID string) {
	storage, _, ok := s.directAttachmentUploadStorage(w)
	if !ok {
		return
	}
	actor, intent, ok := s.findAttachmentUploadIntentForActor(w, r, uploadIntentID)
	if !ok {
		return
	}
	if !s.requireAttachmentResourceEdit(w, r, intent.CompanyID, intent.ResourceType, intent.ResourceID) {
		s.cleanupDeniedAttachmentUpload(r.Context(), storage, actor.User.UserID, intent)
		return
	}
	intent, claimed, err := s.repo.BeginAttachmentUploadCompletion(store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID,
		ActorUserID: actor.User.UserID, UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()})
	if err != nil {
		writeAttachmentUploadStoreError(w, err)
		return
	}
	if intent.Status == domain.AttachmentUploadStatusCompleted {
		s.writeCompletedAttachmentIntent(r.Context(), w, intent, actor.User.UserID, AttachmentHeadObjectOutput{})
		return
	}
	if !claimed {
		if s.recoverCompletingAttachmentUpload(w, r, storage, actor.User.UserID, intent) {
			return
		}
		writeError(w, http.StatusConflict, "attachment_upload_state_conflict")
		return
	}
	providerCompleted := false
	expectedMultipartChecksum := ""
	multipartUploadMissing := false
	if intent.Strategy == domain.AttachmentUploadStrategyMultipart {
		parts, listErr := storage.ListMultipartParts(r.Context(), AttachmentMultipartInput{Key: intent.StorageKey, UploadID: intent.MultipartUploadID})
		if listErr == nil {
			if err := s.verifyAndPersistMultipartParts(intent, parts); err != nil {
				_, _ = s.repo.ReopenAttachmentUploadIntent(store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID, ActorUserID: actor.User.UserID, UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()}, directUploadFailureCode(err))
				writeAttachmentCompletionError(w, err)
				return
			}
			expectedMultipartChecksum = multipartChecksumFromS3Parts(parts)
			if err := storage.CompleteMultipartUpload(r.Context(), AttachmentCompleteMultipartInput{Key: intent.StorageKey, UploadID: intent.MultipartUploadID, Parts: parts}); err != nil {
				writeAttachmentDirectStorageError(w, err)
				return
			}
			providerCompleted = true
		} else if errors.Is(listErr, ErrAttachmentObjectNotFound) {
			multipartUploadMissing = true
		} else {
			_, _ = s.repo.ReopenAttachmentUploadIntent(store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID, ActorUserID: actor.User.UserID, UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()}, "storage_unavailable")
			writeAttachmentDirectStorageError(w, listErr)
			return
		}
	}
	if intent.Strategy == domain.AttachmentUploadStrategyMultipart && expectedMultipartChecksum == "" {
		if durableParts, partsErr := s.repo.ListAttachmentUploadParts(intent.CompanyID, actor.User.UserID, intent.UploadIntentID); partsErr == nil {
			expectedMultipartChecksum = multipartChecksumFromDurableParts(durableParts, intent.PartCount)
		}
	}
	head, err := storage.HeadObject(r.Context(), AttachmentHeadObjectInput{Key: intent.StorageKey})
	if err != nil {
		if intent.Strategy == domain.AttachmentUploadStrategyMultipart && multipartUploadMissing {
			_ = storage.DeleteObject(r.Context(), intent.StorageKey)
			_, _ = s.repo.FailAttachmentUploadIntent(store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID, ActorUserID: actor.User.UserID, UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()}, "incomplete")
		} else if !providerCompleted {
			_, _ = s.repo.ReopenAttachmentUploadIntent(store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID, ActorUserID: actor.User.UserID, UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()}, "incomplete")
		}
		writeAttachmentCompletionError(w, errors.New("incomplete"))
		return
	}
	if err := verifyAttachmentHead(intent, head, expectedMultipartChecksum); err != nil {
		if providerCompleted || intent.Strategy == domain.AttachmentUploadStrategyMultipart {
			_ = storage.DeleteObject(r.Context(), intent.StorageKey)
			_, _ = s.repo.FailAttachmentUploadIntent(store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID, ActorUserID: actor.User.UserID, UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()}, directUploadFailureCode(err))
		} else if intent.Strategy == domain.AttachmentUploadStrategySingle {
			_ = storage.DeleteObject(r.Context(), intent.StorageKey)
			_, _ = s.repo.ReopenAttachmentUploadIntent(store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID, ActorUserID: actor.User.UserID, UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()}, directUploadFailureCode(err))
		}
		writeAttachmentCompletionError(w, err)
		return
	}
	s.writeCompletedAttachmentIntent(r.Context(), w, intent, actor.User.UserID, head)
}

func (s *Server) recoverCompletingAttachmentUpload(w http.ResponseWriter, r *http.Request, storage AttachmentDirectUploadStorage, actorUserID string, intent domain.AttachmentUploadIntent) bool {
	// A recent claimer may still be inside CompleteMultipartUpload. Avoid any
	// provider calls until its lease grace window has elapsed.
	if time.Since(intent.UpdatedTimestamp) < attachmentCompletionRecoveryGrace {
		return false
	}
	expectedMultipart := ""
	if intent.Strategy == domain.AttachmentUploadStrategyMultipart {
		parts, err := s.repo.ListAttachmentUploadParts(intent.CompanyID, actorUserID, intent.UploadIntentID)
		if err != nil {
			return false
		}
		expectedMultipart = multipartChecksumFromDurableParts(parts, intent.PartCount)
	}
	head, err := storage.HeadObject(r.Context(), AttachmentHeadObjectInput{Key: intent.StorageKey})
	if err == nil && verifyAttachmentHead(intent, head, expectedMultipart) == nil {
		s.writeCompletedAttachmentIntent(r.Context(), w, intent, actorUserID, head)
		return true
	}
	if r.Context().Err() != nil {
		return false
	}
	// Once the grace window has elapsed, reconcile provider state before
	// allowing a retry.
	transition := store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID, ActorUserID: actorUserID,
		UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()}
	if intent.Strategy == domain.AttachmentUploadStrategyMultipart {
		parts, err := storage.ListMultipartParts(r.Context(), AttachmentMultipartInput{Key: intent.StorageKey, UploadID: intent.MultipartUploadID})
		if err == nil {
			failureCode := "completion_retry"
			if verifyErr := s.verifyAndPersistMultipartParts(intent, parts); verifyErr != nil {
				failureCode = directUploadFailureCode(verifyErr)
			}
			_, _ = s.repo.ReopenAttachmentUploadIntent(transition, failureCode)
			return false
		}
		if errors.Is(err, ErrAttachmentObjectNotFound) {
			_ = storage.DeleteObject(r.Context(), intent.StorageKey)
			_, _ = s.repo.FailAttachmentUploadIntent(transition, "incomplete")
		}
		return false
	}
	_, _ = s.repo.ReopenAttachmentUploadIntent(transition, "completion_retry")
	return false
}

func (s *Server) writeCompletedAttachmentIntent(ctx context.Context, w http.ResponseWriter, intent domain.AttachmentUploadIntent, actorUserID string, head AttachmentHeadObjectOutput) {
	method := "client_reported"
	storageType := strings.TrimSpace(head.ChecksumType)
	if intent.Strategy == domain.AttachmentUploadStrategySingle && storageType == "" {
		storageType = "FULL_OBJECT"
	} else if intent.Strategy == domain.AttachmentUploadStrategyMultipart && storageType == "" {
		storageType = "COMPOSITE"
	}
	if strings.EqualFold(storageType, "FULL_OBJECT") && head.ChecksumValue == rawSHA256Base64(intent.SHA256) {
		method = "s3_full"
	}
	if intent.Status == domain.AttachmentUploadStatusCompleted {
		method = intent.SHA256VerificationMethod
		head.ChecksumAlgorithm = intent.StorageChecksumAlgorithm
		head.ChecksumValue = intent.StorageChecksumValue
		storageType = intent.StorageChecksumType
	}
	attachment, link, err := s.repo.FinalizeAttachmentUpload(store.AttachmentUploadFinalizeInput{CompanyID: intent.CompanyID,
		ActorUserID: actorUserID, UploadIntentID: intent.UploadIntentID, SHA256VerificationMethod: method,
		StorageChecksumAlgorithm: strings.TrimSpace(head.ChecksumAlgorithm), StorageChecksumValue: strings.TrimSpace(head.ChecksumValue),
		StorageChecksumType: storageType, Now: time.Now().UTC()})
	if err != nil {
		writeAttachmentUploadStoreError(w, err)
		return
	}
	if s.attachmentVariantEnsurer != nil {
		variants, variantErr := s.attachmentVariantEnsurer.EnsureImageVariants(ctx, attachment)
		if variantErr != nil {
			reason := strings.ReplaceAll(strings.TrimSpace(variantErr.Error()), "\n", " ")
			if len(reason) > 120 {
				reason = reason[:120]
			}
			log.Printf("attachment_image_variants status=skipped attachment_id=%s reason=%q", attachment.AttachmentID, reason)
		} else {
			attachment.Variants = variants
		}
	}
	log.Printf("attachment_direct_upload_job status=completed upload_job_id=%s strategy=%s size_bytes=%d latency_ms=%d", intent.UploadIntentID, intent.Strategy, intent.SizeBytes, time.Since(intent.CreatedTimestamp).Milliseconds())
	writeJSON(w, http.StatusCreated, attachmentUploadResponse{Attachment: attachment, ResourceAttachment: link})
}

func (s *Server) handleAttachmentUploadIntentAbort(w http.ResponseWriter, r *http.Request, uploadIntentID string) {
	storage, _, ok := s.directAttachmentUploadStorage(w)
	if !ok {
		return
	}
	actor, intent, ok := s.findAttachmentUploadIntentForActorAllowExpired(w, r, uploadIntentID)
	if !ok {
		return
	}
	if intent.Status != domain.AttachmentUploadStatusCompleted && intent.Status != domain.AttachmentUploadStatusAborted {
		if intent.Strategy == domain.AttachmentUploadStrategyMultipart {
			if err := storage.AbortMultipartUpload(r.Context(), AttachmentMultipartInput{Key: intent.StorageKey, UploadID: intent.MultipartUploadID}); err != nil {
				writeAttachmentDirectStorageError(w, err)
				return
			}
		}
		if err := storage.DeleteObject(r.Context(), intent.StorageKey); err != nil {
			writeAttachmentDirectStorageError(w, err)
			return
		}
	}
	intent, err := s.repo.AbortAttachmentUploadIntent(store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID,
		ActorUserID: actor.User.UserID, UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()})
	if err != nil {
		writeAttachmentUploadStoreError(w, err)
		return
	}
	log.Printf("attachment_direct_upload_job status=%s upload_job_id=%s", intent.Status, intent.UploadIntentID)
	writeJSON(w, http.StatusOK, map[string]any{"uploadIntentId": intent.UploadIntentID, "status": intent.Status})
}

func (s *Server) cleanupExpiredAttachmentUploads(ctx context.Context) {
	storage, ok := s.attachmentStorage.(AttachmentDirectUploadStorage)
	if !ok {
		return
	}
	items, err := s.repo.ListExpiredAttachmentUploadIntents(time.Now().UTC(), 100)
	if err != nil {
		log.Printf("attachment_direct_upload_cleanup status=list_failed")
		return
	}
	for _, intent := range items {
		if intent.Strategy == domain.AttachmentUploadStrategyMultipart {
			if err := storage.AbortMultipartUpload(ctx, AttachmentMultipartInput{Key: intent.StorageKey, UploadID: intent.MultipartUploadID}); err != nil {
				log.Printf("attachment_direct_upload_cleanup status=abort_failed upload_job_id=%s", intent.UploadIntentID)
				continue
			}
		}
		if err := storage.DeleteObject(ctx, intent.StorageKey); err != nil {
			log.Printf("attachment_direct_upload_cleanup status=delete_failed upload_job_id=%s", intent.UploadIntentID)
			continue
		}
		if _, err := s.repo.ExpireAttachmentUploadIntent(intent.UploadIntentID, time.Now().UTC()); err != nil {
			log.Printf("attachment_direct_upload_cleanup status=mark_failed upload_job_id=%s", intent.UploadIntentID)
			continue
		}
		log.Printf("attachment_direct_upload_cleanup status=expired upload_job_id=%s", intent.UploadIntentID)
	}
}

func (s *Server) cleanupDeniedAttachmentUpload(ctx context.Context, storage AttachmentDirectUploadStorage, actorUserID string, intent domain.AttachmentUploadIntent) {
	if intent.Status == domain.AttachmentUploadStatusCompleted || intent.Status == domain.AttachmentUploadStatusAborted {
		return
	}
	if intent.Strategy == domain.AttachmentUploadStrategyMultipart {
		if err := storage.AbortMultipartUpload(ctx, AttachmentMultipartInput{Key: intent.StorageKey, UploadID: intent.MultipartUploadID}); err != nil {
			return
		}
	}
	if err := storage.DeleteObject(ctx, intent.StorageKey); err != nil {
		return
	}
	_, _ = s.repo.AbortAttachmentUploadIntent(store.AttachmentUploadTransitionInput{CompanyID: intent.CompanyID,
		ActorUserID: actorUserID, UploadIntentID: intent.UploadIntentID, Now: time.Now().UTC()})
}

func (s *Server) startAttachmentUploadCleanup() {
	if s.attachmentUploadCleanupDisabled {
		return
	}
	config := s.attachmentDirectUpload.normalized()
	if !config.Enabled {
		return
	}
	if _, ok := s.attachmentStorage.(AttachmentDirectUploadStorage); !ok {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.attachmentUploadCleanupCancel = cancel
	go func() {
		// Clean once at startup so a quiet deployment still handles objects
		// orphaned by a previous process, then continue on a bounded cadence.
		s.cleanupExpiredAttachmentUploads(ctx)
		ticker := time.NewTicker(config.CleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.cleanupExpiredAttachmentUploads(ctx)
			}
		}
	}()
}

func (s *Server) directAttachmentUploadStorage(w http.ResponseWriter) (AttachmentDirectUploadStorage, attachmentDirectUploadConfig, bool) {
	config := s.attachmentDirectUpload.normalized()
	storage, ok := s.attachmentStorage.(AttachmentDirectUploadStorage)
	if !config.Enabled || !ok {
		writeError(w, http.StatusServiceUnavailable, "attachment_upload_storage_unavailable")
		return nil, config, false
	}
	return storage, config, true
}

func (s *Server) resolveAttachmentUploadCompany(w http.ResponseWriter, r *http.Request, actor ActorContext, resourceType, resourceID string) (string, bool) {
	resourceID = strings.TrimSpace(resourceID)
	if companyID := strings.TrimSpace(r.Header.Get(attachmentCompanyContextHeader)); companyID != "" {
		if activeCompanyID := strings.TrimSpace(actor.CompanyID); activeCompanyID != "" && activeCompanyID != companyID {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return "", false
		}
		if actorRoleForCompany(actor, companyID) == "" && !actor.IsDevAdmin {
			writeError(w, http.StatusForbidden, "company_access_denied")
			return "", false
		}
		if !s.requireAttachmentResourceEdit(w, r, companyID, resourceType, resourceID) {
			return "", false
		}
		return companyID, true
	}
	if companyID := strings.TrimSpace(actor.CompanyID); companyID != "" && (actorRoleForCompany(actor, companyID) != "" || actor.IsDevAdmin) {
		if !s.requireAttachmentResourceEdit(w, r, companyID, resourceType, resourceID) {
			return "", false
		}
		return companyID, true
	}
	candidates := make([]string, 0)
	seen := map[string]bool{}
	ordered := make([]string, 0, len(actor.Memberships))
	for _, membership := range actor.Memberships {
		if companyID := strings.TrimSpace(membership.CompanyID); companyID != "" && !seen[companyID] {
			ordered = append(ordered, companyID)
			seen[companyID] = true
		}
	}
	for _, companyID := range ordered {
		allowed, err := s.canEditAttachmentResourceForResolution(companyID, actor.User.UserID, resourceType, resourceID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed_to_check_attachment_permission")
			return "", false
		}
		if allowed {
			candidates = append(candidates, companyID)
		}
	}
	if len(candidates) == 1 {
		if !s.requireAttachmentResourceEdit(w, r, candidates[0], resourceType, resourceID) {
			return "", false
		}
		return candidates[0], true
	}
	if len(candidates) == 0 && len(ordered) == 1 {
		if !s.requireAttachmentResourceEdit(w, r, ordered[0], resourceType, resourceID) {
			return "", false
		}
		return ordered[0], true
	}
	if len(candidates) == 0 {
		writeAccessResourceNotFound(w)
	} else {
		writeError(w, http.StatusConflict, "attachment_resource_company_ambiguous")
	}
	return "", false
}

func (s *Server) canEditAttachmentResourceForResolution(companyID, userID, resourceType, resourceID string) (bool, error) {
	if isFinalEmailAttachmentResource(resourceType) {
		access, err := s.getEmailAttachmentResourceAccess(companyID, userID, resourceType, resourceID)
		if errors.Is(err, store.ErrInvalid) || errors.Is(err, store.ErrNotFound) {
			return false, nil
		}
		return access.Allowed, err
	}
	entityType, ok := attachmentPermissionEntityType(resourceType)
	if !ok {
		return false, nil
	}
	return s.repo.UserHasEffectiveAccess(companyID, userID, entityType, resourceID, store.EntityPermissionEdit)
}
func (s *Server) findAttachmentUploadIntentForActor(w http.ResponseWriter, r *http.Request, uploadIntentID string) (ActorContext, domain.AttachmentUploadIntent, bool) {
	return s.findAttachmentUploadIntentForActorWithExpiry(w, r, uploadIntentID, false)
}

func (s *Server) findAttachmentUploadIntentForActorAllowExpired(w http.ResponseWriter, r *http.Request, uploadIntentID string) (ActorContext, domain.AttachmentUploadIntent, bool) {
	return s.findAttachmentUploadIntentForActorWithExpiry(w, r, uploadIntentID, true)
}

func (s *Server) findAttachmentUploadIntentForActorWithExpiry(w http.ResponseWriter, r *http.Request, uploadIntentID string, allowExpired bool) (ActorContext, domain.AttachmentUploadIntent, bool) {
	actor, ok := authenticatedActor(r)
	if !ok || strings.TrimSpace(actor.User.UserID) == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return ActorContext{}, domain.AttachmentUploadIntent{}, false
	}
	companyIDs := make([]string, 0, len(actor.Memberships)+1)
	seen := map[string]bool{}
	if companyID := strings.TrimSpace(actor.CompanyID); companyID != "" {
		companyIDs = append(companyIDs, companyID)
		seen[companyID] = true
	}
	for _, membership := range actor.Memberships {
		companyID := strings.TrimSpace(membership.CompanyID)
		if companyID != "" && !seen[companyID] {
			companyIDs = append(companyIDs, companyID)
			seen[companyID] = true
		}
	}
	for _, companyID := range companyIDs {
		intent, err := s.repo.GetAttachmentUploadIntent(companyID, actor.User.UserID, uploadIntentID)
		if err == nil {
			if !allowExpired && !uploadIntentTerminal(intent.Status) && !intent.ExpiresTimestamp.After(time.Now().UTC()) {
				writeError(w, http.StatusGone, "attachment_upload_intent_expired")
				return ActorContext{}, domain.AttachmentUploadIntent{}, false
			}
			return actor, intent, true
		}
		if !errors.Is(err, store.ErrNotFound) {
			writeAttachmentUploadStoreError(w, err)
			return ActorContext{}, domain.AttachmentUploadIntent{}, false
		}
	}
	writeError(w, http.StatusNotFound, "attachment_upload_intent_not_found")
	return ActorContext{}, domain.AttachmentUploadIntent{}, false
}

func (s *Server) persistObservedAttachmentParts(intent domain.AttachmentUploadIntent, observed []AttachmentS3Part) ([]domain.AttachmentUploadPart, error) {
	parts := make([]domain.AttachmentUploadPart, 0, len(observed))
	for _, part := range observed {
		parts = append(parts, domain.AttachmentUploadPart{PartNumber: part.PartNumber, ObservedSizeBytes: part.SizeBytes,
			ETag: part.ETag, S3Checksum: part.ChecksumSHA256})
	}
	return s.repo.ReplaceAttachmentUploadObservedParts(store.AttachmentUploadObservedPartsInput{CompanyID: intent.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Parts: parts, Now: time.Now().UTC()})
}

func (s *Server) verifyAndPersistMultipartParts(intent domain.AttachmentUploadIntent, observed []AttachmentS3Part) error {
	durable, err := s.persistObservedAttachmentParts(intent, observed)
	if err != nil {
		return err
	}
	if len(observed) != intent.PartCount || len(durable) < intent.PartCount {
		return errors.New("incomplete")
	}
	durableByNumber := map[int]domain.AttachmentUploadPart{}
	for _, part := range durable {
		durableByNumber[part.PartNumber] = part
	}
	sort.Slice(observed, func(i, j int) bool { return observed[i].PartNumber < observed[j].PartNumber })
	for index, part := range observed {
		if part.PartNumber != index+1 {
			return errors.New("incomplete")
		}
		expected, ok := durableByNumber[part.PartNumber]
		if !ok || expected.ExpectedChecksum == "" || strings.TrimSpace(part.ETag) == "" {
			return errors.New("incomplete")
		}
		if expected.ExpectedSizeBytes != part.SizeBytes {
			return errors.New("size_mismatch")
		}
		if expected.ExpectedChecksum != part.ChecksumSHA256 {
			return errors.New("checksum_mismatch")
		}
	}
	return nil
}

func verifyAttachmentHead(intent domain.AttachmentUploadIntent, head AttachmentHeadObjectOutput, expectedMultipart string) error {
	if head.ContentLength != intent.SizeBytes {
		return errors.New("size_mismatch")
	}
	if !strings.EqualFold(strings.TrimSpace(head.ChecksumAlgorithm), "SHA256") || strings.TrimSpace(head.ChecksumValue) == "" {
		return errors.New("checksum_mismatch")
	}
	if intent.Strategy == domain.AttachmentUploadStrategySingle {
		if (strings.TrimSpace(head.ChecksumType) != "" && !strings.EqualFold(strings.TrimSpace(head.ChecksumType), "FULL_OBJECT")) ||
			head.ChecksumValue != rawSHA256Base64(intent.SHA256) {
			return errors.New("checksum_mismatch")
		}
	} else {
		expected := expectedMultipart
		if strings.EqualFold(strings.TrimSpace(head.ChecksumType), "FULL_OBJECT") {
			expected = rawSHA256Base64(intent.SHA256)
		}
		if expected == "" || head.ChecksumValue != expected {
			return errors.New("checksum_mismatch")
		}
	}
	expectedSSE := strings.TrimSpace(os.Getenv("MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION"))
	if expectedSSE == "" {
		expectedSSE = "AES256"
	}
	if !strings.EqualFold(expectedSSE, "none") && !strings.EqualFold(strings.TrimSpace(head.ServerSideEncryption), expectedSSE) {
		return errors.New("encryption_mismatch")
	}
	return nil
}

func multipartChecksumFromS3Parts(parts []AttachmentS3Part) string {
	ordered := append([]AttachmentS3Part(nil), parts...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].PartNumber < ordered[j].PartNumber })
	checksums := make([]string, 0, len(ordered))
	for _, part := range ordered {
		checksums = append(checksums, part.ChecksumSHA256)
	}
	return multipartChecksumFromBase64Parts(checksums)
}

func multipartChecksumFromDurableParts(parts []domain.AttachmentUploadPart, partCount int) string {
	ordered := append([]domain.AttachmentUploadPart(nil), parts...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].PartNumber < ordered[j].PartNumber })
	if len(ordered) != partCount {
		return ""
	}
	checksums := make([]string, 0, len(ordered))
	for index, part := range ordered {
		if part.PartNumber != index+1 || part.ExpectedChecksum == "" {
			return ""
		}
		checksums = append(checksums, part.ExpectedChecksum)
	}
	return multipartChecksumFromBase64Parts(checksums)
}

func multipartChecksumFromBase64Parts(checksums []string) string {
	if len(checksums) == 0 {
		return ""
	}
	joined := make([]byte, 0, len(checksums)*sha256.Size)
	for _, encoded := range checksums {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
		if err != nil || len(decoded) != sha256.Size {
			return ""
		}
		joined = append(joined, decoded...)
	}
	digest := sha256.Sum256(joined)
	return base64.StdEncoding.EncodeToString(digest[:]) + "-" + strconv.Itoa(len(checksums))
}

func acceptedAttachmentParts(parts []domain.AttachmentUploadPart) []attachmentAcceptedPartResponse {
	items := make([]attachmentAcceptedPartResponse, 0)
	for _, part := range parts {
		if part.ETag == "" || part.S3Checksum == "" || part.ObservedSizeBytes != part.ExpectedSizeBytes || part.S3Checksum != part.ExpectedChecksum {
			continue
		}
		items = append(items, attachmentAcceptedPartResponse{PartNumber: part.PartNumber, SizeBytes: part.ObservedSizeBytes,
			ETag: part.ETag, Checksum: part.S3Checksum})
	}
	return items
}

func validAttachmentUploadIntentRequest(req attachmentUploadIntentRequest) bool {
	sha := strings.TrimSpace(req.SHA256)
	return strings.TrimSpace(req.ClientRequestID) != "" && len(req.ClientRequestID) <= 200 && validAttachmentSignedHeaderValue(req.ClientRequestID) &&
		strings.TrimSpace(req.Filename) != "" && len(req.Filename) <= 1024 && validAttachmentSignedHeaderValue(req.Filename) && req.SizeBytes >= 0 &&
		sha == strings.ToLower(sha) && validAttachmentSHA256Hex(sha) && strings.TrimSpace(req.ContentType) != "" &&
		strings.TrimSpace(req.ResourceType) != "" && strings.TrimSpace(req.ResourceID) != "" && len(req.ResourceID) <= 2048 && validAttachmentSignedHeaderValue(req.ResourceID) &&
		(req.InformationID == "" || validAttachmentUUIDText(req.InformationID)) &&
		(req.OriginalWidth == nil || *req.OriginalWidth > 0) && (req.OriginalHeight == nil || *req.OriginalHeight > 0)
}

func validAttachmentUUIDText(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	decoded, err := hex.DecodeString(strings.ReplaceAll(value, "-", ""))
	return err == nil && len(decoded) == 16
}

func normalizeAttachmentUploadContentType(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 255 || !validAttachmentSignedHeaderValue(value) {
		return "", false
	}
	mediaType, parameters, err := mime.ParseMediaType(value)
	if err != nil || strings.TrimSpace(mediaType) == "" {
		return "", false
	}
	normalized := mime.FormatMediaType(strings.ToLower(mediaType), parameters)
	if normalized == "" || len(normalized) > 255 {
		return "", false
	}
	return normalized, true
}

func validAttachmentSignedHeaderValue(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}

func attachmentIntentMatchesRequest(intent domain.AttachmentUploadIntent, req attachmentUploadIntentRequest) bool {
	return intent.ClientRequestID == strings.TrimSpace(req.ClientRequestID) && intent.OriginalFilename == strings.TrimSpace(req.Filename) &&
		intent.SizeBytes == req.SizeBytes && intent.SHA256 == strings.TrimSpace(req.SHA256) && intent.MimeType == strings.TrimSpace(req.ContentType) &&
		intent.ResourceType == store.NormalizeAttachmentResourceType(req.ResourceType) && intent.ResourceID == strings.TrimSpace(req.ResourceID) &&
		intent.RelationshipKind == store.NormalizeAttachmentRelationshipKind(req.RelationshipKind) && intent.SourceKind == store.NormalizeAttachmentSourceKind(req.SourceKind) &&
		intent.InformationID == strings.TrimSpace(req.InformationID) && intent.MessageID == strings.TrimSpace(req.MessageID) &&
		intent.EditorSurface == strings.TrimSpace(req.EditorSurface) && intent.SourceProvider == strings.TrimSpace(req.SourceProvider) &&
		sameAttachmentDimension(intent.OriginalWidth, req.OriginalWidth) && sameAttachmentDimension(intent.OriginalHeight, req.OriginalHeight)
}

func sameAttachmentDimension(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func rawSHA256Base64(rawHex string) string {
	decoded, err := hex.DecodeString(strings.TrimSpace(rawHex))
	if err != nil {
		return ""
	}
	return base64.StdEncoding.EncodeToString(decoded)
}

func attachmentUploadURLLifetime(intentExpires time.Time, configured time.Duration) (time.Duration, bool) {
	remaining := time.Until(intentExpires)
	if remaining < time.Second {
		return 0, false
	}
	remaining = time.Duration(int64(remaining/time.Second)) * time.Second
	if configured <= 0 || configured > remaining {
		configured = remaining
	}
	return configured, true
}

func uploadIntentTerminal(status string) bool {
	return status == domain.AttachmentUploadStatusCompleted || status == domain.AttachmentUploadStatusAborted || status == domain.AttachmentUploadStatusExpired
}

func directUploadFailureCode(err error) string {
	switch strings.TrimSpace(err.Error()) {
	case "checksum_mismatch":
		return "checksum_mismatch"
	case "size_mismatch":
		return "size_mismatch"
	case "incomplete":
		return "incomplete"
	default:
		return "verification_failed"
	}
}

func writeAttachmentCompletionError(w http.ResponseWriter, err error) {
	failureCode := directUploadFailureCode(err)
	log.Printf("attachment_direct_upload_verification status=failed code=%s", failureCode)
	switch failureCode {
	case "checksum_mismatch":
		writeError(w, http.StatusUnprocessableEntity, "attachment_upload_checksum_mismatch")
	case "size_mismatch":
		writeError(w, http.StatusUnprocessableEntity, "attachment_upload_size_mismatch")
	case "incomplete":
		writeError(w, http.StatusConflict, "attachment_upload_incomplete")
	default:
		writeError(w, http.StatusUnprocessableEntity, "attachment_upload_verification_failed")
	}
}

func writeAttachmentUploadStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "attachment_upload_intent_not_found")
	case errors.Is(err, store.ErrUploadIntentExpired):
		writeError(w, http.StatusGone, "attachment_upload_intent_expired")
	case errors.Is(err, store.ErrUploadPayloadConflict), errors.Is(err, store.ErrUploadStateConflict), errors.Is(err, store.ErrAlreadyExists):
		writeError(w, http.StatusConflict, "attachment_upload_state_conflict")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, http.StatusBadRequest, "attachment_upload_part_invalid")
	default:
		writeError(w, http.StatusInternalServerError, "attachment_upload_failed")
	}
}

func writeAttachmentDirectStorageError(w http.ResponseWriter, err error) {
	log.Printf("attachment_direct_upload_storage status=failed category=%s", attachmentDirectStorageErrorCategory(err))
	if errors.Is(err, ErrAttachmentObjectNotFound) {
		writeError(w, http.StatusConflict, "attachment_upload_incomplete")
		return
	}
	if errors.Is(err, ErrAttachmentStorageUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "attachment_upload_storage_unavailable")
		return
	}
	writeError(w, http.StatusBadGateway, "attachment_upload_storage_failed")
}

func attachmentDirectStorageErrorCategory(err error) string {
	switch {
	case errors.Is(err, ErrAttachmentObjectNotFound):
		return "not_found"
	case errors.Is(err, ErrAttachmentStorageUnavailable):
		return "unavailable"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	default:
		return "provider_error"
	}
}
