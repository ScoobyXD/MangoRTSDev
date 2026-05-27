package httpapi

import (
	"context"
	"testing"
	"time"
)

func TestNylasRequestGateLimitsSameKeyConcurrency(t *testing.T) {
	t.Parallel()

	gate := newNylasRequestGate(0)
	releases := make([]func(), 0, communicationsNylasMaxInFlightPerGrant)
	for i := 0; i < communicationsNylasMaxInFlightPerGrant; i++ {
		release, err := gate.acquire(context.Background(), "grant-1")
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, release)
		defer release()
	}

	acquiredNext := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		release, err := gate.acquire(context.Background(), "grant-1")
		if err != nil {
			t.Errorf("next acquire: %v", err)
			return
		}
		close(acquiredNext)
		release()
	}()

	select {
	case <-acquiredNext:
		t.Fatal("acquire completed above the same-grant in-flight limit")
	case <-time.After(25 * time.Millisecond):
	}

	releases[0]()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("blocked acquire did not unblock")
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

func TestCommunicationsNylasRequestIntervalTargetsTwentyStartsPerSecond(t *testing.T) {
	t.Parallel()

	if communicationsNylasMinRequestInterval != 50*time.Millisecond {
		t.Fatalf("communicationsNylasMinRequestInterval = %s, want 50ms for 20 starts/second", communicationsNylasMinRequestInterval)
	}
}

func TestNylasRequestGateSpacesStartsForSameKey(t *testing.T) {
	t.Parallel()

	const interval = 25 * time.Millisecond
	gate := newNylasRequestGate(interval)
	releaseFirst, err := gate.acquire(context.Background(), "grant-1")
	if err != nil {
		t.Fatal(err)
	}
	first := time.Now()
	releaseFirst()

	releaseSecond, err := gate.acquire(context.Background(), "grant-1")
	if err != nil {
		t.Fatal(err)
	}
	second := time.Now()
	releaseSecond()

	if elapsed := second.Sub(first); elapsed < 15*time.Millisecond {
		t.Fatalf("same-grant starts were spaced by %s, want roughly %s", elapsed, interval)
	}
}
