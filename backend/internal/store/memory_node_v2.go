package store

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

type memoryNodeV2EmailLink struct {
	companyID      string
	nodeID         string
	textboxID      string
	emailThreadID  string
	emailMessageID string
	createdAt      time.Time
	deletedAt      *time.Time
}

func encodeBase64(value []byte) string {
	return base64.StdEncoding.EncodeToString(value)
}

type memoryNodeV2State struct {
	textboxes          map[string]domain.NodeV2TextBox
	creationKeys       map[string]string
	timeline           map[string][]domain.NodeV2TimelineItem
	updates            map[string][]domain.NodeV2YjsUpdate
	checkpoints        map[string][]domain.NodeV2YjsCheckpoint
	threads            map[string][]domain.NodeV2CommentThread
	commentKeys        map[string]string
	attachmentLinks    map[string]domain.NodeV2AttachmentLink
	emailLinks         map[string]memoryNodeV2EmailLink
	verificationStamps map[string]string
}

func newMemoryNodeV2State() memoryNodeV2State {
	return memoryNodeV2State{
		textboxes: map[string]domain.NodeV2TextBox{}, creationKeys: map[string]string{},
		timeline: map[string][]domain.NodeV2TimelineItem{}, updates: map[string][]domain.NodeV2YjsUpdate{},
		checkpoints: map[string][]domain.NodeV2YjsCheckpoint{}, threads: map[string][]domain.NodeV2CommentThread{},
		commentKeys: map[string]string{}, attachmentLinks: map[string]domain.NodeV2AttachmentLink{},
		emailLinks: map[string]memoryNodeV2EmailLink{}, verificationStamps: map[string]string{},
	}
}

func memoryNodeV2NodeKey(companyID, nodeID string) string       { return key(companyID, nodeID) }
func memoryNodeV2TextboxKey(companyID, textboxID string) string { return key(companyID, textboxID) }

func cloneNodeV2Textbox(item domain.NodeV2TextBox) domain.NodeV2TextBox {
	item.DocumentJSON = append(json.RawMessage(nil), item.DocumentJSON...)
	return item
}

func cloneNodeV2Thread(item domain.NodeV2CommentThread) domain.NodeV2CommentThread {
	item.Comments = append([]domain.NodeV2Comment(nil), item.Comments...)
	for i := range item.Comments {
		item.Comments[i].Mentions = append([]domain.NodeV2CommentMention(nil), item.Comments[i].Mentions...)
	}
	return item
}

func normalizeNodeV2Limit(limit, maximum int) int {
	if limit <= 0 {
		return NodeV2DefaultPageLimit
	}
	if limit > maximum {
		return maximum
	}
	return limit
}

func nodeV2CursorBefore(ts time.Time, id string, cursor *NodeV2Cursor) bool {
	if cursor == nil {
		return true
	}
	return ts.Before(cursor.Timestamp) || (ts.Equal(cursor.Timestamp) && id < cursor.ID)
}

func (r *MemoryRepo) nodeV2TextboxesLocked(companyID, nodeID string, archived bool) []domain.NodeV2TextBox {
	items := make([]domain.NodeV2TextBox, 0)
	for _, item := range r.nodeV2.textboxes {
		if item.CompanyID == companyID && item.NodeID == nodeID && (item.DeletedTimestamp != nil) == archived {
			item.CommentCount = len(r.nodeV2.threads[memoryNodeV2TextboxKey(companyID, item.TextboxID)])
			for _, link := range r.nodeV2.attachmentLinks {
				if link.TextboxID == item.TextboxID && link.DeletedTimestamp == nil {
					item.AttachmentCount++
				}
			}
			for _, link := range r.nodeV2.emailLinks {
				if link.textboxID == item.TextboxID && link.deletedAt == nil {
					item.EmailLinkCount++
				}
			}
			items = append(items, cloneNodeV2Textbox(item))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].DisplayOrder != items[j].DisplayOrder {
			return items[i].DisplayOrder < items[j].DisplayOrder
		}
		return items[i].TextboxID < items[j].TextboxID
	})
	return items
}

