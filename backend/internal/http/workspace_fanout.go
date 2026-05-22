package httpapi

import (
	"context"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"sync"
	"time"
)

const workspaceFanoutNotifyTimeout = time.Second
const workspaceFanoutReconnectDelay = time.Second

type workspaceEventNotificationHub struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan store.WorkspaceEventNotification]struct{}
}

func newWorkspaceEventNotificationHub() *workspaceEventNotificationHub {
	return &workspaceEventNotificationHub{subscribers: map[string]map[chan store.WorkspaceEventNotification]struct{}{}}
}

func (h *workspaceEventNotificationHub) subscribe(companyID string) chan store.WorkspaceEventNotification {
	return h.subscribeUser(companyID, "")
}

func (h *workspaceEventNotificationHub) subscribeUser(companyID, userID string) chan store.WorkspaceEventNotification {
	ch := make(chan store.WorkspaceEventNotification, 24)
	key := workspaceSubscriptionKey(companyID, userID)
	h.mu.Lock()
	bucket := h.subscribers[key]
	if bucket == nil {
		bucket = map[chan store.WorkspaceEventNotification]struct{}{}
		h.subscribers[key] = bucket
	}
	bucket[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *workspaceEventNotificationHub) unsubscribe(companyID string, ch chan store.WorkspaceEventNotification) {
	h.unsubscribeUser(companyID, "", ch)
}

func (h *workspaceEventNotificationHub) unsubscribeUser(companyID, userID string, ch chan store.WorkspaceEventNotification) {
	key := workspaceSubscriptionKey(companyID, userID)
	h.mu.Lock()
	if bucket := h.subscribers[key]; bucket != nil {
		delete(bucket, ch)
		if len(bucket) == 0 {
			delete(h.subscribers, key)
		}
	}
	h.mu.Unlock()
	close(ch)
}

func (h *workspaceEventNotificationHub) publish(notification store.WorkspaceEventNotification) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subscribers[workspaceSubscriptionKey(notification.CompanyID, notification.UserID)] {
		select {
		case ch <- notification:
		default:
		}
	}
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
			s.workspaceWakeHub.publish(notification)
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
