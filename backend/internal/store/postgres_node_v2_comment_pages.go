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
	childArgs = append(childArgs, NodeV2DefaultPageLimit+1)
	commentLimitPlaceholder := fmt.Sprintf("$%d", len(childArgs))
	commentRows, err := r.db.QueryContext(ctx, `with ranked_comments as (
	  select comment_id,thread_id,parent_comment_id,author_user_id,author_display_name,body_text,
	         created_timestamp,edited_timestamp,deleted_timestamp,
	         count(*) over(partition by thread_id)::integer as comment_count,
	         row_number() over(partition by thread_id order by created_timestamp desc,comment_id desc) as comment_rank
	    from node_textbox_comments
	   where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
	     and thread_id in (`+threadIDs+`)
	)
	select comment_id::text,thread_id::text,coalesce(parent_comment_id::text,''),
	       coalesce(author_user_id::text,''),author_display_name,body_text,created_timestamp,
	       edited_timestamp,deleted_timestamp,comment_count
	  from ranked_comments
	 where comment_rank<=`+commentLimitPlaceholder+`
	 order by thread_id,created_timestamp,comment_id`, childArgs...)
	if err != nil {
		return NodeV2CommentPage{}, err
	}
	commentLocations := map[string][2]int{}
	for commentRows.Next() {
		var comment domain.NodeV2Comment
		var commentCount int
		if err := commentRows.Scan(&comment.CommentID, &comment.ThreadID, &comment.ParentCommentID, &comment.AuthorUserID, &comment.AuthorDisplayName, &comment.BodyText, &comment.CreatedTimestamp, &comment.EditedTimestamp, &comment.DeletedTimestamp, &commentCount); err != nil {
			_ = commentRows.Close()
			return NodeV2CommentPage{}, err
		}
		index, ok := threadIndex[comment.ThreadID]
		if !ok {
			_ = commentRows.Close()
			return NodeV2CommentPage{}, sql.ErrNoRows
		}
		page.Threads[index].CommentCount = commentCount
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

	mentionRows, err := r.db.QueryContext(ctx, `with ranked_comment_ids as (
	  select comment_id,row_number() over(partition by thread_id order by created_timestamp desc,comment_id desc) as comment_rank
	    from node_textbox_comments
	   where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
	     and thread_id in (`+threadIDs+`)
	)
	select mention.comment_id::text,mention.principal_type,mention.principal_id::text,mention.principal_display_name
	  from node_textbox_comment_mentions mention
	  join ranked_comment_ids ranked on ranked.comment_id=mention.comment_id and ranked.comment_rank<=`+commentLimitPlaceholder+`
	 where mention.company_id=$1::uuid and mention.node_id=$2::uuid and mention.textbox_id=$3::uuid
	 order by mention.comment_id,mention.principal_type,mention.principal_display_name,mention.principal_id`, childArgs...)
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
	for index := range page.Threads {
		thread := &page.Threads[index]
		if len(thread.Comments) <= NodeV2DefaultPageLimit {
			continue
		}
		thread.Comments = thread.Comments[len(thread.Comments)-NodeV2DefaultPageLimit:]
		oldest := thread.Comments[0]
		thread.CommentsNextCursor = &domain.NodeV2CommentCursor{Version: 1, Kind: "node_v2_comment_replies", Timestamp: oldest.CreatedTimestamp, ID: oldest.CommentID}
	}
	return page, mentionRows.Err()
}

