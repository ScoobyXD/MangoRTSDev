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
	mu        sync.Mutex
	start     time.Time
	spans     []requestTimingSpan
	lookup    map[string]int
	accounted time.Duration
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
	t.recordTiming(label, duration, false)
}

func (t *requestTimingRecorder) RecordAccountedTiming(label string, duration time.Duration) {
	t.recordTiming(label, duration, true)
}

func (t *requestTimingRecorder) recordTiming(label string, duration time.Duration, accounted bool) {
	if t == nil || strings.TrimSpace(label) == "" {
		return
	}
	label = normalizeTimingLabel(strings.TrimSpace(label))
	t.mu.Lock()
	defer t.mu.Unlock()
	if accounted {
		t.accounted += duration
	}
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

func (t *requestTimingRecorder) observeAccounted(label string) func() {
	if t == nil {
		return func() {}
	}
	start := time.Now()
	return func() {
		t.RecordAccountedTiming(label, time.Since(start))
	}
}

func normalizeTimingLabel(label string) string {
	switch label {
	case "repo.CreateWorkspaceEntityBatch.node_writes",
		"repo.CreateRacioMatrixNode.node_writes",
		"repo.assignNodeToLogicGateStatusTx.node_writes",
		"repo.MoveLogicGateNodeAssignment.node_writes":
		return "source.node"
	case "repo.CreateWorkspaceEntityBatch.logic_gate_writes",
		"repo.CreateRacioMatrixNode.logic_gate_writes",
		"repo.createRacioMatrixLogicGateTx.logic_gate_insert":
		return "source.logic_gate"
	case "repo.CreateWorkspaceEntityBatch.raci_assignment_writes",
		"repo.createRacioMatrixLogicGateTx.raci_assignment_writes":
		return "source.raci_assignment"
	case "repo.assignNodeToLogicGateStatusTx.assignment_writes",
		"repo.MoveLogicGateNodeAssignment.assignment_writes",
		"repo.CreateRacioMatrixNode.assignment_writes":
		return "source.assignment"
	case "repo.assignNodeToLogicGateStatusTx.node_assignment_writes",
		"repo.MoveLogicGateNodeAssignment.node_assignment_writes":
		return "source.assignment"
	case "repo.assignNodeToLogicGateStatusTx.access_policy_copy",
		"repo.MoveLogicGateNodeAssignment.access_policy_copy":
		return "source.access_policy_copy"
	case "repo.CreateWorkspaceEntityBatch.commit",
		"repo.CreateRacioMatrixNode.commit",
		"repo.AssignNodeToLogicGateStatus.commit",
		"repo.MoveLogicGateNodeAssignment.commit":
		return "source.transaction_commit"
	case "repo.CreateWorkspaceEntityBatch.relationship_writes":
		return "source.relationship"
	case "repo.CreateWorkspaceEntityBatch.transaction",
		"repo.CreateRacioMatrixNode.transaction",
		"repo.AssignNodeToLogicGateStatus.transaction",
		"repo.MoveLogicGateNodeAssignment.transaction":
		return "source.transaction_repo"
	case "repo.assignNodeToLogicGateStatusTx.total",
		"repo.MoveLogicGateNodeAssignmentTx.total":
		return "source.command_total"
	case "repo.CreateRacioMatrixNode.normalize_input":
		return "source.normalize_input"
	case "repo.CreateWorkspaceEntityBatch.folder_setup":
		return "explorer.folder_setup"
	case "repo.ensureCompanyExplorerSystemFolderSQL":
		return "explorer.folder_setup"
	case "repo.CreateWorkspaceEntityBatch.folder_item_writes",
		"repo.createRacioMatrixLogicGateTx.folder_item_writes":
		return "explorer.folder_item_write"
	case "repo.CreateRacioMatrixNode.folder_item_read":
		return "explorer.folder_item_read"
	case "repo.nextCompanyExplorerSQLRowPosition":
		return "explorer.folder_position_read"
	case "repo.CreateWorkspaceEntityBatch.map_position_writes":
		return "map.position_write"
	case "repo.CreateWorkspaceEntityBatch.creator_assignee_read":
		return "reread.assignment"
	case "repo.CreateRacioMatrixNode.projection_reread",
		"repo.assignNodeToLogicGateStatusTx.projection_reread",
		"repo.MoveLogicGateNodeAssignment.projection_reread":
		return "reread.racio_projection"
	case "repo.assignNodeToLogicGateStatusTx.node_reread",
		"repo.MoveLogicGateNodeAssignment.node_reread",
		"repo.MoveLogicGateNodeAssignment.node_read":
		return "reread.node"
	case "repo.assignNodeToLogicGateStatusTx.assignment_read",
		"repo.MoveLogicGateNodeAssignment.assignment_read":
		return "reread.assignment"
	case "repo.assignNodeToLogicGateStatusTx.assignment_position_read",
		"repo.MoveLogicGateNodeAssignment.assignment_position_read":
		return "source.assignment_position_read"
	case "repo.MoveLogicGateNodeAssignment.email_reference_work":
		return "kanban.email_reference_work"
	case "repo.assignNodeToLogicGateStatusTx.racio_projection_sync",
		"repo.MoveLogicGateNodeAssignment.racio_projection_sync",
		"repo.CreateWorkspaceEntityBatch.racio_projection_sync",
		"repo.createRacioMatrixLogicGateTx.racio_projection_sync":
		return "racio_projection.sync_call"
	case "repo.syncPostgresRacioProjectionForNodeTx.total":
		return "racio_projection.total"
	case "repo.syncPostgresRacioProjectionForNodeTx.delete_stale":
		return "racio_projection.delete_stale"
	case "repo.syncPostgresRacioProjectionForNodeTx.upsert":
		return "racio_projection.upsert"
	case "repo.syncPostgresRacioProjectionForLogicGateUsersTx.total":
		return "racio_projection.total"
	case "repo.deleteStalePostgresRacioProjectionForLogicGateUserTx":
		return "racio_projection.delete_stale"
	case "repo.upsertPostgresRacioProjectionForLogicGateUserTx":
		return "racio_projection.upsert"
	case "repo.assignNodeToLogicGateStatusTx.domain_event_append",
		"repo.MoveLogicGateNodeAssignment.domain_event_append",
		"repo.CreateRacioMatrixNode.domain_event_append":
		return "events.append.total"
	case "repo.appendDomainEventTx.normalize_payload":
		return "events.payload_build"
	case "repo.appendDomainEventTx.advisory_lock":
		return "events.sequence_lock"
	case "repo.appendDomainEventTx.insert":
		return "events.insert"
	case "repo.appendDomainEventsTx.total":
		return "events.append.batch_total"
	case "repo.appendDomainEventTx.total":
		return "events.append.item_total"
	case "repo.AppendDomainEvents.transaction",
		"repo.AppendDomainEvent.transaction":
		return "events.append.transaction"
	}
	return label
}

func (t *requestTimingRecorder) log(r *http.Request, status int) {
	if t == nil || r == nil {
		return
	}
	total := time.Since(t.start)
	accounted := t.accountedTotal()
	unaccounted := total - accounted
	if unaccounted < 0 {
		unaccounted = 0
	}
	log.Printf(
		"request_timing method=%s path=%s route=%s status=%d request_id=%s request.total=%s request.accounted_total=%s request.unaccounted=%s timings=%s",
		r.Method,
		r.URL.Path,
		normalizeHTTPRoute(r),
		status,
		requestCorrelationID(r),
		formatTimingDuration(total),
		formatTimingDuration(accounted),
		formatTimingDuration(unaccounted),
		t.formatSpans(),
	)
}

func (t *requestTimingRecorder) accountedTotal() time.Duration {
	if t == nil {
		return 0
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.accounted
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
	writeTime   time.Duration
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
	start := time.Now()
	n, err := w.ResponseWriter.Write(body)
	duration := time.Since(start)
	w.writeTime += duration
	if w.timings != nil {
		w.timings.RecordAccountedTiming("response.write", duration)
	}
	return n, err
}

func (w *timedResponseWriter) recordResponseSerialization(duration time.Duration) {
	if w == nil || w.timings == nil {
		return
	}
	duration -= w.writeTime
	if duration < 0 {
		duration = 0
	}
	w.timings.RecordAccountedTiming("response.serialize", duration)
}

func (w *timedResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
