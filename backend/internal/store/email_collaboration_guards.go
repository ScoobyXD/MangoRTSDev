package store

import "miraeopus/backend/internal/domain"

func (r *MemoryRepo) emailRelationshipForNodeLocked(companyID, nodeID string) (domain.CommunicationsEmailCollaboration, bool) {
	for _, item := range r.emailCollaborations {
		if item.CompanyID == companyID && item.NodeID == nodeID {
			return cloneCommunicationsEmailCollaboration(item), true
		}
	}
	return domain.CommunicationsEmailCollaboration{}, false
}