func (r *PostgresRepo) ListNodeV2CommentReplies(query NodeV2CommentReplyQuery) (NodeV2CommentReplyPage, error) {
	query.CompanyID, query.NodeID, query.TextboxID, query.ThreadID = cleanUUIDText(query.CompanyID), cleanUUIDText(query.NodeID), cleanUUIDText(query.TextboxID), cleanUUIDText(query.ThreadID)
	if query.CompanyID == "" || query.NodeID == "" || query.TextboxID == "" || query.ThreadID == "" {
		return NodeV2CommentReplyPage{}, ErrInvalid
	}
	if query.Limit <= 0 || query.Limit > NodeV2MaxPageLimit {
		query.Limit = NodeV2DefaultPageLimit
	}
	if query.Cursor != nil && (query.Cursor.Version != 1 || query.Cursor.Kind != "node_v2_comment_replies" || query.Cursor.Timestamp.IsZero() || cleanUUIDText(query.Cursor.ID) == "") {
		return NodeV2CommentReplyPage{}, ErrInvalid
	}

	ctx := context.Background()
	var threadExists bool
	if err := r.db.QueryRowContext(ctx, `select exists(select 1 from node_textbox_comment_threads where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and thread_id=$4::uuid)`, query.CompanyID, query.NodeID, query.TextboxID, query.ThreadID).Scan(&threadExists); err != nil {
		return NodeV2CommentReplyPage{}, err
	}
	if !threadExists {
		return NodeV2CommentReplyPage{}, ErrNotFound
	}

	args := []any{query.CompanyID, query.NodeID, query.TextboxID, query.ThreadID, query.Limit + 1}
	predicate := ""
	if query.Cursor != nil {
		predicate = " and (created_timestamp<$6 or (created_timestamp=$6 and comment_id<$7::uuid))"
		args = append(args, query.Cursor.Timestamp, query.Cursor.ID)
	}
	rows, err := r.db.QueryContext(ctx, `select comment_id::text,thread_id::text,coalesce(parent_comment_id::text,''),coalesce(author_user_id::text,''),author_display_name,body_text,created_timestamp,edited_timestamp,deleted_timestamp from node_textbox_comments where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and thread_id=$4::uuid`+predicate+` order by created_timestamp desc,comment_id desc limit $5`, args...)
	if err != nil {
		return NodeV2CommentReplyPage{}, err
	}
	page := NodeV2CommentReplyPage{Items: []domain.NodeV2Comment{}}
	for rows.Next() {
		var comment domain.NodeV2Comment
		if err := rows.Scan(&comment.CommentID, &comment.ThreadID, &comment.ParentCommentID, &comment.AuthorUserID, &comment.AuthorDisplayName, &comment.BodyText, &comment.CreatedTimestamp, &comment.EditedTimestamp, &comment.DeletedTimestamp); err != nil {
			_ = rows.Close()
			return NodeV2CommentReplyPage{}, err
		}
		comment.Mentions = []domain.NodeV2CommentMention{}
		page.Items = append(page.Items, comment)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return NodeV2CommentReplyPage{}, err
	}
	if err := rows.Close(); err != nil {
		return NodeV2CommentReplyPage{}, err
	}
	if len(page.Items) > query.Limit {
		oldest := page.Items[query.Limit-1]
		page.Items = page.Items[:query.Limit]
		page.NextCursor = &NodeV2Cursor{Version: 1, Kind: "node_v2_comment_replies", Timestamp: oldest.CreatedTimestamp, ID: oldest.CommentID}
	}

	if len(page.Items) > 0 {
		mentionArgs := []any{query.CompanyID, query.NodeID, query.TextboxID}
		locations := make(map[string]int, len(page.Items))
		for index, comment := range page.Items {
			locations[comment.CommentID] = index
			mentionArgs = append(mentionArgs, comment.CommentID)
		}
		commentIDs := nodeV2UUIDPlaceholders(4, len(page.Items))
		mentionRows, mentionErr := r.db.QueryContext(ctx, `select comment_id::text,principal_type,principal_id::text,principal_display_name from node_textbox_comment_mentions where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid and comment_id in (`+commentIDs+`) order by comment_id,principal_type,principal_display_name,principal_id`, mentionArgs...)
		if mentionErr != nil {
			return NodeV2CommentReplyPage{}, mentionErr
		}
		for mentionRows.Next() {
			var commentID string
			var mention domain.NodeV2CommentMention
			if err := mentionRows.Scan(&commentID, &mention.PrincipalType, &mention.PrincipalID, &mention.PrincipalDisplayName); err != nil {
				_ = mentionRows.Close()
				return NodeV2CommentReplyPage{}, err
			}
			if index, ok := locations[commentID]; ok {
				page.Items[index].Mentions = append(page.Items[index].Mentions, mention)
			}
		}
		if err := mentionRows.Close(); err != nil {
			return NodeV2CommentReplyPage{}, err
		}
	}
	for left, right := 0, len(page.Items)-1; left < right; left, right = left+1, right-1 {
		page.Items[left], page.Items[right] = page.Items[right], page.Items[left]
	}
	return page, nil
}
