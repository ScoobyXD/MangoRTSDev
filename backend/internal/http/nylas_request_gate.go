package httpapi

import (
	"context"
	"miraeopus/backend/internal/domain"
	"strings"
	"sync"
	"time"
)

type nylasRequestGate struct {
	mu       sync.Mutex
	entries  map[string]*nylasRequestGateEntry
	interval time.Duration
	capacity int
}

type nylasRequestGateEntry struct {
	mu        sync.Mutex
	sem       chan struct{}
	refs      int
	nextStart time.Time
}

func newNylasRequestGate(interval time.Duration) *nylasRequestGate {
	return &nylasRequestGate{
		entries:  make(map[string]*nylasRequestGateEntry),
		interval: interval,
		capacity: communicationsNylasMaxInFlightPerGrant,
	}
}

func (g *nylasRequestGate) acquire(ctx context.Context, key string) (func(), error) {
	if g == nil {
		return func() {}, nil
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return func() {}, nil
	}
	entry := g.entry(key)
	acquired := false
	releaseRef := func() {
		g.releaseRef(key, entry)
	}
	defer func() {
		if !acquired {
			releaseRef()
		}
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-entry.sem:
		acquired = true
	}

	wait := entry.reserveStartDelay(g.interval)
	if wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			entry.sem <- struct{}{}
			acquired = false
			return nil, ctx.Err()
		case <-timer.C:
		}
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			entry.sem <- struct{}{}
			releaseRef()
		})
	}, nil
}

func (g *nylasRequestGate) entry(key string) *nylasRequestGateEntry {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	for existingKey, existing := range g.entries {
		if existing.refs <= 0 && existing.startWindowExpired(now) {
			delete(g.entries, existingKey)
		}
	}
	entry := g.entries[key]
	if entry == nil {
		capacity := g.capacity
		if capacity <= 0 {
			capacity = 1
		}
		entry = &nylasRequestGateEntry{sem: make(chan struct{}, capacity)}
		for i := 0; i < capacity; i++ {
			entry.sem <- struct{}{}
		}
		g.entries[key] = entry
	}
	entry.refs++
	return entry
}

func (e *nylasRequestGateEntry) reserveStartDelay(interval time.Duration) time.Duration {
	if interval <= 0 {
		return 0
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	now := time.Now()
	start := now
	if e.nextStart.After(now) {
		start = e.nextStart
	}
	e.nextStart = start.Add(interval)
	return time.Until(start)
}

func (g *nylasRequestGate) releaseRef(key string, entry *nylasRequestGateEntry) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if current := g.entries[key]; current != entry {
		return
	}
	entry.refs--
	if entry.refs <= 0 && entry.startWindowExpired(time.Now()) {
		delete(g.entries, key)
	}
}

func (e *nylasRequestGateEntry) startWindowExpired(now time.Time) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return !e.nextStart.After(now)
}

func (s *Server) withCommunicationsNylasGate(ctx context.Context, connection domain.UserEmailConnection, call func(context.Context) error) error {
	if call == nil {
		return nil
	}
	if s.nylasGate == nil {
		return call(ctx)
	}
	key := firstNonBlank(connection.GrantID, connection.UserID)
	release, err := s.nylasGate.acquire(ctx, key)
	if err != nil {
		return err
	}
	defer release()
	return call(ctx)
}
