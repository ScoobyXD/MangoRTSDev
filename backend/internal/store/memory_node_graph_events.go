package store

import (
	"time"

	"miraeopus/backend/internal/domain"
)

type memoryNodeGraphEventSnapshot struct {
	nodes                          map[string]domain.Node
	nodeInfo                       map[string][]domain.NodeInformation
	nodeText                       map[string]map[string]domain.NodeProjection
	nodeRels                       map[string][]domain.NodeRelationship
	folders                        map[string]domain.CompanyExplorerFolder
	folderItems                    map[string]domain.CompanyExplorerFolderItem
	defaultFolderSeed              map[string]bool
	kanbanCards                    map[string][]domain.KanbanCard
	emailNodeLinks                 map[string]communicationsEmailNodeLink
	emailDrafts                    map[string]domain.CommunicationsEmailDraft
	attachments                    map[string]domain.Attachment
	resourceAttachments            map[string]domain.ResourceAttachment
	nodeEmailThreads               map[string]domain.CommunicationsNodeEmailThread
	emailCollaborations            map[string]domain.CommunicationsEmailCollaboration
	emailCollaborationParticipants map[string]domain.CommunicationsEmailCollaborationParticipant
	actionItemSources              map[string]domain.ActionItemSource
	domainEvents                   map[string]domain.DomainEvent
	nodeCompletionTransitions      map[string]time.Time
	effectiveAccess                map[string]domain.EffectiveResourceAccess
}

func cloneMemoryMap[V any](items map[string]V) map[string]V {
	out := make(map[string]V, len(items))
	for k, v := range items {
		out[k] = v
	}
	return out
}

func cloneMemorySliceMap[V any](items map[string][]V) map[string][]V {
	out := make(map[string][]V, len(items))
	for k, v := range items {
		out[k] = append([]V(nil), v...)
	}
	return out
}

func cloneMemoryNodeText(items map[string]map[string]domain.NodeProjection) map[string]map[string]domain.NodeProjection {
	out := make(map[string]map[string]domain.NodeProjection, len(items))
	for k, v := range items {
		out[k] = cloneMemoryMap(v)
	}
	return out
}

func (r *MemoryRepo) snapshotNodeGraphEventStateLocked() memoryNodeGraphEventSnapshot {
	return memoryNodeGraphEventSnapshot{
		nodes:                          cloneMemoryMap(r.nodes),
		nodeInfo:                       cloneMemorySliceMap(r.nodeInfo),
		nodeText:                       cloneMemoryNodeText(r.nodeText),
		nodeRels:                       cloneMemorySliceMap(r.nodeRels),
		folders:                        cloneMemoryMap(r.folders),
		folderItems:                    cloneMemoryMap(r.folderItems),
		defaultFolderSeed:              cloneMemoryMap(r.defaultFolderSeed),
		kanbanCards:                    cloneMemorySliceMap(r.kanbanCards),
		emailNodeLinks:                 cloneMemoryMap(r.emailNodeLinks),
		emailDrafts:                    cloneMemoryMap(r.emailDrafts),
		attachments:                    cloneMemoryMap(r.attachments),
		resourceAttachments:            cloneMemoryMap(r.resourceAttachments),
		nodeEmailThreads:               cloneMemoryMap(r.nodeEmailThreads),
		emailCollaborations:            cloneMemoryMap(r.emailCollaborations),
		emailCollaborationParticipants: cloneMemoryMap(r.emailCollaborationParticipants),
		actionItemSources:              cloneMemoryMap(r.actionItemSources),
		domainEvents:                   cloneMemoryMap(r.domainEvents),
		nodeCompletionTransitions:      cloneMemoryMap(r.nodeCompletionTransitions),
		effectiveAccess:                cloneMemoryMap(r.effectiveAccess),
	}
}

func (r *MemoryRepo) restoreNodeGraphEventStateLocked(snapshot memoryNodeGraphEventSnapshot) {
	r.nodes = snapshot.nodes
	r.nodeInfo = snapshot.nodeInfo
	r.nodeText = snapshot.nodeText
	r.nodeRels = snapshot.nodeRels
	r.folders = snapshot.folders
	r.folderItems = snapshot.folderItems
	r.defaultFolderSeed = snapshot.defaultFolderSeed
	r.kanbanCards = snapshot.kanbanCards
	r.emailNodeLinks = snapshot.emailNodeLinks
	r.emailDrafts = snapshot.emailDrafts
	r.attachments = snapshot.attachments
	r.resourceAttachments = snapshot.resourceAttachments
	r.nodeEmailThreads = snapshot.nodeEmailThreads
	r.emailCollaborations = snapshot.emailCollaborations
	r.emailCollaborationParticipants = snapshot.emailCollaborationParticipants
	r.actionItemSources = snapshot.actionItemSources
	r.domainEvents = snapshot.domainEvents
	r.nodeCompletionTransitions = snapshot.nodeCompletionTransitions
	r.effectiveAccess = snapshot.effectiveAccess
}
