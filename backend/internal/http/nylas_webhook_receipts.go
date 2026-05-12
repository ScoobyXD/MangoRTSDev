package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

const (
	nylasWebhookReceiptTTL        = 2 * time.Minute
	nylasWebhookReceiptMaxEntries = 2048
)

type nylasWebhookReceiptCache struct {
	mu   sync.Mutex
	seen map[string]time.Time
}

func newNylasWebhookReceiptCache() *nylasWebhookReceiptCache {
	return &nylasWebhookReceiptCache{seen: map[string]time.Time{}}
}

func (c *nylasWebhookReceiptCache) remember(payload []byte, now time.Time) (string, bool) {
	if c == nil || len(payload) == 0 {
		return "", false
	}
	sum := sha256.Sum256(payload)
	key := hex.EncodeToString(sum[:])

	c.mu.Lock()
	defer c.mu.Unlock()
	c.evictExpiredLocked(now)
	if _, ok := c.seen[key]; ok {
		return key, true
	}
	c.seen[key] = now
	c.evictOldestLocked(nylasWebhookReceiptMaxEntries)
	return key, false
}

func (c *nylasWebhookReceiptCache) forget(key string) {
	if c == nil || key == "" {
		return
	}
	c.mu.Lock()
	delete(c.seen, key)
	c.mu.Unlock()
}

func (c *nylasWebhookReceiptCache) evictExpiredLocked(now time.Time) {
	for key, seenAt := range c.seen {
		if now.Sub(seenAt) > nylasWebhookReceiptTTL {
			delete(c.seen, key)
		}
	}
}

func (c *nylasWebhookReceiptCache) evictOldestLocked(maxEntries int) {
	for len(c.seen) > maxEntries {
		oldestKey := ""
		var oldestTime time.Time
		for key, seenAt := range c.seen {
			if oldestKey == "" || seenAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = seenAt
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.seen, oldestKey)
	}
}
