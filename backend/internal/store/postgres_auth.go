package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

const (
	postgresAuthLockTimeoutSQL      = `set local lock_timeout = '1s'`
	postgresAuthStatementTimeoutSQL = `set local statement_timeout = '4s'`
	postgresAuthTransactionTimeout  = 5 * time.Second
)

func configurePostgresAuthTimeouts(ctx context.Context, tx *sql.Tx) error {
	for _, statement := range []string{
		postgresAuthLockTimeoutSQL,
		postgresAuthStatementTimeoutSQL,
	} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func commitPostgresAuthTx(ctx context.Context, tx *sql.Tx) error {
	err := tx.Commit()
	if err == nil {
		return nil
	}
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	return err
}

func lockPostgresCompanyMembershipCompanySetTx(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `select pg_advisory_xact_lock(hashtextextended('company-membership-company-set',0))`)
	return err
}

func postgresMembershipAffectedCompanyIDsTx(ctx context.Context, tx *sql.Tx, fallbackCompanyIDs []string, globalAccessChanged bool) ([]string, error) {
	if !globalAccessChanged {
		return append([]string(nil), fallbackCompanyIDs...), nil
	}
	if err := lockPostgresCompanyMembershipCompanySetTx(ctx, tx); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `select company_id::text from companies order by company_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	companyIDs := []string{}
	for rows.Next() {
		var companyID string
		if err := rows.Scan(&companyID); err != nil {
			return nil, err
		}
		companyIDs = append(companyIDs, companyID)
	}
	return companyIDs, rows.Err()
}

func postgresUserMembershipCompanyIDsTx(ctx context.Context, tx *sql.Tx, userID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `select company_id::text from company_memberships where user_id=$1::uuid order by company_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	companyIDs := []string{}
	for rows.Next() {
		var companyID string
		if err := rows.Scan(&companyID); err != nil {
			return nil, err
		}
		companyIDs = append(companyIDs, companyID)
	}
	return companyIDs, rows.Err()
}

func (r *PostgresRepo) UpsertAuthUser(cognitoSubject, email, displayName string) (domain.User, error) {
	return r.UpsertAuthUserContext(context.Background(), cognitoSubject, email, displayName)
}

func (r *PostgresRepo) ResolveAuthUserContext(ctx context.Context, cognitoSubject, email, displayName string) (domain.User, error) {
	user, err := r.GetAuthUserContext(ctx, cognitoSubject)
	if err == nil && !authUserNeedsClaimRefresh(user, email, displayName) {
		return user, nil
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return domain.User{}, err
	}
	return r.UpsertAuthUserContext(ctx, cognitoSubject, email, displayName)
}

func (r *PostgresRepo) UpsertAuthUserContext(ctx context.Context, cognitoSubject, email, displayName string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = normalizeEmail(email)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}
	insertDisplayName := authInsertDisplayName(cognitoSubject, email, displayName)
	updateDisplayName := authoritativeAuthDisplayName(displayName, email)

	txContext, cancel := context.WithTimeout(ctx, postgresAuthTransactionTimeout)
	defer cancel()
	tx, err := r.db.BeginTx(txContext, nil)
	if err != nil {
		return domain.User{}, err
	}
	defer tx.Rollback()
	if err := configurePostgresAuthTimeouts(txContext, tx); err != nil {
		return domain.User{}, err
	}
	if _, err := tx.ExecContext(txContext, `select pg_advisory_xact_lock(hashtextextended('auth-user:' || $1, 0))`, cognitoSubject); err != nil {
		return domain.User{}, err
	}

	var user domain.User
	err = tx.QueryRowContext(txContext, `
select user_id::text, cognito_subject, email, display_name, created_timestamp, updated_timestamp
from users
where cognito_subject=$1
for update`, cognitoSubject).Scan(
		&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName,
		&user.CreatedTimestamp, &user.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		err = tx.QueryRowContext(txContext, `
insert into users (user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp)
values ($1::uuid, $2, $3, $4, now(), now())
returning user_id::text, cognito_subject, email, display_name, created_timestamp, updated_timestamp`,
			newUUIDv7String(), cognitoSubject, email, insertDisplayName,
		).Scan(
			&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName,
			&user.CreatedTimestamp, &user.UpdatedTimestamp,
		)
		if err != nil {
			return domain.User{}, err
		}
		if err := commitPostgresAuthTx(txContext, tx); err != nil {
			return domain.User{}, err
		}
		return user, nil
	}
	if err != nil {
		return domain.User{}, err
	}

	updatedEmail := user.Email
	if email != "" {
		updatedEmail = email
	}
	updatedDisplayName := user.DisplayName
	if updateDisplayName != "" {
		updatedDisplayName = updateDisplayName
	}
	if updatedEmail == user.Email && updatedDisplayName == user.DisplayName {
		if err := commitPostgresAuthTx(txContext, tx); err != nil {
			return domain.User{}, err
		}
		return user, nil
	}
	err = tx.QueryRowContext(txContext, `
update users
set email=$2, display_name=$3, updated_timestamp=now()
where user_id=$1::uuid
returning user_id::text, cognito_subject, email, display_name, created_timestamp, updated_timestamp`,
		user.UserID, updatedEmail, updatedDisplayName,
	).Scan(
		&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName,
		&user.CreatedTimestamp, &user.UpdatedTimestamp,
	)
	if err != nil {
		return domain.User{}, err
	}
	companyIDs, err := postgresUserMembershipCompanyIDsTx(txContext, tx, user.UserID)
	if err != nil {
		return domain.User{}, err
	}
	if _, err := r.appendDomainEventsTx(txContext, tx, companyMembershipEventInputs(companyIDs, CompanyUserProfileUpdatedEventType, user.UserID)); err != nil {
		return domain.User{}, err
	}
	if err := commitPostgresAuthTx(txContext, tx); err != nil {
		return domain.User{}, err
	}
	return user, nil
}

func (r *PostgresRepo) GetAuthUser(cognitoSubject string) (domain.User, error) {
	return r.GetAuthUserContext(context.Background(), cognitoSubject)
}

func (r *PostgresRepo) GetAuthUserContext(ctx context.Context, cognitoSubject string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}

	var user domain.User
	err := r.db.QueryRowContext(ctx,
		`select user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp
		 from users
		 where cognito_subject = $1`,
		cognitoSubject,
	).Scan(&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName, &user.CreatedTimestamp, &user.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.User{}, ErrNotFound
	}
	return user, err
}

func (r *PostgresRepo) GetAuthUserByEmail(email string) (domain.User, error) {
	email = normalizeEmail(email)
	if email == "" {
		return domain.User{}, ErrInvalid
	}

	var user domain.User
	err := r.db.QueryRow(
		`select user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp
		 from users
		 where email = $1`,
		email,
	).Scan(&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName, &user.CreatedTimestamp, &user.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.User{}, ErrNotFound
	}
	return user, err
}

func (r *PostgresRepo) ListUserMemberships(userID string) ([]domain.CompanyMembership, error) {
	return r.ListUserMembershipsContext(context.Background(), userID)
}

