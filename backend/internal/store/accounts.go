package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func cleanAccountIDs(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		clean := strings.TrimSpace(value)
		if clean == "" || seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
	}
	sort.Strings(out)
	return out
}

func cloneAccountSnapshots(accounts []domain.Account) []domain.Account {
	if len(accounts) == 0 {
		return nil
	}
	out := make([]domain.Account, 0, len(accounts))
	for _, account := range accounts {
		account.FolderID = cloneStringPointer(account.FolderID)
		out = append(out, account)
	}
	return out
}

func sortAccounts(items []domain.Account) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		left := strings.ToLower(strings.TrimSpace(items[i].Name))
		right := strings.ToLower(strings.TrimSpace(items[j].Name))
		if left != right {
			return left < right
		}
		return items[i].AccountID < items[j].AccountID
	})
}

func sortAccountFolders(items []domain.AccountFolder) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		left := strings.ToLower(strings.TrimSpace(items[i].Name))
		right := strings.ToLower(strings.TrimSpace(items[j].Name))
		if left != right {
			return left < right
		}
		return items[i].FolderID < items[j].FolderID
	})
}

func scanAccount(row interface{ Scan(dest ...any) error }) (domain.Account, error) {
	var item domain.Account
	var folderID sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.AccountID,
		&item.Name,
		&folderID,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if folderID.Valid {
		item.FolderID = &folderID.String
	}
	return item, err
}

func scanAccountFolder(row interface{ Scan(dest ...any) error }) (domain.AccountFolder, error) {
	var item domain.AccountFolder
	var parentFolderID sql.NullString
	err := row.Scan(
		&item.CompanyID,
		&item.FolderID,
		&parentFolderID,
		&item.Name,
		&item.Position,
		&item.CreatedTimestamp,
		&item.UpdatedTimestamp,
	)
	if parentFolderID.Valid {
		item.ParentFolderID = &parentFolderID.String
	}
	return item, err
}

func scanNodeAccountAssignment(row interface{ Scan(dest ...any) error }) (domain.NodeAccountAssignment, error) {
	var item domain.NodeAccountAssignment
	err := row.Scan(&item.CompanyID, &item.NodeID, &item.AccountID, &item.AccountName, &item.CreatedTimestamp)
	return item, err
}

func scanAccountSnapshotsJSON(raw sql.NullString) []domain.Account {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return nil
	}
	var accounts []domain.Account
	if err := json.Unmarshal([]byte(raw.String), &accounts); err != nil {
		return nil
	}
	for index := range accounts {
		accounts[index].FolderID = cloneStringPointer(accounts[index].FolderID)
	}
	sortAccounts(accounts)
	if len(accounts) == 0 {
		return nil
	}
	return accounts
}

const postgresAccountSnapshotSQL = `
select coalesce(jsonb_agg(jsonb_build_object(
  'company_id', account.company_id::text,
  'account_id', account.account_id::text,
  'name', account.name,
  'folder_id', account.folder_id::text,
  'position', account.position,
  'created_timestamp', account.created_timestamp,
  'updated_timestamp', account.updated_timestamp
) order by account.position asc, lower(account.name) asc, account.account_id::text asc), '[]'::jsonb) as accounts_json
from node_account_assignments node_account
join accounts account
  on account.company_id=node_account.company_id
 and account.account_id=node_account.account_id`

func postgresAccountSnapshotsForNodeLateralSQL(nodeAlias string) string {
	return `left join lateral (
  ` + postgresAccountSnapshotSQL + `
  where node_account.company_id=` + nodeAlias + `.company_id
    and node_account.node_id=` + nodeAlias + `.node_id
) account_snapshot on true`
}

func postgresEmptyAccountSnapshotSQL() string {
	return `'[]'::jsonb as accounts`
}

