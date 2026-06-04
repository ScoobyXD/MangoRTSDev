package httpapi

import (
	"bufio"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type MetricsRecorder interface {
	RecordHTTPRequest(HTTPRequestMetric)
	RecordOperationalMetric(OperationalMetric)
}

type HTTPRequestMetric struct {
	Method      string
	Route       string
	Status      int
	Duration    time.Duration
	Conditional bool
	NotModified bool
}

type OperationalMetric struct {
	Name      string
	ScopeType string
	Value     int64
	Duration  time.Duration
}

type HTTPRequestMetricKey struct {
	Method      string
	Route       string
	Status      int
	Conditional bool
	NotModified bool
}

type HTTPRequestMetricStats struct {
	Count         int64
	TotalDuration time.Duration
	LastDuration  time.Duration
}

type OperationalMetricKey struct {
	Name      string
	ScopeType string
}

type OperationalMetricStats struct {
	Count         int64
	TotalValue    int64
	LastValue     int64
	TotalDuration time.Duration
	LastDuration  time.Duration
}

type MetricsSnapshot struct {
	HTTPRequests map[HTTPRequestMetricKey]HTTPRequestMetricStats
	Operational  map[OperationalMetricKey]OperationalMetricStats
}

type InMemoryMetricsRecorder struct {
	mu           sync.Mutex
	httpRequests map[HTTPRequestMetricKey]HTTPRequestMetricStats
	operational  map[OperationalMetricKey]OperationalMetricStats
}

func NewInMemoryMetricsRecorder() *InMemoryMetricsRecorder {
	return &InMemoryMetricsRecorder{
		httpRequests: map[HTTPRequestMetricKey]HTTPRequestMetricStats{},
		operational:  map[OperationalMetricKey]OperationalMetricStats{},
	}
}

func (m *InMemoryMetricsRecorder) RecordHTTPRequest(metric HTTPRequestMetric) {
	if m == nil {
		return
	}
	key := HTTPRequestMetricKey{
		Method:      metric.Method,
		Route:       metric.Route,
		Status:      metric.Status,
		Conditional: metric.Conditional,
		NotModified: metric.NotModified,
	}
	m.mu.Lock()
	stats := m.httpRequests[key]
	stats.Count++
	stats.TotalDuration += metric.Duration
	stats.LastDuration = metric.Duration
	m.httpRequests[key] = stats
	m.mu.Unlock()
}

func (m *InMemoryMetricsRecorder) RecordOperationalMetric(metric OperationalMetric) {
	if m == nil || strings.TrimSpace(metric.Name) == "" {
		return
	}
	key := OperationalMetricKey{Name: strings.TrimSpace(metric.Name), ScopeType: strings.TrimSpace(metric.ScopeType)}
	m.mu.Lock()
	stats := m.operational[key]
	stats.Count++
	stats.TotalValue += metric.Value
	stats.LastValue = metric.Value
	stats.TotalDuration += metric.Duration
	stats.LastDuration = metric.Duration
	m.operational[key] = stats
	m.mu.Unlock()
}

func (m *InMemoryMetricsRecorder) Snapshot() MetricsSnapshot {
	snapshot := MetricsSnapshot{
		HTTPRequests: map[HTTPRequestMetricKey]HTTPRequestMetricStats{},
		Operational:  map[OperationalMetricKey]OperationalMetricStats{},
	}
	if m == nil {
		return snapshot
	}
	m.mu.Lock()
	for key, stats := range m.httpRequests {
		snapshot.HTTPRequests[key] = stats
	}
	for key, stats := range m.operational {
		snapshot.Operational[key] = stats
	}
	m.mu.Unlock()
	return snapshot
}

func (s *Server) MetricsSnapshot() MetricsSnapshot {
	if snapshotter, ok := s.metrics.(interface{ Snapshot() MetricsSnapshot }); ok {
		return snapshotter.Snapshot()
	}
	return MetricsSnapshot{
		HTTPRequests: map[HTTPRequestMetricKey]HTTPRequestMetricStats{},
		Operational:  map[OperationalMetricKey]OperationalMetricStats{},
	}
}

func (s *Server) recordOperationalMetric(name, scopeType string, value int64, duration time.Duration) {
	if s == nil || s.metrics == nil {
		return
	}
	s.metrics.RecordOperationalMetric(OperationalMetric{
		Name:      name,
		ScopeType: scopeType,
		Value:     value,
		Duration:  duration,
	})
}

func (s *Server) withHTTPMetrics(next http.Handler) http.Handler {
	if s.metrics == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &metricsResponseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		s.metrics.RecordHTTPRequest(HTTPRequestMetric{
			Method:      r.Method,
			Route:       normalizeHTTPRoute(r),
			Status:      rec.status,
			Duration:    time.Since(start),
			Conditional: r.Method == http.MethodGet && strings.TrimSpace(r.Header.Get("If-None-Match")) != "",
			NotModified: rec.status == http.StatusNotModified,
		})
	})
}

func normalizeHTTPRoute(r *http.Request) string {
	if r == nil {
		return ""
	}
	if strings.TrimSpace(r.Pattern) != "" {
		return r.Pattern
	}
	path := strings.TrimSpace(r.URL.Path)
	if path == "" {
		return "/"
	}
	leadingSlash := strings.HasPrefix(path, "/")
	trailingSlash := strings.HasSuffix(path, "/")
	parts := strings.Split(path, "/")
	for index, part := range parts {
		if isLikelyRouteIDSegment(part) {
			parts[index] = "{id}"
		}
	}
	normalized := strings.Join(parts, "/")
	if leadingSlash && !strings.HasPrefix(normalized, "/") {
		normalized = "/" + normalized
	}
	if trailingSlash && !strings.HasSuffix(normalized, "/") {
		normalized += "/"
	}
	return normalized
}

func isLikelyRouteIDSegment(segment string) bool {
	segment = strings.TrimSpace(segment)
	if segment == "" {
		return false
	}
	if isCanonicalUUID(segment) {
		return true
	}
	if len(segment) < 16 {
		return false
	}
	hasDigit := false
	hasLetter := false
	for _, char := range segment {
		switch {
		case char >= '0' && char <= '9':
			hasDigit = true
		case (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z'):
			hasLetter = true
		case char == '-' || char == '_' || char == ':':
		default:
			return false
		}
	}
	return hasDigit && hasLetter
}

type metricsResponseWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *metricsResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *metricsResponseWriter) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.wroteHeader = true
	}
	return w.ResponseWriter.Write(body)
}

func (w *metricsResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *metricsResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *metricsResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}