func (r *PostgresRepo) ListUserMembershipsContext(ctx context.Context, userID string) ([]domain.CompanyMembership, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.QueryContext(ctx,
		`select cm.company_id, c.name, cm.user_id, cm.role, cm.created_timestamp, cm.updated_timestamp
		 from company_memberships cm
		 join companies c on c.company_id = cm.company_id
		 where cm.user_id = $1
		 order by c.name, cm.company_id`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyMembership, 0)
	for rows.Next() {
		var item domain.CompanyMembership
		if err := rows.Scan(&item.CompanyID, &item.CompanyName, &item.UserID, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) UserHasCompanyAccess(cognitoSubject, companyID string) (bool, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	companyID = strings.TrimSpace(companyID)
	if cognitoSubject == "" || companyID == "" {
		return false, ErrInvalid
	}

	var ok bool
	err := r.db.QueryRow(
		`select exists(
		   select 1
		   from users u
		   join company_memberships cm on cm.user_id = u.user_id
		   where u.cognito_subject = $1
		     and (cm.company_id = $2 or cm.role = 'dev_admin')
		 )`,
		cognitoSubject,
		companyID,
	).Scan(&ok)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return ok, err
}

func (r *PostgresRepo) AddCompanyMembership(cognitoSubject, companyID, role string) (domain.CompanyMembership, error) {
	return r.AddCompanyMembershipContext(context.Background(), cognitoSubject, companyID, role)
}

func (r *PostgresRepo) AddCompanyMembershipContext(ctx context.Context, cognitoSubject, companyID, role string) (domain.CompanyMembership, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	companyID = strings.TrimSpace(companyID)
	normalizedRole, ok := normalizeRole(role)
	if cognitoSubject == "" || companyID == "" || !ok {
		return domain.CompanyMembership{}, ErrInvalid
	}

	txContext, cancel := context.WithTimeout(ctx, postgresAuthTransactionTimeout)
	defer cancel()
	tx, err := r.db.BeginTx(txContext, nil)
	if err != nil {
		return domain.CompanyMembership{}, err
	}
	defer tx.Rollback()
	if err := configurePostgresAuthTimeouts(txContext, tx); err != nil {
		return domain.CompanyMembership{}, err
	}

	var userID string
	err = tx.QueryRowContext(txContext, `
select user_id::text
from users
where cognito_subject=$1
for update`, cognitoSubject).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyMembership{}, ErrNotFound
	}
	if err != nil {
		return domain.CompanyMembership{}, err
	}
	var existingRole string
	var hadGlobalAccess, hasOtherGlobalAccess bool
	err = tx.QueryRowContext(txContext, `
select coalesce((
         select target_membership.role
         from company_memberships target_membership
         where target_membership.user_id=$1::uuid
           and target_membership.company_id=$2::uuid
       ), ''),
       exists (
         select 1
         from company_memberships dev_membership
         where dev_membership.user_id=$1::uuid
           and dev_membership.role='dev_admin'
       ),
       exists (
         select 1
         from company_memberships dev_membership
         where dev_membership.user_id=$1::uuid
           and dev_membership.company_id<>$2::uuid
           and dev_membership.role='dev_admin'
       )`, userID, companyID).Scan(&existingRole, &hadGlobalAccess, &hasOtherGlobalAccess)
	if err != nil {
		return domain.CompanyMembership{}, err
	}
	if existingRole == normalizedRole {
		var membership domain.CompanyMembership
		err = tx.QueryRowContext(txContext, `
select membership.company_id::text, company.name, membership.user_id::text, membership.role,
       membership.created_timestamp, membership.updated_timestamp
from company_memberships membership
join companies company on company.company_id=membership.company_id
where membership.company_id=$1::uuid
  and membership.user_id=$2::uuid`, companyID, userID).Scan(
			&membership.CompanyID, &membership.CompanyName, &membership.UserID, &membership.Role,
			&membership.CreatedTimestamp, &membership.UpdatedTimestamp,
		)
		if err != nil {
			return domain.CompanyMembership{}, err
		}
		if err := commitPostgresAuthTx(txContext, tx); err != nil {
			return domain.CompanyMembership{}, err
		}
		return membership, nil
	}
	hasGlobalAccess := normalizedRole == domain.RoleDevAdmin || hasOtherGlobalAccess
	affectedCompanyIDs, err := postgresMembershipAffectedCompanyIDsTx(txContext, tx, []string{companyID}, hadGlobalAccess != hasGlobalAccess)
	if err != nil {
		return domain.CompanyMembership{}, err
	}
	if err := advancePostgresPolicyGroupMembershipVersionsTx(txContext, tx, affectedCompanyIDs); err != nil {
		return domain.CompanyMembership{}, err
	}

	var membership domain.CompanyMembership
	err = tx.QueryRowContext(txContext, `
with upserted as (
	insert into company_memberships (company_id, user_id, role, created_timestamp, updated_timestamp)
	values ($1::uuid, $2::uuid, $3, now(), now())
	on conflict (company_id, user_id) do update set
	  role=excluded.role,
	  updated_timestamp=now()
	returning company_id, user_id, role, created_timestamp, updated_timestamp
)
select upserted.company_id::text, companies.name, upserted.user_id::text, upserted.role,
       upserted.created_timestamp, upserted.updated_timestamp
from upserted
join companies on companies.company_id=upserted.company_id`,
		companyID,
		userID,
		normalizedRole,
	).Scan(&membership.CompanyID, &membership.CompanyName, &membership.UserID, &membership.Role, &membership.CreatedTimestamp, &membership.UpdatedTimestamp)
	if err != nil {
		return domain.CompanyMembership{}, err
	}
	if _, err := r.appendDomainEventsTx(txContext, tx, companyMembershipEventInputs(affectedCompanyIDs, CompanyMembershipSavedEventType, userID)); err != nil {
		return domain.CompanyMembership{}, err
	}
	if err := commitPostgresAuthTx(txContext, tx); err != nil {
		return domain.CompanyMembership{}, err
	}
	return membership, nil
}

func (r *PostgresRepo) BootstrapDevAdminContext(ctx context.Context, cognitoSubject, companyName string) (domain.CompanyMembership, bool, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	companyName = strings.TrimSpace(companyName)
	if cognitoSubject == "" || companyName == "" {
		return domain.CompanyMembership{}, false, ErrInvalid
	}

	txContext, cancel := context.WithTimeout(ctx, postgresAuthTransactionTimeout)
	defer cancel()
	tx, err := r.db.BeginTx(txContext, nil)
	if err != nil {
		return domain.CompanyMembership{}, false, err
	}
	defer tx.Rollback()
	if err := configurePostgresAuthTimeouts(txContext, tx); err != nil {
		return domain.CompanyMembership{}, false, err
	}
	if _, err := tx.ExecContext(txContext, `select pg_advisory_xact_lock(hashtextextended('auth-user:' || $1, 0))`, cognitoSubject); err != nil {
		return domain.CompanyMembership{}, false, err
	}

	var userID string
	err = tx.QueryRowContext(txContext, `
select user_id::text
from users
where cognito_subject=$1
for update`, cognitoSubject).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyMembership{}, false, ErrNotFound
	}
	if err != nil {
		return domain.CompanyMembership{}, false, err
	}
	var hasMembership bool
	if err := tx.QueryRowContext(txContext, `select exists(select 1 from company_memberships where user_id=$1::uuid)`, userID).Scan(&hasMembership); err != nil {
		return domain.CompanyMembership{}, false, err
	}
	if hasMembership {
		if err := commitPostgresAuthTx(txContext, tx); err != nil {
			return domain.CompanyMembership{}, false, err
		}
		return domain.CompanyMembership{}, false, nil
	}
	if err := lockPostgresCompanyMembershipCompanySetTx(txContext, tx); err != nil {
		return domain.CompanyMembership{}, false, err
	}

	companyID := newUUIDv7String()
	if _, err := tx.ExecContext(txContext, `
insert into companies (company_id, name, created_timestamp, updated_timestamp)
values ($1::uuid, $2, now(), now())`, companyID, companyName); err != nil {
		return domain.CompanyMembership{}, false, err
	}
	if _, err := r.ensureCompanyExplorerDefaultFoldersTx(txContext, tx, companyID, ""); err != nil {
		return domain.CompanyMembership{}, false, err
	}
	if err := r.ensureActionItemDefaultsTx(txContext, tx, companyID); err != nil {
		return domain.CompanyMembership{}, false, err
	}
	affectedCompanyIDs, err := postgresMembershipAffectedCompanyIDsTx(txContext, tx, []string{companyID}, true)
	if err != nil {
		return domain.CompanyMembership{}, false, err
	}
	if err := advancePostgresPolicyGroupMembershipVersionsTx(txContext, tx, affectedCompanyIDs); err != nil {
		return domain.CompanyMembership{}, false, err
	}

	var membership domain.CompanyMembership
	err = tx.QueryRowContext(txContext, `
insert into company_memberships (company_id, user_id, role, created_timestamp, updated_timestamp)
values ($1::uuid, $2::uuid, 'dev_admin', now(), now())
returning company_id::text, $3::text, user_id::text, role, created_timestamp, updated_timestamp`,
		companyID, userID, companyName,
	).Scan(
		&membership.CompanyID, &membership.CompanyName, &membership.UserID, &membership.Role,
		&membership.CreatedTimestamp, &membership.UpdatedTimestamp,
	)
	if err != nil {
		return domain.CompanyMembership{}, false, err
	}
	if _, err := r.appendDomainEventsTx(txContext, tx, companyMembershipEventInputs(affectedCompanyIDs, CompanyMembershipSavedEventType, userID)); err != nil {
		return domain.CompanyMembership{}, false, err
	}
	if err := commitPostgresAuthTx(txContext, tx); err != nil {
		return domain.CompanyMembership{}, false, err
	}
	return membership, true, nil
}

