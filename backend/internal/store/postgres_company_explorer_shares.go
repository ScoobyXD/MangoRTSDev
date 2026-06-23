package store

import (
	"context"
	"database/sql"
	"miraeopus/backend/internal/domain"
	"strings"
)

func (r *PostgresRepo) ListCompanyExplorerFolderShares(companyID, folderID string) ([]domain.CompanyExplorerFolderShare, error) {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return nil, ErrInvalid
	}

	var folderExists bool
	if err := r.db.QueryRow(
		`select exists(select 1 from company_explorer_folders where company_id=$1 and folder_id=$2)`,
		companyID,
		folderID,
	).Scan(&folderExists); err != nil {
		return nil, err
	}
	if !folderExists {
		return nil, ErrNotFound
	}

	rows, err := r.db.Query(
		`select company_id, folder_id, email, user_id, status, invited_by_user_id, created_timestamp, updated_timestamp
		 from company_explorer_folder_shares
		 where company_id=$1 and folder_id=$2
		 order by status asc, email asc`,
		companyID,
		folderID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyExplorerFolderShare, 0)
	for rows.Next() {
		share, err := scanCompanyExplorerFolderShare(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, share)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UpsertCompanyExplorerFolderShare(input CompanyExplorerFolderShareInput) (domain.CompanyExplorerFolderShare, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	folderID := strings.TrimSpace(input.FolderID)
	email := normalizeEmail(input.Email)
	userID := strings.TrimSpace(input.UserID)
	invitedByUserID := strings.TrimSpace(input.InvitedByUserID)
	if companyID == "" || folderID == "" || email == "" || invitedByUserID == "" {
		return domain.CompanyExplorerFolderShare{}, ErrInvalid
	}
	var userParam any
	status := "pending"
	if userID != "" {
		userParam = userID
		status = "active"
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyExplorerFolderShare{}, err
	}
	defer tx.Rollback()

	var folderExists bool
	if err := tx.QueryRowContext(ctx,
		`select exists(select 1 from company_explorer_folders where company_id=$1 and folder_id=$2)`,
		companyID,
		folderID,
	).Scan(&folderExists); err != nil {
		return domain.CompanyExplorerFolderShare{}, err
	}
	if !folderExists {
		return domain.CompanyExplorerFolderShare{}, ErrNotFound
	}
	if userID != "" {
		var membershipExists bool
		if err := tx.QueryRowContext(ctx,
			`select exists(select 1 from company_memberships where company_id=$1 and user_id=$2)`,
			companyID,
			userID,
		).Scan(&membershipExists); err != nil {
			return domain.CompanyExplorerFolderShare{}, err
		}
		if !membershipExists {
			return domain.CompanyExplorerFolderShare{}, ErrNotFound
		}
	}

	row := tx.QueryRowContext(ctx,
		`insert into company_explorer_folder_shares
		   (company_id, folder_id, email, user_id, status, invited_by_user_id, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, $5, $6, now(), now())
		 on conflict (company_id, folder_id, email) do update set
		   user_id = excluded.user_id,
		   status = excluded.status,
		   invited_by_user_id = excluded.invited_by_user_id,
		   updated_timestamp = now()
		 returning company_id, folder_id, email, user_id, status, invited_by_user_id, created_timestamp, updated_timestamp`,
		companyID,
		folderID,
		email,
		userParam,
		status,
		invitedByUserID,
	)
	share, err := scanCompanyExplorerFolderShare(row)
	if err != nil {
		return domain.CompanyExplorerFolderShare{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyExplorerFolderShare{}, err
	}
	return share, nil
}

func (r *PostgresRepo) DeleteCompanyExplorerFolderShare(companyID, folderID, email string) error {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	email = normalizeEmail(email)
	if companyID == "" || folderID == "" || email == "" {
		return ErrInvalid
	}
	result, err := r.db.Exec(
		`delete from company_explorer_folder_shares
		 where company_id=$1 and folder_id=$2 and email=$3`,
		companyID,
		folderID,
		email,
	)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

type companyExplorerFolderShareScanner interface {
	Scan(dest ...any) error
}

func scanCompanyExplorerFolderShare(row companyExplorerFolderShareScanner) (domain.CompanyExplorerFolderShare, error) {
	var share domain.CompanyExplorerFolderShare
	var userID sql.NullString
	err := row.Scan(
		&share.CompanyID,
		&share.FolderID,
		&share.Email,
		&userID,
		&share.Status,
		&share.InvitedByUserID,
		&share.CreatedTimestamp,
		&share.UpdatedTimestamp,
	)
	if err != nil {
		return domain.CompanyExplorerFolderShare{}, err
	}
	if userID.Valid {
		share.UserID = &userID.String
	}
	return share, nil
}
