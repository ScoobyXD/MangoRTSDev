package httpapi

import (
	"strings"
	"sync"
	"time"
)

const (
	communicationsArchiveMutationTTL        = 2 * time.Minute
	communicationsArchiveMutationMaxEntries = 4096
)

type communicationsArchiveMutationTracker struct {
	mu      sync.Mutex
	entries map[string]time.Time
}

func newCommunicationsArchiveMutationTracker() *communicationsArchiveMutationTracker {
	return &communicationsArchiveMutationTracker{entries: map[string]time.Time{}}
}

func (t *communicationsArchiveMutationTracker) remember(cacheScope string, messageIDs []string, now time.Time) {
	cacheScope = strings.TrimSpace(cacheScope)
	if t == nil || cacheScope == "" || len(messageIDs) == 0 {
		return
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	expiresAt := now.Add(communicationsArchiveMutationTTL)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.pruneLocked(now)
	for _, messageID := range cleanStringList(messageIDs) {
		t.entries[communicationsArchiveMutationKey(cacheScope, messageID)] = expiresAt
	}
	t.pruneOldestLocked()
}

func (t *communicationsArchiveMutationTracker) consume(cacheScope, messageID string, now time.Time) bool {
	cacheScope = strings.TrimSpace(cacheScope)
	messageID = strings.TrimSpace(messageID)
	if t == nil || cacheScope == "" || messageID == "" {
		return false
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	key := communicationsArchiveMutationKey(cacheScope, messageID)
	t.mu.Lock()
	defer t.mu.Unlock()
	expiresAt, ok := t.entries[key]
	if !ok {
		return false
	}
	delete(t.entries, key)
	return expiresAt.After(now)
}

func (t *communicationsArchiveMutationTracker) pruneLocked(now time.Time) {
	for key, expiresAt := range t.entries {
		if !expiresAt.After(now) {
			delete(t.entries, key)
		}
	}
}

func (t *communicationsArchiveMutationTracker) pruneOldestLocked() {
	for len(t.entries) > communicationsArchiveMutationMaxEntries {
		var oldestKey string
		var oldest time.Time
		for key, expiresAt := range t.entries {
			if oldestKey == "" || expiresAt.Before(oldest) {
				oldestKey = key
				oldest = expiresAt
			}
		}
		if oldestKey == "" {
			return
		}
		delete(t.entries, oldestKey)
	}
}

func communicationsArchiveMutationKey(cacheScope, messageID string) string {
	return strings.TrimSpace(cacheScope) + "\x1f" + strings.TrimSpace(messageID)
}

func (s *Server) rememberRecentCommunicationsArchiveMutation(cacheScope string, messageIDs []string, now time.Time) {
	if s == nil || s.commArchiveMutations == nil {
		return
	}
	s.commArchiveMutations.remember(cacheScope, messageIDs, now)
}

func (s *Server) consumeRecentCommunicationsArchiveMutation(cacheScope, messageID string, now time.Time) bool {
	if s == nil || s.commArchiveMutations == nil {
		return false
	}
	return s.commArchiveMutations.consume(cacheScope, messageID, now)
}