func (r *PostgresRepo) CreateCompany(name string) (domain.Company, error) {
	return r.CreateCompanyContext(context.Background(), name)
}

func (r *PostgresRepo) CreateCompanyContext(ctx context.Context, name string) (domain.Company, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return domain.Company{}, ErrInvalid
	}

	txContext, cancel := context.WithTimeout(ctx, postgresAuthTransactionTimeout)
	defer cancel()
	tx, err := r.db.BeginTx(txContext, nil)
	if err != nil {
		return domain.Company{}, err
	}
	defer tx.Rollback()
	if err := configurePostgresAuthTimeouts(txContext, tx); err != nil {
		return domain.Company{}, err
	}
	if err := lockPostgresCompanyMembershipCompanySetTx(txContext, tx); err != nil {
		return domain.Company{}, err
	}

	var company domain.Company
	err = tx.QueryRowContext(txContext,
		`insert into companies (company_id, name, created_timestamp, updated_timestamp)
		 values ($1, $2, now(), now())
		 returning company_id, name, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		name,
	).Scan(&company.CompanyID, &company.Name, &company.CreatedTimestamp, &company.UpdatedTimestamp)
	if err != nil {
		return domain.Company{}, err
	}
	if _, err := r.ensureCompanyExplorerDefaultFoldersTx(txContext, tx, company.CompanyID, ""); err != nil {
		return domain.Company{}, err
	}
	if err := r.ensureActionItemDefaultsTx(txContext, tx, company.CompanyID); err != nil {
		return domain.Company{}, err
	}
	if err := commitPostgresAuthTx(txContext, tx); err != nil {
		return domain.Company{}, err
	}
	return company, nil
}

func (r *PostgresRepo) ListCompanies(query string, limit int) ([]domain.Company, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	limit = NormalizeCompanyListLimit(limit)

	rows, err := r.db.Query(
		`select company_id, name, created_timestamp, updated_timestamp
		 from companies
		 where $1 = ''
		    or lower(name) like '%' || $1 || '%'
		    or company_id::text like '%' || $1 || '%'
		 order by lower(name), company_id
		 limit $2`,
		query,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.Company, 0)
	for rows.Next() {
		var item domain.Company
		if err := rows.Scan(&item.CompanyID, &item.Name, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListCompanyUsers(companyID string) ([]domain.CompanyUser, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.Query(
		`select cm.company_id, u.user_id, u.cognito_subject, u.email, u.display_name, cm.role, cm.created_timestamp, cm.updated_timestamp
		 from company_memberships cm
		 join users u on u.user_id = cm.user_id
		 where cm.company_id = $1
		 order by coalesce(nullif(u.display_name, ''), u.email), u.user_id`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyUser, 0)
	for rows.Next() {
		var item domain.CompanyUser
		if err := rows.Scan(&item.CompanyID, &item.UserID, &item.CognitoSubject, &item.Email, &item.DisplayName, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) postgresTableExists(tableName string) (bool, error) {
	tableName = strings.TrimSpace(tableName)
	if tableName == "" {
		return false, ErrInvalid
	}
	var exists bool
	err := r.db.QueryRow(`select to_regclass($1) is not null`, "public."+tableName).Scan(&exists)
	return exists, err
}

func (r *PostgresRepo) postgresColumnExists(tableName, columnName string) (bool, error) {
	tableName = strings.TrimSpace(tableName)
	columnName = strings.TrimSpace(columnName)
	if tableName == "" || columnName == "" {
		return false, ErrInvalid
	}
	var exists bool
	err := r.db.QueryRow(
		`select exists(
		   select 1
		   from information_schema.columns
		   where table_schema = 'public'
		     and table_name = $1
		     and column_name = $2
		 )`,
		tableName,
		columnName,
	).Scan(&exists)
	return exists, err
}

func (r *PostgresRepo) ListCompanyUserOnboarding(companyID string) ([]domain.CompanyUserOnboarding, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	hasEmailConnections, err := r.postgresTableExists("email_connections")
	if err != nil {
		return nil, err
	}
	hasInvitationDeliveryStatus, err := r.postgresColumnExists("invitations", "cognito_status")
	if err != nil {
		return nil, err
	}
	latestInvitationDeliveryColumns := `i.cognito_status,
		     i.invite_email_status, i.invite_email_error, i.invite_email_sent_timestamp,`
	if !hasInvitationDeliveryStatus {
		latestInvitationDeliveryColumns = `'not_started'::text as cognito_status,
		     'not_started'::text as invite_email_status, ''::text as invite_email_error, null::timestamptz as invite_email_sent_timestamp,`
	}
	connectionJoin := ""
	connectionStatus := `'not_connected'::text`
	connectionAccountEmail := `''::text`
	memberUpdatedTimestamp := `greatest(cm.updated_timestamp, u.updated_timestamp, coalesce(li.updated_timestamp, cm.updated_timestamp))`
	if hasEmailConnections {
		connectionJoin = `left join email_connections connection
		  on connection.personal_user_id = u.user_id
		 and connection.connection_type = 'personal'
		 and connection.company_id = cm.company_id
		 and connection.account_email = lower(btrim(u.email))`
		connectionStatus = `case
		       when connection.provider = 'google' and connection.status = 'connected' then 'connected'
		       when connection.provider = 'google' and connection.status = 'reauth_required' then 'reauth_required'
		       else 'not_connected'
		     end`
		connectionAccountEmail = `case when connection.provider = 'google' then connection.account_email else '' end`
		memberUpdatedTimestamp = `greatest(cm.updated_timestamp, u.updated_timestamp, coalesce(li.updated_timestamp, cm.updated_timestamp), coalesce(connection.updated_timestamp, cm.updated_timestamp))`
	}

	rows, err := r.db.Query(
		`with latest_invitation as (
		   select distinct on (i.company_id, i.email)
		     i.invitation_id::text as invitation_id, i.company_id, i.email, i.role, i.status, `+latestInvitationDeliveryColumns+`
		     i.accepted_by_user_id, i.accepted_timestamp, i.created_timestamp, i.updated_timestamp
		   from invitations i
		   where i.company_id = $1
		     and i.status <> 'revoked'
		   order by i.company_id, i.email, i.created_timestamp desc
		 ), member_rows as (
		   select cm.company_id, lower(u.email) as email, cm.role, u.user_id::text as user_id, u.display_name,
		     li.invitation_id, coalesce(li.status, 'none') as invitation_status,
		     coalesce(li.cognito_status, 'existing_mango_user') as cognito_status,
		     coalesce(li.invite_email_status, 'not_started') as invite_email_status,
		     coalesce(li.invite_email_error, '') as invite_email_error,
		     li.invite_email_sent_timestamp,
		     coalesce(li.status = 'accepted', false) as invite_accepted,
		     `+connectionStatus+` as google_connection_status,
		     `+connectionAccountEmail+` as google_connection_account_email,
		     cm.created_timestamp,
		     `+memberUpdatedTimestamp+` as updated_timestamp
		   from company_memberships cm
		   join users u on u.user_id = cm.user_id
		   left join latest_invitation li on li.company_id = cm.company_id and li.email = lower(u.email)
		   `+connectionJoin+`
		   where cm.company_id = $1
		 ), pending_invite_rows as (
		   select li.company_id, li.email, li.role, null::text as user_id, ''::text as display_name,
		     li.invitation_id, li.status as invitation_status,
		     coalesce(li.cognito_status, 'not_started') as cognito_status,
		     coalesce(li.invite_email_status, 'not_started') as invite_email_status,
		     coalesce(li.invite_email_error, '') as invite_email_error,
		     li.invite_email_sent_timestamp,
		     false as invite_accepted,
		     'not_connected'::text as google_connection_status,
		     ''::text as google_connection_account_email,
		     li.created_timestamp,
		     li.updated_timestamp
		   from latest_invitation li
		   where li.status = 'pending'
		     and not exists (
		       select 1
		       from users u
		       join company_memberships cm on cm.user_id = u.user_id
		       where cm.company_id = li.company_id
		         and lower(u.email) = li.email
		     )
		 )
		 select company_id, email, role, user_id, display_name, invitation_id, invitation_status,
		   cognito_status, invite_email_status, invite_email_error, invite_email_sent_timestamp,
		   invite_accepted, google_connection_status, google_connection_account_email,
		   created_timestamp, updated_timestamp
		 from member_rows
		 union all
		 select company_id, email, role, user_id, display_name, invitation_id, invitation_status,
		   cognito_status, invite_email_status, invite_email_error, invite_email_sent_timestamp,
		   invite_accepted, google_connection_status, google_connection_account_email,
		   created_timestamp, updated_timestamp
		 from pending_invite_rows
		 order by email, user_id nulls first`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyUserOnboarding, 0)
	for rows.Next() {
		var item domain.CompanyUserOnboarding
		var userID sql.NullString
		var displayName sql.NullString
		var invitationID sql.NullString
		var emailSentAt sql.NullTime
		if err := rows.Scan(
			&item.CompanyID,
			&item.Email,
			&item.Role,
			&userID,
			&displayName,
			&invitationID,
			&item.InvitationStatus,
			&item.CognitoStatus,
			&item.InviteEmailStatus,
			&item.InviteEmailError,
			&emailSentAt,
			&item.InviteAccepted,
			&item.GoogleConnectionStatus,
			&item.GoogleConnectionAccountEmail,
			&item.CreatedTimestamp,
			&item.UpdatedTimestamp,
		); err != nil {
			return nil, err
		}
		if userID.Valid {
			item.UserID = userID.String
		}
		if displayName.Valid {
			item.DisplayName = displayName.String
		}
		if invitationID.Valid {
			item.InvitationID = invitationID.String
		}
		if emailSentAt.Valid {
			item.InviteEmailSentTimestamp = &emailSentAt.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) ListMentionableCompanyUsers(companyID string) ([]domain.CompanyUser, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.Query(
		`select company_id::text, user_id::text, cognito_subject, email, display_name, role, created_timestamp, updated_timestamp
		 from (
		   select distinct on (candidate.user_id)
		     candidate.company_id, candidate.user_id, candidate.cognito_subject, candidate.email, candidate.display_name,
		     candidate.role, candidate.created_timestamp, candidate.updated_timestamp
		   from (
		     select cm.company_id, u.user_id, u.cognito_subject, u.email, u.display_name, cm.role,
		            cm.created_timestamp, cm.updated_timestamp, 0 as priority
		     from company_memberships cm
		     join users u on u.user_id = cm.user_id
		     where cm.company_id = $1::uuid
		     union all
		     select $1::uuid as company_id, u.user_id, u.cognito_subject, u.email, u.display_name, cm.role,
		            cm.created_timestamp, cm.updated_timestamp, 1 as priority
		     from company_memberships cm
		     join users u on u.user_id = cm.user_id
		     where cm.role = 'dev_admin'
		   ) candidate
		   order by candidate.user_id, candidate.priority
		 ) deduped
		 order by coalesce(nullif(display_name, ''), email), user_id`,
		companyID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.CompanyUser, 0)
	for rows.Next() {
		var item domain.CompanyUser
		if err := rows.Scan(&item.CompanyID, &item.UserID, &item.CognitoSubject, &item.Email, &item.DisplayName, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) GetCompanyUser(companyID, userID string) (domain.CompanyUser, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return domain.CompanyUser{}, ErrInvalid
	}

	var item domain.CompanyUser
	err := r.db.QueryRow(
		`select cm.company_id, u.user_id, u.cognito_subject, u.email, u.display_name, cm.role, cm.created_timestamp, cm.updated_timestamp
		 from company_memberships cm
		 join users u on u.user_id = cm.user_id
		 where cm.company_id = $1
		   and u.user_id = $2`,
		companyID,
		userID,
	).Scan(&item.CompanyID, &item.UserID, &item.CognitoSubject, &item.Email, &item.DisplayName, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyUser{}, ErrNotFound
	}
	return item, err
}

func execOptionalPostgresCleanup(tx *sql.Tx, query string, shouldIgnore func(error) bool, args ...any) error {
	if tx == nil {
		return ErrInvalid
	}
	const savepoint = "mangorts_optional_cleanup"
	if _, err := tx.Exec(`savepoint ` + savepoint); err != nil {
		return fmt.Errorf("create optional cleanup savepoint: %w", err)
	}
	if _, err := tx.Exec(query, args...); err != nil {
		if shouldIgnore != nil && shouldIgnore(err) {
			if _, rollbackErr := tx.Exec(`rollback to savepoint ` + savepoint); rollbackErr != nil {
				return fmt.Errorf("rollback optional cleanup savepoint after ignored error %v: %w", err, rollbackErr)
			}
			if _, releaseErr := tx.Exec(`release savepoint ` + savepoint); releaseErr != nil {
				return fmt.Errorf("release optional cleanup savepoint after ignored error %v: %w", err, releaseErr)
			}
			return nil
		}
		_, _ = tx.Exec(`rollback to savepoint ` + savepoint)
		return err
	}
	if _, err := tx.Exec(`release savepoint ` + savepoint); err != nil {
		return fmt.Errorf("release optional cleanup savepoint: %w", err)
	}
	return nil
}

func isOptionalPostgresCleanupShapeError(err error, tableName string) bool {
	return isPostgresUndefinedTable(err, tableName) || isPostgresUndefinedColumn(err, "")
}

func (r *PostgresRepo) DeleteCompanyUser(companyID, userID string, deleteIdentity bool) (DeleteCompanyUserResult, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return DeleteCompanyUserResult{}, ErrInvalid
	}

	tx, err := r.db.Begin()
	if err != nil {
		return DeleteCompanyUserResult{}, err
	}
	defer tx.Rollback()
	optionalCleanup := func(step, tableName, query string, args ...any) error {
		if err := execOptionalPostgresCleanup(tx, query, func(err error) bool {
			return isOptionalPostgresCleanupShapeError(err, tableName)
		}, args...); err != nil {
			return fmt.Errorf("%s: %w", step, err)
		}
		return nil
	}
	clearCompanyLogicGateAssignmentMemberRefs := func(companyID, userID string) error {
		if err := optionalCleanup(
			"clear company logic gate assignment member references",
			"node_logic_gate_assignments",
			`update node_logic_gate_assignments
			 set requested_by_user_id = case when requested_by_user_id = $2::uuid then null else requested_by_user_id end,
			     placed_by_user_id = case when placed_by_user_id = $2::uuid then null else placed_by_user_id end
			 where company_id = $1::uuid
			   and (requested_by_user_id = $2::uuid or placed_by_user_id = $2::uuid)`,
			companyID,
			userID,
		); err != nil {
			return err
		}
		return nil
	}
	clearAllLogicGateAssignmentMemberRefs := func(userID string) error {
		if err := optionalCleanup(
			"clear all logic gate assignment member references",
			"node_logic_gate_assignments",
			`update node_logic_gate_assignments
			 set requested_by_user_id = case when requested_by_user_id = $1::uuid then null else requested_by_user_id end,
			     placed_by_user_id = case when placed_by_user_id = $1::uuid then null else placed_by_user_id end
			 where requested_by_user_id = $1::uuid
			    or placed_by_user_id = $1::uuid`,
			userID,
		); err != nil {
			return err
		}
		return nil
	}

	var lockedUserID string
	err = tx.QueryRow(`select user_id::text from users where user_id=$1::uuid for update`, userID).Scan(&lockedUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return DeleteCompanyUserResult{}, ErrNotFound
	}
	if err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("lock company user: %w", err)
	}
	var item domain.CompanyUser
	err = tx.QueryRow(
		`select cm.company_id, u.user_id, u.cognito_subject, u.email, u.display_name, cm.role, cm.created_timestamp, cm.updated_timestamp
		 from company_memberships cm
		 join users u on u.user_id = cm.user_id
		 where cm.company_id = $1::uuid
		   and u.user_id = $2::uuid`,
		companyID,
		userID,
	).Scan(&item.CompanyID, &item.UserID, &item.CognitoSubject, &item.Email, &item.DisplayName, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return DeleteCompanyUserResult{}, ErrNotFound
	}
	if err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("load company user: %w", err)
	}
	originalMembershipCompanyIDs := []string{}
	hadGlobalAccess := false
	hasOtherGlobalAccess := false
	membershipRows, err := tx.Query(`
select company_id::text, role
from company_memberships
where user_id=$1::uuid
order by company_id`, userID)
	if err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("list user memberships before deletion: %w", err)
	}
	for membershipRows.Next() {
		var membershipCompanyID string
		var membershipRole string
		if err := membershipRows.Scan(&membershipCompanyID, &membershipRole); err != nil {
			membershipRows.Close()
			return DeleteCompanyUserResult{}, fmt.Errorf("scan user membership before deletion: %w", err)
		}
		originalMembershipCompanyIDs = append(originalMembershipCompanyIDs, membershipCompanyID)
		if membershipRole == domain.RoleDevAdmin {
			hadGlobalAccess = true
			if membershipCompanyID != companyID {
				hasOtherGlobalAccess = true
			}
		}
	}
	if err := membershipRows.Err(); err != nil {
		membershipRows.Close()
		return DeleteCompanyUserResult{}, fmt.Errorf("iterate user memberships before deletion: %w", err)
	}
	membershipRows.Close()
	deleteAllMemberships := deleteIdentity || len(originalMembershipCompanyIDs) == 1
	globalAccessChanged := hadGlobalAccess
	fallbackCompanyIDs := originalMembershipCompanyIDs
	if !deleteAllMemberships {
		globalAccessChanged = hadGlobalAccess != hasOtherGlobalAccess
		fallbackCompanyIDs = []string{companyID}
	}
	membershipAffectedCompanyIDs, err := postgresMembershipAffectedCompanyIDsTx(context.Background(), tx, fallbackCompanyIDs, globalAccessChanged)
	if err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("list membership deletion companies: %w", err)
	}
	if err := advancePostgresPolicyGroupMembershipVersionsTx(context.Background(), tx, membershipAffectedCompanyIDs); err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("lock membership permission versions: %w", err)
	}
	var lockedMembership int
	if err := tx.QueryRow(`
select 1
from company_memberships
where company_id=$1::uuid and user_id=$2::uuid
for update`, companyID, userID).Scan(&lockedMembership); errors.Is(err, sql.ErrNoRows) {
		return DeleteCompanyUserResult{}, ErrNotFound
	} else if err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("lock company membership: %w", err)
	}

	gvicRows, err := tx.Query(`select distinct company_id::text, resource_type, resource_id::text from resource_gvic_assignments where company_id = $1::uuid and principal_type = 'user' and principal_id = $2::uuid`, companyID, userID)
	if err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("list user gvic assignments: %w", err)
	}
	gvicKeys := []resourceRACIKey{}
	for gvicRows.Next() {
		var keyValue resourceRACIKey
		if scanErr := gvicRows.Scan(&keyValue.companyID, &keyValue.resourceType, &keyValue.resourceID); scanErr != nil {
			gvicRows.Close()
			return DeleteCompanyUserResult{}, fmt.Errorf("scan user gvic assignment: %w", scanErr)
		}
		gvicKeys = append(gvicKeys, keyValue)
	}
	if err = gvicRows.Err(); err != nil {
		gvicRows.Close()
		return DeleteCompanyUserResult{}, fmt.Errorf("iterate user gvic assignments: %w", err)
	}
	gvicRows.Close()

	if err = optionalCleanup("delete company gvic assignments for user", "resource_gvic_assignments", `delete from resource_gvic_assignments where company_id = $1::uuid and principal_type = 'user' and principal_id = $2::uuid`, companyID, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if err = optionalCleanup("delete company resource permissions for user", "resource_permissions", `delete from resource_permissions where company_id = $1::uuid and subject_type = 'user' and subject_id = $2::uuid`, companyID, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if err = clearCompanyLogicGateAssignmentMemberRefs(companyID, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if _, err = tx.Exec(`delete from company_memberships where company_id = $1::uuid and user_id = $2::uuid`, companyID, userID); err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("delete company membership: %w", err)
	}

	var hasRemainingMembership bool
	if err = tx.QueryRow(`
select exists(select 1 from company_memberships where user_id=$1::uuid)`, userID).Scan(&hasRemainingMembership); err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("check remaining memberships: %w", err)
	}
	if hasRemainingMembership && !deleteIdentity {
		if _, err := r.appendDomainEventsTx(context.Background(), tx, companyMembershipEventInputs(membershipAffectedCompanyIDs, CompanyMembershipDeletedEventType, userID)); err != nil {
			return DeleteCompanyUserResult{}, fmt.Errorf("append company membership deletion event: %w", err)
		}
		if err = tx.Commit(); err != nil {
			return DeleteCompanyUserResult{}, fmt.Errorf("commit company membership deletion: %w", err)
		}
		return DeleteCompanyUserResult{User: item, DeleteExternalIdentity: false}, nil
	}

	if _, err = tx.Exec(
		`insert into auth_external_identity_deletions
			 (provider, external_subject, user_id, email, status, attempts, last_error, created_timestamp, updated_timestamp)
			 values ('cognito', $1, $2::uuid, $3, 'pending', 0, '', now(), now())
			 on conflict (provider, external_subject) do update set
			   user_id=excluded.user_id,
			   email=excluded.email,
			   status='pending',
			   last_error='',
			   updated_timestamp=now(),
			   completed_timestamp=null`,
		item.CognitoSubject,
		userID,
		normalizeEmail(item.Email),
	); err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("queue external identity deletion: %w", err)
	}
	if _, err = tx.Exec(
		`delete from invitations
			 where ($1 <> '' and email = $1)
			    or invited_by_user_id = $2::uuid
			    or accepted_by_user_id = $2::uuid`,
		normalizeEmail(item.Email),
		userID,
	); err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("delete user invitations: %w", err)
	}
	if err = optionalCleanup(
		"delete company explorer folder shares for user",
		"company_explorer_folder_shares",
		`delete from company_explorer_folder_shares
			 where ($1 <> '' and email = $1)
			    or invited_by_user_id = $2::uuid
			    or user_id = $2::uuid`,
		normalizeEmail(item.Email),
		userID,
	); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if err = optionalCleanup("delete user email connections", "email_connections", `delete from email_connections where personal_user_id = $1::uuid`, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if err = optionalCleanup("delete all gvic assignments for user", "resource_gvic_assignments", `delete from resource_gvic_assignments where principal_type = 'user' and principal_id = $1::uuid`, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if err = optionalCleanup("clear project timeline created-by references for user", "project_management_timeline_items", `update project_management_timeline_items set created_by_user_id = null where created_by_user_id = $1::uuid`, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if err = optionalCleanup("delete all resource permissions for user", "resource_permissions", `delete from resource_permissions where subject_type = 'user' and subject_id = $1::uuid`, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if err = clearAllLogicGateAssignmentMemberRefs(userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if _, err = tx.Exec(`delete from company_memberships where user_id = $1::uuid`, userID); err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("delete remaining company memberships: %w", err)
	}
	if _, err = tx.Exec(`delete from users where user_id = $1::uuid`, userID); err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("delete user row: %w", err)
	}
	if _, err := r.appendDomainEventsTx(context.Background(), tx, companyMembershipEventInputs(membershipAffectedCompanyIDs, CompanyMembershipDeletedEventType, userID)); err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("append full company membership deletion events: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return DeleteCompanyUserResult{}, fmt.Errorf("commit user deletion: %w", err)
	}
	return DeleteCompanyUserResult{User: item, DeleteExternalIdentity: true}, nil
}

func (r *PostgresRepo) CompleteExternalIdentityDeletion(cognitoSubject string) error {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	if cognitoSubject == "" {
		return ErrInvalid
	}
	_, err := r.db.Exec(
		`update auth_external_identity_deletions
		 set status='completed', last_error='', updated_timestamp=now(), completed_timestamp=now()
		 where provider='cognito' and external_subject=$1`,
		cognitoSubject,
	)
	return err
}
func (r *PostgresRepo) CreateInvitation(input CreateInvitationInput) (domain.Invitation, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	email := normalizeEmail(input.Email)
	role, ok := normalizeInvitableRole(input.Role)
	invitedByUserID := strings.TrimSpace(input.InvitedByUserID)
	if companyID == "" || email == "" || invitedByUserID == "" || !ok {
		return domain.Invitation{}, ErrInvalid
	}
	tx, err := r.db.Begin()
	if err != nil {
		return domain.Invitation{}, err
	}
	defer tx.Rollback()
	var companyExists bool
	if err = tx.QueryRow(
		`select exists(
		   select 1
		   from companies
		   where company_id = $1
		 )`,
		companyID,
	).Scan(&companyExists); err != nil {
		return domain.Invitation{}, err
	}
	if !companyExists {
		return domain.Invitation{}, ErrNotFound
	}
	var inviterRole string
	if err = tx.QueryRow(
		`select role
		 from company_memberships
		 where user_id = $1
		   and (role = 'dev_admin' or company_id = $2)
		 order by case
		   when role = 'dev_admin' then 3
		   when role = 'company_admin' then 2
		   when role = 'company_manager' then 1
		   else 0
		 end desc
		 limit 1`,
		invitedByUserID,
		companyID,
	).Scan(&inviterRole); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Invitation{}, ErrInvalid
		}
		return domain.Invitation{}, err
	}
	if !domain.CanInviteCompanyRole(inviterRole, role) {
		return domain.Invitation{}, ErrInvalid
	}
	var existingCompanyUser bool
	if err = tx.QueryRow(
		`select exists(
		   select 1
		   from users u
		   join company_memberships cm on cm.user_id = u.user_id
		   where lower(u.email) = $1
		     and cm.company_id = $2
		 )`,
		email,
		companyID,
	).Scan(&existingCompanyUser); err != nil {
		return domain.Invitation{}, err
	}
	if existingCompanyUser {
		return domain.Invitation{}, ErrAlreadyExists
	}
	token, tokenHash, err := newInvitationToken()
	if err != nil {
		return domain.Invitation{}, err
	}
	ttl := input.ExpiresIn
	if ttl <= 0 {
		ttl = DefaultInvitationTTL
	}

	var invitation domain.Invitation
	if _, err = tx.Exec(
		`update invitations
		 set status = 'revoked',
		     updated_timestamp = now()
		 where company_id = $1
		   and email = $2
		   and status = 'pending'`,
		companyID,
		email,
	); err != nil {
		return domain.Invitation{}, err
	}
	var emailSentAt sql.NullTime
	err = tx.QueryRow(
		`insert into invitations (
		   invitation_id, company_id, email, role, token_hash, status,
		   invited_by_user_id, expires_timestamp, created_timestamp, updated_timestamp
		 )
		 values ($1, $2, $3, $4, $5, 'pending', $6, now() + ($7 * interval '1 second'), now(), now())
		 returning invitation_id, company_id, email, role, status, cognito_status, cognito_error,
		   invite_email_status, invite_email_error, invite_email_sent_timestamp, invited_by_user_id,
		   expires_timestamp, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		companyID,
		email,
		role,
		tokenHash,
		invitedByUserID,
		int64(ttl.Seconds()),
	).Scan(
		&invitation.InvitationID,
		&invitation.CompanyID,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&invitation.CognitoStatus,
		&invitation.CognitoError,
		&invitation.InviteEmailStatus,
		&invitation.InviteEmailError,
		&emailSentAt,
		&invitation.InvitedByUserID,
		&invitation.ExpiresTimestamp,
		&invitation.CreatedTimestamp,
		&invitation.UpdatedTimestamp,
	)
	if err != nil {
		return domain.Invitation{}, err
	}
	if emailSentAt.Valid {
		invitation.EmailSentTimestamp = &emailSentAt.Time
	}
	if err = tx.QueryRow(`select name from companies where company_id = $1`, companyID).Scan(&invitation.CompanyName); err != nil {
		return domain.Invitation{}, err
	}
	invitation.Token = token
	if err = tx.Commit(); err != nil {
		return domain.Invitation{}, err
	}
	return invitation, nil
}

