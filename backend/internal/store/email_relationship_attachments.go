package store

import (
	"context"
	"database/sql"
	"errors"
)

func (r *PostgresRepo) GetEmailRelationshipAttachmentResource(companyID, emailRelationshipID string) (EmailRelationshipAttachmentResource, error) {
	companyID = cleanUUIDText(companyID)
	emailRelationshipID = cleanUUIDText(emailRelationshipID)
	if companyID == "" || emailRelationshipID == "" {
		return EmailRelationshipAttachmentResource{}, ErrInvalid
	}
	var item EmailRelationshipAttachmentResource
	err := r.db.QueryRowContext(context.Background(), `
select resource_type,resource_id::text
from email_relationships
where company_id=$1::uuid and email_relationship_id=$2::uuid`, companyID, emailRelationshipID).Scan(&item.ResourceType, &item.ResourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return EmailRelationshipAttachmentResource{}, ErrNotFound
	}
	if err != nil {
		return EmailRelationshipAttachmentResource{}, err
	}
	return item, nil
}

func (r *MemoryRepo) GetEmailRelationshipAttachmentResource(companyID, emailRelationshipID string) (EmailRelationshipAttachmentResource, error) {
	companyID = cleanUUIDText(companyID)
	emailRelationshipID = cleanUUIDText(emailRelationshipID)
	if companyID == "" || emailRelationshipID == "" {
		return EmailRelationshipAttachmentResource{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, collaboration := range r.emailCollaborations {
		if collaboration.CompanyID != companyID {
			continue
		}
		if collaboration.CollaborationID == emailRelationshipID || collaboration.AttachedEmailInformationID == emailRelationshipID {
			return EmailRelationshipAttachmentResource{ResourceType: EntityTypeNode, ResourceID: collaboration.NodeID}, nil
		}
	}
	return EmailRelationshipAttachmentResource{}, ErrNotFound
}