func (r *MemoryRepo) GetNodeV2Workspace(query NodeV2WorkspaceQuery) (NodeV2WorkspaceResult, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	node, ok := r.nodes[key(query.CompanyID, query.NodeID)]
	if !ok {
		return NodeV2WorkspaceResult{}, ErrNotFound
	}
	result := NodeV2WorkspaceResult{Node: node}
	allTextboxes := r.nodeV2TextboxesLocked(query.CompanyID, query.NodeID, false)
	allArchived := r.nodeV2TextboxesLocked(query.CompanyID, query.NodeID, true)
	result.Counts.Textboxes, result.Counts.ArchivedTextboxes = len(allTextboxes), len(allArchived)
	for _, textbox := range append(append([]domain.NodeV2TextBox{}, allTextboxes...), allArchived...) {
		result.Counts.Comments += textbox.CommentCount
		result.Counts.Attachments += textbox.AttachmentCount
	}
	if len(allTextboxes) > NodeV2MaxPageLimit {
		allTextboxes = allTextboxes[:NodeV2MaxPageLimit]
	}
	if len(allArchived) > NodeV2MaxPageLimit {
		allArchived = allArchived[:NodeV2MaxPageLimit]
	}
	result.Textboxes, result.ArchivedTextboxes = allTextboxes, allArchived
	result.Timeline = r.listNodeV2TimelineLocked(NodeV2TimelineQuery{CompanyID: query.CompanyID, NodeID: query.NodeID, Limit: query.TimelineLimit, Cursor: query.TimelineCursor})
	attachments := r.listNodeV2AttachmentsLocked(NodeV2AggregateQuery{CompanyID: query.CompanyID, NodeID: query.NodeID, Limit: query.AggregateLimit})
	result.AttachmentSummaries, result.AttachmentNextCursor = attachments.Items, attachments.NextCursor
	emails := r.listNodeV2EmailThreadsLocked(NodeV2AggregateQuery{CompanyID: query.CompanyID, NodeID: query.NodeID, Limit: query.AggregateLimit})
	result.EmailThreadSummaries, result.EmailNextCursor = emails.Items, emails.NextCursor
	result.Counts.EmailThreads = len(result.EmailThreadSummaries)
	return result, nil
}

func (r *MemoryRepo) listNodeV2TimelineLocked(query NodeV2TimelineQuery) NodeV2TimelinePage {
	limit := normalizeNodeV2Limit(query.Limit, NodeV2MaxPageLimit)
	all := append([]domain.NodeV2TimelineItem(nil), r.nodeV2.timeline[memoryNodeV2NodeKey(query.CompanyID, query.NodeID)]...)
	sort.Slice(all, func(i, j int) bool {
		if !all[i].OccurredAt.Equal(all[j].OccurredAt) {
			return all[i].OccurredAt.After(all[j].OccurredAt)
		}
		return all[i].TimelineSequence > all[j].TimelineSequence
	})
	items := make([]domain.NodeV2TimelineItem, 0, limit+1)
	for _, item := range all {
		if query.Cursor != nil && !(item.OccurredAt.Before(query.Cursor.Timestamp) || (item.OccurredAt.Equal(query.Cursor.Timestamp) && item.TimelineSequence < query.Cursor.Sequence)) {
			continue
		}
		items = append(items, item)
		if len(items) == limit+1 {
			break
		}
	}
	page := NodeV2TimelinePage{Items: items}
	if len(items) > limit {
		last := items[limit-1]
		page.Items = items[:limit]
		page.NextCursor = &NodeV2Cursor{Timestamp: last.OccurredAt, ID: last.TimelineItemID, Sequence: last.TimelineSequence}
	}
	return page
}

func (r *MemoryRepo) ListNodeV2Timeline(query NodeV2TimelineQuery) (NodeV2TimelinePage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodes[key(query.CompanyID, query.NodeID)]; !ok {
		return NodeV2TimelinePage{}, ErrNotFound
	}
	return r.listNodeV2TimelineLocked(query), nil
}

