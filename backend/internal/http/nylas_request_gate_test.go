package httpapi

import (
	"context"
	"testing"
	"time"
)

func TestNylasRequestGateSerializesSameKey(t *testing.T) {
	t.Parallel()

	gate := newNylasRequestGate(0)
	releaseFirst, err := gate.acquire(context.Background(), "grant-1")
	if err != nil {
		t.Fatal(err)
	}
	defer releaseFirst()

	acquiredSecond := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		releaseSecond, err := gate.acquire(context.Background(), "grant-1")
		if err != nil {
			t.Errorf("second acquire: %v", err)
			return
		}
		close(acquiredSecond)
		releaseSecond()
	}()

	select {
	case <-acquiredSecond:
		t.Fatal("second acquire completed while first request was still held")
	case <-time.After(25 * time.Millisecond):
	}

	releaseFirst()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("second acquire did not unblock")
	}
}

func TestNylasRequestGateAllowsDifferentKeys(t *testing.T) {
	t.Parallel()

	gate := newNylasRequestGate(0)
	releaseFirst, err := gate.acquire(context.Background(), "grant-1")
	if err != nil {
		t.Fatal(err)
	}
	defer releaseFirst()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	releaseSecond, err := gate.acquire(ctx, "grant-2")
	if err != nil {
		t.Fatal(err)
	}
	releaseSecond()
}
