package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

// ErrProtectedEmailCollaborationResource marks mutations that would overwrite
// or detach collaboration-owned canonical resources outside their lifecycle.
// Deleting the owning Node is allowed and tears down the Node-side bridge while
// leaving the independent stored email thread and provider email untouched.
var ErrProtectedEmailCollaborationResource = errors.New("protected email collaboration resource")

func (r *MemoryRepo) emailCollaborationForNodeLocked(companyID, nodeID string) (domain.CommunicationsEmailCollaboration, bool) {
	for _, item := range r.emailCollaborations {
		if item.CompanyID == companyID && item.NodeID == nodeID {
			return cloneCommunicationsEmailCollaboration(item), true
		}
	}
	return domain.CommunicationsEmailCollaboration{}, false
}

func (r *MemoryRepo) rejectEmailCollaborationExplorerNodeMutationLocked(companyID string, entity memoryCompanyExplorerV2Entity) error {
	if entity.EntityType != CompanyExplorerV2EntityNode {
		return nil
	}
	nodeID := entity.ResourceID
	if nodeID == "" {
		nodeID = entity.EntityID
	}
	if _, exists := r.nodes[key(companyID, nodeID)]; !exists {
		return ErrNotFound
	}
	return nil
}

// GetCommunicationsEmailCollaborationByNode is an internal-authorization
// lookup. Unlike participant-facing reads, it deliberately does not accept an
// actor and must only be used to recognize and protect the canonical bridge.
func (r *MemoryRepo) GetCommunicationsEmailCollaborationByNode(companyID, nodeID string) (domain.CommunicationsEmailCollaboration, error) {
	companyID, nodeID = cleanUUIDText(companyID), cleanUUIDText(nodeID)
	if companyID == "" || nodeID == "" {
		return domain.CommunicationsEmailCollaboration{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.emailCollaborationForNodeLocked(companyID, nodeID)
	if !ok {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	return item, nil
}

func postgresEmailCollaborationByNode(ctx context.Context, queryer emailCollaborationQueryer, companyID, nodeID string) (domain.CommunicationsEmailCollaboration, error) {
	companyID, nodeID = cleanUUIDText(companyID), cleanUUIDText(nodeID)
	if ctx == nil || queryer == nil || companyID == "" || nodeID == "" {
		return domain.CommunicationsEmailCollaboration{}, ErrInvalid
	}
	item, err := scanPostgresEmailCollaboration(queryer.QueryRowContext(ctx, `
select `+postgresEmailCollaborationColumns+`
from email_relationships relationship
join email_threads thread on thread.company_id=relationship.company_id and thread.email_thread_id=relationship.email_thread_id
join email_messages message on message.company_id=relationship.company_id
 and message.email_thread_id=relationship.email_thread_id and message.email_message_id=relationship.email_message_id
where relationship.company_id=$1::uuid and relationship.resource_type='node'
 and relationship.resource_id=$2::uuid and relationship.resource_textbox_id is null
order by relationship.created_timestamp limit 1`, companyID, nodeID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CommunicationsEmailCollaboration{}, ErrNotFound
	}
	if err != nil {
		return domain.CommunicationsEmailCollaboration{}, err
	}
	item.Participants, err = listPostgresEmailCollaborationParticipants(ctx, queryer, companyID, item.CollaborationID)
	return item, err
}

func (r *PostgresRepo) GetCommunicationsEmailCollaborationByNode(companyID, nodeID string) (domain.CommunicationsEmailCollaboration, error) {
	return postgresEmailCollaborationByNode(context.Background(), r.db, companyID, nodeID)
}

func postgresRejectEmailCollaborationNodeMutation(ctx context.Context, queryer emailCollaborationQueryer, companyID, nodeID string) error {
	companyID, nodeID = cleanUUIDText(companyID), cleanUUIDText(nodeID)
	if ctx == nil || queryer == nil || companyID == "" || nodeID == "" {
		return ErrInvalid
	}
	var exists bool
	if err := queryer.QueryRowContext(ctx, `
select exists(select 1 from nodes where company_id=$1::uuid and node_id=$2::uuid)`,
		companyID, nodeID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}
