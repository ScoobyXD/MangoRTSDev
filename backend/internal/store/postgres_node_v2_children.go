package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
)

func nodeV2ActorNameTx(ctx context.Context, tx *sql.Tx, companyID, userID string) (string, error) {
	var name string
	err := tx.QueryRowContext(ctx, `select coalesce(nullif(u.display_name,''),nullif(u.email,''),'Unknown user')
from company_memberships m join users u on u.user_id=m.user_id
where m.company_id=$1::uuid and m.user_id=$2::uuid`, companyID, userID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrPrincipalNotInCompany
	}
	return name, err
}

func nodeV2MentionsTx(ctx context.Context, queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, companyID, nodeID, textboxID, threadID, commentID string) ([]domain.NodeV2CommentMention, error) {
	rows, err := queryer.QueryContext(ctx, `select principal_type,principal_id::text,principal_display_name from node_textbox_comment_mentions where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and thread_id=$4::uuid and comment_id=$5::uuid order by principal_type,principal_display_name,principal_id`, companyID, nodeID, textboxID, threadID, commentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.NodeV2CommentMention{}
	for rows.Next() {
		var item domain.NodeV2CommentMention
		if err := rows.Scan(&item.PrincipalType, &item.PrincipalID, &item.PrincipalDisplayName); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanNodeV2CommentThread(scanner interface{ Scan(...any) error }) (domain.NodeV2CommentThread, error) {
	var item domain.NodeV2CommentThread
	var start, end []byte
	var creator sql.NullString
	err := scanner.Scan(&item.ThreadID, &item.TextboxID, &item.SelectedQuote, &item.AnchorBeforeText, &item.AnchorAfterText, &item.AnchorFormat, &item.AnchorStatus, &start, &end, &creator, &item.CreatedByDisplayName, &item.CreatedTimestamp, &item.ResolvedTimestamp)
	if err != nil {
		return item, err
	}
	if len(start) > 0 {
		item.AnchorStartBase64 = base64.StdEncoding.EncodeToString(start)
	}
	if len(end) > 0 {
		item.AnchorEndBase64 = base64.StdEncoding.EncodeToString(end)
	}
	if creator.Valid {
		item.CreatedByUserID = creator.String
	}
	item.Comments = []domain.NodeV2Comment{}
	return item, nil
}

func nodeV2CommentThreadByIDTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, textboxID, threadID string) (domain.NodeV2CommentThread, error) {
	item, err := scanNodeV2CommentThread(tx.QueryRowContext(ctx, `select thread_id::text,textbox_id::text,selected_quote,anchor_before_text,anchor_after_text,anchor_format,anchor_status,anchor_start,anchor_end,created_by_user_id::text,created_by_display_name,created_timestamp,resolved_timestamp from node_textbox_comment_threads where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and thread_id=$4::uuid`, companyID, nodeID, textboxID, threadID))
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	if err != nil {
		return item, err
	}
	rows, err := tx.QueryContext(ctx, `select comment_id::text,thread_id::text,coalesce(parent_comment_id::text,''),coalesce(author_user_id::text,''),author_display_name,body_text,created_timestamp,edited_timestamp,deleted_timestamp from node_textbox_comments where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and thread_id=$4::uuid order by created_timestamp,comment_id`, companyID, nodeID, textboxID, threadID)
	if err != nil {
		return item, err
	}
	comments := []domain.NodeV2Comment{}
	for rows.Next() {
		var c domain.NodeV2Comment
		if err := rows.Scan(&c.CommentID, &c.ThreadID, &c.ParentCommentID, &c.AuthorUserID, &c.AuthorDisplayName, &c.BodyText, &c.CreatedTimestamp, &c.EditedTimestamp, &c.DeletedTimestamp); err != nil {
			_ = rows.Close()
			return item, err
		}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return item, err
	}
	if err := rows.Close(); err != nil {
		return item, err
	}
	for index := range comments {
		mentions, err := nodeV2MentionsTx(ctx, tx, companyID, nodeID, textboxID, threadID, comments[index].CommentID)
		if err != nil {
			return item, err
		}
		comments[index].Mentions = mentions
	}
	item.Comments = comments
	return item, nil
}

func insertNodeV2MentionsTx(ctx context.Context, tx *sql.Tx, companyID, nodeID, textboxID, threadID, commentID string, mentions []NodeV2MentionInput) error {
	seen := map[string]bool{}
	for _, mention := range mentions {
		mention.PrincipalType = strings.TrimSpace(mention.PrincipalType)
		mention.PrincipalID = cleanUUIDText(mention.PrincipalID)
		key := mention.PrincipalType + ":" + mention.PrincipalID
		if mention.PrincipalID == "" || seen[key] || !(mention.PrincipalType == "user" || mention.PrincipalType == "group") {
			if seen[key] {
				continue
			}
			return ErrInvalid
		}
		seen[key] = true
		var name string
		var err error
		if mention.PrincipalType == "user" {
			err = tx.QueryRowContext(ctx, `select coalesce(nullif(u.display_name,''),nullif(u.email,''),'Unknown user') from company_memberships m join users u on u.user_id=m.user_id where m.company_id=$1::uuid and m.user_id=$2::uuid`, companyID, mention.PrincipalID).Scan(&name)
		} else {
			err = tx.QueryRowContext(ctx, `select name from company_user_groups where company_id=$1::uuid and group_id=$2::uuid`, companyID, mention.PrincipalID).Scan(&name)
		}
		if errors.Is(err, sql.ErrNoRows) {
			return ErrPrincipalNotInCompany
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `insert into node_textbox_comment_mentions(company_id,node_id,textbox_id,thread_id,comment_id,principal_type,principal_id,principal_display_name) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$8)`, companyID, nodeID, textboxID, threadID, commentID, mention.PrincipalType, mention.PrincipalID, name); err != nil {
			return err
		}
	}
	return nil
}

func (r *PostgresRepo) CreateNodeV2CommentThread(input NodeV2CreateCommentThreadInput) (domain.NodeV2CommentThread, error) {
	input.CompanyID, input.NodeID, input.TextboxID, input.ActorUserID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.NodeID), cleanUUIDText(input.TextboxID), cleanUUIDText(input.ActorUserID)
	input.IdempotencyKey, input.BodyText = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.BodyText)
	if input.CompanyID == "" || input.NodeID == "" || input.TextboxID == "" || input.ActorUserID == "" || input.IdempotencyKey == "" || len([]byte(input.IdempotencyKey)) > 160 || input.BodyText == "" {
		return domain.NodeV2CommentThread{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeV2CommentThread{}, err
	}
	defer tx.Rollback()
	var existing string
	err = tx.QueryRowContext(ctx, `select thread_id::text from node_textbox_comment_threads where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and idempotency_key=$4`, input.CompanyID, input.NodeID, input.TextboxID, input.IdempotencyKey).Scan(&existing)
	if err == nil {
		return nodeV2CommentThreadByIDTx(ctx, tx, input.CompanyID, input.NodeID, input.TextboxID, existing)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return domain.NodeV2CommentThread{}, err
	}
	actorName, err := nodeV2ActorNameTx(ctx, tx, input.CompanyID, input.ActorUserID)
	if err != nil {
		return domain.NodeV2CommentThread{}, err
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null)`, input.CompanyID, input.NodeID, input.TextboxID).Scan(&exists); err != nil {
		return domain.NodeV2CommentThread{}, err
	}
	if !exists {
		return domain.NodeV2CommentThread{}, ErrNotFound
	}
	threadID, commentID := newUUIDv7String(), newUUIDv7String()
	format, status := "none", "unanchored"
	var start, end any
	if len(input.AnchorStart) > 0 && len(input.AnchorEnd) > 0 {
		format = "yjs_relative_v1"
		status = strings.TrimSpace(input.AnchorStatus)
		if status == "" {
			status = "anchored"
		}
		start = input.AnchorStart
		end = input.AnchorEnd
	}
	if _, err := tx.ExecContext(ctx, `insert into node_textbox_comment_threads(company_id,node_id,textbox_id,thread_id,selected_quote,anchor_before_text,anchor_after_text,anchor_format,anchor_status,anchor_start,anchor_end,created_by_user_id,created_by_display_name,idempotency_key) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::uuid,$13,$14)`, input.CompanyID, input.NodeID, input.TextboxID, threadID, input.SelectedQuote, input.AnchorBeforeText, input.AnchorAfterText, format, status, start, end, input.ActorUserID, actorName, input.IdempotencyKey); err != nil {
		return domain.NodeV2CommentThread{}, err
	}
	if _, err := tx.ExecContext(ctx, `insert into node_textbox_comments(company_id,node_id,textbox_id,thread_id,comment_id,author_user_id,author_display_name,body_text,idempotency_key) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9)`, input.CompanyID, input.NodeID, input.TextboxID, threadID, commentID, input.ActorUserID, actorName, input.BodyText, input.IdempotencyKey+":root"); err != nil {
		return domain.NodeV2CommentThread{}, err
	}
	if err := insertNodeV2MentionsTx(ctx, tx, input.CompanyID, input.NodeID, input.TextboxID, threadID, commentID, input.Mentions); err != nil {
		return domain.NodeV2CommentThread{}, err
	}
	if _, err := r.appendNodeV2BusinessMutationTx(ctx, tx, input.CompanyID, input.NodeID, input.ActorUserID, "node.comment.created", "node-v2-comment:"+input.IdempotencyKey, map[string]any{"textbox_id": input.TextboxID, "thread_id": threadID, "comment_id": commentID}); err != nil {
		return domain.NodeV2CommentThread{}, err
	}
	item, err := nodeV2CommentThreadByIDTx(ctx, tx, input.CompanyID, input.NodeID, input.TextboxID, threadID)
	if err != nil {
		return item, err
	}
	if err := tx.Commit(); err != nil {
		return item, err
	}
	return item, nil
}

func (r *PostgresRepo) ReplyNodeV2Comment(input NodeV2ReplyCommentInput) (domain.NodeV2Comment, error) {
	input.CompanyID, input.NodeID, input.TextboxID, input.ThreadID, input.ActorUserID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.NodeID), cleanUUIDText(input.TextboxID), cleanUUIDText(input.ThreadID), cleanUUIDText(input.ActorUserID)
	input.ParentCommentID = cleanUUIDText(input.ParentCommentID)
	input.IdempotencyKey, input.BodyText = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.BodyText)
	if input.CompanyID == "" || input.NodeID == "" || input.TextboxID == "" || input.ThreadID == "" || input.ActorUserID == "" || input.IdempotencyKey == "" || input.BodyText == "" {
		return domain.NodeV2Comment{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeV2Comment{}, err
	}
	defer tx.Rollback()
	var item domain.NodeV2Comment
	err = tx.QueryRowContext(ctx, `select comment_id::text,thread_id::text,coalesce(parent_comment_id::text,''),coalesce(author_user_id::text,''),author_display_name,body_text,created_timestamp,edited_timestamp,deleted_timestamp from node_textbox_comments where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and idempotency_key=$4`, input.CompanyID, input.NodeID, input.TextboxID, input.IdempotencyKey).Scan(&item.CommentID, &item.ThreadID, &item.ParentCommentID, &item.AuthorUserID, &item.AuthorDisplayName, &item.BodyText, &item.CreatedTimestamp, &item.EditedTimestamp, &item.DeletedTimestamp)
	if err == nil {
		item.Mentions, err = nodeV2MentionsTx(ctx, tx, input.CompanyID, input.NodeID, input.TextboxID, item.ThreadID, item.CommentID)
		return item, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return item, err
	}
	actorName, err := nodeV2ActorNameTx(ctx, tx, input.CompanyID, input.ActorUserID)
	if err != nil {
		return item, err
	}
	commentID := newUUIDv7String()
	var parent any
	if input.ParentCommentID != "" {
		parent = input.ParentCommentID
	}
	err = tx.QueryRowContext(ctx, `insert into node_textbox_comments(company_id,node_id,textbox_id,thread_id,comment_id,parent_comment_id,author_user_id,author_display_name,body_text,idempotency_key) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,nullif($6,'')::uuid,$7::uuid,$8,$9,$10) returning comment_id::text,thread_id::text,coalesce(parent_comment_id::text,''),coalesce(author_user_id::text,''),author_display_name,body_text,created_timestamp,edited_timestamp,deleted_timestamp`, input.CompanyID, input.NodeID, input.TextboxID, input.ThreadID, commentID, input.ParentCommentID, input.ActorUserID, actorName, input.BodyText, input.IdempotencyKey).Scan(&item.CommentID, &item.ThreadID, &item.ParentCommentID, &item.AuthorUserID, &item.AuthorDisplayName, &item.BodyText, &item.CreatedTimestamp, &item.EditedTimestamp, &item.DeletedTimestamp)
	_ = parent
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	if err != nil {
		return item, err
	}
	if err := insertNodeV2MentionsTx(ctx, tx, input.CompanyID, input.NodeID, input.TextboxID, input.ThreadID, commentID, input.Mentions); err != nil {
		return item, err
	}
	if _, err := r.appendNodeV2BusinessMutationTx(ctx, tx, input.CompanyID, input.NodeID, input.ActorUserID, "node.comment.replied", "node-v2-comment-reply:"+input.IdempotencyKey, map[string]any{"textbox_id": input.TextboxID, "thread_id": input.ThreadID, "comment_id": commentID}); err != nil {
		return item, err
	}
	item.Mentions, err = nodeV2MentionsTx(ctx, tx, input.CompanyID, input.NodeID, input.TextboxID, input.ThreadID, commentID)
	if err != nil {
		return item, err
	}
	if err := tx.Commit(); err != nil {
		return item, err
	}
	return item, nil
}

func scanNodeV2AttachmentRow(scanner interface{ Scan(...any) error }) (domain.NodeV2AttachmentLink, error) {
	var item domain.NodeV2AttachmentLink
	var linkDeleted, attachmentDeleted sql.NullTime
	var width, height sql.NullInt64
	err := scanner.Scan(&item.AttachmentLinkID, &item.TextboxID, &item.RelationshipKind, &item.CreatedTimestamp, &linkDeleted, &item.Attachment.CompanyID, &item.Attachment.AttachmentID, &item.Attachment.UploadedByUserID, &item.Attachment.OriginalFilename, &item.Attachment.MimeType, &item.Attachment.ByteSize, &item.Attachment.SHA256, &item.Attachment.SHA256VerificationMethod, &item.Attachment.StorageChecksumAlgorithm, &item.Attachment.StorageChecksumValue, &item.Attachment.StorageChecksumType, &item.Attachment.StorageBucket, &item.Attachment.StorageKey, &width, &height, &item.Attachment.SourceKind, &item.Attachment.SourceProvider, &item.Attachment.CreatedTimestamp, &attachmentDeleted)
	if err != nil {
		return item, err
	}
	if linkDeleted.Valid {
		item.DeletedTimestamp = &linkDeleted.Time
	}
	if attachmentDeleted.Valid {
		item.Attachment.DeletedTimestamp = &attachmentDeleted.Time
	}
	if width.Valid {
		v := int(width.Int64)
		item.Attachment.OriginalWidth = &v
	}
	if height.Valid {
		v := int(height.Int64)
		item.Attachment.OriginalHeight = &v
	}
	return item, nil
}

func listPostgresNodeV2Attachments(ctx context.Context, queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, query NodeV2AggregateQuery) (NodeV2AttachmentPage, error) {
	if query.Limit <= 0 || query.Limit > NodeV2MaxPageLimit {
		query.Limit = NodeV2DefaultPageLimit
	}
	args := []any{query.CompanyID, query.NodeID, query.Limit + 1}
	predicate := ""
	if query.Cursor != nil {
		if query.Cursor.Version != 1 || query.Cursor.Kind != "node_v2_attachments" || query.Cursor.Timestamp.IsZero() || cleanUUIDText(query.Cursor.ID) == "" {
			return NodeV2AttachmentPage{}, ErrInvalid
		}
		predicate = ` and (l.created_timestamp<$4 or (l.created_timestamp=$4 and l.attachment_link_id<$5::uuid))`
		args = append(args, query.Cursor.Timestamp, query.Cursor.ID)
	}
	rows, err := queryer.QueryContext(ctx, `select l.attachment_link_id::text,l.textbox_id::text,l.relationship_kind,l.created_timestamp,l.deleted_timestamp,a.company_id::text,a.attachment_id::text,coalesce(a.uploaded_by_user_id::text,''),a.original_filename,a.mime_type,a.byte_size,a.sha256,a.sha256_verification_method,a.storage_checksum_algorithm,a.storage_checksum_value,a.storage_checksum_type,a.storage_bucket,a.storage_key,a.original_width,a.original_height,a.source_kind,a.source_provider,a.created_timestamp,a.deleted_timestamp from node_textbox_attachment_links l join attachments a on (a.company_id,a.attachment_id)=(l.company_id,l.attachment_id) where l.company_id=$1::uuid and l.node_id=$2::uuid and l.deleted_timestamp is null and a.deleted_timestamp is null`+predicate+` order by l.created_timestamp desc,l.attachment_link_id desc limit $3`, args...)
	if err != nil {
		return NodeV2AttachmentPage{}, err
	}
	defer rows.Close()
	items := []domain.NodeV2AttachmentLink{}
	for rows.Next() {
		item, err := scanNodeV2AttachmentRow(rows)
		if err != nil {
			return NodeV2AttachmentPage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return NodeV2AttachmentPage{}, err
	}
	page := NodeV2AttachmentPage{Items: items}
	if len(items) > query.Limit {
		last := items[query.Limit-1]
		page.Items = items[:query.Limit]
		page.NextCursor = &NodeV2Cursor{Version: 1, Kind: "node_v2_attachments", Timestamp: last.CreatedTimestamp, ID: last.AttachmentLinkID}
	}
	return page, nil
}
func (r *PostgresRepo) ListNodeV2Attachments(query NodeV2AggregateQuery) (NodeV2AttachmentPage, error) {
	query.CompanyID, query.NodeID = cleanUUIDText(query.CompanyID), cleanUUIDText(query.NodeID)
	if query.CompanyID == "" || query.NodeID == "" {
		return NodeV2AttachmentPage{}, ErrInvalid
	}
	return listPostgresNodeV2Attachments(context.Background(), r.db, query)
}

func (r *PostgresRepo) SetNodeV2AttachmentLink(input NodeV2AttachmentLinkInput) (domain.NodeV2AttachmentLink, error) {
	input.CompanyID, input.NodeID, input.TextboxID, input.AttachmentID, input.ActorUserID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.NodeID), cleanUUIDText(input.TextboxID), cleanUUIDText(input.AttachmentID), cleanUUIDText(input.ActorUserID)
	input.RelationshipKind, input.IdempotencyKey = strings.TrimSpace(input.RelationshipKind), strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.NodeID == "" || input.TextboxID == "" || input.AttachmentID == "" || input.ActorUserID == "" || input.IdempotencyKey == "" || len([]byte(input.IdempotencyKey)) > 160 || !(input.RelationshipKind == "file_attachment" || input.RelationshipKind == "inline_image") {
		return domain.NodeV2AttachmentLink{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.NodeV2AttachmentLink{}, err
	}
	defer tx.Rollback()
	eventKey := "node-v2-attachment:" + input.IdempotencyKey
	var replayed bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from domain_events where company_id=$1::uuid and idempotency_key=$2)`, input.CompanyID, eventKey).Scan(&replayed); err != nil {
		return domain.NodeV2AttachmentLink{}, err
	}
	if replayed {
		return scanNodeV2AttachmentRow(tx.QueryRowContext(ctx, `select l.attachment_link_id::text,l.textbox_id::text,l.relationship_kind,l.created_timestamp,l.deleted_timestamp,a.company_id::text,a.attachment_id::text,coalesce(a.uploaded_by_user_id::text,''),a.original_filename,a.mime_type,a.byte_size,a.sha256,a.sha256_verification_method,a.storage_checksum_algorithm,a.storage_checksum_value,a.storage_checksum_type,a.storage_bucket,a.storage_key,a.original_width,a.original_height,a.source_kind,a.source_provider,a.created_timestamp,a.deleted_timestamp from node_textbox_attachment_links l join attachments a on (a.company_id,a.attachment_id)=(l.company_id,l.attachment_id) where l.company_id=$1::uuid and l.node_id=$2::uuid and l.textbox_id=$3::uuid and l.attachment_id=$4::uuid and l.relationship_kind=$5`, input.CompanyID, input.NodeID, input.TextboxID, input.AttachmentID, input.RelationshipKind))
	}
	if input.Deleted {
		result, err := tx.ExecContext(ctx, `update node_textbox_attachment_links set deleted_timestamp=coalesce(deleted_timestamp,now()) where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and attachment_id=$4::uuid and relationship_kind=$5 and deleted_timestamp is null`, input.CompanyID, input.NodeID, input.TextboxID, input.AttachmentID, input.RelationshipKind)
		if err != nil {
			return domain.NodeV2AttachmentLink{}, err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			return domain.NodeV2AttachmentLink{}, ErrNotFound
		}
	} else {
		if _, err := tx.ExecContext(ctx, `update node_textbox_attachment_links set deleted_timestamp=null where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and attachment_id=$4::uuid and relationship_kind=$5`, input.CompanyID, input.NodeID, input.TextboxID, input.AttachmentID, input.RelationshipKind); err != nil {
			return domain.NodeV2AttachmentLink{}, err
		}
		var exists bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from node_textbox_attachment_links where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and attachment_id=$4::uuid and relationship_kind=$5 and deleted_timestamp is null)`, input.CompanyID, input.NodeID, input.TextboxID, input.AttachmentID, input.RelationshipKind).Scan(&exists); err != nil {
			return domain.NodeV2AttachmentLink{}, err
		}
		if !exists {
			if _, err := tx.ExecContext(ctx, `insert into node_textbox_attachment_links(company_id,node_id,textbox_id,attachment_link_id,attachment_id,relationship_kind,created_by_user_id) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid)`, input.CompanyID, input.NodeID, input.TextboxID, newUUIDv7String(), input.AttachmentID, input.RelationshipKind, input.ActorUserID); err != nil {
				return domain.NodeV2AttachmentLink{}, err
			}
		}
	}
	eventType := "node.attachment.linked"
	if input.Deleted {
		eventType = "node.attachment.unlinked"
	}
	if _, eventErr := r.appendNodeV2BusinessMutationTx(ctx, tx, input.CompanyID, input.NodeID, input.ActorUserID, eventType, eventKey, map[string]any{"textbox_id": input.TextboxID, "attachment_id": input.AttachmentID, "relationship_kind": input.RelationshipKind}); eventErr != nil {
		return domain.NodeV2AttachmentLink{}, eventErr
	}
	item, err := scanNodeV2AttachmentRow(tx.QueryRowContext(ctx, `select l.attachment_link_id::text,l.textbox_id::text,l.relationship_kind,l.created_timestamp,l.deleted_timestamp,a.company_id::text,a.attachment_id::text,coalesce(a.uploaded_by_user_id::text,''),a.original_filename,a.mime_type,a.byte_size,a.sha256,a.sha256_verification_method,a.storage_checksum_algorithm,a.storage_checksum_value,a.storage_checksum_type,a.storage_bucket,a.storage_key,a.original_width,a.original_height,a.source_kind,a.source_provider,a.created_timestamp,a.deleted_timestamp from node_textbox_attachment_links l join attachments a on (a.company_id,a.attachment_id)=(l.company_id,l.attachment_id) where l.company_id=$1::uuid and l.node_id=$2::uuid and l.textbox_id=$3::uuid and l.attachment_id=$4::uuid and l.relationship_kind=$5`, input.CompanyID, input.NodeID, input.TextboxID, input.AttachmentID, input.RelationshipKind))
	if err != nil {
		return item, err
	}
	if err := tx.Commit(); err != nil {
		return item, err
	}
	return item, nil
}

func listPostgresNodeV2Emails(ctx context.Context, queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, query NodeV2AggregateQuery) (NodeV2EmailPage, error) {
	if query.Limit <= 0 || query.Limit > NodeV2MaxPageLimit {
		query.Limit = NodeV2DefaultPageLimit
	}
	args := []any{query.CompanyID, query.NodeID, query.Limit + 1}
	predicate := ""
	if query.Cursor != nil {
		if query.Cursor.Version != 1 || query.Cursor.Kind != "node_v2_email_threads" || query.Cursor.Timestamp.IsZero() || cleanUUIDText(query.Cursor.ID) == "" {
			return NodeV2EmailPage{}, ErrInvalid
		}
		predicate = ` and (n.created_timestamp<$4 or (n.created_timestamp=$4 and n.email_thread_id<$5::uuid))`
		args = append(args, query.Cursor.Timestamp, query.Cursor.ID)
	}
	rows, err := queryer.QueryContext(ctx, `select n.email_thread_id::text,t.account_email,coalesce(latest.subject,''),coalesce(latest.snippet,''),coalesce(latest.message_timestamp,0),coalesce(messages.message_count,0)::integer,t.download_status,t.history_complete,n.created_timestamp,coalesce(to_json(links.textbox_ids),'[]'::json)::text,coalesce(to_json(links.message_ids),'[]'::json)::text from communications_node_email_threads n join communications_email_threads t on (t.company_id,t.email_thread_id)=(n.company_id,n.email_thread_id) left join lateral(select subject,snippet,message_timestamp from communications_email_messages m where m.company_id=n.company_id and m.email_thread_id=n.email_thread_id order by message_order desc,provider_message_id desc limit 1)latest on true left join lateral(select count(*) message_count from communications_email_messages m where m.company_id=n.company_id and m.email_thread_id=n.email_thread_id)messages on true left join lateral(select array_agg(distinct l.textbox_id::text) textbox_ids,array_agg(distinct l.email_message_id::text) filter(where l.email_message_id is not null) message_ids from node_textbox_email_links l where l.company_id=n.company_id and l.node_id=n.node_id and l.email_thread_id=n.email_thread_id and l.deleted_timestamp is null)links on true where n.company_id=$1::uuid and n.node_id=$2::uuid`+predicate+` order by n.created_timestamp desc,n.email_thread_id desc limit $3`, args...)
	if err != nil {
		return NodeV2EmailPage{}, err
	}
	defer rows.Close()
	items := []domain.NodeV2EmailThreadSummary{}
	for rows.Next() {
		var item domain.NodeV2EmailThreadSummary
		var linkedTextboxIDsJSON, linkedMessageIDsJSON string
		if err := rows.Scan(&item.EmailThreadID, &item.AccountEmail, &item.Subject, &item.Snippet, &item.LatestMessageAt, &item.MessageCount, &item.DownloadStatus, &item.HistoryComplete, &item.NodeAttachedTimestamp, &linkedTextboxIDsJSON, &linkedMessageIDsJSON); err != nil {
			return NodeV2EmailPage{}, err
		}
		if err := json.Unmarshal([]byte(linkedTextboxIDsJSON), &item.LinkedTextboxIDs); err != nil {
			return NodeV2EmailPage{}, err
		}
		if err := json.Unmarshal([]byte(linkedMessageIDsJSON), &item.LinkedMessageIDs); err != nil {
			return NodeV2EmailPage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return NodeV2EmailPage{}, err
	}
	page := NodeV2EmailPage{Items: items}
	if len(items) > query.Limit {
		last := items[query.Limit-1]
		page.Items = items[:query.Limit]
		page.NextCursor = &NodeV2Cursor{Version: 1, Kind: "node_v2_email_threads", Timestamp: last.NodeAttachedTimestamp, ID: last.EmailThreadID}
	}
	return page, nil
}
func (r *PostgresRepo) ListNodeV2EmailThreads(query NodeV2AggregateQuery) (NodeV2EmailPage, error) {
	query.CompanyID, query.NodeID = cleanUUIDText(query.CompanyID), cleanUUIDText(query.NodeID)
	if query.CompanyID == "" || query.NodeID == "" {
		return NodeV2EmailPage{}, ErrInvalid
	}
	return listPostgresNodeV2Emails(context.Background(), r.db, query)
}

func (r *PostgresRepo) SetNodeV2EmailLink(input NodeV2EmailLinkInput) error {
	input.CompanyID, input.NodeID, input.TextboxID, input.EmailThreadID, input.EmailMessageID, input.ActorUserID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.NodeID), cleanUUIDText(input.TextboxID), cleanUUIDText(input.EmailThreadID), cleanUUIDText(input.EmailMessageID), cleanUUIDText(input.ActorUserID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.CompanyID == "" || input.NodeID == "" || input.TextboxID == "" || input.EmailThreadID == "" || input.ActorUserID == "" || input.IdempotencyKey == "" || len([]byte(input.IdempotencyKey)) > 160 {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	eventKey := "node-v2-email:" + input.IdempotencyKey
	var replayed bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from domain_events where company_id=$1::uuid and idempotency_key=$2)`, input.CompanyID, eventKey).Scan(&replayed); err != nil {
		return err
	}
	if replayed {
		return nil
	}
	if input.Deleted {
		result, err := tx.ExecContext(ctx, `update node_textbox_email_links set deleted_timestamp=coalesce(deleted_timestamp,now()) where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and email_thread_id=$4::uuid and email_message_id is not distinct from nullif($5,'')::uuid and deleted_timestamp is null`, input.CompanyID, input.NodeID, input.TextboxID, input.EmailThreadID, input.EmailMessageID)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			return ErrNotFound
		}
	} else {
		var valid bool
		if input.EmailMessageID == "" {
			err = tx.QueryRowContext(ctx, `select exists(select 1 from communications_node_email_threads where company_id=$1::uuid and node_id=$2::uuid and email_thread_id=$3::uuid)`, input.CompanyID, input.NodeID, input.EmailThreadID).Scan(&valid)
		} else {
			err = tx.QueryRowContext(ctx, `select exists(select 1 from communications_node_email_threads n join communications_email_messages m on (m.company_id,m.email_thread_id)=(n.company_id,n.email_thread_id) where n.company_id=$1::uuid and n.node_id=$2::uuid and n.email_thread_id=$3::uuid and m.email_message_id=$4::uuid)`, input.CompanyID, input.NodeID, input.EmailThreadID, input.EmailMessageID).Scan(&valid)
		}
		if err != nil {
			return err
		}
		if !valid {
			return ErrNotFound
		}
		if _, err := tx.ExecContext(ctx, `update node_textbox_email_links set deleted_timestamp=null,linked_by_user_id=$6::uuid,linked_timestamp=now() where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and email_thread_id=$4::uuid and email_message_id is not distinct from nullif($5,'')::uuid`, input.CompanyID, input.NodeID, input.TextboxID, input.EmailThreadID, input.EmailMessageID, input.ActorUserID); err != nil {
			return err
		}
		var exists bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from node_textbox_email_links where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and email_thread_id=$4::uuid and email_message_id is not distinct from nullif($5,'')::uuid and deleted_timestamp is null)`, input.CompanyID, input.NodeID, input.TextboxID, input.EmailThreadID, input.EmailMessageID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			if _, err := tx.ExecContext(ctx, `insert into node_textbox_email_links(company_id,node_id,textbox_id,email_link_id,email_thread_id,email_message_id,linked_by_user_id) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,nullif($6,'')::uuid,$7::uuid)`, input.CompanyID, input.NodeID, input.TextboxID, newUUIDv7String(), input.EmailThreadID, input.EmailMessageID, input.ActorUserID); err != nil {
				return err
			}
		}
	}
	eventType := "node.email.linked"
	if input.Deleted {
		eventType = "node.email.unlinked"
	}
	if _, err := r.appendNodeV2BusinessMutationTx(ctx, tx, input.CompanyID, input.NodeID, input.ActorUserID, eventType, eventKey, map[string]any{"textbox_id": input.TextboxID, "email_thread_id": input.EmailThreadID, "email_message_id": input.EmailMessageID}); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListNodeV2EmailMessages(query NodeV2EmailMessageQuery) (NodeV2EmailMessagePage, error) {
	query.CompanyID, query.NodeID, query.EmailThreadID = cleanUUIDText(query.CompanyID), cleanUUIDText(query.NodeID), cleanUUIDText(query.EmailThreadID)
	if query.CompanyID == "" || query.NodeID == "" || query.EmailThreadID == "" {
		return NodeV2EmailMessagePage{}, ErrInvalid
	}
	if query.Cursor != nil && (query.Cursor.Version != 1 || query.Cursor.Kind != "node_v2_email_messages" || query.Cursor.ID == "") {
		return NodeV2EmailMessagePage{}, ErrInvalid
	}
	if query.Limit <= 0 || query.Limit > NodeV2MaxPageLimit {
		query.Limit = 20
	}
	bodyColumn := "''"
	if query.IncludeBody {
		bodyColumn = "m.rich_html_body"
	}
	afterOrder, afterID := int64(-1), ""
	if query.Cursor != nil {
		afterOrder, afterID = query.Cursor.Order, query.Cursor.ID
	}
	rows, err := r.db.QueryContext(context.Background(), "select m.email_message_id::text,m.email_thread_id::text,m.provider_message_id,m.message_order,m.subject,m.snippet,m.message_timestamp,m.sender_snapshot::text,m.to_snapshot::text,m.cc_snapshot::text,m.bcc_snapshot::text,"+bodyColumn+",m.attachment_metadata::text from communications_email_messages m join communications_node_email_threads n on (n.company_id,n.email_thread_id)=(m.company_id,m.email_thread_id) where n.company_id=$1::uuid and n.node_id=$2::uuid and n.email_thread_id=$3::uuid and (m.message_order>$4 or (m.message_order=$4 and m.provider_message_id>$5)) order by m.message_order,m.provider_message_id limit $6", query.CompanyID, query.NodeID, query.EmailThreadID, afterOrder, afterID, query.Limit+1)
	if err != nil {
		return NodeV2EmailMessagePage{}, err
	}
	defer rows.Close()
	page := NodeV2EmailMessagePage{Items: []domain.NodeV2EmailMessageSummary{}}
	for rows.Next() {
		var item domain.NodeV2EmailMessageSummary
		var from, to, cc, bcc, attachments string
		if err := rows.Scan(&item.EmailMessageID, &item.EmailThreadID, &item.ProviderMessageID, &item.MessageOrder, &item.Subject, &item.Snippet, &item.Date, &from, &to, &cc, &bcc, &item.BodyHTML, &attachments); err != nil {
			return page, err
		}
		for _, v := range []struct {
			raw    string
			target any
		}{{from, &item.From}, {to, &item.To}, {cc, &item.Cc}, {bcc, &item.Bcc}, {attachments, &item.Attachments}} {
			if err := json.Unmarshal([]byte(v.raw), v.target); err != nil {
				return page, err
			}
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > query.Limit {
		last := page.Items[query.Limit-1]
		page.Items = page.Items[:query.Limit]
		page.NextCursor = &NodeV2Cursor{Version: 1, Kind: "node_v2_email_messages", Order: int64(last.MessageOrder), ID: last.ProviderMessageID}
	}
	return page, nil
}

func sortNodeV2Comments(items []domain.NodeV2Comment) {
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.After(items[j].CreatedTimestamp)
		}
		return items[i].CommentID > items[j].CommentID
	})
}
