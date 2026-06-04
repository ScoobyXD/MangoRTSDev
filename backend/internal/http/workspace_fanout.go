package httpapi

import (
	"context"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"strings"
	"sync"
	"time"
)

const workspaceFanoutNotifyTimeout = time.Second
const workspaceFanoutReconnectDelay = time.Second
const workspaceEventPublishDedupeMax = 4096

type workspaceEventPublishDedupeKey struct {
	CompanyID string
	Sequence  int64
}

type workspaceEventPublishDedupe struct {
	mu    sync.Mutex
	seen  map[workspaceEventPublishDedupeKey]struct{}
	order []workspaceEventPublishDedupeKey
}

func newWorkspaceEventPublishDedupe() *workspaceEventPublishDedupe {
	return &workspaceEventPublishDedupe{seen: map[workspaceEventPublishDedupeKey]struct{}{}}
}

func (d *workspaceEventPublishDedupe) mark(companyID string, sequence int64) bool {
	companyID = strings.TrimSpace(companyID)
	if d == nil || companyID == "" || sequence <= 0 {
		return true
	}
	key := workspaceEventPublishDedupeKey{CompanyID: companyID, Sequence: sequence}
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.seen[key]; ok {
		return false
	}
	d.seen[key] = struct{}{}
	d.order = append(d.order, key)
	for len(d.order) > workspaceEventPublishDedupeMax {
		delete(d.seen, d.order[0])
		d.order = d.order[1:]
	}
	return true
}

func (s *Server) startWorkspaceEventFanout() {
	if s.workspaceFanout == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.workspaceFanoutCancel = cancel
	go s.runWorkspaceEventFanout(ctx)
}

func (s *Server) runWorkspaceEventFanout(ctx context.Context) {
	for ctx.Err() == nil {
		err := s.workspaceFanout.ListenWorkspaceEvents(ctx, func(notification store.WorkspaceEventNotification) {
			s.publishWorkspaceFanoutNotification(notification)
		})
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			log.Printf("workspace event fanout listener failed: %v", err)
		}
		timer := time.NewTimer(workspaceFanoutReconnectDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (s *Server) publishWorkspaceFanoutNotification(notification store.WorkspaceEventNotification) {
	if strings.TrimSpace(notification.UserID) != "" {
		return
	}
	companyID := strings.TrimSpace(notification.CompanyID)
	if companyID == "" || notification.Sequence <= 0 {
		return
	}
	events, err := s.repo.ListDomainEventsAfter(store.DomainEventReplayQuery{
		CompanyID:     companyID,
		StreamType:    workspaceDomainStreamType,
		StreamID:      companyID,
		AfterSequence: notification.Sequence - 1,
		Limit:         1,
	})
	if err != nil {
		log.Printf("workspace event fanout replay failed company_id=%s sequence=%d: %v", companyID, notification.Sequence, err)
		return
	}
	if len(events) == 0 || events[0].Sequence != notification.Sequence {
		log.Printf("workspace event fanout replay missed company_id=%s sequence=%d", companyID, notification.Sequence)
		return
	}
	s.publishCommittedWorkspaceEventFromFanout(events[0])
}

func (s *Server) notifyWorkspaceEventFanout(event domain.DomainEvent) {
	if s.workspaceFanout == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), workspaceFanoutNotifyTimeout)
	defer cancel()
	if err := s.workspaceFanout.NotifyWorkspaceEvent(ctx, event); err != nil {
		log.Printf("workspace event fanout notify failed company_id=%s sequence=%d event_id=%s: %v", event.CompanyID, event.Sequence, event.EventID, err)
	}
}
