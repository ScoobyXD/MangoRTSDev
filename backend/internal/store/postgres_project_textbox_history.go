package store

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

const (
	projectSavedVersionType   = "Saved version"
	projectSavedVersionPrefix = "MANGO_PROJECT_SAVE_V1:"
)

type projectTextboxHistoryRequest struct {
	Blocks []projectTextboxHistoryBlock `json:"blocks"`
}

type projectTextboxHistoryBlock struct {
	ID               string          `json:"id"`
	Title            string          `json:"title"`
	Document         string          `json:"document"`
	Attachments      json.RawMessage `json:"attachments"`
	CreatedTimestamp string          `json:"createdTimestamp"`
	UpdatedTimestamp string          `json:"updatedTimestamp"`
}

type projectTextboxHistoryMetadata struct {
	Title            string          `json:"title"`
	Attachments      json.RawMessage `json:"attachments"`
	CreatedTimestamp string          `json:"createdTimestamp"`
	UpdatedTimestamp string          `json:"updatedTimestamp"`
}

func parseProjectTextboxHistoryRequest(information string) (map[string]projectTextboxHistoryMetadata, error) {
	if !strings.HasPrefix(information, projectSavedVersionPrefix) {
		return nil, ErrInvalid
	}
	var request projectTextboxHistoryRequest
	if json.Unmarshal([]byte(strings.TrimPrefix(information, projectSavedVersionPrefix)), &request) != nil {
		return nil, ErrInvalid
	}
	metadata := make(map[string]projectTextboxHistoryMetadata, len(request.Blocks))
	for _, block := range request.Blocks {
		id := strings.TrimSpace(block.ID)
		if id == "" {
			return nil, ErrInvalid
		}
		attachments := block.Attachments
		if len(attachments) == 0 {
			attachments = json.RawMessage("[]")
		}
		metadata[id] = projectTextboxHistoryMetadata{
			Title: strings.TrimSpace(block.Title), Attachments: attachments,
			CreatedTimestamp: strings.TrimSpace(block.CreatedTimestamp),
			UpdatedTimestamp: strings.TrimSpace(block.UpdatedTimestamp),
		}
	}
	return metadata, nil
}

