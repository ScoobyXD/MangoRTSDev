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
	case "repo.DeleteCompanyExplorerTargets.total":
		return "delete.total"
	case "repo.DeleteCompanyExplorerTargets.begin":
		return "delete.begin"
	case "repo.DeleteCompanyExplorerTargets.resolve_targets":
		return "delete.resolve_targets"
	case "repo.DeleteCompanyExplorerTargets.validate_targets":
		return "delete.validate_targets"
	case "repo.DeleteCompanyExplorerTargets.recycle_bin_write":
		return "delete.recycle_bin_write"
	case "repo.DeleteCompanyExplorerTargets.folder_effective_delete":
		return "delete.folder_effective_delete"
	case "repo.DeleteCompanyExplorerTargets.logic_gate_delete":
		return "delete.logic_gate_delete"
	case "repo.DeleteCompanyExplorerTargets.kanban_delete":
		return "delete.kanban_delete"
	case "repo.DeleteCompanyExplorerTargets.project_delete":
		return "delete.project_delete"
	case "repo.DeleteCompanyExplorerTargets.node_delete":
		return "delete.node_delete"
	case "repo.DeleteCompanyExplorerTargets.folder_access_cleanup":
		return "delete.folder_access_cleanup"
	case "repo.DeleteCompanyExplorerTargets.folder_root_delete":
		return "delete.folder_root_delete"
	case "repo.DeleteCompanyExplorerTargets.commit":
		return "delete.commit"
	case "repo.postgresDeleteNodeWithDependentProjectionsTx.total":
		return "delete.node.total"
	case "repo.postgresDeleteNodeWithDependentProjectionsTx.projection_dependencies":
		return "delete.node.projection_dependencies"
	case "repo.postgresDeleteNodeWithDependentProjectionsTx.project_relationship_delete":
		return "delete.node.project_relationship_delete"
	case "repo.postgresDeleteNodeWithDependentProjectionsTx.node_rows_delete":
		return "delete.node.rows_total"
	case "repo.postgresDeleteNodeRowsTx.total":
		return "delete.node.rows.total"
	case "repo.postgresDeleteNodeRowsTx.effective_facts_delete":
		return "delete.node.rows.effective_facts"
	case "repo.postgresDeleteNodeRowsTx.gvic_matrix_projection_delete":
		return "delete.node.rows.gvic_matrix_projection"
	case "repo.postgresDeleteNodeRowsTx.project_timeline_projection_delete":
		return "delete.node.rows.project_timeline_projection"
	case "repo.postgresDeleteNodeRowsTx.project_timeline_items_delete":
		return "delete.node.rows.project_timeline_items"
	case "repo.postgresDeleteNodeRowsTx.node_relationships_delete":
		return "delete.node.rows.node_relationships"
	case "repo.postgresDeleteNodeRowsTx.company_explorer_items_delete":
		return "delete.node.rows.company_explorer_items"
	case "repo.postgresDeleteNodeRowsTx.kanban_projection_delete":
		return "delete.node.rows.kanban_projection"
	case "repo.postgresDeleteNodeRowsTx.node_projection_delete":
		return "delete.node.rows.node_projection"
	case "repo.postgresDeleteNodeRowsTx.node_map_positions_delete":
		return "delete.node.rows.node_map_positions"
	case "repo.postgresDeleteNodeRowsTx.resource_permissions_delete":
		return "delete.node.rows.resource_permissions"
	case "repo.postgresDeleteNodeRowsTx.node_delete":
		return "delete.node.rows.node"
	case "repo.CreateWorkspaceEntityBatch.node_writes",
		"repo.CreateGVICMatrixNode.node_writes",
		"repo.assignNodeToLogicGateStatusTx.node_writes",
		"repo.MoveLogicGateNodeAssignment.node_writes":
		return "source.node"
	case "repo.CreateWorkspaceEntityBatch.logic_gate_writes",
		"repo.CreateGVICMatrixNode.logic_gate_writes",
		"repo.createGVICMatrixLogicGateTx.logic_gate_insert":
		return "source.logic_gate"
	case "repo.CreateWorkspaceEntityBatch.GVIC_assignment_writes",
		"repo.createGVICMatrixLogicGateTx.GVIC_assignment_writes":
		return "source.GVIC_assignment"
	case "repo.assignNodeToLogicGateStatusTx.assignment_writes",
		"repo.MoveLogicGateNodeAssignment.assignment_writes",
		"repo.CreateGVICMatrixNode.assignment_writes":
		return "source.assignment"
	case "repo.assignNodeToLogicGateStatusTx.node_assignment_writes",
		"repo.MoveLogicGateNodeAssignment.node_assignment_writes":
		return "source.assignment"
	case "repo.assignNodeToLogicGateStatusTx.access_policy_copy",
		"repo.MoveLogicGateNodeAssignment.access_policy_copy":
		return "source.access_policy_copy"
	case "repo.CreateWorkspaceEntityBatch.commit",
		"repo.CreateGVICMatrixNode.commit",
		"repo.AssignNodeToLogicGateStatus.commit",
		"repo.MoveLogicGateNodeAssignment.commit":
		return "source.transaction_commit"
	case "repo.CreateWorkspaceEntityBatch.relationship_writes":
		return "source.relationship"
	case "repo.CreateWorkspaceEntityBatch.transaction",
		"repo.CreateGVICMatrixNode.transaction",
		"repo.AssignNodeToLogicGateStatus.transaction",
		"repo.MoveLogicGateNodeAssignment.transaction":
		return "source.transaction_repo"
	case "repo.assignNodeToLogicGateStatusTx.total",
		"repo.MoveLogicGateNodeAssignmentTx.total":
		return "source.command_total"
	case "repo.CreateGVICMatrixNode.normalize_input":
		return "source.normalize_input"
	case "repo.CreateWorkspaceEntityBatch.folder_setup":
		return "explorer.folder_setup"
	case "repo.CreateWorkspaceEntityBatch.folder_item_writes",
		"repo.createGVICMatrixLogicGateTx.folder_item_writes":
		return "explorer.folder_item_write"
	case "repo.CreateGVICMatrixNode.folder_item_read":
		return "explorer.folder_item_read"
	case "repo.nextCompanyExplorerSQLRowPosition":
		return "explorer.folder_position_read"
	case "repo.CreateWorkspaceEntityBatch.map_position_writes":
		return "map.position_write"
	case "repo.CreateWorkspaceEntityBatch.creator_assignee_read":
		return "reread.assignment"
	case "repo.assignNodeToLogicGateStatusTx.logic_gate_read":
		return "source.logic_gate_read"
	case "repo.assignNodeToLogicGateStatusTx.node_read":
		return "source.node_read"
	case "repo.assignNodeToLogicGateStatusTx.node_create":
		return "source.node_create"
	case "repo.assignNodeToLogicGateStatusTx.priority_write":
		return "source.priority_write"
	case "repo.CreateGVICMatrixNode.projection_reread",
		"repo.assignNodeToLogicGateStatusTx.projection_reread",
		"repo.MoveLogicGateNodeAssignment.projection_reread":
		return "reread.GVIC_MATRIX_PROJECTION"
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
	case "repo.assignNodeToLogicGateStatusTx.GVIC_MATRIX_PROJECTION_sync",
		"repo.MoveLogicGateNodeAssignment.GVIC_MATRIX_PROJECTION_sync",
		"repo.CreateWorkspaceEntityBatch.GVIC_MATRIX_PROJECTION_sync",
		"repo.createGVICMatrixLogicGateTx.GVIC_MATRIX_PROJECTION_sync":
		return "GVIC_MATRIX_PROJECTION.sync_call"
	case "repo.assignNodeToLogicGateStatusTx.projection_dependencies":
		return "projection.dependencies"
	case "repo.syncPostgresGVICMatrixProjectionForNodeTx.total":
		return "GVIC_MATRIX_PROJECTION.total"
	case "repo.syncPostgresGVICMatrixProjectionForNodeTx.delete_stale":
		return "GVIC_MATRIX_PROJECTION.delete_stale"
	case "repo.syncPostgresGVICMatrixProjectionForNodeTx.upsert":
		return "GVIC_MATRIX_PROJECTION.upsert"
	case "repo.syncPostgresGVICMatrixProjectionForLogicGateUsersTx.total":
		return "GVIC_MATRIX_PROJECTION.total"
	case "repo.deleteStalePostgresGVICMatrixProjectionForLogicGateUserTx":
		return "GVIC_MATRIX_PROJECTION.delete_stale"
	case "repo.upsertPostgresGVICMatrixProjectionForLogicGateUserTx":
		return "GVIC_MATRIX_PROJECTION.upsert"
	case "repo.assignNodeToLogicGateStatusTx.domain_event_append",
		"repo.MoveLogicGateNodeAssignment.domain_event_append",
		"repo.CreateGVICMatrixNode.domain_event_append":
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
