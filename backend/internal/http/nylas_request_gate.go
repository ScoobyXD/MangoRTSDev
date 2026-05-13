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
}

type nylasRequestGateEntry struct {
	sem         chan struct{}
	refs        int
	nextAllowed time.Time
}

func newNylasRequestGate(interval time.Duration) *nylasRequestGate {
	return &nylasRequestGate{
		entries:  make(map[string]*nylasRequestGateEntry),
		interval: interval,
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

	if wait := time.Until(entry.nextAllowed); wait > 0 {
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
			entry.nextAllowed = time.Now().Add(g.interval)
			entry.sem <- struct{}{}
			releaseRef()
		})
	}, nil
}

func (g *nylasRequestGate) entry(key string) *nylasRequestGateEntry {
	g.mu.Lock()
	defer g.mu.Unlock()
	entry := g.entries[key]
	if entry == nil {
		entry = &nylasRequestGateEntry{sem: make(chan struct{}, 1)}
		entry.sem <- struct{}{}
		g.entries[key] = entry
	}
	entry.refs++
	return entry
}

func (g *nylasRequestGate) releaseRef(key string, entry *nylasRequestGateEntry) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if current := g.entries[key]; current != entry {
		return
	}
	entry.refs--
	if entry.refs <= 0 {
		delete(g.entries, key)
	}
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
