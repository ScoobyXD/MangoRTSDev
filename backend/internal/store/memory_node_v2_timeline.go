package store

import (
	"time"

	"miraeopus/backend/internal/domain"
)

func (r *MemoryRepo) appendNodeV2MovementLocked(item domain.NodeTimelineEvent) {
	movementID := newUUIDv7String()
	timelineKey := memoryNodeV2NodeKey(item.CompanyID, item.NodeID)
	r.nodeV2.timeline[timelineKey] = append(r.nodeV2.timeline[timelineKey], domain.NodeV2TimelineItem{
		TimelineItemID: newUUIDv7String(), CompanyID: item.CompanyID, NodeID: item.NodeID,
		TimelineSequence: int64(len(r.nodeV2.timeline[timelineKey]) + 1), ItemType: domain.NodeV2TimelineNodeMoved,
		OccurredAt: item.CreatedTimestamp, RecordedAt: item.CreatedTimestamp, ActorUserID: item.ActorUserID,
		MovementID: movementID,
		SummaryJSON: memoryNodeV2Summary(map[string]any{
			"from_logic_gate_name": item.FromLogicGateName,
			"to_logic_gate_name":   item.ToLogicGateName,
			"actor_display_name":   item.ActorDisplayName,
		}),
	})
}

func (r *MemoryRepo) appendNodeV2VerificationStampLocked(companyID, nodeID, legacyEventID, userID string, occurredAt time.Time) {
	stampKey := companyID + "\x1f" + legacyEventID + "\x1f" + userID
	if r.nodeV2.verificationStamps[stampKey] != "" {
		return
	}
	verificationEventID := newUUIDv7String()
	r.nodeV2.verificationStamps[stampKey] = verificationEventID
	timelineKey := memoryNodeV2NodeKey(companyID, nodeID)
	r.nodeV2.timeline[timelineKey] = append(r.nodeV2.timeline[timelineKey], domain.NodeV2TimelineItem{
		TimelineItemID: newUUIDv7String(), CompanyID: companyID, NodeID: nodeID,
		TimelineSequence: int64(len(r.nodeV2.timeline[timelineKey]) + 1), ItemType: domain.NodeV2TimelineVerificationStamp,
		OccurredAt: occurredAt, RecordedAt: occurredAt, ActorUserID: userID,
		VerificationEventID: verificationEventID,
		SummaryJSON:         memoryNodeV2Summary(map[string]any{"actor_display_name": r.nodeV2DisplayNameLocked(userID), "legacy_verification_request_id": legacyEventID}),
	})
}
