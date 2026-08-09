package realtime

import (
	"context"
	"errors"
	"sync"
)

var ErrBackplaneClosed = errors.New("realtime backplane is closed")

// LocalBackplane keeps local development and unit tests event-driven without
// pretending to provide cross-process delivery. Deployed dev uses Valkey.
type LocalBackplane struct {
	mu          sync.RWMutex
	nextID      uint64
	subscribers map[uint64]func([]byte)
	closed      chan struct{}
	closeOnce   sync.Once
}

func NewLocalBackplane() *LocalBackplane {
	return &LocalBackplane{subscribers: map[uint64]func([]byte){}, closed: make(chan struct{})}
}

func (b *LocalBackplane) Publish(ctx context.Context, payload []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	b.mu.RLock()
	select {
	case <-b.closed:
		b.mu.RUnlock()
		return ErrBackplaneClosed
	default:
	}
	handlers := make([]func([]byte), 0, len(b.subscribers))
	for _, handler := range b.subscribers {
		handlers = append(handlers, handler)
	}
	b.mu.RUnlock()
	for _, handler := range handlers {
		if err := ctx.Err(); err != nil {
			return err
		}
		handler(append([]byte(nil), payload...))
	}
	return nil
}

func (b *LocalBackplane) Subscribe(ctx context.Context, onMessage func([]byte), onReady func()) error {
	if onMessage == nil {
		return errors.New("realtime subscriber handler is required")
	}
	b.mu.Lock()
	select {
	case <-b.closed:
		b.mu.Unlock()
		return ErrBackplaneClosed
	default:
	}
	b.nextID++
	id := b.nextID
	b.subscribers[id] = onMessage
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		delete(b.subscribers, id)
		b.mu.Unlock()
	}()
	if onReady != nil {
		onReady()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-b.closed:
		return ErrBackplaneClosed
	}
}

func (b *LocalBackplane) Close() {
	if b == nil {
		return
	}
	b.closeOnce.Do(func() { close(b.closed) })
}
