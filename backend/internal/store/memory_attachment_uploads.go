package store

import (
	"encoding/base64"
	"encoding/hex"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) GetAttachmentUploadIntentByClientRequest(companyID, actorUserID, clientRequestID string) (domain.AttachmentUploadIntent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	id := r.attachmentUploadRequestIDs[attachmentUploadRequestKey(companyID, actorUserID, clientRequestID)]
	if id == "" {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	intent, ok := r.attachmentUploadIntents[id]
	if !ok {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	return cloneAttachmentUploadIntent(intent), nil
}

func (r *MemoryRepo) CreateAttachmentUploadIntent(input AttachmentUploadIntentCreateInput) (domain.AttachmentUploadIntent, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, err := normalizeAttachmentUploadIntentCreateInput(input)
	if err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	if _, ok := r.companies[intent.CompanyID]; !ok {
		return domain.AttachmentUploadIntent{}, false, ErrNotFound
	}
	requestKey := attachmentUploadRequestKey(intent.CompanyID, intent.ActorUserID, intent.ClientRequestID)
	if existingID := r.attachmentUploadRequestIDs[requestKey]; existingID != "" {
		existing := r.attachmentUploadIntents[existingID]
		if !sameAttachmentUploadPayload(existing, intent) {
			return domain.AttachmentUploadIntent{}, false, ErrUploadPayloadConflict
		}
		return cloneAttachmentUploadIntent(existing), false, nil
	}
	if _, ok := r.attachmentUploadIntents[intent.UploadIntentID]; ok {
		return domain.AttachmentUploadIntent{}, false, ErrAlreadyExists
	}
	r.attachmentUploadIntents[intent.UploadIntentID] = intent
	r.attachmentUploadRequestIDs[requestKey] = intent.UploadIntentID
	r.attachmentUploadParts[intent.UploadIntentID] = map[int]domain.AttachmentUploadPart{}
	return cloneAttachmentUploadIntent(intent), true, nil
}

func (r *MemoryRepo) GetAttachmentUploadIntent(companyID, actorUserID, uploadIntentID string) (domain.AttachmentUploadIntent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	intent, ok := r.attachmentUploadIntents[cleanUUIDText(uploadIntentID)]
	if !ok || intent.CompanyID != strings.TrimSpace(companyID) || intent.ActorUserID != cleanUUIDText(actorUserID) {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	return cloneAttachmentUploadIntent(intent), nil
}

func (r *MemoryRepo) UpsertAttachmentUploadParts(input AttachmentUploadPartsInput) ([]domain.AttachmentUploadPart, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, err := r.mutableUploadIntentLocked(input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return nil, err
	}
	if intent.Strategy != domain.AttachmentUploadStrategyMultipart || (intent.Status != domain.AttachmentUploadStatusPending && intent.Status != domain.AttachmentUploadStatusUploading) {
		return nil, ErrUploadStateConflict
	}
	parts := r.attachmentUploadParts[intent.UploadIntentID]
	if parts == nil {
		parts = map[int]domain.AttachmentUploadPart{}
		r.attachmentUploadParts[intent.UploadIntentID] = parts
	}
	now := normalizedUploadNow(input.Now)
	for _, requested := range input.Parts {
		part, err := normalizeAttachmentUploadPart(intent, requested, now)
		if err != nil {
			return nil, err
		}
		if existing, ok := parts[part.PartNumber]; ok {
			if existing.ExpectedChecksum != part.ExpectedChecksum || existing.ChecksumAlgorithm != part.ChecksumAlgorithm {
				return nil, ErrUploadPayloadConflict
			}
			part.ETag = existing.ETag
			part.S3Checksum = existing.S3Checksum
			part.UploadedTimestamp = cloneTimePointer(existing.UploadedTimestamp)
			part.ObservedSizeBytes = existing.ObservedSizeBytes
			part.SigningAttemptCount = existing.SigningAttemptCount
			part.LastSignedTimestamp = cloneTimePointer(existing.LastSignedTimestamp)
			part.CreatedTimestamp = existing.CreatedTimestamp
		}
		part.SigningAttemptCount++
		part.LastSignedTimestamp = &now
		parts[part.PartNumber] = part
	}
	intent.Status = domain.AttachmentUploadStatusUploading
	intent.FailureCode = ""
	intent.Version++
	intent.UpdatedTimestamp = now
	r.attachmentUploadIntents[intent.UploadIntentID] = intent
	return cloneAttachmentUploadParts(parts), nil
}

func (r *MemoryRepo) ReplaceAttachmentUploadObservedParts(input AttachmentUploadObservedPartsInput) ([]domain.AttachmentUploadPart, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, err := r.mutableUploadIntentLocked(input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return nil, err
	}
	if intent.Strategy != domain.AttachmentUploadStrategyMultipart {
		return nil, ErrUploadStateConflict
	}
	parts := r.attachmentUploadParts[intent.UploadIntentID]
	if parts == nil {
		parts = map[int]domain.AttachmentUploadPart{}
		r.attachmentUploadParts[intent.UploadIntentID] = parts
	}
	for number, part := range parts {
		part.ETag = ""
		part.S3Checksum = ""
		part.UploadedTimestamp = nil
		parts[number] = part
	}
	now := normalizedUploadNow(input.Now)
	for _, observed := range input.Parts {
		if observed.PartNumber < 1 || observed.PartNumber > intent.PartCount {
			return nil, ErrInvalid
		}
		part := parts[observed.PartNumber]
		part.UploadIntentID = intent.UploadIntentID
		part.PartNumber = observed.PartNumber
		part.ObservedSizeBytes = observed.ObservedSizeBytes
		part.ETag = strings.Trim(strings.TrimSpace(observed.ETag), "\"")
		part.S3Checksum = strings.TrimSpace(observed.S3Checksum)
		part.UpdatedTimestamp = now
		part.UploadedTimestamp = cloneTimePointer(observed.UploadedTimestamp)
		if part.UploadedTimestamp == nil {
			part.UploadedTimestamp = &now
		}
		parts[part.PartNumber] = part
	}
	intent.UpdatedTimestamp = now
	intent.Version++
	r.attachmentUploadIntents[intent.UploadIntentID] = intent
	return cloneAttachmentUploadParts(parts), nil
}

func (r *MemoryRepo) ListAttachmentUploadParts(companyID, actorUserID, uploadIntentID string) ([]domain.AttachmentUploadPart, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	intent, ok := r.attachmentUploadIntents[cleanUUIDText(uploadIntentID)]
	if !ok || intent.CompanyID != strings.TrimSpace(companyID) || intent.ActorUserID != cleanUUIDText(actorUserID) {
		return nil, ErrNotFound
	}
	return cloneAttachmentUploadParts(r.attachmentUploadParts[intent.UploadIntentID]), nil
}

func (r *MemoryRepo) BeginAttachmentUploadCompletion(input AttachmentUploadTransitionInput) (domain.AttachmentUploadIntent, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, err := r.mutableUploadIntentLocked(input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return domain.AttachmentUploadIntent{}, false, err
	}
	if intent.Status == domain.AttachmentUploadStatusCompleted {
		return cloneAttachmentUploadIntent(intent), false, nil
	}
	now := normalizedUploadNow(input.Now)
	if intent.Status == domain.AttachmentUploadStatusCompleting && now.Sub(intent.UpdatedTimestamp) < 2*time.Minute {
		return cloneAttachmentUploadIntent(intent), false, nil
	}
	if intent.Status != domain.AttachmentUploadStatusPending && intent.Status != domain.AttachmentUploadStatusUploading && intent.Status != domain.AttachmentUploadStatusCompleting {
		return domain.AttachmentUploadIntent{}, false, ErrUploadStateConflict
	}
	intent.Status = domain.AttachmentUploadStatusCompleting
	intent.FailureCode = ""
	intent.Version++
	intent.UpdatedTimestamp = now
	r.attachmentUploadIntents[intent.UploadIntentID] = intent
	return cloneAttachmentUploadIntent(intent), true, nil
}

func (r *MemoryRepo) ReopenAttachmentUploadIntent(input AttachmentUploadTransitionInput, failureCode string) (domain.AttachmentUploadIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, err := r.mutableUploadIntentLocked(input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return domain.AttachmentUploadIntent{}, err
	}
	if intent.Status == domain.AttachmentUploadStatusCompleted {
		return cloneAttachmentUploadIntent(intent), nil
	}
	if intent.Status != domain.AttachmentUploadStatusCompleting && intent.Status != domain.AttachmentUploadStatusFailed {
		return domain.AttachmentUploadIntent{}, ErrUploadStateConflict
	}
	now := normalizedUploadNow(input.Now)
	intent.Status = domain.AttachmentUploadStatusUploading
	intent.FailureCode = strings.TrimSpace(failureCode)
	intent.Version++
	intent.UpdatedTimestamp = now
	r.attachmentUploadIntents[intent.UploadIntentID] = intent
	return cloneAttachmentUploadIntent(intent), nil
}

func (r *MemoryRepo) FailAttachmentUploadIntent(input AttachmentUploadTransitionInput, failureCode string) (domain.AttachmentUploadIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, err := r.mutableUploadIntentLocked(input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return domain.AttachmentUploadIntent{}, err
	}
	if intent.Status == domain.AttachmentUploadStatusCompleted || intent.Status == domain.AttachmentUploadStatusAborted {
		return domain.AttachmentUploadIntent{}, ErrUploadStateConflict
	}
	now := normalizedUploadNow(input.Now)
	intent.Status = domain.AttachmentUploadStatusFailed
	intent.FailureCode = strings.TrimSpace(failureCode)
	intent.Version++
	intent.UpdatedTimestamp = now
	r.attachmentUploadIntents[intent.UploadIntentID] = intent
	return cloneAttachmentUploadIntent(intent), nil
}

func (r *MemoryRepo) FinalizeAttachmentUpload(input AttachmentUploadFinalizeInput) (domain.Attachment, domain.ResourceAttachment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, err := r.mutableUploadIntentLocked(input.CompanyID, input.ActorUserID, input.UploadIntentID, input.Now)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	if intent.Status == domain.AttachmentUploadStatusCompleted {
		attachment := r.attachments[attachmentKey(intent.CompanyID, intent.AttachmentID)]
		links := r.resourceAttachmentLinksLocked(intent.CompanyID, intent.AttachmentID, true)
		var primaryLink domain.ResourceAttachment
		for _, candidate := range links {
			if intent.ResourceAttachmentID != "" && candidate.ResourceAttachmentID == intent.ResourceAttachmentID {
				primaryLink = candidate
				break
			}
			if intent.ResourceAttachmentID == "" && candidate.ResourceType == intent.ResourceType && candidate.ResourceID == intent.ResourceID &&
				candidate.RelationshipKind == intent.RelationshipKind && candidate.InformationID == intent.InformationID &&
				candidate.MessageID == intent.MessageID && candidate.EditorSurface == intent.EditorSurface {
				primaryLink = candidate
				break
			}
		}
		if attachment.AttachmentID == "" || primaryLink.ResourceAttachmentID == "" {
			return domain.Attachment{}, domain.ResourceAttachment{}, ErrUploadStateConflict
		}
		return cloneAttachment(attachment), cloneResourceAttachment(primaryLink), nil
	}
	if intent.Status != domain.AttachmentUploadStatusCompleting {
		return domain.Attachment{}, domain.ResourceAttachment{}, ErrUploadStateConflict
	}
	now := normalizedUploadNow(input.Now)
	attachment, link, err := normalizeAttachmentCreateInput(AttachmentCreateInput{
		CompanyID: intent.CompanyID, AttachmentID: intent.AttachmentID, UploadedByUserID: intent.ActorUserID,
		OriginalFilename: intent.OriginalFilename, MimeType: intent.MimeType, ByteSize: intent.SizeBytes,
		SHA256: intent.SHA256, SHA256VerificationMethod: input.SHA256VerificationMethod,
		StorageChecksumAlgorithm: input.StorageChecksumAlgorithm, StorageChecksumValue: input.StorageChecksumValue,
		StorageChecksumType: input.StorageChecksumType, StorageBucket: intent.StorageBucket, StorageKey: intent.StorageKey,
		OriginalWidth: intent.OriginalWidth, OriginalHeight: intent.OriginalHeight, SourceKind: intent.SourceKind,
		SourceProvider: intent.SourceProvider, CreatedTimestamp: now,
		ResourceLink: ResourceAttachmentInput{CompanyID: intent.CompanyID, ResourceType: intent.ResourceType,
			ResourceID: intent.ResourceID, InformationID: intent.InformationID, MessageID: intent.MessageID,
			EditorSurface: intent.EditorSurface, RelationshipKind: intent.RelationshipKind,
			CreatedByUserID: intent.ActorUserID, CreatedTimestamp: now},
	})
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	if existing, ok := r.attachments[attachmentKey(intent.CompanyID, intent.AttachmentID)]; ok {
		attachment = existing
	} else {
		r.attachments[attachmentKey(intent.CompanyID, intent.AttachmentID)] = attachment
	}
	link.AttachmentID = attachment.AttachmentID
	storedLink, err := r.upsertResourceAttachmentLocked(link)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	intent.Status = domain.AttachmentUploadStatusCompleted
	intent.ResourceAttachmentID = storedLink.ResourceAttachmentID
	intent.SHA256VerificationMethod = strings.TrimSpace(input.SHA256VerificationMethod)
	intent.StorageChecksumAlgorithm = strings.TrimSpace(input.StorageChecksumAlgorithm)
	intent.StorageChecksumValue = strings.TrimSpace(input.StorageChecksumValue)
	intent.StorageChecksumType = strings.TrimSpace(input.StorageChecksumType)
	intent.FailureCode = ""
	intent.CompletedTimestamp = &now
	intent.UpdatedTimestamp = now
	intent.Version++
	r.attachmentUploadIntents[intent.UploadIntentID] = intent
	return cloneAttachment(attachment), cloneResourceAttachment(storedLink), nil
}

func (r *MemoryRepo) AbortAttachmentUploadIntent(input AttachmentUploadTransitionInput) (domain.AttachmentUploadIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, ok := r.attachmentUploadIntents[cleanUUIDText(input.UploadIntentID)]
	if !ok || intent.CompanyID != strings.TrimSpace(input.CompanyID) || intent.ActorUserID != cleanUUIDText(input.ActorUserID) {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	if intent.Status == domain.AttachmentUploadStatusAborted || intent.Status == domain.AttachmentUploadStatusExpired || intent.Status == domain.AttachmentUploadStatusCompleted {
		return cloneAttachmentUploadIntent(intent), nil
	}
	now := normalizedUploadNow(input.Now)
	intent.Status = domain.AttachmentUploadStatusAborted
	intent.FailureCode = ""
	intent.UpdatedTimestamp = now
	intent.Version++
	r.attachmentUploadIntents[intent.UploadIntentID] = intent
	return cloneAttachmentUploadIntent(intent), nil
}

func (r *MemoryRepo) ListExpiredAttachmentUploadIntents(now time.Time, limit int) ([]domain.AttachmentUploadIntent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	now = normalizedUploadNow(now)
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	items := make([]domain.AttachmentUploadIntent, 0)
	for _, intent := range r.attachmentUploadIntents {
		if (intent.Status != domain.AttachmentUploadStatusFailed && intent.ExpiresTimestamp.After(now)) || uploadStatusTerminal(intent.Status) {
			continue
		}
		items = append(items, cloneAttachmentUploadIntent(intent))
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ExpiresTimestamp.Before(items[j].ExpiresTimestamp) })
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *MemoryRepo) ExpireAttachmentUploadIntent(uploadIntentID string, now time.Time) (domain.AttachmentUploadIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	intent, ok := r.attachmentUploadIntents[cleanUUIDText(uploadIntentID)]
	if !ok {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	if uploadStatusTerminal(intent.Status) {
		return cloneAttachmentUploadIntent(intent), nil
	}
	now = normalizedUploadNow(now)
	intent.Status = domain.AttachmentUploadStatusExpired
	intent.UpdatedTimestamp = now
	intent.Version++
	r.attachmentUploadIntents[intent.UploadIntentID] = intent
	return cloneAttachmentUploadIntent(intent), nil
}

func normalizeAttachmentUploadIntentCreateInput(input AttachmentUploadIntentCreateInput) (domain.AttachmentUploadIntent, error) {
	now := normalizedUploadNow(input.CreatedTimestamp)
	intent := domain.AttachmentUploadIntent{
		UploadIntentID: cleanUUIDText(input.UploadIntentID), CompanyID: strings.TrimSpace(input.CompanyID),
		ActorUserID: cleanUUIDText(input.ActorUserID), ClientRequestID: strings.TrimSpace(input.ClientRequestID),
		AttachmentID: cleanUUIDText(input.AttachmentID), OriginalFilename: attachmentFilenameForStore(input.OriginalFilename),
		MimeType: strings.TrimSpace(input.MimeType), SizeBytes: input.SizeBytes, SHA256: strings.ToLower(strings.TrimSpace(input.SHA256)),
		SHA256VerificationMethod: "client_reported", ResourceType: NormalizeAttachmentResourceType(input.ResourceType),
		ResourceID: strings.TrimSpace(input.ResourceID), InformationID: cleanUUIDText(input.InformationID), MessageID: strings.TrimSpace(input.MessageID),
		EditorSurface: strings.TrimSpace(input.EditorSurface), RelationshipKind: NormalizeAttachmentRelationshipKind(input.RelationshipKind),
		SourceKind: NormalizeAttachmentSourceKind(input.SourceKind), SourceProvider: strings.TrimSpace(input.SourceProvider),
		OriginalWidth: cloneAttachmentIntPointer(input.OriginalWidth), OriginalHeight: cloneAttachmentIntPointer(input.OriginalHeight),
		StorageBucket: strings.TrimSpace(input.StorageBucket), StorageKey: strings.TrimSpace(input.StorageKey),
		MultipartUploadID: strings.TrimSpace(input.MultipartUploadID), Strategy: strings.TrimSpace(input.Strategy),
		PartSizeBytes: input.PartSizeBytes, PartCount: input.PartCount, Status: domain.AttachmentUploadStatusPending,
		Version: 1, CreatedTimestamp: now, UpdatedTimestamp: now, ExpiresTimestamp: input.ExpiresTimestamp.UTC(),
	}
	if intent.UploadIntentID == "" || intent.CompanyID == "" || intent.ActorUserID == "" || intent.ClientRequestID == "" ||
		intent.AttachmentID == "" || intent.MimeType == "" || intent.SizeBytes < 0 || !validRawSHA256(intent.SHA256) ||
		intent.ResourceType == "" || intent.ResourceID == "" || intent.RelationshipKind == "" || intent.SourceKind == "" ||
		intent.StorageBucket == "" || intent.StorageKey == "" || !intent.ExpiresTimestamp.After(now) {
		return domain.AttachmentUploadIntent{}, ErrInvalid
	}
	switch intent.Strategy {
	case domain.AttachmentUploadStrategySingle:
		if intent.SizeBytes > 64*1024*1024 || intent.MultipartUploadID != "" || intent.PartSizeBytes != 0 || intent.PartCount != 0 {
			return domain.AttachmentUploadIntent{}, ErrInvalid
		}
	case domain.AttachmentUploadStrategyMultipart:
		expectedPartCount := int((intent.SizeBytes + 16*1024*1024 - 1) / (16 * 1024 * 1024))
		if intent.SizeBytes <= 64*1024*1024 || intent.MultipartUploadID == "" || intent.PartSizeBytes != 16*1024*1024 ||
			intent.PartCount != expectedPartCount || intent.PartCount <= 0 || intent.PartCount > 10000 {
			return domain.AttachmentUploadIntent{}, ErrInvalid
		}
	default:
		return domain.AttachmentUploadIntent{}, ErrInvalid
	}
	return intent, nil
}

func normalizeAttachmentUploadPart(intent domain.AttachmentUploadIntent, input domain.AttachmentUploadPart, now time.Time) (domain.AttachmentUploadPart, error) {
	checksum := strings.TrimSpace(input.ExpectedChecksum)
	decoded, err := base64.StdEncoding.DecodeString(checksum)
	if err != nil || len(decoded) != 32 || input.PartNumber < 1 || input.PartNumber > intent.PartCount || !strings.EqualFold(strings.TrimSpace(input.ChecksumAlgorithm), "SHA256") {
		return domain.AttachmentUploadPart{}, ErrInvalid
	}
	created := input.CreatedTimestamp
	if created.IsZero() {
		created = now
	}
	expectedSize := intent.PartSizeBytes
	if input.PartNumber == intent.PartCount {
		expectedSize = intent.SizeBytes - int64(intent.PartCount-1)*intent.PartSizeBytes
	}
	return domain.AttachmentUploadPart{UploadIntentID: intent.UploadIntentID, PartNumber: input.PartNumber, ExpectedSizeBytes: expectedSize,
		ChecksumAlgorithm: "SHA256", ExpectedChecksum: checksum, CreatedTimestamp: created, UpdatedTimestamp: now}, nil
}

func (r *MemoryRepo) mutableUploadIntentLocked(companyID, actorUserID, uploadIntentID string, now time.Time) (domain.AttachmentUploadIntent, error) {
	intent, ok := r.attachmentUploadIntents[cleanUUIDText(uploadIntentID)]
	if !ok || intent.CompanyID != strings.TrimSpace(companyID) || intent.ActorUserID != cleanUUIDText(actorUserID) {
		return domain.AttachmentUploadIntent{}, ErrNotFound
	}
	now = normalizedUploadNow(now)
	if !uploadStatusTerminal(intent.Status) && !intent.ExpiresTimestamp.After(now) {
		return domain.AttachmentUploadIntent{}, ErrUploadIntentExpired
	}
	return intent, nil
}

func sameAttachmentUploadPayload(a, b domain.AttachmentUploadIntent) bool {
	return a.OriginalFilename == b.OriginalFilename && a.MimeType == b.MimeType && a.SizeBytes == b.SizeBytes &&
		a.SHA256 == b.SHA256 && a.ResourceType == b.ResourceType && a.ResourceID == b.ResourceID &&
		a.InformationID == b.InformationID && a.MessageID == b.MessageID && a.EditorSurface == b.EditorSurface &&
		a.RelationshipKind == b.RelationshipKind && a.SourceKind == b.SourceKind && a.SourceProvider == b.SourceProvider &&
		sameOptionalAttachmentInt(a.OriginalWidth, b.OriginalWidth) && sameOptionalAttachmentInt(a.OriginalHeight, b.OriginalHeight)
}

func sameOptionalAttachmentInt(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func attachmentUploadRequestKey(companyID, actorUserID, requestID string) string {
	return strings.TrimSpace(companyID) + ":" + cleanUUIDText(actorUserID) + ":" + strings.TrimSpace(requestID)
}

func cloneAttachmentUploadIntent(input domain.AttachmentUploadIntent) domain.AttachmentUploadIntent {
	input.OriginalWidth = cloneAttachmentIntPointer(input.OriginalWidth)
	input.OriginalHeight = cloneAttachmentIntPointer(input.OriginalHeight)
	input.CompletedTimestamp = cloneTimePointer(input.CompletedTimestamp)
	return input
}

func cloneAttachmentUploadParts(input map[int]domain.AttachmentUploadPart) []domain.AttachmentUploadPart {
	items := make([]domain.AttachmentUploadPart, 0, len(input))
	for _, item := range input {
		item.UploadedTimestamp = cloneTimePointer(item.UploadedTimestamp)
		item.LastSignedTimestamp = cloneTimePointer(item.LastSignedTimestamp)
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].PartNumber < items[j].PartNumber })
	return items
}

func cloneTimePointer(input *time.Time) *time.Time {
	if input == nil {
		return nil
	}
	value := *input
	return &value
}

func normalizedUploadNow(now time.Time) time.Time {
	if now.IsZero() {
		return time.Now().UTC()
	}
	return now.UTC()
}

func uploadStatusTerminal(status string) bool {
	return status == domain.AttachmentUploadStatusCompleted || status == domain.AttachmentUploadStatusAborted || status == domain.AttachmentUploadStatusExpired
}

func validRawSHA256(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32
}

func attachmentFilenameForStore(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "attachment"
	}
	return value
}