func (r *PostgresRepo) UpdateInvitationDeliveryStatus(input InvitationDeliveryStatusInput) (domain.Invitation, error) {
	invitationID := strings.TrimSpace(input.InvitationID)
	if invitationID == "" {
		return domain.Invitation{}, ErrInvalid
	}
	cognitoStatus := strings.TrimSpace(input.CognitoStatus)
	if cognitoStatus != "" {
		cognitoStatus = normalizeInvitationCognitoStatus(cognitoStatus)
		if cognitoStatus == "" {
			return domain.Invitation{}, ErrInvalid
		}
	}
	emailStatus := strings.TrimSpace(input.InviteEmailStatus)
	if emailStatus != "" {
		emailStatus = normalizeInvitationEmailStatus(emailStatus)
		if emailStatus == "" {
			return domain.Invitation{}, ErrInvalid
		}
	}

	var invitation domain.Invitation
	var acceptedBy sql.NullString
	var acceptedAt sql.NullTime
	var emailSentAt sql.NullTime
	err := r.db.QueryRow(
		`update invitations i
		 set cognito_status = case when $2 <> '' then $2 else i.cognito_status end,
		     cognito_error = case when $2 <> '' then $3 else i.cognito_error end,
		     invite_email_status = case when $4 <> '' then $4 else i.invite_email_status end,
		     invite_email_error = case when $4 <> '' then $5 else i.invite_email_error end,
		     invite_email_sent_timestamp = case
		       when $4 = 'sent' then now()
		       when $4 <> '' then null
		       else i.invite_email_sent_timestamp
		     end,
		     updated_timestamp = now()
		 from companies c
		 where i.company_id = c.company_id
		   and i.invitation_id = $1
		 returning i.invitation_id, i.company_id, c.name, i.email, i.role, i.status,
		   i.cognito_status, i.cognito_error, i.invite_email_status, i.invite_email_error,
		   i.invite_email_sent_timestamp, i.invited_by_user_id, i.accepted_by_user_id,
		   i.expires_timestamp, i.accepted_timestamp, i.created_timestamp, i.updated_timestamp`,
		invitationID,
		cognitoStatus,
		strings.TrimSpace(input.CognitoError),
		emailStatus,
		strings.TrimSpace(input.InviteEmailError),
	).Scan(
		&invitation.InvitationID,
		&invitation.CompanyID,
		&invitation.CompanyName,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&invitation.CognitoStatus,
		&invitation.CognitoError,
		&invitation.InviteEmailStatus,
		&invitation.InviteEmailError,
		&emailSentAt,
		&invitation.InvitedByUserID,
		&acceptedBy,
		&invitation.ExpiresTimestamp,
		&acceptedAt,
		&invitation.CreatedTimestamp,
		&invitation.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Invitation{}, ErrNotFound
	}
	if err != nil {
		return domain.Invitation{}, err
	}
	if acceptedBy.Valid {
		invitation.AcceptedByUserID = &acceptedBy.String
	}
	if acceptedAt.Valid {
		invitation.AcceptedTimestamp = &acceptedAt.Time
	}
	if emailSentAt.Valid {
		invitation.EmailSentTimestamp = &emailSentAt.Time
	}
	return invitation, nil
}

