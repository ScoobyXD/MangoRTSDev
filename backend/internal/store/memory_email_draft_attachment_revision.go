package store

import (
	"strings"
	"time"
)

func (r *MemoryRepo) advanceSharedEmailDraftAttachmentRevisionLocked(
	companyID, draftID, actorUserID string,
	expectedRevision int64,
) (int64, error) {
	sharedRevision, err := r.validateSharedEmailDraftAttachmentRevisionLocked(companyID, draftID, actorUserID, expectedRevision)
	if err != nil || sharedRevision == 0 {
		return sharedRevision, err
	}
	companyID = cleanUUIDText(companyID)
	draftID = strings.TrimSpace(draftID)
	actorUserID = cleanUUIDText(actorUserID)
	draftKey := communicationsEmailDraftKey(companyID, draftID)
	draft := r.emailDrafts[draftKey]
	draft.Revision++
	draft.UpdatedByUserID = actorUserID
	draft.UpdatedTimestamp = time.Now().UTC()
	r.emailDrafts[draftKey] = draft
	return draft.Revision, nil
}

func (r *MemoryRepo) validateSharedEmailDraftAttachmentRevisionLocked(companyID, draftID, actorUserID string, expectedRevision int64) (int64, error) {
	companyID, draftID, actorUserID = cleanUUIDText(companyID), strings.TrimSpace(draftID), cleanUUIDText(actorUserID)
	draft, ok := r.emailDrafts[communicationsEmailDraftKey(companyID, draftID)]
	if !ok || draft.DeletedTimestamp != nil {
		return 0, ErrNotFound
	}
	resourceType, resourceID := draftSharedResourceType(draft), draftSharedResourceID(draft)
	if resourceType == "" {
		return 0, nil
	}
	if actorUserID == "" || expectedRevision <= 0 || draft.Revision != expectedRevision ||
		!r.userHasEffectiveAccessLocked(companyID, actorUserID, resourceType, resourceID, EntityPermissionEdit) {
		return 0, ErrConflict
	}
	return expectedRevision, nil
}