func projectHistoryBodyWithMetadata(body json.RawMessage, metadata projectTextboxHistoryMetadata) (json.RawMessage, error) {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(body, &envelope) != nil {
		return nil, ErrInvalid
	}
	encodedMetadata, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	envelope["history_metadata"] = encodedMetadata
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func decodeProjectHistoryBody(body json.RawMessage) (json.RawMessage, projectTextboxHistoryMetadata, error) {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(body, &envelope) != nil {
		return nil, projectTextboxHistoryMetadata{}, ErrInvalid
	}
	var metadata projectTextboxHistoryMetadata
	if raw := envelope["history_metadata"]; len(raw) != 0 {
		if json.Unmarshal(raw, &metadata) != nil {
			return nil, projectTextboxHistoryMetadata{}, ErrInvalid
		}
	}
	delete(envelope, "history_metadata")
	withoutMetadata, err := json.Marshal(envelope)
	if err != nil {
		return nil, projectTextboxHistoryMetadata{}, err
	}
	document, _, err := decodeEditorTextboxBody(withoutMetadata)
	return document, metadata, err
}

func encodeProjectSavedVersionInformation(projectName string, blocks []projectTextboxHistoryBlock) (string, error) {
	payload := struct {
		Name   string                       `json:"name"`
		Blocks []projectTextboxHistoryBlock `json:"blocks"`
	}{Name: projectName, Blocks: blocks}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return projectSavedVersionPrefix + string(encoded), nil
}

func (r *PostgresRepo) addProjectTextboxHistory(input ProjectInformationInput) (domain.ProjectInformation, error) {
	metadata, err := parseProjectTextboxHistoryRequest(input.Information)
	if err != nil {
		return domain.ProjectInformation{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ProjectInformation{}, err
	}
	defer tx.Rollback()
	var projectName string
	if err := tx.QueryRowContext(ctx, `select name from projects where company_id=$1::uuid and project_id=$2::uuid`,
		input.CompanyID, input.ProjectID).Scan(&projectName); err != nil {
		return domain.ProjectInformation{}, err
	}
	rows, err := tx.QueryContext(ctx, `select textbox_id,body_json,display_order,created_timestamp,updated_timestamp
		from project_textboxes where company_id=$1::uuid and project_id=$2::uuid and deleted_timestamp is null
		order by display_order,textbox_id`, input.CompanyID, input.ProjectID)
	if err != nil {
		return domain.ProjectInformation{}, err
	}
	type currentRow struct {
		textboxID string
		body      []byte
		display   int64
		created   time.Time
		updated   time.Time
	}
	current := make([]currentRow, 0)
	for rows.Next() {
		var row currentRow
		if err := rows.Scan(&row.textboxID, &row.body, &row.display, &row.created, &row.updated); err != nil {
			rows.Close()
			return domain.ProjectInformation{}, err
		}
		current = append(current, row)
	}
	if err := rows.Close(); err != nil {
		return domain.ProjectInformation{}, err
	}
	if len(current) == 0 {
		return domain.ProjectInformation{}, ErrInvalid
	}
	batchID, savedAt := newUUIDv7String(), time.Now().UTC()
	blocks := make([]projectTextboxHistoryBlock, 0, len(current))
	for _, row := range current {
		itemMetadata := metadata[row.textboxID]
		if itemMetadata.CreatedTimestamp == "" {
			itemMetadata.CreatedTimestamp = row.created.UTC().Format(time.RFC3339Nano)
		}
		if itemMetadata.UpdatedTimestamp == "" {
			itemMetadata.UpdatedTimestamp = row.updated.UTC().Format(time.RFC3339Nano)
		}
		if len(itemMetadata.Attachments) == 0 {
			itemMetadata.Attachments = json.RawMessage("[]")
		}
		historyBody, err := projectHistoryBodyWithMetadata(row.body, itemMetadata)
		if err != nil {
			return domain.ProjectInformation{}, err
		}
		if _, err := tx.ExecContext(ctx, `insert into project_textboxes_history(
			company_id,project_id,textbox_id,batch_id,body_json,display_order,saved_by_user_id,saved_timestamp
		) values($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb,$6,nullif($7,'')::uuid,$8)`,
			input.CompanyID, input.ProjectID, row.textboxID, batchID, historyBody,
			row.display, cleanUUIDText(input.ActorUserID), savedAt); err != nil {
			return domain.ProjectInformation{}, err
		}
		document, _, err := decodeProjectHistoryBody(historyBody)
		if err != nil {
			return domain.ProjectInformation{}, err
		}
		blocks = append(blocks, projectTextboxHistoryBlock{
			ID: row.textboxID, Title: itemMetadata.Title, Document: string(document),
			Attachments: itemMetadata.Attachments, CreatedTimestamp: itemMetadata.CreatedTimestamp,
			UpdatedTimestamp: itemMetadata.UpdatedTimestamp,
		})
	}
	information, err := encodeProjectSavedVersionInformation(projectName, blocks)
	if err != nil {
		return domain.ProjectInformation{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ProjectInformation{}, err
	}
	return domain.ProjectInformation{
		CompanyID: input.CompanyID, ProjectID: input.ProjectID, InformationID: batchID,
		Type: projectSavedVersionType, Information: information,
		CreatedTimestamp: savedAt, UpdatedTimestamp: savedAt,
	}, nil
}

func (r *PostgresRepo) listProjectTextboxHistory(companyID, projectID string) ([]domain.ProjectInformation, error) {
	rows, err := r.db.QueryContext(context.Background(), `select history.batch_id::text,history.textbox_id,
		history.body_json,history.saved_timestamp,project.name
		from project_textboxes_history history
		join projects project on project.company_id=history.company_id and project.project_id=history.project_id
		where history.company_id=$1::uuid and history.project_id=$2::uuid
		order by history.saved_timestamp asc,history.batch_id,history.display_order,history.textbox_id`, companyID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type batch struct {
		name    string
		savedAt time.Time
		blocks  []projectTextboxHistoryBlock
	}
	batches := map[string]*batch{}
	order := make([]string, 0)
	for rows.Next() {
		var batchID, textboxID, projectName string
		var body []byte
		var savedAt time.Time
		if err := rows.Scan(&batchID, &textboxID, &body, &savedAt, &projectName); err != nil {
			return nil, err
		}
		document, metadata, err := decodeProjectHistoryBody(body)
		if err != nil {
			return nil, err
		}
		current := batches[batchID]
		if current == nil {
			current = &batch{name: projectName, savedAt: savedAt, blocks: []projectTextboxHistoryBlock{}}
			batches[batchID] = current
			order = append(order, batchID)
		}
		current.blocks = append(current.blocks, projectTextboxHistoryBlock{
			ID: textboxID, Title: metadata.Title, Document: string(document),
			Attachments: metadata.Attachments, CreatedTimestamp: metadata.CreatedTimestamp,
			UpdatedTimestamp: metadata.UpdatedTimestamp,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(order, func(i, j int) bool { return batches[order[i]].savedAt.Before(batches[order[j]].savedAt) })
	result := make([]domain.ProjectInformation, 0, len(order))
	for _, batchID := range order {
		current := batches[batchID]
		information, err := encodeProjectSavedVersionInformation(current.name, current.blocks)
		if err != nil {
			return nil, err
		}
		result = append(result, domain.ProjectInformation{
			CompanyID: companyID, ProjectID: projectID, InformationID: batchID,
			Type: projectSavedVersionType, Information: information,
			CreatedTimestamp: current.savedAt, UpdatedTimestamp: current.savedAt,
		})
	}
	return result, nil
}
