package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

func validateSharedEmailDraftAttachmentRevisionTx(ctx context.Context, tx *sql.Tx, companyID, draftID, actorUserID string, expectedRevision int64) (int64, error) {
	companyID, draftID, actorUserID = cleanUUIDText(companyID), strings.TrimSpace(draftID), cleanUUIDText(actorUserID)
	if companyID == "" || draftID == "" {
		return 0, ErrInvalid
	}
	var shared, allowed bool
	var revision int64
	err := tx.QueryRowContext(ctx, `
select shared_resource_type is not null,revision,
  case when shared_resource_type is not null then mangorts_user_can_access_resource(company_id,shared_resource_type,shared_resource_id,$3::uuid,'edit')
       else true end
from email_drafts
where company_id=$1::uuid and draft_id=$2 and deleted_timestamp is null
for share`, companyID, draftID, actorUserID).Scan(&shared, &revision, &allowed)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if !shared {
		return 0, nil
	}
	if actorUserID == "" || expectedRevision < 1 || revision != expectedRevision || !allowed {
		return 0, ErrConflict
	}
	return expectedRevision, nil
}

// advanceSharedEmailDraftAttachmentRevisionTx makes a shared draft attachment
// mutation and its optimistic revision change one transaction. Personal drafts
// keep their existing attachment behavior and do not use revisions.
func advanceSharedEmailDraftAttachmentRevisionTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, draftID, actorUserID string,
	expectedRevision int64,
) (int64, error) {
	companyID = cleanUUIDText(companyID)
	draftID = strings.TrimSpace(draftID)
	actorUserID = cleanUUIDText(actorUserID)
	if companyID == "" || draftID == "" {
		return 0, ErrInvalid
	}

	var shared bool
	if err := tx.QueryRowContext(ctx, `
select shared_resource_type is not null
from email_drafts
where company_id=$1::uuid and draft_id=$2 and deleted_timestamp is null
for update`, companyID, draftID).Scan(&shared); errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	} else if err != nil {
		return 0, err
	}
	if !shared {
		return 0, nil
	}
	if actorUserID == "" || expectedRevision <= 0 {
		return 0, ErrConflict
	}

	var revision int64
	err := tx.QueryRowContext(ctx, `
update email_drafts draft
set revision=draft.revision+1,
    updated_by_user_id=$3::uuid,
    updated_timestamp=now()
where draft.company_id=$1::uuid
  and draft.draft_id=$2
  and draft.deleted_timestamp is null
  and draft.revision=$4
	and draft.shared_resource_type is not null
	and mangorts_user_can_access_resource(
	  draft.company_id,draft.shared_resource_type,draft.shared_resource_id,$3::uuid,'edit')
returning draft.revision`, companyID, draftID, actorUserID, expectedRevision).Scan(&revision)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrConflict
	}
	return revision, err
}
