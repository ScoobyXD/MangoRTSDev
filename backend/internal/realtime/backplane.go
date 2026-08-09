package realtime

import "context"

// Backplane broadcasts compact committed realtime events to every API process.
// PostgreSQL remains the durable source of truth and recovery record.
type Backplane interface {
	Publish(ctx context.Context, payload []byte) error
	Subscribe(ctx context.Context, onMessage func([]byte), onReady func()) error
	Close()
}
