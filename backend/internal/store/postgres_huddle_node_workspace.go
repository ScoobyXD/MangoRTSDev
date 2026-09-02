package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

func scanPostgresHuddleNodeTextbox(row interface{ Scan(...any) error }) (HuddleNodeTextbox, error) {
	var item HuddleNodeTextbox
	err := row.Scan(
		&item.CompanyID, &item.HuddleNodeID, &item.TextboxID, &item.Title,
		&item.DisplayOrder, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp,
	)
	return item, err
}

func (r *PostgresRepo) GetHuddleNodeWorkspace(companyID, huddleNodeID string) (HuddleNodeWorkspace, error) {
	companyID = cleanUUIDText(companyID)
	huddleNodeID = cleanUUIDText(huddleNodeID)
	if companyID == "" || huddleNodeID == "" {
		return HuddleNodeWorkspace{}, ErrInvalid
	}
	var exists bool
	if err := r.db.QueryRow(`select exists(select 1 from huddle_nodes where company_id=$1::uuid and huddle_node_id=$2::uuid)`, companyID, huddleNodeID).Scan(&exists); err != nil {
		return HuddleNodeWorkspace{}, err
	}
	if !exists {
		return HuddleNodeWorkspace{}, ErrNotFound
	}
	workspace := HuddleNodeWorkspace{Textboxes: []HuddleNodeTextbox{}, Chats: []HuddleNodeTextboxChat{}}
	rows, err := r.db.Query(`
select company_id::text,huddle_node_id::text,textbox_id::text,title,display_order,revision,created_timestamp,updated_timestamp
from huddle_node_textboxes
where company_id=$1::uuid and huddle_node_id=$2::uuid and deleted_timestamp is null
order by display_order desc,textbox_id desc`, companyID, huddleNodeID)
	if err != nil {
		return HuddleNodeWorkspace{}, err
	}
	for rows.Next() {
		item, scanErr := scanPostgresHuddleNodeTextbox(rows)
		if scanErr != nil {
			rows.Close()
			return HuddleNodeWorkspace{}, scanErr
		}
		workspace.Textboxes = append(workspace.Textboxes, item)
	}
	if err = rows.Close(); err != nil {
		return HuddleNodeWorkspace{}, err
	}
	if err = rows.Err(); err != nil {
		return HuddleNodeWorkspace{}, err
	}

	chatRows, err := r.db.Query(`
select company_id::text,huddle_node_id::text,textbox_id::text,chat_id::text,
       coalesce(parent_chat_id::text,''),selection_quote,selection_start,selection_end,
       coalesce(author_user_id::text,''),author_display_name,message,entity_links::text,
       to_jsonb(mentioned_user_ids)::text,to_jsonb(mentioned_group_ids)::text,
       revision,created_timestamp,updated_timestamp,edited_timestamp
from huddle_node_textbox_chats
where company_id=$1::uuid and huddle_node_id=$2::uuid and deleted_timestamp is null
order by created_timestamp,chat_id`, companyID, huddleNodeID)
	if err != nil {
		return HuddleNodeWorkspace{}, err
	}
	defer chatRows.Close()
	for chatRows.Next() {
		var item HuddleNodeTextboxChat
		var entityLinks, mentionedUsers, mentionedGroups []byte
		if err := chatRows.Scan(
			&item.CompanyID, &item.HuddleNodeID, &item.TextboxID, &item.ChatID,
			&item.ParentChatID, &item.SelectionQuote, &item.SelectionStart, &item.SelectionEnd,
			&item.AuthorUserID, &item.AuthorDisplayName, &item.Message, &entityLinks,
			&mentionedUsers, &mentionedGroups, &item.Revision, &item.CreatedTimestamp,
			&item.UpdatedTimestamp, &item.EditedTimestamp,
		); err != nil {
			return HuddleNodeWorkspace{}, err
		}
		item.EntityLinks = append(json.RawMessage(nil), entityLinks...)
		if err := json.Unmarshal(mentionedUsers, &item.MentionedUserIDs); err != nil {
			return HuddleNodeWorkspace{}, err
		}
		if err := json.Unmarshal(mentionedGroups, &item.MentionedGroupIDs); err != nil {
			return HuddleNodeWorkspace{}, err
		}
		workspace.Chats = append(workspace.Chats, item)
	}
	return workspace, chatRows.Err()
}

