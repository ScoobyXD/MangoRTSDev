package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"miraeopus/backend/internal/domain"
)

func nodeV2UUIDPlaceholders(start, count int) string {
	values := make([]string, count)
	for index := range values {
		values[index] = fmt.Sprintf("$%d::uuid", start+index)
	}
	return strings.Join(values, ",")
}

// ListNodeV2Comments pages complete thread headers before hydrating children.
// Paging individual comment rows can split replies from their thread and make a
// cursor duplicate or omit the conversation on the following page.
func (r *PostgresRepo) ListNodeV2Comments(query NodeV2CommentQuery) (NodeV2CommentPage, error) {
	query.CompanyID, query.NodeID, query.TextboxID = cleanUUIDText(query.CompanyID), cleanUUIDText(query.NodeID), cleanUUIDText(query.TextboxID)
	if query.CompanyID == "" || query.NodeID == "" || query.TextboxID == "" {
		return NodeV2CommentPage{}, ErrInvalid
	}
	if query.Limit <= 0 || query.Limit > NodeV2MaxPageLimit {
		query.Limit = NodeV2DefaultPageLimit
	}

	args := []any{query.CompanyID, query.NodeID, query.TextboxID, query.Limit + 1}
	predicate := ""
	if query.Cursor != nil {
		if query.Cursor.Version != 1 || query.Cursor.Kind != "node_v2_comments" || query.Cursor.Timestamp.IsZero() || cleanUUIDText(query.Cursor.ID) == "" {
			return NodeV2CommentPage{}, ErrInvalid
		}
		predicate = ` and (t.created_timestamp<$5 or (t.created_timestamp=$5 and t.thread_id<$6::uuid))`
		args = append(args, query.Cursor.Timestamp, query.Cursor.ID)
	}

	ctx := context.Background()
	rows, err := r.db.QueryContext(ctx, `select thread_id::text,textbox_id::text,selected_quote,anchor_before_text,anchor_after_text,anchor_format,anchor_status,anchor_start,anchor_end,created_by_user_id::text,created_by_display_name,created_timestamp,resolved_timestamp from node_textbox_comment_threads t where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`+predicate+` order by created_timestamp desc,thread_id desc limit $4`, args...)
	if err != nil {
		return NodeV2CommentPage{}, err
	}
	threads := []domain.NodeV2CommentThread{}
	for rows.Next() {
		thread, scanErr := scanNodeV2CommentThread(rows)
		if scanErr != nil {
			_ = rows.Close()
			return NodeV2CommentPage{}, scanErr
		}
		threads = append(threads, thread)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return NodeV2CommentPage{}, err
	}
	if err := rows.Close(); err != nil {
		return NodeV2CommentPage{}, err
	}

	page := NodeV2CommentPage{Threads: threads}
	if len(page.Threads) > query.Limit {
		last := page.Threads[query.Limit-1]
		page.NextCursor = &NodeV2Cursor{Version: 1, Kind: "node_v2_comments", Timestamp: last.CreatedTimestamp, ID: last.ThreadID}
		page.Threads = page.Threads[:query.Limit]
	}
	if len(page.Threads) == 0 {
		return page, nil
	}

	threadIndex := make(map[string]int, len(page.Threads))
	childArgs := []any{query.CompanyID, query.NodeID, query.TextboxID}
	for index, thread := range page.Threads {
		threadIndex[thread.ThreadID] = index
		childArgs = append(childArgs, thread.ThreadID)
	}
	threadIDs := nodeV2UUIDPlaceholders(4, len(page.Threads))
	commentRows, err := r.db.QueryContext(ctx, `select comment_id::text,thread_id::text,coalesce(parent_comment_id::text,''),coalesce(author_user_id::text,''),author_display_name,body_text,created_timestamp,edited_timestamp,deleted_timestamp from node_textbox_comments where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and thread_id in (`+threadIDs+`) order by created_timestamp,comment_id`, childArgs...)
	if err != nil {
		return NodeV2CommentPage{}, err
	}
	commentLocations := map[string][2]int{}
	for commentRows.Next() {
		var comment domain.NodeV2Comment
		if err := commentRows.Scan(&comment.CommentID, &comment.ThreadID, &comment.ParentCommentID, &comment.AuthorUserID, &comment.AuthorDisplayName, &comment.BodyText, &comment.CreatedTimestamp, &comment.EditedTimestamp, &comment.DeletedTimestamp); err != nil {
			_ = commentRows.Close()
			return NodeV2CommentPage{}, err
		}
		index, ok := threadIndex[comment.ThreadID]
		if !ok {
			_ = commentRows.Close()
			return NodeV2CommentPage{}, sql.ErrNoRows
		}
		comment.Mentions = []domain.NodeV2CommentMention{}
		page.Threads[index].Comments = append(page.Threads[index].Comments, comment)
		commentLocations[comment.CommentID] = [2]int{index, len(page.Threads[index].Comments) - 1}
	}
	if err := commentRows.Err(); err != nil {
		_ = commentRows.Close()
		return NodeV2CommentPage{}, err
	}
	if err := commentRows.Close(); err != nil {
		return NodeV2CommentPage{}, err
	}

	mentionRows, err := r.db.QueryContext(ctx, `select comment_id::text,principal_type,principal_id::text,principal_display_name from node_textbox_comment_mentions where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and thread_id in (`+threadIDs+`) order by comment_id,principal_type,principal_display_name,principal_id`, childArgs...)
	if err != nil {
		return NodeV2CommentPage{}, err
	}
	defer mentionRows.Close()
	for mentionRows.Next() {
		var commentID string
		var mention domain.NodeV2CommentMention
		if err := mentionRows.Scan(&commentID, &mention.PrincipalType, &mention.PrincipalID, &mention.PrincipalDisplayName); err != nil {
			return NodeV2CommentPage{}, err
		}
		if location, ok := commentLocations[commentID]; ok {
			comment := &page.Threads[location[0]].Comments[location[1]]
			comment.Mentions = append(comment.Mentions, mention)
		}
	}
	return page, mentionRows.Err()
}
