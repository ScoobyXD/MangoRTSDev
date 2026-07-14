package httpapi

import (
	"testing"
	"time"
)

func TestParseNylasWebhookChangesCapturesRecentOpenSignals(t *testing.T) {
	body := []byte(`{
  "type":"message.opened",
  "data":{"object":{
    "grant_id":"grant-1",
    "message_id":"message-1",
    "message_data":{"count":4,"timestamp":1720972800},
    "recents":[
      {"timestamp":1720972920,"ip":"ignored","user_agent":"ignored"},
      {"timestamp":1720972860},
      {"timestamp":1720972920}
    ]
  }}
}`)
	changes, err := parseNylasWebhookChanges(body)
	if err != nil {
		t.Fatalf("parseNylasWebhookChanges: %v", err)
	}
	if len(changes) != 1 {
		t.Fatalf("changes = %d, want 1", len(changes))
	}
	change := changes[0]
	if change.SignalCount != 4 {
		t.Fatalf("SignalCount = %d, want 4", change.SignalCount)
	}
	if len(change.SignalTimestamps) != 2 {
		t.Fatalf("SignalTimestamps = %v, want 2 deduplicated values", change.SignalTimestamps)
	}
	if !change.SignalTimestamps[0].Before(change.SignalTimestamps[1]) {
		t.Fatalf("SignalTimestamps are not ascending: %v", change.SignalTimestamps)
	}
	if !change.OccurredAt.Equal(time.Unix(1720972920, 0).UTC()) {
		t.Fatalf("OccurredAt = %s, want latest recent signal", change.OccurredAt)
	}
}
