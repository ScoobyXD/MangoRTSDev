package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"time"
)

const workspaceDerivedDomainEventCatchupInterval = 30 * time.Second
const workspaceDerivedDomainEventCatchupLimit = 100

type workspaceDerivedProjectionRepository interface {
	GetWorkspaceDerivedDomainEventCheckpoint(companyID string) (store.NotificationDomainEventCheckpoint, bool, error)
	SaveWorkspaceDerivedDomainEventCheckpoint(checkpoint store.NotificationDomainEventCheckpoint) error
	ProjectWorkspaceDerivedDomainEvent(event domain.DomainEvent) ([]domain.DomainEvent, error)
}

func (s *Server) workspaceDerivedProjectionRepo() workspaceDerivedProjectionRepository {
	repo, ok := s.repo.(workspaceDerivedProjectionRepository)
	if !ok {
		return nil
	}
	return repo
}

func (s *Server) initializeWorkspaceDerivedDomainEventCheckpoints(ctx context.Context) {
	projector := s.workspaceDerivedProjectionRepo()
	if projector == nil || s.repo == nil {
		return
	}
	companies, err := s.repo.ListCompanies("", store.CompanyListMaxLimit)
	if err != nil {
		log.Printf("workspace derived projection checkpoint initialization failed: %v", err)
		return
	}
	for _, company := range companies {
		if ctx.Err() != nil {
			return
		}
		if _, ok, err := projector.GetWorkspaceDerivedDomainEventCheckpoint(company.CompanyID); err != nil || ok {
			if err != nil {
				log.Printf("workspace derived projection checkpoint initialization failed company_id=%s: %v", company.CompanyID, err)
			}
			continue
		}
		checkpoint, ok, err := s.repo.LatestDomainEventForNotificationProjection(company.CompanyID)
		if err != nil {
			log.Printf("workspace derived projection checkpoint initialization failed company_id=%s: %v", company.CompanyID, err)
			continue
		}
		if ok {
			if err := projector.SaveWorkspaceDerivedDomainEventCheckpoint(checkpoint); err != nil {
				log.Printf("workspace derived projection checkpoint initialization failed company_id=%s: %v", company.CompanyID, err)
			}
		}
	}
}

func (s *Server) startWorkspaceDerivedDomainEventCatchup() {
	if s.workspaceDerivedProjectionRepo() == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.workspaceDerivedCatchupCancel = cancel
	go s.runWorkspaceDerivedDomainEventCatchup(ctx)
}

func (s *Server) runWorkspaceDerivedDomainEventCatchup(ctx context.Context) {
	timer := time.NewTimer(s.workspaceDerivedCatchupInterval)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			s.runWorkspaceDerivedDomainEventCatchupOnce(ctx)
			timer.Reset(s.workspaceDerivedCatchupInterval)
		}
	}
}

func (s *Server) runWorkspaceDerivedDomainEventCatchupOnce(ctx context.Context) {
	projector := s.workspaceDerivedProjectionRepo()
	if projector == nil {
		return
	}
	companies, err := s.repo.ListCompanies("", store.CompanyListMaxLimit)
	if err != nil {
		log.Printf("workspace derived projection catch-up failed to list companies: %v", err)
		return
	}
	for _, company := range companies {
		if ctx.Err() != nil {
			return
		}
		if err := s.replayWorkspaceDerivedDomainEvents(ctx, projector, company.CompanyID, s.workspaceDerivedCatchupLimit); err != nil {
			log.Printf("workspace derived projection catch-up failed company_id=%s: %v", company.CompanyID, err)
		}
	}
}

func (s *Server) replayWorkspaceDerivedDomainEvents(ctx context.Context, projector workspaceDerivedProjectionRepository, companyID string, limit int) error {
	if limit <= 0 || limit > store.DomainEventListMaxLimit {
		limit = workspaceDerivedDomainEventCatchupLimit
	}
	checkpoint, ok, err := projector.GetWorkspaceDerivedDomainEventCheckpoint(companyID)
	if err != nil {
		return err
	}
	if !ok {
		checkpoint = store.NotificationDomainEventCheckpoint{CompanyID: companyID}
	}
	events, err := s.repo.ListDomainEventsForNotificationProjection(store.DomainEventNotificationProjectionQuery{
		CompanyID:             companyID,
		AfterCreatedTimestamp: checkpoint.CreatedTimestamp,
		AfterEventID:          checkpoint.EventID,
		Limit:                 limit,
	})
	if err != nil {
		return err
	}
	for _, event := range events {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		projected, err := projector.ProjectWorkspaceDerivedDomainEvent(event)
		if err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				return fmt.Errorf("event_id=%s sequence=%d type=%s: %w", event.EventID, event.Sequence, event.Type, err)
			}
			log.Printf("workspace derived projection skipped missing target company_id=%s sequence=%d event_id=%s type=%s", event.CompanyID, event.Sequence, event.EventID, event.Type)
		} else if len(projected) > 0 {
			s.publishCommittedWorkspaceEvents(projected)
		}
		checkpoint = store.NotificationDomainEventCheckpoint{
			CompanyID:        event.CompanyID,
			CreatedTimestamp: event.CreatedTimestamp,
			EventID:          event.EventID,
		}
		if err := projector.SaveWorkspaceDerivedDomainEventCheckpoint(checkpoint); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) projectCommittedWorkspaceDerivedEventsWithTiming(events []domain.DomainEvent, timings *requestTimingRecorder) {
	projector := s.workspaceDerivedProjectionRepo()
	stop := timings.observeAccounted("derived_projection.enqueue")
	events = cloneDomainEventsForAsync(events)
	stop()
	if projector == nil || len(events) == 0 {
		return
	}
	go s.projectCommittedWorkspaceDerivedEventsAsync(projector, events)
}

func (s *Server) projectCommittedWorkspaceDerivedEventsAsync(projector workspaceDerivedProjectionRepository, events []domain.DomainEvent) {
	start := time.Now()
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("async workspace derived projection failed count=%d event_types=%s panic=%v", len(events), domainEventTypesForLog(events), recovered)
		}
	}()
	for _, event := range events {
		projected, err := projector.ProjectWorkspaceDerivedDomainEvent(event)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				log.Printf("async workspace derived projection skipped missing target company_id=%s sequence=%d event_id=%s type=%s", event.CompanyID, event.Sequence, event.EventID, event.Type)
			} else {
				log.Printf("async workspace derived projection failed company_id=%s sequence=%d event_id=%s type=%s: %v", event.CompanyID, event.Sequence, event.EventID, event.Type, err)
				go s.runWorkspaceDerivedDomainEventCatchupOnce(context.Background())
				continue
			}
		}
		if len(projected) > 0 {
			s.publishCommittedWorkspaceEvents(projected)
		}
		checkpoint := store.NotificationDomainEventCheckpoint{
			CompanyID:        event.CompanyID,
			CreatedTimestamp: event.CreatedTimestamp,
			EventID:          event.EventID,
		}
		if err := projector.SaveWorkspaceDerivedDomainEventCheckpoint(checkpoint); err != nil {
			log.Printf("async workspace derived projection checkpoint save failed company_id=%s sequence=%d event_id=%s type=%s: %v", event.CompanyID, event.Sequence, event.EventID, event.Type, err)
			go s.runWorkspaceDerivedDomainEventCatchupOnce(context.Background())
			continue
		}
	}
	duration := time.Since(start)
	log.Printf("async_workspace_derived_projection count=%d duration=%s derived_projection.total=%s event_types=%s", len(events), formatTimingDuration(duration), formatTimingDuration(duration), domainEventTypesForLog(events))
}
