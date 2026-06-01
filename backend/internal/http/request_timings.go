package httpapi

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

type requestTimingRecorder struct {
	mu     sync.Mutex
	start  time.Time
	spans  []requestTimingSpan
	lookup map[string]int
}

type requestTimingSpan struct {
	label    string
	duration time.Duration
	count    int
}

func newRequestTimingRecorder() *requestTimingRecorder {
	return &requestTimingRecorder{
		start:  time.Now(),
		lookup: map[string]int{},
	}
}

func (t *requestTimingRecorder) RecordTiming(label string, duration time.Duration) {
	if t == nil || strings.TrimSpace(label) == "" {
		return
	}
	label = strings.TrimSpace(label)
	t.mu.Lock()
	defer t.mu.Unlock()
	if index, ok := t.lookup[label]; ok {
		t.spans[index].duration += duration
		t.spans[index].count++
		return
	}
	t.lookup[label] = len(t.spans)
	t.spans = append(t.spans, requestTimingSpan{label: label, duration: duration, count: 1})
}

func (t *requestTimingRecorder) observe(label string) func() {
	if t == nil {
		return func() {}
	}
	start := time.Now()
	return func() {
		t.RecordTiming(label, time.Since(start))
	}
}

func (t *requestTimingRecorder) log(r *http.Request, status int) {
	if t == nil || r == nil {
		return
	}
	total := time.Since(t.start)
	log.Printf(
		"request_timing method=%s path=%s route=%s status=%d request_id=%s total=%s timings=%s",
		r.Method,
		r.URL.Path,
		normalizeHTTPRoute(r),
		status,
		requestCorrelationID(r),
		formatTimingDuration(total),
		t.formatSpans(),
	)
}

func (t *requestTimingRecorder) formatSpans() string {
	if t == nil {
		return ""
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.spans) == 0 {
		return "-"
	}
	parts := make([]string, 0, len(t.spans))
	for _, span := range t.spans {
		value := formatTimingDuration(span.duration)
		if span.count > 1 {
			value = fmt.Sprintf("%s(%dx)", value, span.count)
		}
		parts = append(parts, span.label+"="+value)
	}
	return strings.Join(parts, " ")
}

func formatTimingDuration(duration time.Duration) string {
	if duration <= 0 {
		return "0s"
	}
	if duration < time.Millisecond {
		return duration.Round(time.Microsecond).String()
	}
	return duration.Round(100 * time.Microsecond).String()
}

func requestCorrelationID(r *http.Request) string {
	for _, header := range []string{"X-Request-ID", "X-Correlation-ID", "X-Amzn-Trace-Id"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			return value
		}
	}
	return "-"
}

func startTimedRequest(w http.ResponseWriter) (*timedResponseWriter, *requestTimingRecorder) {
	timings := newRequestTimingRecorder()
	return &timedResponseWriter{ResponseWriter: w, status: http.StatusOK, timings: timings}, timings
}

type timedResponseWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	timings     *requestTimingRecorder
}

func (w *timedResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *timedResponseWriter) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.wroteHeader = true
	}
	return w.ResponseWriter.Write(body)
}

func (w *timedResponseWriter) recordResponseSerialization(duration time.Duration) {
	if w == nil || w.timings == nil {
		return
	}
	w.timings.RecordTiming("response_serialization", duration)
}

func (w *timedResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
