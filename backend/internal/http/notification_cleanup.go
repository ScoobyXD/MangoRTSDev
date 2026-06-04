package httpapi

import (
	"context"
	"log"
	"miraeopus/backend/internal/store"
	"strings"
	"time"
)

const defaultNotificationCleanupInterval = time.Hour

func (s *Server) startNotificationCleanup() {
	if s == nil || s.repo == nil || s.notificationCleanupDisabled {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.notificationCleanupCancel = cancel
	go s.runNotificationCleanup(ctx)
}

func (s *Server) runNotificationCleanup(ctx context.Context) {
	if _, err := s.cleanupExpiredNotifications(ctx); err != nil && !strings.Contains(err.Error(), "context canceled") {
		log.Printf("notification cleanup failed: %v", err)
	}
	ticker := time.NewTicker(s.notificationCleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := s.cleanupExpiredNotifications(ctx); err != nil && !strings.Contains(err.Error(), "context canceled") {
				log.Printf("notification cleanup failed: %v", err)
			}
		}
	}
}

func (s *Server) cleanupExpiredNotifications(ctx context.Context) (int, error) {
	if s == nil || s.repo == nil {
		return 0, nil
	}
	retention := store.NormalizeNotificationRetentionDuration(s.notificationRetentionDuration)
	limit := store.NormalizeNotificationCleanupLimit(s.notificationCleanupLimit)
	olderThan := time.Now().UTC().Add(-retention)
	total := 0
	for {
		if ctx != nil {
			if err := ctx.Err(); err != nil {
				return total, err
			}
		}
		deleted, err := s.repo.DeleteExpiredNotifications(olderThan, limit)
		if err != nil {
			return total, err
		}
		if len(deleted) == 0 {
			return total, nil
		}
		total += len(deleted)
		s.publishNotificationDeletions(deleted)
		if len(deleted) < limit {
			return total, nil
		}
	}
}
