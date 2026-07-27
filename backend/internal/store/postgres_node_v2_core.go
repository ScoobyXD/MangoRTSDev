package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const nodeV2EmptyDocument = `{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`

const postgresNodeV2TextBoxColumns = `
t.company_id::text, t.node_id::text, t.textbox_id::text, t.document_json::text,
t.plain_text, t.document_schema_version, t.content_revision,
t.collaboration_epoch::text, t.latest_update_sequence, t.materialized_through_sequence,
t.display_order, coalesce(t.created_by_user_id::text, ''), coalesce(t.updated_by_user_id::text, ''),
t.created_timestamp, t.updated_timestamp, t.deleted_timestamp,
(select count(*) from node_textbox_comments c
  where c.company_id=t.company_id and c.node_id=t.node_id and c.textbox_id=t.textbox_id
    and c.deleted_timestamp is null)::integer,
(select count(*) from node_textbox_attachment_links a
  where a.company_id=t.company_id and a.node_id=t.node_id and a.textbox_id=t.textbox_id
    and a.deleted_timestamp is null)::integer,
(select count(*) from node_textbox_email_links e
  where e.company_id=t.company_id and e.node_id=t.node_id and e.textbox_id=t.textbox_id
    and e.deleted_timestamp is null)::integer`

func scanPostgresNodeV2TextBox(scanner interface{ Scan(...any) error }) (domain.NodeV2TextBox, error) {
	var item domain.NodeV2TextBox
	var raw string
	var deleted sql.NullTime
	err := scanner.Scan(
		&item.CompanyID, &item.NodeID, &item.TextboxID, &raw,
		&item.PlainText, &item.DocumentSchemaVersion, &item.ContentRevision,
		&item.CollaborationEpoch, &item.LatestUpdateSequence, &item.MaterializedThroughSequence,
		&item.DisplayOrder, &item.CreatedByUserID, &item.UpdatedByUserID,
		&item.CreatedTimestamp, &item.UpdatedTimestamp, &deleted,
		&item.CommentCount, &item.AttachmentCount, &item.EmailLinkCount,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeV2TextBox{}, ErrNotFound
	}
	if err != nil {
		return domain.NodeV2TextBox{}, err
	}
	item.DocumentJSON = json.RawMessage(raw)
	if deleted.Valid {
		value := deleted.Time
		item.DeletedTimestamp = &value
	}
	return item, nil
}

func postgresNodeV2TextBoxByID(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, companyID, nodeID, textboxID string) (domain.NodeV2TextBox, error) {
	return scanPostgresNodeV2TextBox(queryer.QueryRowContext(ctx, `select `+postgresNodeV2TextBoxColumns+`
from node_textboxes t
where t.company_id=$1::uuid and t.node_id=$2::uuid and t.textbox_id=$3::uuid`, companyID, nodeID, textboxID))
}

