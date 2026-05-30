package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *PostgresRepo) UpsertAuthUser(cognitoSubject, email, displayName string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = normalizeEmail(email)
	displayName = strings.TrimSpace(displayName)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}

	var user domain.User
	err := r.db.QueryRow(
		`with input(cognito_subject, email, display_name) as (
		   values ($2::text, $3::text, $4::text)
		 ), upsert as (
		   insert into users (user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp)
		   select $1, cognito_subject, email, display_name, now(), now()
		   from input
		   on conflict (cognito_subject) do update set
		     email = case when excluded.email <> '' then excluded.email else users.email end,
		     display_name = case when excluded.display_name <> '' then excluded.display_name else users.display_name end,
		     updated_timestamp = now()
		   where users.email is distinct from case when excluded.email <> '' then excluded.email else users.email end
		      or users.display_name is distinct from case when excluded.display_name <> '' then excluded.display_name else users.display_name end
		   returning user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp
		 )
		 select user_id, cognito_subject, email, display_name, created_timestamp, updated_timestamp
		 from upsert
		 union all
		 select u.user_id, u.cognito_subject, u.email, u.display_name, u.created_timestamp, u.updated_timestamp
		 from users u
		 join input i on i.cognito_subject = u.cognito_subject
		 where not exists (select 1 from upsert)`,
		newUUIDv7String(),
		cognitoSubject,
		email,
		displayName,
	).Scan(&user.UserID, &user.CognitoSubject, &user.Email, &user.DisplayName, &user.CreatedTimestamp, &user.UpdatedTimestamp)
	if err != nil {
		return domain.User{}, err
	}
	return user, nil
}