func (r *MemoryRepo) CreateNodeV2TextBox(input NodeV2CreateTextBoxInput) (NodeV2TextBoxMutationResult, error) {
	if strings.TrimSpace(input.IdempotencyKey) == "" {
		return NodeV2TextBoxMutationResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.nodes[key(input.CompanyID, input.NodeID)]; !ok {
		return NodeV2TextBoxMutationResult{}, ErrNotFound
	}
	creationKey := strings.Join([]string{input.CompanyID, input.NodeID, input.IdempotencyKey}, "\x1f")
	if textboxID := r.nodeV2.creationKeys[creationKey]; textboxID != "" {
		textbox := cloneNodeV2Textbox(r.nodeV2.textboxes[memoryNodeV2TextboxKey(input.CompanyID, textboxID)])
		for _, item := range r.nodeV2.timeline[memoryNodeV2NodeKey(input.CompanyID, input.NodeID)] {
			if item.TextboxID == textboxID && item.ItemType == domain.NodeV2TimelineTextboxCreated {
				return NodeV2TextBoxMutationResult{Textbox: textbox, TimelineItem: item}, nil
			}
		}
	}
	now, textboxID := time.Now().UTC(), newUUIDv7String()
	order := int64(0)
	for _, item := range r.nodeV2.textboxes {
		if item.CompanyID == input.CompanyID && item.NodeID == input.NodeID && item.DisplayOrder <= order {
			order = item.DisplayOrder - 1024
		}
	}
	textbox := domain.NodeV2TextBox{CompanyID: input.CompanyID, NodeID: input.NodeID, TextboxID: textboxID, DocumentJSON: json.RawMessage(`{"type":"doc","content":[{"type":"paragraph"}]}`), DocumentSchemaVersion: 1, ContentRevision: 1, CollaborationEpoch: newUUIDv7String(), DisplayOrder: order, CreatedByUserID: input.ActorUserID, UpdatedByUserID: input.ActorUserID, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.nodeV2.textboxes[memoryNodeV2TextboxKey(input.CompanyID, textboxID)] = textbox
	r.nodeV2.creationKeys[creationKey] = textboxID
	checkpoint := domain.NodeV2YjsCheckpoint{CheckpointID: newUUIDv7String(), CollaborationEpoch: textbox.CollaborationEpoch, PayloadBase64: "AAA=", StateVectorBase64: "AA==", CreatedTimestamp: now}
	r.nodeV2.checkpoints[memoryNodeV2TextboxKey(input.CompanyID, textboxID)] = []domain.NodeV2YjsCheckpoint{checkpoint}
	timelineKey := memoryNodeV2NodeKey(input.CompanyID, input.NodeID)
	sequence := int64(len(r.nodeV2.timeline[timelineKey]) + 1)
	summary, _ := json.Marshal(map[string]any{"textbox_id": textboxID})
	item := domain.NodeV2TimelineItem{TimelineItemID: newUUIDv7String(), CompanyID: input.CompanyID, NodeID: input.NodeID, TimelineSequence: sequence, ItemType: domain.NodeV2TimelineTextboxCreated, OccurredAt: now, RecordedAt: now, ActorUserID: input.ActorUserID, TextboxID: textboxID, SummaryJSON: summary}
	r.nodeV2.timeline[timelineKey] = append(r.nodeV2.timeline[timelineKey], item)
	return NodeV2TextBoxMutationResult{Textbox: cloneNodeV2Textbox(textbox), TimelineItem: item}, nil
}

func (r *MemoryRepo) GetNodeV2TextBox(companyID, nodeID, textboxID string) (domain.NodeV2TextBox, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.nodeV2.textboxes[memoryNodeV2TextboxKey(companyID, textboxID)]
	if !ok || item.NodeID != nodeID {
		return domain.NodeV2TextBox{}, ErrNotFound
	}
	return cloneNodeV2Textbox(item), nil
}

func (r *MemoryRepo) SetNodeV2TextBoxArchived(input NodeV2ArchiveTextBoxInput) (domain.NodeV2TextBox, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := memoryNodeV2TextboxKey(input.CompanyID, input.TextboxID)
	item, ok := r.nodeV2.textboxes[k]
	if !ok || item.NodeID != input.NodeID {
		return domain.NodeV2TextBox{}, ErrNotFound
	}
	now := time.Now().UTC()
	if input.Archived {
		item.DeletedTimestamp = &now
	} else {
		item.DeletedTimestamp = nil
	}
	item.UpdatedByUserID, item.UpdatedTimestamp = input.ActorUserID, now
	r.nodeV2.textboxes[k] = item
	return cloneNodeV2Textbox(item), nil
}

func (r *MemoryRepo) SetNodeV2TextBoxOrder(input NodeV2TextBoxOrderInput) ([]domain.NodeV2TextBox, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	active := r.nodeV2TextboxesLocked(input.CompanyID, input.NodeID, false)
	if len(active) != len(input.TextboxIDs) {
		return nil, ErrVersionConflict
	}
	seen := map[string]bool{}
	for i, textboxID := range input.TextboxIDs {
		k := memoryNodeV2TextboxKey(input.CompanyID, textboxID)
		item, ok := r.nodeV2.textboxes[k]
		if !ok || item.NodeID != input.NodeID || item.DeletedTimestamp != nil || seen[textboxID] {
			return nil, ErrVersionConflict
		}
		seen[textboxID] = true
		item.DisplayOrder = int64(i) * 1024
		item.UpdatedByUserID = input.ActorUserID
		item.UpdatedTimestamp = time.Now().UTC()
		r.nodeV2.textboxes[k] = item
	}
	return r.nodeV2TextboxesLocked(input.CompanyID, input.NodeID, false), nil
}

func (r *MemoryRepo) GetNodeV2TextBoxSync(query NodeV2SyncQuery) (NodeV2SyncPage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	textbox, ok := r.nodeV2.textboxes[memoryNodeV2TextboxKey(query.CompanyID, query.TextboxID)]
	if !ok || textbox.NodeID != query.NodeID {
		return NodeV2SyncPage{}, ErrNotFound
	}
	page := NodeV2SyncPage{Textbox: cloneNodeV2Textbox(textbox)}
	if query.IncludeCheckpoint {
		checkpoints := r.nodeV2.checkpoints[memoryNodeV2TextboxKey(query.CompanyID, query.TextboxID)]
		if len(checkpoints) > 0 {
			cp := checkpoints[len(checkpoints)-1]
			page.Checkpoint = &cp
		}
	}
	limit := normalizeNodeV2Limit(query.Limit, NodeV2MaxSyncPageLimit)
	for _, update := range r.nodeV2.updates[memoryNodeV2TextboxKey(query.CompanyID, query.TextboxID)] {
		if update.UpdateSequence <= query.AfterSequence {
			continue
		}
		if len(page.Updates) == limit {
			page.HasMore = true
			break
		}
		page.Updates = append(page.Updates, update)
		page.NextSequence = update.UpdateSequence
	}
	return page, nil
}

func (r *MemoryRepo) AppendNodeV2YjsUpdate(input NodeV2YjsUpdateInput) (domain.NodeV2YjsUpdate, error) {
	if len(input.Payload) == 0 || len(input.Payload) > NodeV2MaxUpdateBytes || input.UpdateID == "" {
		return domain.NodeV2YjsUpdate{}, ErrInvalid
	}
	digest := sha256.Sum256(input.Payload)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), input.UpdateSHA256) {
		return domain.NodeV2YjsUpdate{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	k := memoryNodeV2TextboxKey(input.CompanyID, input.TextboxID)
	textbox, ok := r.nodeV2.textboxes[k]
	if !ok || textbox.NodeID != input.NodeID {
		return domain.NodeV2YjsUpdate{}, ErrNotFound
	}
	if textbox.CollaborationEpoch != input.CollaborationEpoch {
		return domain.NodeV2YjsUpdate{}, ErrVersionConflict
	}
	for _, item := range r.nodeV2.updates[k] {
		if item.UpdateID == input.UpdateID {
			if !strings.EqualFold(item.UpdateSHA256, input.UpdateSHA256) {
				return domain.NodeV2YjsUpdate{}, ErrVersionConflict
			}
			return item, nil
		}
		if item.CollaborationEpoch == input.CollaborationEpoch && strings.EqualFold(item.UpdateSHA256, input.UpdateSHA256) {
			return item, nil
		}
	}
	now := time.Now().UTC()
	sequence := textbox.LatestUpdateSequence + 1
	item := domain.NodeV2YjsUpdate{UpdateSequence: sequence, UpdateID: input.UpdateID, UpdateSHA256: strings.ToLower(input.UpdateSHA256), CollaborationEpoch: input.CollaborationEpoch, ClientID: input.ClientID, PayloadBase64: encodeBase64(input.Payload), ReceivedTimestamp: now}
	r.nodeV2.updates[k] = append(r.nodeV2.updates[k], item)
	textbox.LatestUpdateSequence = sequence
	textbox.UpdatedByUserID = input.ActorUserID
	textbox.UpdatedTimestamp = now
	r.nodeV2.textboxes[k] = textbox
	return item, nil
}

func (r *MemoryRepo) CheckpointNodeV2TextBox(input NodeV2CheckpointInput) (domain.NodeV2TextBox, error) {
	if !json.Valid(input.DocumentJSON) || len(input.CheckpointPayload) == 0 || len(input.StateVector) == 0 {
		return domain.NodeV2TextBox{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	k := memoryNodeV2TextboxKey(input.CompanyID, input.TextboxID)
	textbox, ok := r.nodeV2.textboxes[k]
	if !ok || textbox.NodeID != input.NodeID {
		return domain.NodeV2TextBox{}, ErrNotFound
	}
	if textbox.CollaborationEpoch != input.CollaborationEpoch || input.ThroughSequence > textbox.LatestUpdateSequence {
		return domain.NodeV2TextBox{}, ErrVersionConflict
	}
	for _, cp := range r.nodeV2.checkpoints[k] {
		if cp.CheckpointID == input.CheckpointID {
			return cloneNodeV2Textbox(textbox), nil
		}
	}
	now := time.Now().UTC()
	cp := domain.NodeV2YjsCheckpoint{CheckpointID: input.CheckpointID, CollaborationEpoch: input.CollaborationEpoch, ThroughSequence: input.ThroughSequence, PayloadBase64: encodeBase64(input.CheckpointPayload), StateVectorBase64: encodeBase64(input.StateVector), CreatedTimestamp: now}
	r.nodeV2.checkpoints[k] = append(r.nodeV2.checkpoints[k], cp)
	textbox.DocumentJSON = append(json.RawMessage(nil), input.DocumentJSON...)
	textbox.PlainText = input.PlainText
	textbox.MaterializedThroughSequence = input.ThroughSequence
	textbox.ContentRevision++
	textbox.UpdatedByUserID = input.ActorUserID
	textbox.UpdatedTimestamp = now
	r.nodeV2.textboxes[k] = textbox
	return cloneNodeV2Textbox(textbox), nil
}

func (r *MemoryRepo) nodeV2DisplayNameLocked(userID string) string {
	for _, user := range r.users {
		if user.UserID == userID {
			return user.DisplayName
		}
	}
	return "Unknown user"
}

func (r *MemoryRepo) nodeV2MentionsLocked(items []NodeV2MentionInput) []domain.NodeV2CommentMention {
	result := make([]domain.NodeV2CommentMention, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		principalType, principalID := strings.TrimSpace(item.PrincipalType), strings.TrimSpace(item.PrincipalID)
		k := principalType + ":" + principalID
		if principalID == "" || (principalType != "user" && principalType != "group") || seen[k] {
			continue
		}
		seen[k] = true
		name := principalID
		if principalType == "user" {
			name = r.nodeV2DisplayNameLocked(principalID)
		}
		result = append(result, domain.NodeV2CommentMention{PrincipalType: principalType, PrincipalID: principalID, PrincipalDisplayName: name})
	}
	return result
}

func (r *MemoryRepo) ListNodeV2Comments(query NodeV2CommentQuery) (NodeV2CommentPage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	textbox, ok := r.nodeV2.textboxes[memoryNodeV2TextboxKey(query.CompanyID, query.TextboxID)]
	if !ok || textbox.NodeID != query.NodeID {
		return NodeV2CommentPage{}, ErrNotFound
	}
	all := r.nodeV2.threads[memoryNodeV2TextboxKey(query.CompanyID, query.TextboxID)]
	sort.Slice(all, func(i, j int) bool {
		if !all[i].CreatedTimestamp.Equal(all[j].CreatedTimestamp) {
			return all[i].CreatedTimestamp.After(all[j].CreatedTimestamp)
		}
		return all[i].ThreadID > all[j].ThreadID
	})
	limit := normalizeNodeV2Limit(query.Limit, NodeV2MaxPageLimit)
	page := NodeV2CommentPage{}
	for _, thread := range all {
		if !nodeV2CursorBefore(thread.CreatedTimestamp, thread.ThreadID, query.Cursor) {
			continue
		}
		page.Threads = append(page.Threads, cloneNodeV2Thread(thread))
		if len(page.Threads) == limit+1 {
			break
		}
	}
	if len(page.Threads) > limit {
		last := page.Threads[limit-1]
		page.Threads = page.Threads[:limit]
		page.NextCursor = &NodeV2Cursor{Timestamp: last.CreatedTimestamp, ID: last.ThreadID}
	}
	return page, nil
}

func (r *MemoryRepo) CreateNodeV2CommentThread(input NodeV2CreateCommentThreadInput) (domain.NodeV2CommentThread, error) {
	if strings.TrimSpace(input.BodyText) == "" || input.IdempotencyKey == "" {
		return domain.NodeV2CommentThread{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	k := memoryNodeV2TextboxKey(input.CompanyID, input.TextboxID)
	textbox, ok := r.nodeV2.textboxes[k]
	if !ok || textbox.NodeID != input.NodeID {
		return domain.NodeV2CommentThread{}, ErrNotFound
	}
	idem := k + "\x1f" + input.IdempotencyKey
	if threadID := r.nodeV2.commentKeys[idem]; threadID != "" {
		for _, thread := range r.nodeV2.threads[k] {
			if thread.ThreadID == threadID {
				return cloneNodeV2Thread(thread), nil
			}
		}
	}
	now := time.Now().UTC()
	format, status := "legacy_unanchored", input.AnchorStatus
	if len(input.AnchorStart) > 0 && len(input.AnchorEnd) > 0 {
		format = "yjs_relative_position_v1"
		if status == "" {
			status = "anchored"
		}
	} else if status == "" {
		status = "legacy_unanchored"
	}
	threadID, commentID := newUUIDv7String(), newUUIDv7String()
	thread := domain.NodeV2CommentThread{ThreadID: threadID, TextboxID: input.TextboxID, SelectedQuote: input.SelectedQuote, AnchorBeforeText: input.AnchorBeforeText, AnchorAfterText: input.AnchorAfterText, AnchorFormat: format, AnchorStatus: status, AnchorStartBase64: encodeBase64(input.AnchorStart), AnchorEndBase64: encodeBase64(input.AnchorEnd), CreatedByUserID: input.ActorUserID, CreatedByDisplayName: r.nodeV2DisplayNameLocked(input.ActorUserID), CreatedTimestamp: now}
	thread.Comments = []domain.NodeV2Comment{{CommentID: commentID, ThreadID: threadID, AuthorUserID: input.ActorUserID, AuthorDisplayName: r.nodeV2DisplayNameLocked(input.ActorUserID), BodyText: strings.TrimSpace(input.BodyText), Mentions: r.nodeV2MentionsLocked(input.Mentions), CreatedTimestamp: now}}
	r.nodeV2.threads[k] = append(r.nodeV2.threads[k], thread)
	r.nodeV2.commentKeys[idem] = threadID
	return cloneNodeV2Thread(thread), nil
}

func (r *MemoryRepo) ReplyNodeV2Comment(input NodeV2ReplyCommentInput) (domain.NodeV2Comment, error) {
	if strings.TrimSpace(input.BodyText) == "" || input.IdempotencyKey == "" {
		return domain.NodeV2Comment{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	k := memoryNodeV2TextboxKey(input.CompanyID, input.TextboxID)
	textbox, ok := r.nodeV2.textboxes[k]
	if !ok || textbox.NodeID != input.NodeID {
		return domain.NodeV2Comment{}, ErrNotFound
	}
	idem := k + "\x1f" + input.IdempotencyKey
	if commentID := r.nodeV2.commentKeys[idem]; commentID != "" {
		for _, thread := range r.nodeV2.threads[k] {
			for _, comment := range thread.Comments {
				if comment.CommentID == commentID {
					return comment, nil
				}
			}
		}
	}
	for ti := range r.nodeV2.threads[k] {
		thread := &r.nodeV2.threads[k][ti]
		if thread.ThreadID != input.ThreadID {
			continue
		}
		if input.ParentCommentID != "" {
			found := false
			for _, comment := range thread.Comments {
				if comment.CommentID == input.ParentCommentID {
					found = true
					break
				}
			}
			if !found {
				return domain.NodeV2Comment{}, ErrNotFound
			}
		}
		comment := domain.NodeV2Comment{CommentID: newUUIDv7String(), ThreadID: thread.ThreadID, ParentCommentID: input.ParentCommentID, AuthorUserID: input.ActorUserID, AuthorDisplayName: r.nodeV2DisplayNameLocked(input.ActorUserID), BodyText: strings.TrimSpace(input.BodyText), Mentions: r.nodeV2MentionsLocked(input.Mentions), CreatedTimestamp: time.Now().UTC()}
		thread.Comments = append(thread.Comments, comment)
		r.nodeV2.commentKeys[idem] = comment.CommentID
		return comment, nil
	}
	return domain.NodeV2Comment{}, ErrNotFound
}

func (r *MemoryRepo) listNodeV2AttachmentsLocked(query NodeV2AggregateQuery) NodeV2AttachmentPage {
	all := []domain.NodeV2AttachmentLink{}
	for _, link := range r.nodeV2.attachmentLinks {
		textbox, ok := r.nodeV2.textboxes[memoryNodeV2TextboxKey(query.CompanyID, link.TextboxID)]
		if ok && textbox.NodeID == query.NodeID && link.DeletedTimestamp == nil {
			all = append(all, link)
		}
	}
	sort.Slice(all, func(i, j int) bool {
		if !all[i].CreatedTimestamp.Equal(all[j].CreatedTimestamp) {
			return all[i].CreatedTimestamp.After(all[j].CreatedTimestamp)
		}
		return all[i].AttachmentLinkID > all[j].AttachmentLinkID
	})
	limit := normalizeNodeV2Limit(query.Limit, NodeV2MaxPageLimit)
	page := NodeV2AttachmentPage{}
	for _, item := range all {
		if !nodeV2CursorBefore(item.CreatedTimestamp, item.AttachmentLinkID, query.Cursor) {
			continue
		}
		page.Items = append(page.Items, item)
		if len(page.Items) == limit+1 {
			break
		}
	}
	if len(page.Items) > limit {
		last := page.Items[limit-1]
		page.Items = page.Items[:limit]
		page.NextCursor = &NodeV2Cursor{Timestamp: last.CreatedTimestamp, ID: last.AttachmentLinkID}
	}
	return page
}

func (r *MemoryRepo) ListNodeV2Attachments(query NodeV2AggregateQuery) (NodeV2AttachmentPage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodes[key(query.CompanyID, query.NodeID)]; !ok {
		return NodeV2AttachmentPage{}, ErrNotFound
	}
	return r.listNodeV2AttachmentsLocked(query), nil
}

func (r *MemoryRepo) SetNodeV2AttachmentLink(input NodeV2AttachmentLinkInput) (domain.NodeV2AttachmentLink, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	textbox, ok := r.nodeV2.textboxes[memoryNodeV2TextboxKey(input.CompanyID, input.TextboxID)]
	if !ok || textbox.NodeID != input.NodeID {
		return domain.NodeV2AttachmentLink{}, ErrNotFound
	}
	attachment, ok := r.attachments[key(input.CompanyID, input.AttachmentID)]
	if !ok {
		return domain.NodeV2AttachmentLink{}, ErrNotFound
	}
	if input.RelationshipKind != "file_attachment" && input.RelationshipKind != "inline_image" {
		return domain.NodeV2AttachmentLink{}, ErrInvalid
	}
	k := strings.Join([]string{input.CompanyID, input.TextboxID, input.AttachmentID, input.RelationshipKind}, "\x1f")
	link, found := r.nodeV2.attachmentLinks[k]
	now := time.Now().UTC()
	if !found {
		link = domain.NodeV2AttachmentLink{AttachmentLinkID: newUUIDv7String(), TextboxID: input.TextboxID, RelationshipKind: input.RelationshipKind, CreatedTimestamp: now, Attachment: attachment}
	}
	if input.Deleted {
		link.DeletedTimestamp = &now
	} else {
		link.DeletedTimestamp = nil
	}
	r.nodeV2.attachmentLinks[k] = link
	return link, nil
}

func (r *MemoryRepo) listNodeV2EmailThreadsLocked(query NodeV2AggregateQuery) NodeV2EmailPage {
	byThread := map[string]domain.NodeV2EmailThreadSummary{}
	for _, nodeLink := range r.nodeEmailThreads {
		if nodeLink.CompanyID != query.CompanyID || nodeLink.NodeID != query.NodeID {
			continue
		}
		thread, ok := r.emailThreads[key(query.CompanyID, nodeLink.EmailThreadID)]
		if !ok {
			continue
		}
		summary := domain.NodeV2EmailThreadSummary{EmailThreadID: thread.EmailThreadID, AccountEmail: thread.AccountEmail, HydrationStatus: thread.HydrationStatus, HistoryComplete: thread.HistoryComplete, NodeAttachedTimestamp: nodeLink.CreatedTimestamp, MessageCount: len(thread.Messages)}
		if len(thread.Messages) > 0 {
			last := thread.Messages[len(thread.Messages)-1].Message
			summary.Subject = last.Subject
			summary.Snippet = last.Snippet
			summary.LatestMessageAt = last.Date
		}
		byThread[thread.EmailThreadID] = summary
	}
	for _, link := range r.nodeV2.emailLinks {
		if link.companyID != query.CompanyID || link.nodeID != query.NodeID || link.deletedAt != nil {
			continue
		}
		summary, ok := byThread[link.emailThreadID]
		if !ok {
			continue
		}
		if link.textboxID != "" {
			summary.LinkedTextboxIDs = append(summary.LinkedTextboxIDs, link.textboxID)
		}
		if link.emailMessageID != "" {
			summary.LinkedMessageIDs = append(summary.LinkedMessageIDs, link.emailMessageID)
		}
		byThread[link.emailThreadID] = summary
	}
	all := make([]domain.NodeV2EmailThreadSummary, 0, len(byThread))
	for _, item := range byThread {
		sort.Strings(item.LinkedTextboxIDs)
		sort.Strings(item.LinkedMessageIDs)
		all = append(all, item)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].LatestMessageAt != all[j].LatestMessageAt {
			return all[i].LatestMessageAt > all[j].LatestMessageAt
		}
		return all[i].EmailThreadID > all[j].EmailThreadID
	})
	limit := normalizeNodeV2Limit(query.Limit, NodeV2MaxPageLimit)
	page := NodeV2EmailPage{}
	for _, item := range all {
		ts := time.Unix(item.LatestMessageAt, 0).UTC()
		if !nodeV2CursorBefore(ts, item.EmailThreadID, query.Cursor) {
			continue
		}
		page.Items = append(page.Items, item)
		if len(page.Items) == limit+1 {
			break
		}
	}
	if len(page.Items) > limit {
		last := page.Items[limit-1]
		page.Items = page.Items[:limit]
		page.NextCursor = &NodeV2Cursor{Timestamp: time.Unix(last.LatestMessageAt, 0).UTC(), ID: last.EmailThreadID}
	}
	return page
}

func (r *MemoryRepo) ListNodeV2EmailThreads(query NodeV2AggregateQuery) (NodeV2EmailPage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodes[key(query.CompanyID, query.NodeID)]; !ok {
		return NodeV2EmailPage{}, ErrNotFound
	}
	return r.listNodeV2EmailThreadsLocked(query), nil
}

func (r *MemoryRepo) SetNodeV2EmailLink(input NodeV2EmailLinkInput) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	textbox, ok := r.nodeV2.textboxes[memoryNodeV2TextboxKey(input.CompanyID, input.TextboxID)]
	if !ok || textbox.NodeID != input.NodeID {
		return ErrNotFound
	}
	nodeLink, ok := r.nodeEmailThreads[memoryNodeEmailThreadKey(input.CompanyID, input.NodeID, input.EmailThreadID)]
	if !ok {
		return ErrNotFound
	}
	thread, ok := r.emailThreads[key(input.CompanyID, input.EmailThreadID)]
	if !ok {
		return ErrNotFound
	}
	_ = nodeLink
	if input.EmailMessageID != "" {
		found := false
		for _, message := range thread.Messages {
			if message.EmailMessageID == input.EmailMessageID {
				found = true
				break
			}
		}
		if !found {
			return ErrNotFound
		}
	}
	k := strings.Join([]string{input.CompanyID, input.TextboxID, input.EmailThreadID, input.EmailMessageID}, "\x1f")
	link := r.nodeV2.emailLinks[k]
	if link.createdAt.IsZero() {
		link = memoryNodeV2EmailLink{companyID: input.CompanyID, nodeID: input.NodeID, textboxID: input.TextboxID, emailThreadID: input.EmailThreadID, emailMessageID: input.EmailMessageID, createdAt: time.Now().UTC()}
	}
	if input.Deleted {
		now := time.Now().UTC()
		link.deletedAt = &now
	} else {
		link.deletedAt = nil
	}
	r.nodeV2.emailLinks[k] = link
	return nil
}

func (r *MemoryRepo) ListNodeV2EmailMessages(query NodeV2EmailMessageQuery) (NodeV2EmailMessagePage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodeEmailThreads[memoryNodeEmailThreadKey(query.CompanyID, query.NodeID, query.EmailThreadID)]; !ok {
		return NodeV2EmailMessagePage{}, ErrNotFound
	}
	thread, ok := r.emailThreads[key(query.CompanyID, query.EmailThreadID)]
	if !ok {
		return NodeV2EmailMessagePage{}, ErrNotFound
	}
	limit := normalizeNodeV2Limit(query.Limit, NodeV2MaxPageLimit)
	page := NodeV2EmailMessagePage{}
	for _, item := range thread.Messages {
		if item.MessageOrder < query.AfterOrder {
			continue
		}
		message := domain.NodeV2EmailMessageSummary{EmailMessageID: item.EmailMessageID, EmailThreadID: item.EmailThreadID, ProviderMessageID: item.ProviderMessageID, MessageOrder: item.MessageOrder, Subject: item.Message.Subject, Snippet: item.Message.Snippet, Date: item.Message.Date, From: append([]domain.EmailAddressSnapshot(nil), item.Message.From...), To: append([]domain.EmailAddressSnapshot(nil), item.Message.To...), Cc: append([]domain.EmailAddressSnapshot(nil), item.Message.Cc...), Bcc: append([]domain.EmailAddressSnapshot(nil), item.Message.Bcc...), Attachments: append([]domain.EmailAttachmentSnapshot(nil), item.Message.Attachments...)}
		if query.IncludeBody {
			message.BodyHTML = item.Message.Body
		}
		if len(page.Items) == limit {
			page.HasMore = true
			page.NextOrder = item.MessageOrder
			break
		}
		page.Items = append(page.Items, message)
	}
	return page, nil
}