func (r *PostgresRepo) ValidateInvitationToken(token string) (domain.Invitation, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return domain.Invitation{}, ErrInvalid
	}

	var invitation domain.Invitation
	var acceptedBy sql.NullString
	var acceptedAt sql.NullTime
	var emailSentAt sql.NullTime
	err := r.db.QueryRow(
		`select i.invitation_id, i.company_id, c.name, i.email, i.role, i.status, i.invited_by_user_id,
		   i.cognito_status, i.cognito_error, i.invite_email_status, i.invite_email_error, i.invite_email_sent_timestamp,
		   i.accepted_by_user_id, i.expires_timestamp, i.accepted_timestamp, i.created_timestamp, i.updated_timestamp
		 from invitations i
		 join companies c on c.company_id = i.company_id
		 where i.token_hash = $1`,
		invitationTokenHash(token),
	).Scan(
		&invitation.InvitationID,
		&invitation.CompanyID,
		&invitation.CompanyName,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&invitation.InvitedByUserID,
		&invitation.CognitoStatus,
		&invitation.CognitoError,
		&invitation.InviteEmailStatus,
		&invitation.InviteEmailError,
		&emailSentAt,
		&acceptedBy,
		&invitation.ExpiresTimestamp,
		&acceptedAt,
		&invitation.CreatedTimestamp,
		&invitation.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Invitation{}, ErrInvitationBadToken
	}
	if err != nil {
		return domain.Invitation{}, err
	}
	if acceptedBy.Valid {
		invitation.AcceptedByUserID = &acceptedBy.String
	}
	if acceptedAt.Valid {
		invitation.AcceptedTimestamp = &acceptedAt.Time
	}
	if emailSentAt.Valid {
		invitation.EmailSentTimestamp = &emailSentAt.Time
	}
	if err := invitationAvailabilityError(invitation, time.Now().UTC()); err != nil {
		return domain.Invitation{}, err
	}
	return invitation, nil
}

