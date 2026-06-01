package store

import (
	"context"
	"time"
)

type TimingRecorder interface {
	RecordTiming(label string, duration time.Duration)
}

type timingRecorderContextKey struct{}

func ContextWithTimingRecorder(ctx context.Context, recorder TimingRecorder) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if recorder == nil {
		return ctx
	}
	return context.WithValue(ctx, timingRecorderContextKey{}, recorder)
}

func timingRecorderFromContext(ctx context.Context) TimingRecorder {
	if ctx == nil {
		return nil
	}
	recorder, _ := ctx.Value(timingRecorderContextKey{}).(TimingRecorder)
	return recorder
}

func observeTiming(ctx context.Context, label string) func() {
	if timingRecorderFromContext(ctx) == nil {
		return func() {}
	}
	start := time.Now()
	return func() {
		recordTiming(ctx, label, time.Since(start))
	}
}

func recordTiming(ctx context.Context, label string, duration time.Duration) {
	recorder := timingRecorderFromContext(ctx)
	if recorder == nil || label == "" {
		return
	}
	recorder.RecordTiming(label, duration)
}