func (r *PostgresRepo) GetAuthUser(cognitoSubject string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}

	var user domain.User
	err := r.db.QueryRow(
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
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}

	rows, err := r.db.Query(
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
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	companyID = strings.TrimSpace(companyID)
	normalizedRole, ok := normalizeRole(role)
	if cognitoSubject == "" || companyID == "" || !ok {
		return domain.CompanyMembership{}, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.CompanyMembership{}, err
	}
	defer tx.Rollback()

	var membership domain.CompanyMembership
	err = tx.QueryRowContext(ctx,
		`with target_user as (
		   select user_id
		   from users
		   where cognito_subject = $1
		 ), upserted as (
		   insert into company_memberships (company_id, user_id, role, created_timestamp, updated_timestamp)
		   select $2::uuid, user_id, $3, now(), now()
		   from target_user
		   on conflict (company_id, user_id) do update set
		     role = excluded.role,
		     updated_timestamp = now()
		   returning company_id, user_id, role, created_timestamp, updated_timestamp
		 )
		 select upserted.company_id, companies.name, upserted.user_id, upserted.role, upserted.created_timestamp, upserted.updated_timestamp
		 from upserted
		 join companies on companies.company_id = upserted.company_id`,
		cognitoSubject,
		companyID,
		normalizedRole,
	).Scan(&membership.CompanyID, &membership.CompanyName, &membership.UserID, &membership.Role, &membership.CreatedTimestamp, &membership.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CompanyMembership{}, ErrNotFound
	}
	if err != nil {
		return domain.CompanyMembership{}, err
	}
	if err := recomputeCompanyAdminEffectiveAccessForUserTx(ctx, tx, membership.UserID); err != nil {
		return domain.CompanyMembership{}, err
	}
	if err := recomputeCompanyMemberDefaultEffectiveAccessForUserTx(ctx, tx, companyID, membership.UserID); err != nil {
		return domain.CompanyMembership{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.CompanyMembership{}, err
	}
	return membership, nil
}

func (r *PostgresRepo) CreateCompany(name string) (domain.Company, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return domain.Company{}, ErrInvalid
	}

	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Company{}, err
	}
	defer tx.Rollback()

	var company domain.Company
	err = tx.QueryRowContext(ctx,
		`insert into companies (company_id, name, created_timestamp, updated_timestamp)
		 values ($1, $2, now(), now())
		 returning company_id, name, created_timestamp, updated_timestamp`,
		newUUIDv7String(),
		name,
	).Scan(&company.CompanyID, &company.Name, &company.CreatedTimestamp, &company.UpdatedTimestamp)
	if err != nil {
		return domain.Company{}, err
	}
	if err := ensureCompanyExplorerDefaultFoldersSQL(ctx, tx, company.CompanyID); err != nil {
		return domain.Company{}, err
	}
	if err := tx.Commit(); err != nil {
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

	hasEmailConnections, err := r.postgresTableExists("user_email_connections")
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
		connectionJoin = `left join user_email_connections connection on connection.user_id = u.user_id`
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

func (r *PostgresRepo) DeleteCompanyUser(companyID, userID string) (DeleteCompanyUserResult, error) {
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

	var item domain.CompanyUser
	err = tx.QueryRow(
		`select cm.company_id, u.user_id, u.cognito_subject, u.email, u.display_name, cm.role, cm.created_timestamp, cm.updated_timestamp
		 from company_memberships cm
		 join users u on u.user_id = cm.user_id
		 where cm.company_id = $1
		   and u.user_id = $2
		 for update of cm, u`,
		companyID,
		userID,
	).Scan(&item.CompanyID, &item.UserID, &item.CognitoSubject, &item.Email, &item.DisplayName, &item.Role, &item.CreatedTimestamp, &item.UpdatedTimestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return DeleteCompanyUserResult{}, ErrNotFound
	}
	if err != nil {
		return DeleteCompanyUserResult{}, err
	}

	assignedNodeRows, err := tx.Query(`select node_id::text from nodes where company_id = $1 and assignee_user_id = $2`, companyID, userID)
	if err != nil {
		return DeleteCompanyUserResult{}, err
	}
	assignedNodeIDs := []string{}
	for assignedNodeRows.Next() {
		var nodeID string
		if scanErr := assignedNodeRows.Scan(&nodeID); scanErr != nil {
			assignedNodeRows.Close()
			return DeleteCompanyUserResult{}, scanErr
		}
		assignedNodeIDs = append(assignedNodeIDs, nodeID)
	}
	if err = assignedNodeRows.Err(); err != nil {
		assignedNodeRows.Close()
		return DeleteCompanyUserResult{}, err
	}
	assignedNodeRows.Close()

	if _, err = tx.Exec(`update nodes set assignee_user_id = null where company_id = $1 and assignee_user_id = $2`, companyID, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if _, err = tx.Exec(`delete from resource_access_grants where company_id = $1 and principal_type = 'user' and principal_id = $2`, companyID, userID); err != nil && !isPostgresUndefinedTable(err, "resource_access_grants") {
		return DeleteCompanyUserResult{}, err
	}
	if _, err = tx.Exec(`delete from resource_access where company_id = $1 and user_id = $2`, companyID, userID); err != nil && !isPostgresUndefinedTable(err, "resource_access") {
		return DeleteCompanyUserResult{}, err
	}
	if _, err = tx.Exec(`delete from resource_raci_assignments where company_id = $1 and subject_type = 'user' and subject_id = $2`, companyID, userID); err != nil && !isPostgresUndefinedTable(err, "resource_raci_assignments") {
		return DeleteCompanyUserResult{}, err
	}
	if _, err = tx.Exec(`delete from company_memberships where company_id = $1 and user_id = $2`, companyID, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if err = recomputeCompanyAdminEffectiveAccessForUserTx(context.Background(), tx, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	for _, nodeID := range assignedNodeIDs {
		if err = recomputeNodeAssigneeEffectiveAccessTx(context.Background(), tx, companyID, nodeID); err != nil {
			return DeleteCompanyUserResult{}, err
		}
	}
	if err = deleteEffectiveFactsForCompanyUserTx(context.Background(), tx, companyID, userID); err != nil {
		return DeleteCompanyUserResult{}, err
	}

	var hasRemainingMembership bool
	if err = tx.QueryRow(`select exists(select 1 from company_memberships where user_id = $1)`, userID).Scan(&hasRemainingMembership); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	if !hasRemainingMembership {
		if _, err = tx.Exec(
			`insert into auth_external_identity_deletions
			 (provider, external_subject, user_id, email, status, attempts, last_error, created_timestamp, updated_timestamp)
			 values ('cognito', $1, $2, $3, 'pending', 0, '', now(), now())
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
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(
			`delete from invitations
			 where ($1 <> '' and email = $1)
			    or invited_by_user_id = $2
			    or accepted_by_user_id = $2`,
			normalizeEmail(item.Email),
			userID,
		); err != nil {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(
			`delete from company_explorer_folder_shares
			 where ($1 <> '' and email = $1)
			    or invited_by_user_id = $2
			    or user_id = $2`,
			normalizeEmail(item.Email),
			userID,
		); err != nil {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(`delete from user_email_connections where user_id = $1`, userID); err != nil {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(`update nodes set assignee_user_id = null where assignee_user_id = $1`, userID); err != nil {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(`delete from resource_access_grants where principal_type = 'user' and principal_id = $1`, userID); err != nil && !isPostgresUndefinedTable(err, "resource_access_grants") {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(`delete from resource_access where user_id = $1`, userID); err != nil && !isPostgresUndefinedTable(err, "resource_access") {
			return DeleteCompanyUserResult{}, err
		}
		if _, err = tx.Exec(`delete from users where user_id = $1`, userID); err != nil {
			return DeleteCompanyUserResult{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return DeleteCompanyUserResult{}, err
	}
	return DeleteCompanyUserResult{User: item, DeleteExternalIdentity: !hasRemainingMembership}, nil
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
	var inviterCanManage bool
	if err = tx.QueryRow(
		`select exists(
		   select 1
		   from company_memberships
		   where user_id = $1
		     and (role = 'dev_admin' or (company_id = $2 and role = 'company_admin'))
		 )`,
		invitedByUserID,
		companyID,
	).Scan(&inviterCanManage); err != nil {
		return domain.Invitation{}, err
	}
	if !inviterCanManage {
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
	if err = recomputeCompanyAdminEffectiveAccessForUserTx(context.Background(), tx, user.UserID); err != nil {
		return domain.Invitation{}, err
	}
	if err = recomputeCompanyMemberDefaultEffectiveAccessForUserTx(context.Background(), tx, invitation.CompanyID, user.UserID); err != nil {
		return domain.Invitation{}, err
	}

	if err = activateCompanyExplorerFolderSharesSQL(context.Background(), tx, invitation.CompanyID, invitation.Email, user.UserID); err != nil {
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
	if err = tx.Commit(); err != nil {
		return domain.Invitation{}, err
	}
	return invitation, nil
}
