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

type nylasWebhookReceipt struct {
	firstSeenAt time.Time
	remembered  bool
}

type nylasWebhookReceiptCache struct {
	mu   sync.Mutex
	seen map[string]nylasWebhookReceipt
}

func newNylasWebhookReceiptCache() *nylasWebhookReceiptCache {
	return &nylasWebhookReceiptCache{seen: map[string]nylasWebhookReceipt{}}
}

func (c *nylasWebhookReceiptCache) remember(payload []byte, now time.Time) (string, time.Time, bool) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if c == nil || len(payload) == 0 {
		return "", now, false
	}
	sum := sha256.Sum256(payload)
	key := hex.EncodeToString(sum[:])

	c.mu.Lock()
	defer c.mu.Unlock()
	c.evictExpiredLocked(now)
	if receipt, ok := c.seen[key]; ok {
		if receipt.remembered {
			return key, receipt.firstSeenAt, true
		}
		receipt.remembered = true
		c.seen[key] = receipt
		return key, receipt.firstSeenAt, false
	}
	c.seen[key] = nylasWebhookReceipt{firstSeenAt: now, remembered: true}
	c.evictOldestLocked(nylasWebhookReceiptMaxEntries)
	return key, now, false
}

func (c *nylasWebhookReceiptCache) forget(key string) {
	if c == nil || key == "" {
		return
	}
	c.mu.Lock()
	if receipt, ok := c.seen[key]; ok {
		receipt.remembered = false
		c.seen[key] = receipt
	}
	c.mu.Unlock()
}

func (c *nylasWebhookReceiptCache) evictExpiredLocked(now time.Time) {
	for key, receipt := range c.seen {
		if now.Sub(receipt.firstSeenAt) > nylasWebhookReceiptTTL {
			delete(c.seen, key)
		}
	}
}

func (c *nylasWebhookReceiptCache) evictOldestLocked(maxEntries int) {
	for len(c.seen) > maxEntries {
		oldestKey := ""
		var oldestTime time.Time
		for key, receipt := range c.seen {
			if oldestKey == "" || receipt.firstSeenAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = receipt.firstSeenAt
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.seen, oldestKey)
	}
}
