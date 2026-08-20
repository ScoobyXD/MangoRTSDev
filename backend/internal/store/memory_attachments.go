package store

import (
	"context"
	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateAttachmentWithResourceLink(input AttachmentCreateInput) (domain.Attachment, domain.ResourceAttachment, error) {
	return r.CreateAttachmentWithResourceLinkContext(context.Background(), input)
}

func (r *MemoryRepo) CreateAttachmentWithResourceLinkContext(ctx context.Context, input AttachmentCreateInput) (domain.Attachment, domain.ResourceAttachment, error) {
	if err := ctx.Err(); err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	attachment, link, err := normalizeAttachmentCreateInput(input)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	if _, ok := r.companies[attachment.CompanyID]; !ok {
		return domain.Attachment{}, domain.ResourceAttachment{}, ErrNotFound
	}
	if _, ok := r.attachments[attachmentKey(attachment.CompanyID, attachment.AttachmentID)]; ok {
		return domain.Attachment{}, domain.ResourceAttachment{}, ErrAlreadyExists
	}
	for _, existing := range r.attachments {
		if existing.StorageBucket == attachment.StorageBucket && existing.StorageKey == attachment.StorageKey {
			return domain.Attachment{}, domain.ResourceAttachment{}, ErrAlreadyExists
		}
	}
	if link.ResourceType == "email_draft" {
		link.ResourceRevision, err = r.advanceSharedEmailDraftAttachmentRevisionLocked(
			link.CompanyID, link.ResourceID, link.CreatedByUserID, input.ResourceLink.ExpectedRevision,
		)
		if err != nil {
			return domain.Attachment{}, domain.ResourceAttachment{}, err
		}
	}
	r.attachments[attachmentKey(attachment.CompanyID, attachment.AttachmentID)] = attachment

	link.AttachmentID = attachment.AttachmentID
	storedLink, err := r.upsertResourceAttachmentLocked(link)
	if err != nil {
		delete(r.attachments, attachmentKey(attachment.CompanyID, attachment.AttachmentID))
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	return cloneAttachment(attachment), cloneResourceAttachment(storedLink), nil
}

func (r *MemoryRepo) GetAttachment(companyID, attachmentID string) (domain.Attachment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	attachment, ok := r.attachments[attachmentKey(companyID, attachmentID)]
	if !ok || attachment.DeletedTimestamp != nil {
		return domain.Attachment{}, ErrNotFound
	}
	attachment.Variants = r.attachmentVariantsLocked(attachment.AttachmentID)
	attachment.ResourceLinks = r.resourceAttachmentLinksLocked(attachment.CompanyID, attachment.AttachmentID, false)
	return cloneAttachment(attachment), nil
}

func (r *MemoryRepo) AttachmentExistsContext(ctx context.Context, companyID, attachmentID string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	attachment, ok := r.attachments[attachmentKey(companyID, attachmentID)]
	return ok && attachment.DeletedTimestamp == nil, nil
}

func (r *MemoryRepo) PreparePermanentAttachmentDeletion(ctx context.Context, companyID, attachmentID, resourceType, resourceID string) (AttachmentDeletionPlan, error) {
	if err := ctx.Err(); err != nil {
		return AttachmentDeletionPlan{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := attachmentKey(companyID, attachmentID)
	attachment, ok := r.attachments[key]
	if !ok {
		return AttachmentDeletionPlan{}, ErrNotFound
	}
	matchingLink := false
	for _, link := range r.resourceAttachments {
		if link.CompanyID != companyID || link.AttachmentID != attachmentID {
			continue
		}
		if link.DeletedTimestamp == nil && link.ResourceType == resourceType && link.ResourceID == resourceID && link.RelationshipKind == AttachmentRelationshipFileAttachment {
			matchingLink = true
		} else if link.DeletedTimestamp == nil {
			return AttachmentDeletionPlan{}, ErrAttachmentShared
		}
	}
	if !matchingLink {
		return AttachmentDeletionPlan{}, ErrNotFound
	}
	objects := []attachmentcleanup.ObjectRef{{Bucket: attachment.StorageBucket, Key: attachment.StorageKey}}
	for _, variant := range r.attachmentVariants {
		if variant.AttachmentID == attachmentID {
			objects = append(objects, attachmentcleanup.ObjectRef{Bucket: variant.StorageBucket, Key: variant.StorageKey})
		}
	}
	now := time.Now().UTC()
	attachment.DeletedTimestamp = &now
	r.attachments[key] = attachment
	for linkID, link := range r.resourceAttachments {
		if link.CompanyID == companyID && link.AttachmentID == attachmentID && link.DeletedTimestamp == nil {
			link.DeletedTimestamp = &now
			r.resourceAttachments[linkID] = link
		}
	}
	return AttachmentDeletionPlan{Objects: objects}, nil
}

func (r *MemoryRepo) GetAttachmentVariant(ctx context.Context, companyID, attachmentID, variantType string) (domain.AttachmentVariant, error) {
	if err := ctx.Err(); err != nil {
		return domain.AttachmentVariant{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	attachment, ok := r.attachments[attachmentKey(companyID, attachmentID)]
	if !ok || attachment.DeletedTimestamp != nil {
		return domain.AttachmentVariant{}, ErrNotFound
	}
	variantType = NormalizeAttachmentVariantType(variantType)
	if variantType == "" {
		return domain.AttachmentVariant{}, ErrInvalid
	}
	if variantType == AttachmentVariantOriginal {
		return domain.AttachmentVariant{
			AttachmentID:     attachment.AttachmentID,
			VariantType:      AttachmentVariantOriginal,
			MimeType:         attachment.MimeType,
			ByteSize:         attachment.ByteSize,
			Width:            cloneAttachmentIntPointer(attachment.OriginalWidth),
			Height:           cloneAttachmentIntPointer(attachment.OriginalHeight),
			StorageBucket:    attachment.StorageBucket,
			StorageKey:       attachment.StorageKey,
			CreatedTimestamp: attachment.CreatedTimestamp,
			UpdatedTimestamp: attachment.CreatedTimestamp,
		}, nil
	}
	variant, ok := r.attachmentVariants[attachmentVariantKey(attachmentID, variantType)]
	if !ok {
		return domain.AttachmentVariant{}, ErrNotFound
	}
	return cloneAttachmentVariant(variant), nil
}

func (r *MemoryRepo) ReadAttachmentContent(ctx context.Context, companyID, attachmentID, variantType string) (AttachmentContentRead, error) {
	if err := ctx.Err(); err != nil {
		return AttachmentContentRead{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	companyID = strings.TrimSpace(companyID)
	attachmentID = cleanUUIDText(attachmentID)
	variantType = NormalizeAttachmentVariantType(variantType)
	if companyID == "" || attachmentID == "" || variantType == "" {
		return AttachmentContentRead{}, ErrInvalid
	}
	attachment, ok := r.attachments[attachmentKey(companyID, attachmentID)]
	if !ok || attachment.DeletedTimestamp != nil {
		return AttachmentContentRead{}, ErrNotFound
	}
	variant := domain.AttachmentVariant{
		AttachmentID: attachment.AttachmentID, VariantType: AttachmentVariantOriginal,
		MimeType: attachment.MimeType, ByteSize: attachment.ByteSize,
		Width: cloneAttachmentIntPointer(attachment.OriginalWidth), Height: cloneAttachmentIntPointer(attachment.OriginalHeight),
		StorageBucket: attachment.StorageBucket, StorageKey: attachment.StorageKey, CreatedTimestamp: attachment.CreatedTimestamp,
		UpdatedTimestamp: attachment.CreatedTimestamp,
	}
	if variantType != AttachmentVariantOriginal {
		if stored, exists := r.attachmentVariants[attachmentVariantKey(attachmentID, variantType)]; exists {
			if stored.SHA256 != nil && stored.GenerationVersion != nil && *stored.GenerationVersion == AttachmentVariantGenerationVersion {
				variant = cloneAttachmentVariant(stored)
			}
		}
	}
	contentSHA := attachment.SHA256
	generationVersion := 0
	if variant.VariantType != AttachmentVariantOriginal {
		contentSHA = ""
		if variant.SHA256 != nil {
			contentSHA = *variant.SHA256
		}
		if variant.GenerationVersion != nil {
			generationVersion = *variant.GenerationVersion
		}
	}
	return AttachmentContentRead{
		CompanyID: attachment.CompanyID, AttachmentID: attachment.AttachmentID,
		OriginalFilename: attachment.OriginalFilename, OriginalMimeType: attachment.MimeType, OriginalSHA256: attachment.SHA256,
		OriginalByteSize: attachment.ByteSize, OriginalStorageBucket: attachment.StorageBucket,
		OriginalStorageKey: attachment.StorageKey, OriginalCreatedTimestamp: attachment.CreatedTimestamp,
		OriginalUpdatedTimestamp: attachment.CreatedTimestamp,
		RequestedVariant:         variantType, ServedVariant: variant.VariantType, MimeType: variant.MimeType, ByteSize: variant.ByteSize,
		SHA256: contentSHA, GenerationVersion: generationVersion,
		Width: cloneAttachmentIntPointer(variant.Width), Height: cloneAttachmentIntPointer(variant.Height),
		StorageBucket: variant.StorageBucket, StorageKey: variant.StorageKey, CreatedTimestamp: variant.CreatedTimestamp,
		UpdatedTimestamp: variant.UpdatedTimestamp,
		ResourceLinks:    r.resourceAttachmentLinksLocked(companyID, attachmentID, false),
	}, nil
}

func (r *MemoryRepo) UpsertAttachmentVariants(ctx context.Context, companyID string, inputs []AttachmentVariantInput) ([]domain.AttachmentVariant, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	companyID = strings.TrimSpace(companyID)
	if companyID == "" || len(inputs) == 0 {
		return nil, ErrInvalid
	}
	items := make([]domain.AttachmentVariant, 0, len(inputs))
	for _, input := range inputs {
		attachmentID := cleanUUIDText(input.AttachmentID)
		variantType := NormalizeAttachmentVariantType(input.VariantType)
		if variantType == "" || variantType == AttachmentVariantOriginal || attachmentID == "" ||
			strings.TrimSpace(input.MimeType) == "" || input.ByteSize < 0 || strings.TrimSpace(input.StorageBucket) == "" ||
			strings.TrimSpace(input.StorageKey) == "" || !validAttachmentVariantGeneration(input) {
			return nil, ErrInvalid
		}
		attachment, ok := r.attachments[attachmentKey(companyID, attachmentID)]
		if !ok || attachment.DeletedTimestamp != nil {
			return nil, ErrNotFound
		}
		created := input.CreatedTimestamp
		if created.IsZero() {
			created = time.Now().UTC()
		}
		variant := domain.AttachmentVariant{AttachmentID: attachmentID, VariantType: variantType,
			MimeType: strings.TrimSpace(input.MimeType), ByteSize: input.ByteSize,
			SHA256: cloneAttachmentStringPointer(input.SHA256), GenerationVersion: cloneAttachmentIntPointer(input.GenerationVersion),
			Width: cloneAttachmentIntPointer(input.Width), Height: cloneAttachmentIntPointer(input.Height),
			StorageBucket: strings.TrimSpace(input.StorageBucket), StorageKey: strings.TrimSpace(input.StorageKey),
			CreatedTimestamp: created, UpdatedTimestamp: created}
		key := attachmentVariantKey(attachmentID, variantType)
		if existing, exists := r.attachmentVariants[key]; exists && sameAttachmentVariantStorage(existing, variant) {
			variant.CreatedTimestamp = existing.CreatedTimestamp
			variant.UpdatedTimestamp = existing.UpdatedTimestamp
		}
		r.attachmentVariants[key] = variant
		items = append(items, cloneAttachmentVariant(variant))
	}
	return items, nil
}

func sameAttachmentVariantStorage(a, b domain.AttachmentVariant) bool {
	return a.AttachmentID == b.AttachmentID && a.VariantType == b.VariantType && a.MimeType == b.MimeType &&
		a.ByteSize == b.ByteSize && attachmentOptionalStringEqual(a.SHA256, b.SHA256) && attachmentOptionalIntEqual(a.GenerationVersion, b.GenerationVersion) &&
		attachmentOptionalIntEqual(a.Width, b.Width) && attachmentOptionalIntEqual(a.Height, b.Height) &&
		a.StorageBucket == b.StorageBucket && a.StorageKey == b.StorageKey
}

func attachmentOptionalIntEqual(a, b *int) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func attachmentOptionalStringEqual(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func (r *MemoryRepo) ListAttachmentResourceLinks(companyID, attachmentID string) ([]domain.ResourceAttachment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	attachment, ok := r.attachments[attachmentKey(companyID, attachmentID)]
	if !ok || attachment.DeletedTimestamp != nil {
		return nil, ErrNotFound
	}
	return r.resourceAttachmentLinksLocked(companyID, attachmentID, false), nil
}

func (r *MemoryRepo) ListResourceAttachments(companyID, resourceType, resourceID string) ([]domain.ResourceAttachment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	resourceType = NormalizeAttachmentResourceType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if strings.TrimSpace(companyID) == "" || resourceType == "" || resourceID == "" {
		return nil, ErrInvalid
	}
	items := make([]domain.ResourceAttachment, 0)
	for _, link := range r.resourceAttachments {
		if link.CompanyID != companyID || link.ResourceType != resourceType || link.ResourceID != resourceID || link.DeletedTimestamp != nil {
			continue
		}
		attachment, ok := r.attachments[attachmentKey(companyID, link.AttachmentID)]
		if !ok || attachment.DeletedTimestamp != nil {
			continue
		}
		copied := cloneResourceAttachment(link)
		clonedAttachment := cloneAttachment(attachment)
		clonedAttachment.Variants = r.attachmentVariantsLocked(clonedAttachment.AttachmentID)
		copied.Attachment = &clonedAttachment
		items = append(items, copied)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].ResourceAttachmentID < items[j].ResourceAttachmentID
		}
		return items[i].CreatedTimestamp.After(items[j].CreatedTimestamp)
	})
	return items, nil
}

func (r *MemoryRepo) LinkResourceAttachment(input ResourceAttachmentInput) (domain.ResourceAttachment, error) {
	return r.LinkResourceAttachmentContext(context.Background(), input)
}

func (r *MemoryRepo) LinkResourceAttachmentContext(ctx context.Context, input ResourceAttachmentInput) (domain.ResourceAttachment, error) {
	if err := ctx.Err(); err != nil {
		return domain.ResourceAttachment{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	link, err := normalizeResourceAttachmentInput(input)
	if err != nil {
		return domain.ResourceAttachment{}, err
	}
	if attachment, ok := r.attachments[attachmentKey(link.CompanyID, link.AttachmentID)]; !ok || attachment.DeletedTimestamp != nil {
		return domain.ResourceAttachment{}, ErrNotFound
	}
	if link.ResourceType == "email_draft" {
		link.ResourceRevision, err = r.advanceSharedEmailDraftAttachmentRevisionLocked(
			link.CompanyID, link.ResourceID, link.CreatedByUserID, input.ExpectedRevision,
		)
		if err != nil {
			return domain.ResourceAttachment{}, err
		}
	}
	storedLink, err := r.upsertResourceAttachmentLocked(link)
	if err != nil {
		return domain.ResourceAttachment{}, err
	}
	return cloneResourceAttachment(storedLink), nil
}

func (r *MemoryRepo) ConvergeCommunicationsEmailThreadAttachmentLinksContext(ctx context.Context, companyID, emailThreadID string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	companyID, emailThreadID = cleanUUIDText(companyID), cleanUUIDText(emailThreadID)
	if companyID == "" || emailThreadID == "" {
		return false, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.emailThreads[key(companyID, emailThreadID)]; !ok {
		return false, ErrNotFound
	}
	return r.convergeCommunicationsEmailThreadAttachmentLinksLocked(companyID, emailThreadID), nil
}

func (r *MemoryRepo) convergeCommunicationsEmailThreadAttachmentLinksLocked(companyID, emailThreadID string) bool {
	thread, ok := r.emailThreads[key(companyID, emailThreadID)]
	if !ok {
		return false
	}
	rules := map[string]map[string]string{}
	for _, message := range thread.Messages {
		if !message.Message.DownloadComplete {
			continue
		}
		for _, attachment := range message.Message.Attachments {
			rule, valid := redundantImportedEmailAttachmentRuleForSnapshot(
				companyID, emailThreadID, message.EmailMessageID, message.ProviderMessageID, attachment,
			)
			if !valid {
				continue
			}
			canonical, exists := r.attachments[attachmentKey(companyID, rule.CanonicalAttachmentID)]
			if !exists || canonical.DeletedTimestamp != nil {
				continue
			}
			if rules[rule.EmailMessageID] == nil {
				rules[rule.EmailMessageID] = map[string]string{}
			}
			rules[rule.EmailMessageID][rule.ImportedAttachmentID] = rule.CanonicalAttachmentID
		}
	}
	if len(rules) == 0 {
		return false
	}
	liveMessageLinks := map[string]map[string]struct{}{}
	for _, link := range r.resourceAttachments {
		if link.CompanyID != companyID || link.ResourceType != "email_message" || link.DeletedTimestamp != nil || rules[link.ResourceID] == nil {
			continue
		}
		if liveMessageLinks[link.ResourceID] == nil {
			liveMessageLinks[link.ResourceID] = map[string]struct{}{}
		}
		liveMessageLinks[link.ResourceID][link.AttachmentID] = struct{}{}
	}
	now := time.Now().UTC()
	retired := map[string]struct{}{}
	for relationshipID, link := range r.resourceAttachments {
		if link.CompanyID != companyID || link.ResourceType != "email_message" || link.DeletedTimestamp != nil {
			continue
		}
		canonicalAttachmentID, redundant := rules[link.ResourceID][link.AttachmentID]
		if !redundant {
			continue
		}
		if _, canonicalLinked := liveMessageLinks[link.ResourceID][canonicalAttachmentID]; !canonicalLinked {
			continue
		}
		link.DeletedTimestamp = &now
		r.resourceAttachments[relationshipID] = link
		retired[link.AttachmentID] = struct{}{}
	}
	if len(retired) == 0 {
		return false
	}
	liveOwners := map[string]struct{}{}
	for _, link := range r.resourceAttachments {
		if link.CompanyID == companyID && link.DeletedTimestamp == nil {
			liveOwners[link.AttachmentID] = struct{}{}
		}
	}
	for attachmentID := range retired {
		if _, owned := liveOwners[attachmentID]; !owned {
			storedAttachmentKey := attachmentKey(companyID, attachmentID)
			attachment := r.attachments[storedAttachmentKey]
			attachment.DeletedTimestamp = &now
			r.attachments[storedAttachmentKey] = attachment
		}
	}
	return true
}

func (r *MemoryRepo) SoftDeleteResourceAttachment(input ResourceAttachmentDeleteInput) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	companyID := strings.TrimSpace(input.CompanyID)
	resourceType := NormalizeAttachmentResourceType(input.ResourceType)
	resourceID := strings.TrimSpace(input.ResourceID)
	attachmentID := cleanUUIDText(input.AttachmentID)
	if companyID == "" || resourceType == "" || resourceID == "" || attachmentID == "" {
		return ErrInvalid
	}
	changed := false
	for _, link := range r.resourceAttachments {
		if link.CompanyID == companyID && link.ResourceType == resourceType && link.ResourceID == resourceID &&
			link.AttachmentID == attachmentID && link.DeletedTimestamp == nil {
			changed = true
			break
		}
	}
	if !changed {
		return ErrNotFound
	}
	if resourceType == "email_draft" {
		if _, err := r.advanceSharedEmailDraftAttachmentRevisionLocked(
			companyID, resourceID, input.ActorUserID, input.ExpectedRevision,
		); err != nil {
			return err
		}
	}
	now := time.Now().UTC()
	for id, link := range r.resourceAttachments {
		if link.CompanyID != companyID || link.ResourceType != resourceType || link.ResourceID != resourceID || link.AttachmentID != attachmentID || link.DeletedTimestamp != nil {
			continue
		}
		link.DeletedTimestamp = &now
		r.resourceAttachments[id] = link
	}
	stillOwned := false
	for _, link := range r.resourceAttachments {
		if link.CompanyID == companyID && link.AttachmentID == attachmentID && link.DeletedTimestamp == nil {
			stillOwned = true
			break
		}
	}
	if !stillOwned {
		key := attachmentKey(companyID, attachmentID)
		attachment := r.attachments[key]
		attachment.DeletedTimestamp = &now
		r.attachments[key] = attachment
	}
	return nil
}

func normalizeAttachmentCreateInput(input AttachmentCreateInput) (domain.Attachment, domain.ResourceAttachment, error) {
	now := input.CreatedTimestamp
	if now.IsZero() {
		now = time.Now().UTC()
	}
	attachmentID := cleanUUIDText(input.AttachmentID)
	if attachmentID == "" {
		attachmentID = newUUIDv7String()
	}
	sourceKind := NormalizeAttachmentSourceKind(input.SourceKind)
	if sourceKind == "" {
		return domain.Attachment{}, domain.ResourceAttachment{}, ErrInvalid
	}
	attachment := domain.Attachment{
		CompanyID:                strings.TrimSpace(input.CompanyID),
		AttachmentID:             attachmentID,
		UploadedByUserID:         cleanUUIDText(input.UploadedByUserID),
		OriginalFilename:         strings.TrimSpace(input.OriginalFilename),
		MimeType:                 strings.TrimSpace(input.MimeType),
		ByteSize:                 input.ByteSize,
		SHA256:                   strings.ToLower(strings.TrimSpace(input.SHA256)),
		SHA256VerificationMethod: strings.TrimSpace(input.SHA256VerificationMethod),
		StorageChecksumAlgorithm: strings.TrimSpace(input.StorageChecksumAlgorithm),
		StorageChecksumValue:     strings.TrimSpace(input.StorageChecksumValue),
		StorageChecksumType:      strings.TrimSpace(input.StorageChecksumType),
		StorageBucket:            strings.TrimSpace(input.StorageBucket),
		StorageKey:               strings.TrimSpace(input.StorageKey),
		OriginalWidth:            cloneAttachmentIntPointer(input.OriginalWidth),
		OriginalHeight:           cloneAttachmentIntPointer(input.OriginalHeight),
		SourceKind:               sourceKind,
		SourceProvider:           strings.TrimSpace(input.SourceProvider),
		CreatedTimestamp:         now,
	}
	if attachment.SHA256VerificationMethod == "" {
		attachment.SHA256VerificationMethod = "server_stream"
	}
	if attachment.CompanyID == "" || attachment.OriginalFilename == "" || attachment.MimeType == "" ||
		attachment.ByteSize < 0 || !validRawSHA256(attachment.SHA256) || attachment.StorageBucket == "" || attachment.StorageKey == "" ||
		!validAttachmentSHA256VerificationMethod(attachment.SHA256VerificationMethod) {
		return domain.Attachment{}, domain.ResourceAttachment{}, ErrInvalid
	}
	linkInput := input.ResourceLink
	linkInput.CompanyID = attachment.CompanyID
	linkInput.AttachmentID = attachment.AttachmentID
	if linkInput.CreatedTimestamp.IsZero() {
		linkInput.CreatedTimestamp = now
	}
	link, err := normalizeResourceAttachmentInput(linkInput)
	if err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	return attachment, link, nil
}

func validAttachmentSHA256VerificationMethod(value string) bool {
	switch strings.TrimSpace(value) {
	case "s3_full", "server_stream", "client_reported":
		return true
	default:
		return false
	}
}

func normalizeResourceAttachmentInput(input ResourceAttachmentInput) (domain.ResourceAttachment, error) {
	now := input.CreatedTimestamp
	if now.IsZero() {
		now = time.Now().UTC()
	}
	resourceAttachmentID := cleanUUIDText(input.ResourceAttachmentID)
	if resourceAttachmentID == "" {
		resourceAttachmentID = newUUIDv7String()
	}
	resourceType := NormalizeAttachmentResourceType(input.ResourceType)
	relationshipKind := NormalizeAttachmentRelationshipKind(input.RelationshipKind)
	if resourceType == "" || relationshipKind == "" {
		return domain.ResourceAttachment{}, ErrInvalid
	}
	link := domain.ResourceAttachment{
		ResourceAttachmentID: resourceAttachmentID,
		CompanyID:            strings.TrimSpace(input.CompanyID),
		ResourceType:         resourceType,
		ResourceID:           strings.TrimSpace(input.ResourceID),
		AttachmentID:         cleanUUIDText(input.AttachmentID),
		InformationID:        cleanUUIDText(input.InformationID),
		MessageID:            strings.TrimSpace(input.MessageID),
		EditorSurface:        strings.TrimSpace(input.EditorSurface),
		RelationshipKind:     relationshipKind,
		CreatedByUserID:      cleanUUIDText(input.CreatedByUserID),
		CreatedTimestamp:     now,
	}
	if link.CompanyID == "" || link.ResourceID == "" || link.AttachmentID == "" {
		return domain.ResourceAttachment{}, ErrInvalid
	}
	return link, nil
}

func (r *MemoryRepo) upsertResourceAttachmentLocked(link domain.ResourceAttachment) (domain.ResourceAttachment, error) {
	if _, ok := r.companies[link.CompanyID]; !ok {
		return domain.ResourceAttachment{}, ErrNotFound
	}
	if attachment, ok := r.attachments[attachmentKey(link.CompanyID, link.AttachmentID)]; !ok || attachment.DeletedTimestamp != nil {
		return domain.ResourceAttachment{}, ErrNotFound
	}
	for id, existing := range r.resourceAttachments {
		if !sameResourceAttachmentIdentity(existing, link) {
			continue
		}
		existing.DeletedTimestamp = nil
		existing.CreatedByUserID = link.CreatedByUserID
		existing.CreatedTimestamp = link.CreatedTimestamp
		r.resourceAttachments[id] = existing
		return existing, nil
	}
	r.resourceAttachments[link.ResourceAttachmentID] = link
	return link, nil
}

func (r *MemoryRepo) attachmentVariantsLocked(attachmentID string) []domain.AttachmentVariant {
	variants := make([]domain.AttachmentVariant, 0)
	for _, variant := range r.attachmentVariants {
		if variant.AttachmentID == attachmentID {
			variants = append(variants, cloneAttachmentVariant(variant))
		}
	}
	sort.Slice(variants, func(i, j int) bool {
		return variants[i].VariantType < variants[j].VariantType
	})
	return variants
}

func (r *MemoryRepo) resourceAttachmentLinksLocked(companyID, attachmentID string, includeDeleted bool) []domain.ResourceAttachment {
	items := make([]domain.ResourceAttachment, 0)
	for _, link := range r.resourceAttachments {
		if link.CompanyID != companyID || link.AttachmentID != attachmentID {
			continue
		}
		if !includeDeleted && link.DeletedTimestamp != nil {
			continue
		}
		items = append(items, cloneResourceAttachment(link))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].ResourceAttachmentID < items[j].ResourceAttachmentID
		}
		return items[i].CreatedTimestamp.After(items[j].CreatedTimestamp)
	})
	return items
}

func sameResourceAttachmentIdentity(a, b domain.ResourceAttachment) bool {
	return a.CompanyID == b.CompanyID &&
		a.ResourceType == b.ResourceType &&
		a.ResourceID == b.ResourceID &&
		a.AttachmentID == b.AttachmentID &&
		a.RelationshipKind == b.RelationshipKind &&
		a.InformationID == b.InformationID &&
		a.MessageID == b.MessageID &&
		a.EditorSurface == b.EditorSurface
}

func attachmentKey(companyID, attachmentID string) string {
	return strings.TrimSpace(companyID) + ":" + cleanUUIDText(attachmentID)
}

func attachmentVariantKey(attachmentID, variantType string) string {
	return cleanUUIDText(attachmentID) + ":" + NormalizeAttachmentVariantType(variantType)
}

func cloneAttachment(input domain.Attachment) domain.Attachment {
	input.OriginalWidth = cloneAttachmentIntPointer(input.OriginalWidth)
	input.OriginalHeight = cloneAttachmentIntPointer(input.OriginalHeight)
	if input.DeletedTimestamp != nil {
		deleted := *input.DeletedTimestamp
		input.DeletedTimestamp = &deleted
	}
	if input.Variants != nil {
		input.Variants = append([]domain.AttachmentVariant(nil), input.Variants...)
	}
	if input.ResourceLinks != nil {
		input.ResourceLinks = append([]domain.ResourceAttachment(nil), input.ResourceLinks...)
	}
	return input
}

func cloneAttachmentVariant(input domain.AttachmentVariant) domain.AttachmentVariant {
	input.SHA256 = cloneAttachmentStringPointer(input.SHA256)
	input.GenerationVersion = cloneAttachmentIntPointer(input.GenerationVersion)
	input.Width = cloneAttachmentIntPointer(input.Width)
	input.Height = cloneAttachmentIntPointer(input.Height)
	return input
}

func cloneAttachmentStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func cloneResourceAttachment(input domain.ResourceAttachment) domain.ResourceAttachment {
	if input.DeletedTimestamp != nil {
		deleted := *input.DeletedTimestamp
		input.DeletedTimestamp = &deleted
	}
	if input.Attachment != nil {
		attachment := cloneAttachment(*input.Attachment)
		input.Attachment = &attachment
	}
	return input
}

func cloneAttachmentIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func (r *MemoryRepo) ListWork(ctx context.Context, companyID string, limit int) ([]attachmentcleanup.WorkItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]attachmentcleanup.WorkItem, 0)
	for _, attachment := range r.attachments {
		if attachment.CompanyID != strings.TrimSpace(companyID) || attachment.DeletedTimestamp == nil {
			continue
		}
		if r.attachmentRestorableFromSharedDraftRecycleLocked(attachment.CompanyID, attachment.AttachmentID) {
			continue
		}
		item := attachmentcleanup.WorkItem{
			Kind: attachmentcleanup.WorkOrphanAttachment, CompanyID: attachment.CompanyID, AttachmentID: attachment.AttachmentID,
			Objects: []attachmentcleanup.ObjectRef{{Bucket: attachment.StorageBucket, Key: attachment.StorageKey}},
		}
		for _, preview := range r.attachmentVariants {
			if preview.AttachmentID == attachment.AttachmentID {
				item.Objects = append(item.Objects, attachmentcleanup.ObjectRef{Bucket: preview.StorageBucket, Key: preview.StorageKey})
			}
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].AttachmentID < items[j].AttachmentID })
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func WorkKindOrphanAttachment() attachmentcleanup.WorkKind {
	return attachmentcleanup.WorkOrphanAttachment
}

func (r *MemoryRepo) Eligible(ctx context.Context, item attachmentcleanup.WorkItem) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	attachment, ok := r.attachments[attachmentKey(item.CompanyID, item.AttachmentID)]
	if !ok || attachment.DeletedTimestamp == nil {
		return false, nil
	}
	for _, link := range r.resourceAttachments {
		if link.CompanyID == item.CompanyID && link.AttachmentID == item.AttachmentID && link.DeletedTimestamp == nil {
			return false, nil
		}
	}
	if r.attachmentRestorableFromSharedDraftRecycleLocked(item.CompanyID, item.AttachmentID) {
		return false, nil
	}
	return true, nil
}

func (r *MemoryRepo) SharedWithRetained(ctx context.Context, _ attachmentcleanup.WorkItem, object attachmentcleanup.ObjectRef) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, attachment := range r.attachments {
		if attachment.DeletedTimestamp == nil && attachment.StorageBucket == object.Bucket && attachment.StorageKey == object.Key {
			return true, nil
		}
	}
	for _, preview := range r.attachmentVariants {
		attachmentFound := false
		for _, attachment := range r.attachments {
			if attachment.AttachmentID == preview.AttachmentID && attachment.DeletedTimestamp == nil {
				attachmentFound = true
				break
			}
		}
		if attachmentFound && preview.StorageBucket == object.Bucket && preview.StorageKey == object.Key {
			return true, nil
		}
	}
	for _, upload := range r.attachmentUploadIntents {
		if upload.StorageBucket == object.Bucket && upload.StorageKey == object.Key &&
			(upload.Status == domain.AttachmentUploadStatusPending || upload.Status == domain.AttachmentUploadStatusUploading ||
				upload.Status == domain.AttachmentUploadStatusCompleting || upload.Status == domain.AttachmentUploadStatusFailed) {
			return true, nil
		}
	}
	return false, nil
}

func (r *MemoryRepo) Finalize(ctx context.Context, item attachmentcleanup.WorkItem) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := attachmentKey(item.CompanyID, item.AttachmentID)
	attachment, ok := r.attachments[key]
	if !ok {
		return nil
	}
	if attachment.DeletedTimestamp == nil {
		return attachmentcleanup.ErrStillOwned
	}
	for _, link := range r.resourceAttachments {
		if link.CompanyID == item.CompanyID && link.AttachmentID == item.AttachmentID && link.DeletedTimestamp == nil {
			return attachmentcleanup.ErrStillOwned
		}
	}
	if r.attachmentRestorableFromSharedDraftRecycleLocked(item.CompanyID, item.AttachmentID) {
		return attachmentcleanup.ErrStillOwned
	}
	delete(r.attachments, key)
	for previewKey, preview := range r.attachmentVariants {
		if preview.AttachmentID == item.AttachmentID {
			delete(r.attachmentVariants, previewKey)
		}
	}
	for relationshipID, link := range r.resourceAttachments {
		if link.CompanyID == item.CompanyID && link.AttachmentID == item.AttachmentID {
			delete(r.resourceAttachments, relationshipID)
		}
	}
	return nil
}

func (r *MemoryRepo) attachmentRestorableFromSharedDraftRecycleLocked(companyID, attachmentID string) bool {
	for _, record := range r.recycleBin {
		if record.Item.CompanyID != companyID {
			continue
		}
		owners := map[string]bool{}
		for _, target := range record.Targets {
			if target.Kind == EntityTypeNode || target.Kind == EntityTypeProject {
				owners[target.Kind+":"+target.ID] = true
			}
		}
		draftIDs := map[string]bool{}
		for _, draft := range record.Snapshot.emailDrafts {
			if draft.CompanyID == companyID && draft.DeletedTimestamp == nil && owners[draft.SharedResourceType+":"+draft.SharedResourceID] {
				draftIDs[draft.DraftID] = true
			}
		}
		for _, link := range record.Snapshot.resourceAttachments {
			if link.CompanyID == companyID && link.DeletedTimestamp == nil && link.ResourceType == "email_draft" && draftIDs[link.ResourceID] && link.AttachmentID == attachmentID {
				return true
			}
		}
	}
	return false
}