func listPostgresNodeV2TextBoxes(ctx context.Context, queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, companyID, nodeID string, archived bool, limit int) ([]domain.NodeV2TextBox, error) {
	if limit <= 0 || limit > NodeV2MaxPageLimit {
		limit = NodeV2MaxPageLimit
	}
	rows, err := queryer.QueryContext(ctx, `select `+postgresNodeV2TextBoxColumns+`
from node_textboxes t
where t.company_id=$1::uuid and t.node_id=$2::uuid
  and (($3 and t.deleted_timestamp is not null) or (not $3 and t.deleted_timestamp is null))
order by case when $3 then 0 else t.display_order end, t.created_timestamp desc, t.textbox_id desc
limit $4`, companyID, nodeID, archived, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.NodeV2TextBox, 0)
	for rows.Next() {
		item, err := scanPostgresNodeV2TextBox(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanPostgresNodeV2TimelineItem(scanner interface{ Scan(...any) error }) (domain.NodeV2TimelineItem, error) {
	var item domain.NodeV2TimelineItem
	var summary string
	err := scanner.Scan(&item.TimelineItemID, &item.CompanyID, &item.NodeID,
		&item.TimelineSequence, &item.ItemType, &item.OccurredAt, &item.RecordedAt,
		&item.ActorUserID, &item.TextboxID, &item.MovementID, &item.VerificationEventID, &summary)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.NodeV2TimelineItem{}, ErrNotFound
	}
	item.SummaryJSON = json.RawMessage(summary)
	return item, err
}

func (r *PostgresRepo) ListNodeV2Timeline(query NodeV2TimelineQuery) (NodeV2TimelinePage, error) {
	query.CompanyID, query.NodeID = cleanUUIDText(query.CompanyID), cleanUUIDText(query.NodeID)
	if query.CompanyID == "" || query.NodeID == "" {
		return NodeV2TimelinePage{}, ErrInvalid
	}
	if query.Limit <= 0 || query.Limit > NodeV2MaxPageLimit {
		query.Limit = NodeV2DefaultPageLimit
	}
	args := []any{query.CompanyID, query.NodeID, query.Limit + 1}
	predicate := ""
	if query.Cursor != nil {
		if query.Cursor.Timestamp.IsZero() || query.Cursor.Sequence <= 0 {
			return NodeV2TimelinePage{}, ErrInvalid
		}
		predicate = ` and (occurred_at < $4 or (occurred_at=$4 and timeline_sequence < $5))`
		args = append(args, query.Cursor.Timestamp, query.Cursor.Sequence)
	}
	rows, err := r.db.QueryContext(context.Background(), `
select timeline_item_id::text, company_id::text, node_id::text, timeline_sequence,
       item_type, occurred_at, recorded_at, coalesce(actor_user_id::text, ''),
       coalesce(textbox_id::text, ''), coalesce(movement_id::text, ''),
       coalesce(verification_event_id::text, ''), summary_json::text
from node_timeline_items
where company_id=$1::uuid and node_id=$2::uuid`+predicate+`
order by occurred_at desc, timeline_sequence desc
limit $3`, args...)
	if err != nil {
		return NodeV2TimelinePage{}, err
	}
	defer rows.Close()
	items := make([]domain.NodeV2TimelineItem, 0, query.Limit+1)
	for rows.Next() {
		item, err := scanPostgresNodeV2TimelineItem(rows)
		if err != nil {
			return NodeV2TimelinePage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return NodeV2TimelinePage{}, err
	}
	page := NodeV2TimelinePage{Items: items}
	if len(items) > query.Limit {
		last := items[query.Limit-1]
		page.Items = items[:query.Limit]
		page.NextCursor = &NodeV2Cursor{Timestamp: last.OccurredAt, Sequence: last.TimelineSequence}
	}
	return page, nil
}

func (r *PostgresRepo) GetNodeV2Workspace(query NodeV2WorkspaceQuery) (NodeV2WorkspaceResult, error) {
	query.CompanyID, query.NodeID = cleanUUIDText(query.CompanyID), cleanUUIDText(query.NodeID)
	if query.CompanyID == "" || query.NodeID == "" {
		return NodeV2WorkspaceResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	defer tx.Rollback()
	var result NodeV2WorkspaceResult
	result.Node, err = postgresNodeByIDTx(ctx, tx, query.CompanyID, query.NodeID)
	if err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	result.Textboxes, err = listPostgresNodeV2TextBoxes(ctx, tx, query.CompanyID, query.NodeID, false, 50)
	if err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	result.ArchivedTextboxes, err = listPostgresNodeV2TextBoxes(ctx, tx, query.CompanyID, query.NodeID, true, 50)
	if err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	if err := tx.QueryRowContext(ctx, `
select count(*) filter (where deleted_timestamp is null)::integer,
       count(*) filter (where deleted_timestamp is not null)::integer
from node_textboxes where company_id=$1::uuid and node_id=$2::uuid`, query.CompanyID, query.NodeID).Scan(
		&result.Counts.Textboxes, &result.Counts.ArchivedTextboxes); err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	if err := tx.QueryRowContext(ctx, `select count(*)::integer from node_textbox_comments
where company_id=$1::uuid and node_id=$2::uuid and deleted_timestamp is null`, query.CompanyID, query.NodeID).Scan(&result.Counts.Comments); err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	if err := tx.QueryRowContext(ctx, `select count(*)::integer from communications_node_email_threads
where company_id=$1::uuid and node_id=$2::uuid`, query.CompanyID, query.NodeID).Scan(&result.Counts.EmailThreads); err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	if err := tx.QueryRowContext(ctx, `select count(*)::integer from node_textbox_attachment_links
where company_id=$1::uuid and node_id=$2::uuid and deleted_timestamp is null`, query.CompanyID, query.NodeID).Scan(&result.Counts.Attachments); err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	// Pages use the same repeatable-read snapshot as the shell. The helpers are
	// intentionally queryer-local to avoid a giant multiplying join.
	result.Timeline, err = listNodeV2TimelineTx(ctx, tx, NodeV2TimelineQuery{
		CompanyID: query.CompanyID, NodeID: query.NodeID, Limit: query.TimelineLimit, Cursor: query.TimelineCursor,
	})
	if err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	attachmentPage, err := listPostgresNodeV2Attachments(ctx, tx, NodeV2AggregateQuery{CompanyID: query.CompanyID, NodeID: query.NodeID, Limit: query.AggregateLimit})
	if err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	result.AttachmentSummaries, result.AttachmentNextCursor = attachmentPage.Items, attachmentPage.NextCursor
	emailPage, err := listPostgresNodeV2Emails(ctx, tx, NodeV2AggregateQuery{CompanyID: query.CompanyID, NodeID: query.NodeID, Limit: query.AggregateLimit})
	if err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	result.EmailThreadSummaries, result.EmailNextCursor = emailPage.Items, emailPage.NextCursor
	if err := tx.Commit(); err != nil {
		return NodeV2WorkspaceResult{}, err
	}
	return result, nil
}

func listNodeV2TimelineTx(ctx context.Context, tx *sql.Tx, query NodeV2TimelineQuery) (NodeV2TimelinePage, error) {
	if query.Limit <= 0 || query.Limit > NodeV2MaxPageLimit {
		query.Limit = NodeV2DefaultPageLimit
	}
	args := []any{query.CompanyID, query.NodeID, query.Limit + 1}
	predicate := ""
	if query.Cursor != nil {
		predicate = ` and (occurred_at < $4 or (occurred_at=$4 and timeline_sequence < $5))`
		args = append(args, query.Cursor.Timestamp, query.Cursor.Sequence)
	}
	rows, err := tx.QueryContext(ctx, `select timeline_item_id::text, company_id::text, node_id::text,
timeline_sequence, item_type, occurred_at, recorded_at, coalesce(actor_user_id::text, ''),
coalesce(textbox_id::text, ''), coalesce(movement_id::text, ''), coalesce(verification_event_id::text, ''), summary_json::text
from node_timeline_items where company_id=$1::uuid and node_id=$2::uuid`+predicate+`
order by occurred_at desc, timeline_sequence desc limit $3`, args...)
	if err != nil {
		return NodeV2TimelinePage{}, err
	}
	defer rows.Close()
	items := make([]domain.NodeV2TimelineItem, 0, query.Limit+1)
	for rows.Next() {
		item, err := scanPostgresNodeV2TimelineItem(rows)
		if err != nil {
			return NodeV2TimelinePage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return NodeV2TimelinePage{}, err
	}
	page := NodeV2TimelinePage{Items: items}
	if len(items) > query.Limit {
		last := items[query.Limit-1]
		page.Items = items[:query.Limit]
		page.NextCursor = &NodeV2Cursor{Timestamp: last.OccurredAt, Sequence: last.TimelineSequence}
	}
	return page, nil
}

func postgresNodeByIDTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) (domain.Node, error) {
	var item domain.Node
	var status, due sql.NullString
	var priority sql.NullInt64
	err := tx.QueryRowContext(ctx, `select company_id::text,node_id::text,name,default_access,status,due_date::text,priority,created_timestamp
from nodes where company_id=$1::uuid and node_id=$2::uuid`, companyID, nodeID).Scan(
		&item.CompanyID, &item.NodeID, &item.Title, &item.DefaultAccess, &status, &due, &priority, &item.CreatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Node{}, ErrNotFound
	}
	if err != nil {
		return domain.Node{}, err
	}
	if status.Valid {
		item.Status = &status.String
	}
	if due.Valid {
		item.DueDate = &due.String
	}
	if priority.Valid {
		v := int(priority.Int64)
		item.Priority = &v
	}
	return item, nil
}

func (r *PostgresRepo) CreateNodeV2TextBox(input NodeV2CreateTextBoxInput) (NodeV2TextBoxMutationResult, error) {
	input.CompanyID, input.NodeID, input.ActorUserID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.NodeID), cleanUUIDText(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.NodeID == "" || input.ActorUserID == "" || input.IdempotencyKey == "" || len([]byte(input.IdempotencyKey)) > 160 {
		return NodeV2TextBoxMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeV2TextBoxMutationResult{}, err
	}
	defer tx.Rollback()
	var existing string
	err = tx.QueryRowContext(ctx, `select textbox_id::text from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and creation_idempotency_key=$3`, input.CompanyID, input.NodeID, input.IdempotencyKey).Scan(&existing)
	if err == nil {
		box, getErr := postgresNodeV2TextBoxByID(ctx, tx, input.CompanyID, input.NodeID, existing)
		if getErr != nil {
			return NodeV2TextBoxMutationResult{}, getErr
		}
		timeline, getErr := scanPostgresNodeV2TimelineItem(tx.QueryRowContext(ctx, `select timeline_item_id::text,company_id::text,node_id::text,timeline_sequence,item_type,occurred_at,recorded_at,coalesce(actor_user_id::text,''),coalesce(textbox_id::text,''),coalesce(movement_id::text,''),coalesce(verification_event_id::text,''),summary_json::text from node_timeline_items where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, input.CompanyID, input.NodeID, existing))
		return NodeV2TextBoxMutationResult{Textbox: box, TimelineItem: timeline}, getErr
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return NodeV2TextBoxMutationResult{}, err
	}
	var actorName string
	if err := tx.QueryRowContext(ctx, `select coalesce(nullif(u.display_name,''),nullif(u.email,''),'Unknown user') from nodes n left join users u on u.user_id=$3::uuid where n.company_id=$1::uuid and n.node_id=$2::uuid for update of n`, input.CompanyID, input.NodeID, input.ActorUserID).Scan(&actorName); errors.Is(err, sql.ErrNoRows) {
		return NodeV2TextBoxMutationResult{}, ErrNotFound
	} else if err != nil {
		return NodeV2TextBoxMutationResult{}, fmt.Errorf("lock node for Node v2 textbox: %w", err)
	}
	textboxID, epoch := newUUIDv7String(), newUUIDv7String()
	var order int64
	if err := tx.QueryRowContext(ctx, `select coalesce(min(display_order),0)-1024 from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and deleted_timestamp is null`, input.CompanyID, input.NodeID).Scan(&order); err != nil {
		return NodeV2TextBoxMutationResult{}, fmt.Errorf("allocate Node v2 textbox order: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `insert into node_textboxes(company_id,node_id,textbox_id,document_json,plain_text,collaboration_epoch,created_by_user_id,updated_by_user_id,display_order,creation_idempotency_key) values($1::uuid,$2::uuid,$3::uuid,$4::jsonb,'',$5::uuid,$6::uuid,$6::uuid,$7,$8)`, input.CompanyID, input.NodeID, textboxID, nodeV2EmptyDocument, epoch, input.ActorUserID, order, input.IdempotencyKey); err != nil {
		return NodeV2TextBoxMutationResult{}, fmt.Errorf("insert Node v2 textbox: %w", err)
	}
	// Yjs empty-state bytes are valid recovery seeds. The first collaborative
	// editor transaction populates the shared ProseMirror fragment.
	if _, err := tx.ExecContext(ctx, `insert into node_textbox_yjs_checkpoints(company_id,node_id,textbox_id,checkpoint_id,collaboration_epoch,through_update_sequence,checkpoint_payload,state_vector,document_json,plain_text,checkpoint_reason,retain_until) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,0,$6,$7,$8::jsonb,'','migration_seed',now()+interval '14 days')`, input.CompanyID, input.NodeID, textboxID, newUUIDv7String(), epoch, []byte{0, 0}, []byte{0}, nodeV2EmptyDocument); err != nil {
		return NodeV2TextBoxMutationResult{}, fmt.Errorf("seed Node v2 Yjs checkpoint: %w", err)
	}
	timelineID := newUUIDv7String()
	timeline, err := scanPostgresNodeV2TimelineItem(tx.QueryRowContext(ctx, `insert into node_timeline_items(company_id,node_id,timeline_item_id,item_type,actor_user_id,textbox_id,occurred_at,summary_json) values($1::uuid,$2::uuid,$3::uuid,'textbox_created',$4::uuid,$5::uuid,now(),jsonb_build_object('actor_display_name',$6::text)) returning timeline_item_id::text,company_id::text,node_id::text,timeline_sequence,item_type,occurred_at,recorded_at,coalesce(actor_user_id::text,''),coalesce(textbox_id::text,''),coalesce(movement_id::text,''),coalesce(verification_event_id::text,''),summary_json::text`, input.CompanyID, input.NodeID, timelineID, input.ActorUserID, textboxID, actorName))
	if err != nil {
		return NodeV2TextBoxMutationResult{}, fmt.Errorf("append Node v2 textbox timeline item: %w", err)
	}
	events, err := r.appendDomainEventsTx(ctx, tx, []DomainEventInput{{CompanyID: input.CompanyID, StreamType: EntityTypeNode, StreamID: input.NodeID, Type: "node.textbox.created", ActorUserID: input.ActorUserID, IdempotencyKey: "node-v2-textbox:" + input.IdempotencyKey, Payload: map[string]any{"node_id": input.NodeID, "textbox_id": textboxID}}})
	if err != nil {
		return NodeV2TextBoxMutationResult{}, fmt.Errorf("append Node v2 textbox domain event: %w", err)
	}
	box, err := postgresNodeV2TextBoxByID(ctx, tx, input.CompanyID, input.NodeID, textboxID)
	if err != nil {
		return NodeV2TextBoxMutationResult{}, fmt.Errorf("read created Node v2 textbox: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return NodeV2TextBoxMutationResult{}, err
	}
	return NodeV2TextBoxMutationResult{Textbox: box, TimelineItem: timeline, Events: events}, nil
}

func (r *PostgresRepo) GetNodeV2TextBox(companyID, nodeID, textboxID string) (domain.NodeV2TextBox, error) {
	companyID, nodeID, textboxID = cleanUUIDText(companyID), cleanUUIDText(nodeID), cleanUUIDText(textboxID)
	if companyID == "" || nodeID == "" || textboxID == "" {
		return domain.NodeV2TextBox{}, ErrInvalid
	}
	return postgresNodeV2TextBoxByID(context.Background(), r.db, companyID, nodeID, textboxID)
}

func (r *PostgresRepo) SetNodeV2TextBoxArchived(input NodeV2ArchiveTextBoxInput) (domain.NodeV2TextBox, error) {
	input.CompanyID, input.NodeID, input.TextboxID, input.ActorUserID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.NodeID), cleanUUIDText(input.TextboxID), cleanUUIDText(input.ActorUserID)
	if input.CompanyID == "" || input.NodeID == "" || input.TextboxID == "" || input.ActorUserID == "" {
		return domain.NodeV2TextBox{}, ErrInvalid
	}
	ctx := context.Background()
	result, err := r.db.ExecContext(ctx, `update node_textboxes set deleted_timestamp=case when $5 then coalesce(deleted_timestamp,now()) else null end,updated_by_user_id=$4::uuid,updated_timestamp=now() where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, input.CompanyID, input.NodeID, input.TextboxID, input.ActorUserID, input.Archived)
	if err != nil {
		return domain.NodeV2TextBox{}, err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return domain.NodeV2TextBox{}, ErrNotFound
	}
	return postgresNodeV2TextBoxByID(ctx, r.db, input.CompanyID, input.NodeID, input.TextboxID)
}

func (r *PostgresRepo) SetNodeV2TextBoxOrder(input NodeV2TextBoxOrderInput) ([]domain.NodeV2TextBox, error) {
	input.CompanyID, input.NodeID, input.ActorUserID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.NodeID), cleanUUIDText(input.ActorUserID)
	if input.CompanyID == "" || input.NodeID == "" || input.ActorUserID == "" || len(input.TextboxIDs) > 500 {
		return nil, ErrInvalid
	}
	seen := map[string]bool{}
	for i := range input.TextboxIDs {
		input.TextboxIDs[i] = cleanUUIDText(input.TextboxIDs[i])
		if input.TextboxIDs[i] == "" || seen[input.TextboxIDs[i]] {
			return nil, ErrInvalid
		}
		seen[input.TextboxIDs[i]] = true
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRowContext(ctx, `with locked as (select textbox_id from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and deleted_timestamp is null for update) select count(*)::integer from locked`, input.CompanyID, input.NodeID).Scan(&count); err != nil {
		return nil, err
	}
	if count != len(input.TextboxIDs) {
		return nil, ErrVersionConflict
	}
	for position, id := range input.TextboxIDs {
		result, err := tx.ExecContext(ctx, `update node_textboxes set display_order=$4,updated_by_user_id=$5::uuid,updated_timestamp=now() where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null`, input.CompanyID, input.NodeID, id, int64(position)*1024, input.ActorUserID)
		if err != nil {
			return nil, err
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return nil, ErrVersionConflict
		}
	}
	items, err := listPostgresNodeV2TextBoxes(ctx, tx, input.CompanyID, input.NodeID, false, NodeV2MaxPageLimit)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostgresRepo) GetNodeV2TextBoxSync(query NodeV2SyncQuery) (NodeV2SyncPage, error) {
	query.CompanyID, query.NodeID, query.TextboxID = cleanUUIDText(query.CompanyID), cleanUUIDText(query.NodeID), cleanUUIDText(query.TextboxID)
	if query.CompanyID == "" || query.NodeID == "" || query.TextboxID == "" || query.AfterSequence < 0 {
		return NodeV2SyncPage{}, ErrInvalid
	}
	if query.Limit <= 0 || query.Limit > NodeV2MaxSyncPageLimit {
		query.Limit = 128
	}
	ctx := context.Background()
	box, err := postgresNodeV2TextBoxByID(ctx, r.db, query.CompanyID, query.NodeID, query.TextboxID)
	if err != nil {
		return NodeV2SyncPage{}, err
	}
	page := NodeV2SyncPage{Textbox: box, Updates: []domain.NodeV2YjsUpdate{}}
	if query.IncludeCheckpoint {
		var cp domain.NodeV2YjsCheckpoint
		var payload, state []byte
		err := r.db.QueryRowContext(ctx, `select checkpoint_id::text,collaboration_epoch::text,through_update_sequence,checkpoint_payload,state_vector,created_timestamp from node_textbox_yjs_checkpoints where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and collaboration_epoch=$4::uuid order by through_update_sequence desc,checkpoint_id desc limit 1`, query.CompanyID, query.NodeID, query.TextboxID, box.CollaborationEpoch).Scan(&cp.CheckpointID, &cp.CollaborationEpoch, &cp.ThroughSequence, &payload, &state, &cp.CreatedTimestamp)
		if err == nil {
			cp.PayloadBase64 = base64.StdEncoding.EncodeToString(payload)
			cp.StateVectorBase64 = base64.StdEncoding.EncodeToString(state)
			page.Checkpoint = &cp
			if query.AfterSequence < cp.ThroughSequence {
				query.AfterSequence = cp.ThroughSequence
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return NodeV2SyncPage{}, err
		}
	}
	rows, err := r.db.QueryContext(ctx, `select update_sequence,update_id::text,update_sha256,collaboration_epoch::text,client_id,update_payload,received_timestamp from node_textbox_yjs_updates where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and collaboration_epoch=$4::uuid and update_sequence>$5 order by update_sequence limit $6`, query.CompanyID, query.NodeID, query.TextboxID, box.CollaborationEpoch, query.AfterSequence, query.Limit+1)
	if err != nil {
		return NodeV2SyncPage{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.NodeV2YjsUpdate
		var payload []byte
		if err := rows.Scan(&item.UpdateSequence, &item.UpdateID, &item.UpdateSHA256, &item.CollaborationEpoch, &item.ClientID, &payload, &item.ReceivedTimestamp); err != nil {
			return NodeV2SyncPage{}, err
		}
		item.PayloadBase64 = base64.StdEncoding.EncodeToString(payload)
		page.Updates = append(page.Updates, item)
	}
	if err := rows.Err(); err != nil {
		return NodeV2SyncPage{}, err
	}
	if len(page.Updates) > query.Limit {
		page.Updates = page.Updates[:query.Limit]
		page.HasMore = true
	}
	if len(page.Updates) > 0 {
		page.NextSequence = page.Updates[len(page.Updates)-1].UpdateSequence
	}
	return page, nil
}

func (r *PostgresRepo) AppendNodeV2YjsUpdate(input NodeV2YjsUpdateInput) (domain.NodeV2YjsUpdate, error) {
	input.CompanyID, input.NodeID, input.TextboxID, input.ActorUserID, input.CollaborationEpoch, input.UpdateID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.NodeID), cleanUUIDText(input.TextboxID), cleanUUIDText(input.ActorUserID), cleanUUIDText(input.CollaborationEpoch), cleanUUIDText(input.UpdateID)
	input.ClientID = strings.TrimSpace(input.ClientID)
	input.UpdateSHA256 = strings.ToLower(strings.TrimSpace(input.UpdateSHA256))
	if input.CompanyID == "" || input.NodeID == "" || input.TextboxID == "" || input.ActorUserID == "" || input.CollaborationEpoch == "" || input.UpdateID == "" || input.ClientID == "" || len([]byte(input.ClientID)) > 160 || len(input.Payload) == 0 || len(input.Payload) > NodeV2MaxUpdateBytes {
		return domain.NodeV2YjsUpdate{}, ErrInvalid
	}
	sum := sha256.Sum256(input.Payload)
	if hex.EncodeToString(sum[:]) != input.UpdateSHA256 {
		return domain.NodeV2YjsUpdate{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeV2YjsUpdate{}, err
	}
	defer tx.Rollback()
	var epoch string
	if err := tx.QueryRowContext(ctx, `select collaboration_epoch::text from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null for update`, input.CompanyID, input.NodeID, input.TextboxID).Scan(&epoch); errors.Is(err, sql.ErrNoRows) {
		return domain.NodeV2YjsUpdate{}, ErrNotFound
	} else if err != nil {
		return domain.NodeV2YjsUpdate{}, err
	}
	if epoch != input.CollaborationEpoch {
		return domain.NodeV2YjsUpdate{}, ErrVersionConflict
	}
	var item domain.NodeV2YjsUpdate
	var payload []byte
	// Page-close and offline recovery may retry identical Yjs bytes with a new
	// operation ID. Phase 1's checksum key makes those retries idempotent too.
	err = tx.QueryRowContext(ctx, `select update_sequence,update_id::text,update_sha256,collaboration_epoch::text,client_id,update_payload,received_timestamp from node_textbox_yjs_updates where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and (update_id=$4::uuid or (collaboration_epoch=$5::uuid and update_sha256=$6)) order by (update_id=$4::uuid) desc limit 1`,
		input.CompanyID, input.NodeID, input.TextboxID, input.UpdateID, input.CollaborationEpoch, input.UpdateSHA256).Scan(&item.UpdateSequence, &item.UpdateID, &item.UpdateSHA256, &item.CollaborationEpoch, &item.ClientID, &payload, &item.ReceivedTimestamp)
	if err == nil {
		if item.UpdateSHA256 != input.UpdateSHA256 {
			return domain.NodeV2YjsUpdate{}, ErrVersionConflict
		}
		item.PayloadBase64 = base64.StdEncoding.EncodeToString(payload)
		return item, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return domain.NodeV2YjsUpdate{}, err
	}
	err = tx.QueryRowContext(ctx, `insert into node_textbox_yjs_updates(company_id,node_id,textbox_id,update_id,update_sha256,collaboration_epoch,client_id,actor_user_id,update_payload) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8::uuid,$9) returning update_sequence,update_id::text,update_sha256,collaboration_epoch::text,client_id,update_payload,received_timestamp`, input.CompanyID, input.NodeID, input.TextboxID, input.UpdateID, input.UpdateSHA256, input.CollaborationEpoch, input.ClientID, input.ActorUserID, input.Payload).Scan(&item.UpdateSequence, &item.UpdateID, &item.UpdateSHA256, &item.CollaborationEpoch, &item.ClientID, &payload, &item.ReceivedTimestamp)
	if err != nil {
		return domain.NodeV2YjsUpdate{}, err
	}
	if _, err := tx.ExecContext(ctx, `update node_textboxes set latest_update_sequence=greatest(latest_update_sequence,$4),updated_by_user_id=$5::uuid,updated_timestamp=now() where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, input.CompanyID, input.NodeID, input.TextboxID, item.UpdateSequence, input.ActorUserID); err != nil {
		return domain.NodeV2YjsUpdate{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.NodeV2YjsUpdate{}, err
	}
	item.PayloadBase64 = base64.StdEncoding.EncodeToString(payload)
	return item, nil
}

func (r *PostgresRepo) CheckpointNodeV2TextBox(input NodeV2CheckpointInput) (domain.NodeV2TextBox, error) {
	input.CompanyID, input.NodeID, input.TextboxID, input.ActorUserID, input.CheckpointID, input.CollaborationEpoch = cleanUUIDText(input.CompanyID), cleanUUIDText(input.NodeID), cleanUUIDText(input.TextboxID), cleanUUIDText(input.ActorUserID), cleanUUIDText(input.CheckpointID), cleanUUIDText(input.CollaborationEpoch)
	input.Reason = strings.TrimSpace(input.Reason)
	if input.CompanyID == "" || input.NodeID == "" || input.TextboxID == "" || input.ActorUserID == "" || input.CheckpointID == "" || input.CollaborationEpoch == "" || input.ThroughSequence < 0 || len(input.CheckpointPayload) == 0 || len(input.StateVector) == 0 || len(input.DocumentJSON) == 0 {
		return domain.NodeV2TextBox{}, ErrInvalid
	}
	var envelope struct {
		Format        string `json:"format"`
		SchemaVersion int    `json:"schema_version"`
		Document      struct {
			Type string `json:"type"`
		} `json:"document"`
	}
	if json.Unmarshal(input.DocumentJSON, &envelope) != nil || envelope.Format != "mango-tiptap-json" || envelope.SchemaVersion != 1 || envelope.Document.Type != "doc" {
		return domain.NodeV2TextBox{}, ErrInvalid
	}
	allowed := map[string]bool{"operation_count": true, "update_bytes": true, "idle": true, "manual_recovery": true}
	if !allowed[input.Reason] {
		return domain.NodeV2TextBox{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeV2TextBox{}, err
	}
	defer tx.Rollback()
	var epoch string
	var latest, materialized int64
	if err := tx.QueryRowContext(ctx, `select collaboration_epoch::text,latest_update_sequence,materialized_through_sequence from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null for update`, input.CompanyID, input.NodeID, input.TextboxID).Scan(&epoch, &latest, &materialized); errors.Is(err, sql.ErrNoRows) {
		return domain.NodeV2TextBox{}, ErrNotFound
	} else if err != nil {
		return domain.NodeV2TextBox{}, err
	}
	if epoch != input.CollaborationEpoch || input.ThroughSequence < materialized || input.ThroughSequence > latest {
		return domain.NodeV2TextBox{}, ErrVersionConflict
	}
	if _, err := tx.ExecContext(ctx, `insert into node_textbox_yjs_checkpoints(company_id,node_id,textbox_id,checkpoint_id,collaboration_epoch,through_update_sequence,checkpoint_payload,state_vector,document_json,plain_text,checkpoint_reason,retain_until) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::jsonb,$10,$11,now()+interval '14 days') on conflict(company_id,node_id,textbox_id,collaboration_epoch,through_update_sequence) do nothing`, input.CompanyID, input.NodeID, input.TextboxID, input.CheckpointID, input.CollaborationEpoch, input.ThroughSequence, input.CheckpointPayload, input.StateVector, string(input.DocumentJSON), input.PlainText, input.Reason); err != nil {
		return domain.NodeV2TextBox{}, err
	}
	if _, err := tx.ExecContext(ctx, `update node_textbox_yjs_updates set checkpointed_timestamp=coalesce(checkpointed_timestamp,now()),retain_until=coalesce(retain_until,now()+interval '7 days') where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and collaboration_epoch=$4::uuid and update_sequence<=$5`, input.CompanyID, input.NodeID, input.TextboxID, input.CollaborationEpoch, input.ThroughSequence); err != nil {
		return domain.NodeV2TextBox{}, err
	}
	if _, err := tx.ExecContext(ctx, `update node_textboxes set document_json=$4::jsonb,plain_text=$5,content_revision=content_revision+1,materialized_through_sequence=$6,updated_by_user_id=$7::uuid,updated_timestamp=now() where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`, input.CompanyID, input.NodeID, input.TextboxID, string(input.DocumentJSON), input.PlainText, input.ThroughSequence, input.ActorUserID); err != nil {
		return domain.NodeV2TextBox{}, err
	}
	box, err := postgresNodeV2TextBoxByID(ctx, tx, input.CompanyID, input.NodeID, input.TextboxID)
	if err != nil {
		return domain.NodeV2TextBox{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.NodeV2TextBox{}, err
	}
	return box, nil
}

// Stable helpers used by the in-memory implementation and tests.
func sortNodeV2TextBoxes(items []domain.NodeV2TextBox) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].DisplayOrder != items[j].DisplayOrder {
			return items[i].DisplayOrder < items[j].DisplayOrder
		}
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.After(items[j].CreatedTimestamp)
		}
		return items[i].TextboxID > items[j].TextboxID
	})
}
func nodeV2Now() time.Time { return time.Now().UTC() }