func (r *PostgresRepo) AcceptInvitation(token, cognitoSubject, email, displayName string) (domain.Invitation, error) {
	token = strings.TrimSpace(token)
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = normalizeEmail(email)
	displayName = strings.TrimSpace(displayName)
	if token == "" || cognitoSubject == "" || email == "" || displayName == "" {
		return domain.Invitation{}, ErrInvalid
	}

	tx, err := r.db.Begin()
	if err != nil {
		return domain.Invitation{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	var invitation domain.Invitation
	var tokenHash string
	var acceptedBy sql.NullString
	var acceptedAt sql.NullTime
	var emailSentAt sql.NullTime
	err = tx.QueryRow(
		`select i.invitation_id, i.company_id, c.name, i.email, i.role, i.status, i.token_hash, i.invited_by_user_id,
		   i.cognito_status, i.cognito_error, i.invite_email_status, i.invite_email_error, i.invite_email_sent_timestamp,
		   i.accepted_by_user_id, i.expires_timestamp, i.accepted_timestamp, i.created_timestamp, i.updated_timestamp
		 from invitations i
		 join companies c on c.company_id = i.company_id
		 where i.token_hash = $1
		 for update`,
		invitationTokenHash(token),
	).Scan(
		&invitation.InvitationID,
		&invitation.CompanyID,
		&invitation.CompanyName,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&tokenHash,
		&invitation.InvitedByUserID,
		&invitation.CognitoStatus,
		&invitation.CognitoError,
		&invitation.InviteEmailStatus,
		&invitation.InviteEmailError,
		&emailSentAt,
		&acceptedBy,
		&invitation.ExpiresTimestamp,
		&acceptedAt,
		&invitation.CreatedTimestamp,
		&invitation.UpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Invitation{}, ErrInvitationBadToken
	}
	if err != nil {
		return domain.Invitation{}, err
	}
	if acceptedBy.Valid {
		invitation.AcceptedByUserID = &acceptedBy.String
	}
	if acceptedAt.Valid {
		invitation.AcceptedTimestamp = &acceptedAt.Time
	}
	if emailSentAt.Valid {
		invitation.EmailSentTimestamp = &emailSentAt.Time
	}
	if stateErr := invitationAvailabilityError(invitation, time.Now().UTC()); stateErr != nil {
		err = stateErr
		return domain.Invitation{}, stateErr
	}
	if normalizeEmail(invitation.Email) != email {
		err = ErrInvitationEmailMismatch
		return domain.Invitation{}, err
	}

	var user domain.User
	err = tx.QueryRow(
		`insert into users (user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, $4, now(), now())
		 on conflict (cognito_subject) do update set
		   email = case when excluded.email <> '' then excluded.email else users.email end,
		   display_name = case when excluded.display_name <> '' then excluded.display_name else users.display_name end,
		   updated_timestamp = now()
		 returning user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		cognitoSubject,
		email,
		displayName,
	).Scan(&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName, &user.CreatedTimestamp, &user.UpdatedTimestamp)
	if err != nil {
		return domain.Invitation{}, err
	}

	var hadGlobalAccess, hasOtherGlobalAccess bool
	if err = tx.QueryRow(`
select exists(
         select 1 from company_memberships
         where user_id=$1::uuid and role='dev_admin'
       ),
       exists(
         select 1 from company_memberships
         where user_id=$1::uuid and company_id<>$2::uuid and role='dev_admin'
       )`, user.UserID, invitation.CompanyID).Scan(&hadGlobalAccess, &hasOtherGlobalAccess); err != nil {
		return domain.Invitation{}, err
	}
	hasGlobalAccess := invitation.Role == domain.RoleDevAdmin || hasOtherGlobalAccess
	affectedCompanyIDs, err := postgresMembershipAffectedCompanyIDsTx(context.Background(), tx, []string{invitation.CompanyID}, hadGlobalAccess != hasGlobalAccess)
	if err != nil {
		return domain.Invitation{}, err
	}
	if err = advancePostgresPolicyGroupMembershipVersionsTx(context.Background(), tx, affectedCompanyIDs); err != nil {
		return domain.Invitation{}, err
	}
	_, err = tx.Exec(
		`insert into company_memberships (company_id, user_id, role, created_timestamp, updated_timestamp)
		 values ($1, $2, $3, now(), now())
		 on conflict (company_id, user_id) do update set
		   role = excluded.role,
		   updated_timestamp = now()`,
		invitation.CompanyID,
		user.UserID,
		invitation.Role,
	)
	if err != nil {
		return domain.Invitation{}, err
	}

	err = tx.QueryRow(
		`update invitations
		 set status = 'accepted',
		     accepted_by_user_id = $2,
		     accepted_timestamp = now(),
		     updated_timestamp = now()
		 where token_hash = $1
		 returning status, accepted_by_user_id, accepted_timestamp, updated_timestamp`,
		tokenHash,
		user.UserID,
	).Scan(&invitation.Status, &acceptedBy, &acceptedAt, &invitation.UpdatedTimestamp)
	if err != nil {
		return domain.Invitation{}, err
	}
	if acceptedBy.Valid {
		invitation.AcceptedByUserID = &acceptedBy.String
	}
	if acceptedAt.Valid {
		invitation.AcceptedTimestamp = &acceptedAt.Time
	}
	if _, err = r.appendDomainEventsTx(context.Background(), tx, companyMembershipEventInputs(affectedCompanyIDs, CompanyMembershipSavedEventType, user.UserID)); err != nil {
		return domain.Invitation{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.Invitation{}, err
	}
	return invitation, nil
}
