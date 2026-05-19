package httpapi

import (
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"strings"
	"sync"
	"time"
)

const (
	defaultAuthMembershipCacheTTL        = 5 * time.Second
	defaultAuthMembershipCacheMaxEntries = 1024
)

type authMembershipCacheKey struct {
	subject string
	email   string
	name    string
}

type authMembershipCacheEntry struct {
	actor     ActorContext
	expiresAt time.Time
}

type authMembershipCache struct {
	mu         sync.Mutex
	ttl        time.Duration
	maxEntries int
	now        func() time.Time
	entries    map[authMembershipCacheKey]authMembershipCacheEntry
}

func newAuthMembershipCache(ttl time.Duration, maxEntries int) *authMembershipCache {
	if ttl == 0 {
		ttl = defaultAuthMembershipCacheTTL
	}
	if maxEntries == 0 {
		maxEntries = defaultAuthMembershipCacheMaxEntries
	}
	return &authMembershipCache{
		ttl:        ttl,
		maxEntries: maxEntries,
		now:        time.Now,
		entries:    map[authMembershipCacheKey]authMembershipCacheEntry{},
	}
}

func (c *authMembershipCache) get(claims auth.Claims) (ActorContext, bool) {
	if c == nil || c.ttl <= 0 || c.maxEntries <= 0 {
		return ActorContext{}, false
	}
	key := cacheKeyForClaims(claims)
	if key.subject == "" {
		return ActorContext{}, false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.entries[key]
	if !ok {
		return ActorContext{}, false
	}
	now := c.now().UTC()
	if !entry.expiresAt.After(now) {
		delete(c.entries, key)
		return ActorContext{}, false
	}
	actor := cloneActorContext(entry.actor)
	actor.Claims = claims
	return actor, true
}

func (c *authMembershipCache) set(claims auth.Claims, actor ActorContext) {
	if c == nil || c.ttl <= 0 || c.maxEntries <= 0 {
		return
	}
	key := cacheKeyForClaims(claims)
	if key.subject == "" {
		return
	}
	actor = cloneActorContext(actor)
	actor.Claims = claims

	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now().UTC()
	c.pruneExpiredLocked(now)
	for len(c.entries) >= c.maxEntries {
		c.evictEarliestLocked()
	}
	c.entries[key] = authMembershipCacheEntry{
		actor:     actor,
		expiresAt: now.Add(c.ttl),
	}
}

func (c *authMembershipCache) invalidateSubject(subject string) {
	if c == nil {
		return
	}
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.entries {
		if key.subject == subject {
			delete(c.entries, key)
		}
	}
}

func (c *authMembershipCache) invalidateUser(userID string) {
	if c == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for key, entry := range c.entries {
		if entry.actor.User.UserID == userID {
			delete(c.entries, key)
		}
	}
}

func (c *authMembershipCache) invalidateCompany(companyID string) {
	if c == nil {
		return
	}
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for key, entry := range c.entries {
		if entry.actor.CompanyID == companyID {
			delete(c.entries, key)
			continue
		}
		for _, membership := range entry.actor.Memberships {
			if membership.CompanyID == companyID {
				delete(c.entries, key)
				break
			}
		}
	}
}

func (c *authMembershipCache) clear() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = map[authMembershipCacheKey]authMembershipCacheEntry{}
}

func (c *authMembershipCache) pruneExpiredLocked(now time.Time) {
	for key, entry := range c.entries {
		if !entry.expiresAt.After(now) {
			delete(c.entries, key)
		}
	}
}

func (c *authMembershipCache) evictEarliestLocked() {
	var oldestKey authMembershipCacheKey
	var oldestExpiresAt time.Time
	for key, entry := range c.entries {
		if oldestExpiresAt.IsZero() || entry.expiresAt.Before(oldestExpiresAt) {
			oldestKey = key
			oldestExpiresAt = entry.expiresAt
		}
	}
	if !oldestExpiresAt.IsZero() {
		delete(c.entries, oldestKey)
	}
}

func cacheKeyForClaims(claims auth.Claims) authMembershipCacheKey {
	return authMembershipCacheKey{
		subject: strings.TrimSpace(claims.Subject),
		email:   strings.ToLower(strings.TrimSpace(claims.Email)),
		name:    strings.TrimSpace(claims.Name),
	}
}

func cloneActorContext(actor ActorContext) ActorContext {
	if actor.Memberships != nil {
		actor.Memberships = append([]domain.CompanyMembership(nil), actor.Memberships...)
	}
	return actor
}
