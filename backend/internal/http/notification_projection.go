package httpapi

import (
	"context"
	"log"
	"miraeopus/backend/internal/store"
	"time"
)

const notificationDomainEventCatchupInterval = 30 * time.Second
const notificationDomainEventCatchupLimit = 100

func (s *Server) initializeNotificationDomainEventCheckpoints(ctx context.Context) {
	if s.repo == nil {
		return
	}
	companies, err := s.repo.ListCompanies("", store.CompanyListMaxLimit)
	if err != nil {
		log.Printf("notification projection checkpoint initialization failed: %v", err)
		return
	}
	for _, company := range companies {
		if ctx.Err() != nil {
			return
		}
		if err := s.notifications.InitializeDomainEventCheckpoint(ctx, company.CompanyID); err != nil {
			log.Printf("notification projection checkpoint initialization failed company_id=%s: %v", company.CompanyID, err)
		}
	}
}

func (s *Server) startNotificationDomainEventCatchup() {
	if s.repo == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.notificationCatchupCancel = cancel
	go s.runNotificationDomainEventCatchup(ctx)
}

func (s *Server) runNotificationDomainEventCatchup(ctx context.Context) {
	timer := time.NewTimer(s.notificationCatchupInterval)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			s.runNotificationDomainEventCatchupOnce(ctx)
			timer.Reset(s.notificationCatchupInterval)
		}
	}
}

func (s *Server) runNotificationDomainEventCatchupOnce(ctx context.Context) {
	companies, err := s.repo.ListCompanies("", store.CompanyListMaxLimit)
	if err != nil {
		log.Printf("notification projection catch-up failed to list companies: %v", err)
		return
	}
	for _, company := range companies {
		if ctx.Err() != nil {
			return
		}
		result, items, err := s.notifications.ReplayDomainEvents(ctx, company.CompanyID, s.notificationCatchupLimit)
		if err != nil {
			log.Printf("notification projection catch-up failed company_id=%s processed=%d: %v", company.CompanyID, result.ProcessedEvents, err)
			continue
		}
		s.publishNotifications(items)
	}
}
