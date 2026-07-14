package httpapi

import (
	"testing"
	"time"
)

func TestNylasWebhookReceiptRetryKeepsFirstSeenTimestamp(t *testing.T) {
	cache := newNylasWebhookReceiptCache()
	payload := []byte(`{"type":"message.opened"}`)
	firstSeenAt := time.Date(2026, time.July, 13, 14, 0, 0, 0, time.UTC)

	key, receivedAt, duplicate := cache.remember(payload, firstSeenAt)
	if key == "" || duplicate || !receivedAt.Equal(firstSeenAt) {
		t.Fatalf("first receipt key=%q received_at=%s duplicate=%t", key, receivedAt, duplicate)
	}
	cache.forget(key)

	retriedKey, retriedAt, retryDuplicate := cache.remember(payload, firstSeenAt.Add(time.Minute))
	if retriedKey != key || retryDuplicate || !retriedAt.Equal(firstSeenAt) {
		t.Fatalf("retry key=%q received_at=%s duplicate=%t, want original timestamp", retriedKey, retriedAt, retryDuplicate)
	}
	_, duplicateAt, duplicate := cache.remember(payload, firstSeenAt.Add(90*time.Second))
	if !duplicate || !duplicateAt.Equal(firstSeenAt) {
		t.Fatalf("accepted duplicate timestamp=%s duplicate=%t, want original timestamp and suppression", duplicateAt, duplicate)
	}
}