func (r *PostgresRepo) CreateHuddleNodeTextbox(input HuddleNodeTextboxCreateInput) (HuddleNodeTextbox, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.HuddleNodeID = cleanUUIDText(input.HuddleNodeID)
	input.TextboxID = cleanUUIDText(input.TextboxID)
	if input.TextboxID == "" {
		input.TextboxID = newUUIDv7String()
	}
	title, err := normalizeHuddleNodeTextboxTitle(input.Title)
	if err != nil || input.CompanyID == "" || input.HuddleNodeID == "" {
		return HuddleNodeTextbox{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return HuddleNodeTextbox{}, err
	}
	defer tx.Rollback()
	var ownerID string
	if err := tx.QueryRowContext(ctx, `select huddle_node_id::text from huddle_nodes where company_id=$1::uuid and huddle_node_id=$2::uuid for key share`, input.CompanyID, input.HuddleNodeID).Scan(&ownerID); errors.Is(err, sql.ErrNoRows) {
		return HuddleNodeTextbox{}, ErrNotFound
	} else if err != nil {
		return HuddleNodeTextbox{}, err
	}
	body := emptyEditorTextboxBody()
	item, err := scanPostgresHuddleNodeTextbox(tx.QueryRowContext(ctx, `
insert into huddle_node_textboxes(company_id,huddle_node_id,textbox_id,title,display_order,body_json)
values($1::uuid,$2::uuid,$3::uuid,$4,
       coalesce((select max(display_order)+1 from huddle_node_textboxes where company_id=$1::uuid and huddle_node_id=$2::uuid),0),
       $5::jsonb)
returning company_id::text,huddle_node_id::text,textbox_id::text,title,display_order,revision,created_timestamp,updated_timestamp`,
		input.CompanyID, input.HuddleNodeID, input.TextboxID, title, body))
	if err != nil {
		return HuddleNodeTextbox{}, mapEditorOwnerTextLimitError(err)
	}
	if err := tx.Commit(); err != nil {
		return HuddleNodeTextbox{}, err
	}
	return item, nil
}

func (r *PostgresRepo) UpsertHuddleNodeTextboxChat(input HuddleNodeTextboxChatInput) (HuddleNodeTextboxChat, error) {
	input, err := normalizeHuddleNodeTextboxChatInput(input)
	if err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	defer tx.Rollback()
	ref := EditorJSONDocumentRef{CompanyID: input.CompanyID, ResourceType: EntityTypeHuddleNode, ResourceID: input.HuddleNodeID}
	if err := lockPostgresHuddleActionItemRelationshipsTx(ctx, tx, ref); err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	var textboxExists bool
	if err := tx.QueryRowContext(ctx, `select exists(
  select 1 from huddle_node_textboxes
  where company_id=$1::uuid and huddle_node_id=$2::uuid and textbox_id=$3::uuid and deleted_timestamp is null
)`, input.CompanyID, input.HuddleNodeID, input.TextboxID).Scan(&textboxExists); err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	if !textboxExists {
		return HuddleNodeTextboxChat{}, ErrNotFound
	}
	var currentRevision int64
	var currentAuthorUserID string
	err = tx.QueryRowContext(ctx, `select revision,coalesce(author_user_id::text,'') from huddle_node_textbox_chats where company_id=$1::uuid and huddle_node_id=$2::uuid and chat_id=$3::uuid for update`, input.CompanyID, input.HuddleNodeID, input.ChatID).Scan(&currentRevision, &currentAuthorUserID)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return HuddleNodeTextboxChat{}, err
	}
	if input.ExpectedRevision == nil {
		if exists {
			return HuddleNodeTextboxChat{}, ErrConflict
		}
	} else {
		if !exists {
			return HuddleNodeTextboxChat{}, ErrNotFound
		}
		if currentAuthorUserID != input.ActorUserID {
			return HuddleNodeTextboxChat{}, ErrNotFound
		}
		if *input.ExpectedRevision != currentRevision {
			return HuddleNodeTextboxChat{}, ErrVersionConflict
		}
	}
	entityLinks := string(input.EntityLinks)
	mentionedUsers, _ := json.Marshal(input.MentionedUserIDs)
	mentionedGroups, _ := json.Marshal(input.MentionedGroupIDs)
	now := time.Now().UTC()
	if exists {
		result, updateErr := tx.ExecContext(ctx, `
update huddle_node_textbox_chats
set message=$4,entity_links=$5::jsonb,
    mentioned_user_ids=array(select jsonb_array_elements_text($6::jsonb)::uuid),
    mentioned_group_ids=array(select jsonb_array_elements_text($7::jsonb)::uuid),
    edited_timestamp=$8,revision=revision+1,updated_timestamp=$8
where company_id=$1::uuid and huddle_node_id=$2::uuid and chat_id=$3::uuid and textbox_id=$9::uuid`,
			input.CompanyID, input.HuddleNodeID, input.ChatID, input.Message, entityLinks,
			string(mentionedUsers), string(mentionedGroups), now, input.TextboxID)
		if updateErr != nil {
			return HuddleNodeTextboxChat{}, updateErr
		}
		affected, updateErr := result.RowsAffected()
		if updateErr != nil {
			return HuddleNodeTextboxChat{}, updateErr
		}
		if affected != 1 {
			return HuddleNodeTextboxChat{}, ErrInvalid
		}
	} else {
		_, err = tx.ExecContext(ctx, `
insert into huddle_node_textbox_chats(
  company_id,chat_id,huddle_node_id,textbox_id,parent_chat_id,
  selection_quote,selection_start,selection_end,author_user_id,author_display_name,
  message,entity_links,mentioned_user_ids,mentioned_group_ids,created_timestamp,updated_timestamp
) values(
  $1::uuid,$2::uuid,$3::uuid,$4::uuid,nullif($5,'')::uuid,
  $6,$7,$8,nullif($9,'')::uuid,$10,$11,$12::jsonb,
  array(select jsonb_array_elements_text($13::jsonb)::uuid),
  array(select jsonb_array_elements_text($14::jsonb)::uuid),$15,$15
)`, input.CompanyID, input.ChatID, input.HuddleNodeID, input.TextboxID, input.ParentChatID,
			input.SelectionQuote, input.SelectionStart, input.SelectionEnd, input.AuthorUserID,
			input.AuthorDisplayName, input.Message, entityLinks, string(mentionedUsers),
			string(mentionedGroups), now)
		if err != nil {
			return HuddleNodeTextboxChat{}, err
		}
	}
	item, err := scanPostgresHuddleNodeTextboxChat(tx.QueryRowContext(ctx, `
select company_id::text,huddle_node_id::text,textbox_id::text,chat_id::text,
       coalesce(parent_chat_id::text,''),selection_quote,selection_start,selection_end,
       coalesce(author_user_id::text,''),author_display_name,message,entity_links::text,
       to_jsonb(mentioned_user_ids)::text,to_jsonb(mentioned_group_ids)::text,
       revision,created_timestamp,updated_timestamp,edited_timestamp
from huddle_node_textbox_chats
where company_id=$1::uuid and huddle_node_id=$2::uuid and chat_id=$3::uuid`, input.CompanyID, input.HuddleNodeID, input.ChatID))
	if err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	if err := r.syncPostgresHuddleActionItemRelationshipsTx(ctx, tx, ref); err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	if err := tx.Commit(); err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	return item, nil
}