type projectionResyncDB interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func postgresAssignedNodeIDsForAccountTx(ctx context.Context, tx *sql.Tx, companyID, accountID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
select node_id::text
from node_account_assignments
where company_id=$1::uuid
  and account_id=$2::uuid
order by node_id::text`, companyID, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodeIDs := []string{}
	for rows.Next() {
		var nodeID string
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		nodeIDs = append(nodeIDs, nodeID)
	}
	return nodeIDs, rows.Err()
}

func (r *PostgresRepo) ListAccounts(companyID string) ([]domain.Account, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select company_id::text, account_id::text, name, folder_id::text, position, created_timestamp, updated_timestamp
from accounts
where company_id=$1::uuid
order by position asc, lower(name) asc, account_id::text asc`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.Account{}
	for rows.Next() {
		item, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) CreateAccount(input AccountInput) (AccountMutationResult, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.AccountID = cleanUUIDText(input.AccountID)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.Name == "" {
		return AccountMutationResult{}, ErrInvalid
	}
	if input.AccountID == "" {
		input.AccountID = newUUIDv7String()
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AccountMutationResult{}, err
	}
	defer tx.Rollback()
	folderID := ""
	if input.FolderID != nil {
		folderID = cleanUUIDText(*input.FolderID)
		if folderID != "" {
			if err := postgresAccountFolderExistsTx(ctx, tx, input.CompanyID, folderID); err != nil {
				return AccountMutationResult{}, err
			}
		}
	}
	item, err := scanAccount(tx.QueryRowContext(ctx, `
insert into accounts (company_id, account_id, name, folder_id, position, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, $3, nullif($4, '')::uuid, $5, now(), now())
returning company_id::text, account_id::text, name, folder_id::text, position, created_timestamp, updated_timestamp`,
		input.CompanyID, input.AccountID, input.Name, folderID, input.Position))
	if err != nil {
		return AccountMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return AccountMutationResult{}, err
	}
	return AccountMutationResult{Account: &item}, nil
}

func (r *PostgresRepo) UpdateAccount(input AccountInput) (AccountMutationResult, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.AccountID = cleanUUIDText(input.AccountID)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.AccountID == "" {
		return AccountMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AccountMutationResult{}, err
	}
	defer tx.Rollback()
	nodeIDs, err := postgresAssignedNodeIDsForAccountTx(ctx, tx, input.CompanyID, input.AccountID)
	if err != nil {
		return AccountMutationResult{}, err
	}
	folderID := ""
	if input.FolderIDSet && input.FolderID != nil {
		folderID = cleanUUIDText(*input.FolderID)
		if folderID != "" {
			if err := postgresAccountFolderExistsTx(ctx, tx, input.CompanyID, folderID); err != nil {
				return AccountMutationResult{}, err
			}
		}
	}
	item, err := scanAccount(tx.QueryRowContext(ctx, `
update accounts
set name = case when $3 <> '' then $3 else name end,
    folder_id = case when $4 then nullif($5, '')::uuid else folder_id end,
    position = case when $6 then $7 else position end,
    updated_timestamp = now()
where company_id=$1::uuid
  and account_id=$2::uuid
returning company_id::text, account_id::text, name, folder_id::text, position, created_timestamp, updated_timestamp`,
		input.CompanyID, input.AccountID, input.Name, input.FolderIDSet, folderID, input.PositionSet, input.Position))
	if errors.Is(err, sql.ErrNoRows) {
		return AccountMutationResult{}, ErrNotFound
	}
	if err != nil {
		return AccountMutationResult{}, err
	}
	err = syncNodeProjectionDependenciesForNodesTx(ctx, tx, input.CompanyID, nodeIDs)
	if err != nil {
		return AccountMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return AccountMutationResult{}, err
	}
	return AccountMutationResult{Account: &item}, nil
}

func (r *PostgresRepo) DeleteAccount(companyID, accountID, actorUserID string) (AccountMutationResult, error) {
	companyID = cleanUUIDText(companyID)
	accountID = cleanUUIDText(accountID)
	if companyID == "" || accountID == "" {
		return AccountMutationResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AccountMutationResult{}, err
	}
	defer tx.Rollback()
	nodeIDs, err := postgresAssignedNodeIDsForAccountTx(ctx, tx, companyID, accountID)
	if err != nil {
		return AccountMutationResult{}, err
	}
	result, err := tx.ExecContext(ctx, `delete from accounts where company_id=$1::uuid and account_id=$2::uuid`, companyID, accountID)
	if err != nil {
		return AccountMutationResult{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return AccountMutationResult{}, err
	}
	if affected == 0 {
		return AccountMutationResult{}, ErrNotFound
	}
	err = syncNodeProjectionDependenciesForNodesTx(ctx, tx, companyID, nodeIDs)
	if err != nil {
		return AccountMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return AccountMutationResult{}, err
	}
	return AccountMutationResult{DeletedAccountID: accountID}, nil
}

func (r *PostgresRepo) ListAccountFolders(companyID string) ([]domain.AccountFolder, error) {
	companyID = cleanUUIDText(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select company_id::text, folder_id::text, parent_folder_id::text, name, position, created_timestamp, updated_timestamp
from account_folders
where company_id=$1::uuid
order by position asc, lower(name) asc, folder_id::text`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.AccountFolder{}
	for rows.Next() {
		item, err := scanAccountFolder(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func postgresAccountFolderExistsTx(ctx context.Context, tx *sql.Tx, companyID, folderID string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `
select exists(select 1 from account_folders where company_id=$1::uuid and folder_id=$2::uuid)`, companyID, folderID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func postgresAccountFolderParentValidTx(ctx context.Context, tx *sql.Tx, companyID, folderID, parentFolderID string) error {
	parentFolderID = cleanUUIDText(parentFolderID)
	if parentFolderID == "" {
		return nil
	}
	if parentFolderID == folderID {
		return ErrInvalid
	}
	if err := postgresAccountFolderExistsTx(ctx, tx, companyID, parentFolderID); err != nil {
		return err
	}
	if folderID == "" {
		return nil
	}
	var descendent bool
	if err := tx.QueryRowContext(ctx, `
with recursive subtree as (
  select company_id, folder_id
  from account_folders
  where company_id=$1::uuid and folder_id=$2::uuid
  union all
  select child.company_id, child.folder_id
  from account_folders child
  join subtree parent on parent.company_id=child.company_id and parent.folder_id=child.parent_folder_id
)
select exists(select 1 from subtree where folder_id=$3::uuid)`, companyID, folderID, parentFolderID).Scan(&descendent); err != nil {
		return err
	}
	if descendent {
		return ErrInvalid
	}
	return nil
}

func (r *PostgresRepo) CreateAccountFolder(input AccountFolderInput) (domain.AccountFolder, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.FolderID = cleanUUIDText(input.FolderID)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.Name == "" {
		return domain.AccountFolder{}, ErrInvalid
	}
	if input.FolderID == "" {
		input.FolderID = newUUIDv7String()
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AccountFolder{}, err
	}
	defer tx.Rollback()
	parentFolderID := ""
	if input.ParentFolderID != nil {
		parentFolderID = cleanUUIDText(*input.ParentFolderID)
		if err := postgresAccountFolderParentValidTx(ctx, tx, input.CompanyID, "", parentFolderID); err != nil {
			return domain.AccountFolder{}, err
		}
	}
	item, err := scanAccountFolder(tx.QueryRowContext(ctx, `
insert into account_folders (company_id, folder_id, parent_folder_id, name, position, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, nullif($3, '')::uuid, $4, $5, now(), now())
returning company_id::text, folder_id::text, parent_folder_id::text, name, position, created_timestamp, updated_timestamp`,
		input.CompanyID, input.FolderID, parentFolderID, input.Name, input.Position))
	if err != nil {
		return domain.AccountFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.AccountFolder{}, err
	}
	return item, nil
}

func (r *PostgresRepo) UpdateAccountFolder(input AccountFolderInput) (domain.AccountFolder, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.FolderID = cleanUUIDText(input.FolderID)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.FolderID == "" {
		return domain.AccountFolder{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AccountFolder{}, err
	}
	defer tx.Rollback()
	parentFolderID := ""
	if input.ParentFolderIDSet && input.ParentFolderID != nil {
		parentFolderID = cleanUUIDText(*input.ParentFolderID)
		if err := postgresAccountFolderParentValidTx(ctx, tx, input.CompanyID, input.FolderID, parentFolderID); err != nil {
			return domain.AccountFolder{}, err
		}
	}
	item, err := scanAccountFolder(tx.QueryRowContext(ctx, `
update account_folders
set parent_folder_id = case when $3 then nullif($4, '')::uuid else parent_folder_id end,
    name = case when $5 <> '' then $5 else name end,
    position = case when $6 then $7 else position end,
    updated_timestamp = now()
where company_id=$1::uuid and folder_id=$2::uuid
returning company_id::text, folder_id::text, parent_folder_id::text, name, position, created_timestamp, updated_timestamp`,
		input.CompanyID, input.FolderID, input.ParentFolderIDSet, parentFolderID, input.Name, input.PositionSet, input.Position))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AccountFolder{}, ErrNotFound
	}
	if err != nil {
		return domain.AccountFolder{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.AccountFolder{}, err
	}
	return item, nil
}

func (r *PostgresRepo) DeleteAccountFolder(companyID, folderID string) error {
	companyID = cleanUUIDText(companyID)
	folderID = cleanUUIDText(folderID)
	if companyID == "" || folderID == "" {
		return ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
update account_folders set parent_folder_id=null, updated_timestamp=now()
where company_id=$1::uuid and parent_folder_id=$2::uuid`, companyID, folderID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
update accounts set folder_id=null, updated_timestamp=now()
where company_id=$1::uuid and folder_id=$2::uuid`, companyID, folderID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `delete from account_folders where company_id=$1::uuid and folder_id=$2::uuid`, companyID, folderID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (r *PostgresRepo) ListNodeAccountAssignments(companyID, nodeID string) ([]domain.NodeAccountAssignment, error) {
	companyID = cleanUUIDText(companyID)
	nodeID = cleanUUIDText(nodeID)
	if companyID == "" || nodeID == "" {
		return nil, ErrInvalid
	}
	rows, err := r.db.QueryContext(context.Background(), `
select assignment.company_id::text, assignment.node_id::text, assignment.account_id::text, account.name, assignment.created_timestamp
from node_account_assignments assignment
join accounts account on account.company_id=assignment.company_id and account.account_id=assignment.account_id
where assignment.company_id=$1::uuid
  and assignment.node_id=$2::uuid
order by account.position asc, lower(account.name) asc, account.account_id::text`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.NodeAccountAssignment{}
	for rows.Next() {
		item, err := scanNodeAccountAssignment(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) SetNodeAccountAssignments(input NodeAccountAssignmentUpdateInput) (NodeAccountAssignmentUpdateResult, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.NodeID = cleanUUIDText(input.NodeID)
	input.AccountIDs = cleanAccountIDs(input.AccountIDs)
	if input.CompanyID == "" || input.NodeID == "" {
		return NodeAccountAssignmentUpdateResult{}, ErrInvalid
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeAccountAssignmentUpdateResult{}, err
	}
	defer tx.Rollback()

	beforeNode, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1::uuid and n.node_id=$2::uuid`, input.CompanyID, input.NodeID))
	if errors.Is(err, sql.ErrNoRows) {
		return NodeAccountAssignmentUpdateResult{}, ErrNotFound
	}
	if err != nil {
		return NodeAccountAssignmentUpdateResult{}, err
	}
	for _, accountID := range input.AccountIDs {
		var exists bool
		if err := tx.QueryRowContext(ctx, `select exists(select 1 from accounts where company_id=$1::uuid and account_id=$2::uuid)`, input.CompanyID, accountID).Scan(&exists); err != nil {
			return NodeAccountAssignmentUpdateResult{}, err
		}
		if !exists {
			return NodeAccountAssignmentUpdateResult{}, ErrNotFound
		}
	}
	if _, err := tx.ExecContext(ctx, `delete from node_account_assignments where company_id=$1::uuid and node_id=$2::uuid`, input.CompanyID, input.NodeID); err != nil {
		return NodeAccountAssignmentUpdateResult{}, err
	}
	for _, accountID := range input.AccountIDs {
		if _, err := tx.ExecContext(ctx, `
insert into node_account_assignments (company_id, node_id, account_id, created_timestamp)
values ($1::uuid, $2::uuid, $3::uuid, now())
on conflict (company_id, node_id, account_id) do nothing`, input.CompanyID, input.NodeID, accountID); err != nil {
			return NodeAccountAssignmentUpdateResult{}, err
		}
	}
	err = syncNodeProjectionDependenciesTx(ctx, tx, NodeProjectionDependencyInput{
		CompanyID: input.CompanyID,
		NodeID:    input.NodeID,
	})
	if err != nil {
		return NodeAccountAssignmentUpdateResult{}, err
	}
	afterNode, err := scanNode(tx.QueryRowContext(ctx, `
select `+nodeSelectColumns+`
from nodes n
`+nodeStatusJoin+`
where n.company_id=$1::uuid and n.node_id=$2::uuid`, input.CompanyID, input.NodeID))
	if err != nil {
		return NodeAccountAssignmentUpdateResult{}, err
	}
	assignments, err := listNodeAccountAssignmentsTx(ctx, tx, input.CompanyID, input.NodeID)
	if err != nil {
		return NodeAccountAssignmentUpdateResult{}, err
	}
	eventInput := nodeUpdatedWorkspaceEventInput(afterNode)
	eventInput.ActorUserID = strings.TrimSpace(input.ActorUserID)
	eventInput.Payload["node_title"] = strings.TrimSpace(afterNode.Title)
	eventInput.Payload["accounts_changed"] = true
	event, err := r.appendDomainEventTx(ctx, tx, eventInput)
	if err != nil {
		return NodeAccountAssignmentUpdateResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return NodeAccountAssignmentUpdateResult{}, err
	}
	_ = beforeNode
	return NodeAccountAssignmentUpdateResult{
		Node:        afterNode,
		Assignments: assignments,
		Events:      []domain.DomainEvent{event},
	}, nil
}

func listNodeAccountAssignmentsTx(ctx context.Context, tx *sql.Tx, companyID, nodeID string) ([]domain.NodeAccountAssignment, error) {
	rows, err := tx.QueryContext(ctx, `
select assignment.company_id::text, assignment.node_id::text, assignment.account_id::text, account.name, assignment.created_timestamp
from node_account_assignments assignment
join accounts account on account.company_id=assignment.company_id and account.account_id=assignment.account_id
where assignment.company_id=$1::uuid
  and assignment.node_id=$2::uuid
order by account.position asc, lower(account.name) asc, account.account_id::text`, companyID, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.NodeAccountAssignment{}
	for rows.Next() {
		item, err := scanNodeAccountAssignment(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func accountFolderIDValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func nowUTC() time.Time {
	return time.Now().UTC()
}
