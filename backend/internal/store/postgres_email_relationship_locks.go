package store

import (
	"context"
	"database/sql"
	"errors"
)

func lockPostgresWideEmailOwnerThreadRelationshipTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, resourceType, resourceID, emailThreadID string,
) (bool, error) {
	var relationshipID string
	err := tx.QueryRowContext(ctx, `select email_relationship_id::text
from email_relationships
where company_id=$1::uuid and email_thread_id=$4::uuid
  and resource_type=$2 and resource_id=$3::uuid and resource_textbox_id is null
order by created_timestamp,email_relationship_id
limit 1
for share`, companyID, resourceType, resourceID, emailThreadID).Scan(&relationshipID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func lockPostgresExactEmailTextboxRelationshipTx(
	ctx context.Context,
	tx *sql.Tx,
	companyID, resourceType, resourceID, textboxID, emailMessageID string,
) (bool, error) {
	var relationshipID string
	err := tx.QueryRowContext(ctx, `select email_relationship_id::text
from email_relationships
where company_id=$1::uuid and email_message_id=$5::uuid
  and resource_type=$2 and resource_id=$3::uuid and resource_textbox_id=$4
order by created_timestamp,email_relationship_id
limit 1
for share`, companyID, resourceType, resourceID, textboxID, emailMessageID).Scan(&relationshipID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
