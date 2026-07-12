package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) CreateAttachmentWithResourceLink(input AttachmentCreateInput) (domain.Attachment, domain.ResourceAttachment, error) {
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

	if _, ok := r.attachments[attachmentKey(companyID, attachmentID)]; !ok {
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
	r.mu.Lock()
	defer r.mu.Unlock()

	link, err := normalizeResourceAttachmentInput(input)
	if err != nil {
		return domain.ResourceAttachment{}, err
	}
	if _, ok := r.attachments[attachmentKey(link.CompanyID, link.AttachmentID)]; !ok {
		return domain.ResourceAttachment{}, ErrNotFound
	}
	storedLink, err := r.upsertResourceAttachmentLocked(link)
	if err != nil {
		return domain.ResourceAttachment{}, err
	}
	return cloneResourceAttachment(storedLink), nil
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
	now := time.Now().UTC()
	changed := false
	for id, link := range r.resourceAttachments {
		if link.CompanyID != companyID || link.ResourceType != resourceType || link.ResourceID != resourceID || link.AttachmentID != attachmentID || link.DeletedTimestamp != nil {
			continue
		}
		link.DeletedTimestamp = &now
		r.resourceAttachments[id] = link
		changed = true
	}
	if !changed {
		return ErrNotFound
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
	if _, ok := r.attachments[attachmentKey(link.CompanyID, link.AttachmentID)]; !ok {
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