func scanPostgresHuddleNodeTextboxChat(row interface{ Scan(...any) error }) (HuddleNodeTextboxChat, error) {
	var item HuddleNodeTextboxChat
	var entityLinks, mentionedUsers, mentionedGroups []byte
	err := row.Scan(
		&item.CompanyID, &item.HuddleNodeID, &item.TextboxID, &item.ChatID,
		&item.ParentChatID, &item.SelectionQuote, &item.SelectionStart, &item.SelectionEnd,
		&item.AuthorUserID, &item.AuthorDisplayName, &item.Message, &entityLinks,
		&mentionedUsers, &mentionedGroups, &item.Revision, &item.CreatedTimestamp,
		&item.UpdatedTimestamp, &item.EditedTimestamp,
	)
	if err != nil {
		return item, err
	}
	item.EntityLinks = append(json.RawMessage(nil), entityLinks...)
	if err := json.Unmarshal(mentionedUsers, &item.MentionedUserIDs); err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	if err := json.Unmarshal(mentionedGroups, &item.MentionedGroupIDs); err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteHuddleNodeTextboxChat(input HuddleNodeTextboxChatDeleteInput) error {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.HuddleNodeID = cleanUUIDText(input.HuddleNodeID)
	input.ChatID = cleanUUIDText(input.ChatID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	if input.CompanyID == "" || input.HuddleNodeID == "" || input.ChatID == "" || input.ActorUserID == "" || input.ExpectedRevision == nil || *input.ExpectedRevision < 0 {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ref := EditorJSONDocumentRef{CompanyID: input.CompanyID, ResourceType: EntityTypeHuddleNode, ResourceID: input.HuddleNodeID}
	if err := lockPostgresHuddleActionItemRelationshipsTx(ctx, tx, ref); err != nil {
		return err
	}
	var currentRevision int64
	var currentAuthorUserID string
	err = tx.QueryRowContext(ctx, `
select revision,coalesce(author_user_id::text,'')
from huddle_node_textbox_chats
where company_id=$1::uuid and huddle_node_id=$2::uuid and chat_id=$3::uuid
for update`, input.CompanyID, input.HuddleNodeID, input.ChatID).Scan(&currentRevision, &currentAuthorUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if currentAuthorUserID != input.ActorUserID {
		return ErrNotFound
	}
	if currentRevision != *input.ExpectedRevision {
		return ErrVersionConflict
	}
	if _, err = tx.ExecContext(ctx, `delete from huddle_node_textbox_chats where company_id=$1::uuid and huddle_node_id=$2::uuid and chat_id=$3::uuid`, input.CompanyID, input.HuddleNodeID, input.ChatID); err != nil {
		return err
	}
	if err := r.syncPostgresHuddleActionItemRelationshipsTx(ctx, tx, ref); err != nil {
		return err
	}
	return tx.Commit()
}
