#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077
export PGSSLMODE=require

readonly app_root=/app
readonly work_root=/work
readonly raw_dump="$work_root/dev-raw.dump"
readonly sanitized_dump="$work_root/qa-sanitized-data.dump"

cutover_complete=false
raw_created=false
next_created=false
cleanup_running=false

fail() {
  printf 'STOP: %s\n' "$*" >&2
  return 1
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "missing required environment value $name"
  fi
}

qa_psql() {
  local database="$1"
  shift
  PGPASSWORD="$QA_DB_PASSWORD" psql \
    --host "$QA_DB_HOST" --port "$QA_DB_PORT" --username "$QA_DB_USER" \
    --dbname "$database" --no-password --no-psqlrc --set ON_ERROR_STOP=on "$@"
}

preserved_business_data_sha256() {
  local database="$1"
  local checksum_output
  local checksum
  if ! checksum_output="$(
    qa_psql "$database" --command "copy (
      select projection_type,company_id,resource_id,value_1,value_2,value_3
      from (
        select 'huddle_node_date'::text as projection_type,
               company_id::text as company_id,
               huddle_node_id::text as resource_id,
               huddle_date::text as value_1,
               ''::text as value_2,
               ''::text as value_3
        from public.huddle_nodes
        union all
        select 'node_completion'::text,
               company_id::text,
               node_id::text,
               status,
               extract(epoch from created_timestamp)::text,
               coalesce(extract(epoch from completion_transition_timestamp)::text,'')
        from public.nodes
      ) projection
      order by projection_type,company_id,resource_id
    ) to stdout with (format csv,force_quote *);" | sha256sum
  )"; then
    printf 'STOP: could not calculate preserved business data checksum\n' >&2
    return 1
  fi
  checksum="${checksum_output%% *}"
  if [[ ! "$checksum" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'STOP: preserved business data checksum is invalid\n' >&2
    return 1
  fi
  printf '%s\n' "$checksum"
}

dev_psql() {
  PGPASSWORD="$DEV_DB_PASSWORD" PGOPTIONS='-c default_transaction_read_only=on' psql \
    --host "$DEV_DB_HOST" --port "$DEV_DB_PORT" --username "$DEV_DB_USER" \
    --dbname "$DEV_DB_NAME" --no-password --no-psqlrc --set ON_ERROR_STOP=on "$@"
}

database_exists() {
  local database="$1"
  [[ "$(qa_psql postgres --tuples-only --no-align --command "select count(*) from pg_database where datname = '$database';")" == "1" ]]
}

drop_exact_scratch_database() {
  local database="$1"
  if [[ ! "$database" =~ ^mangorts_qa_(raw_[0-9]{8}_[0-9]{6}|next_[0-9]{14})$ ]]; then
    printf 'Refusing unexpected scratch database cleanup target: %s\n' "$database" >&2
    return 1
  fi
  if database_exists "$database"; then
    qa_psql postgres --command "alter database $database with allow_connections false;" || true
    qa_psql postgres --command "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$database' and pid <> pg_backend_pid();" || true
    PGPASSWORD="$QA_DB_PASSWORD" dropdb \
      --host "$QA_DB_HOST" --port "$QA_DB_PORT" --username "$QA_DB_USER" \
      --maintenance-db postgres --no-password "$database"
  fi
}

run_migrator() {
  local database="$1"
  shift
  DB_HOST="$QA_DB_HOST" DB_PORT="$QA_DB_PORT" DB_USER="$QA_DB_USER" \
    DB_PASSWORD="$QA_DB_PASSWORD" DB_NAME="$database" DB_SSLMODE=require \
    /usr/local/bin/miraeopus-migrate \
      -schema "$app_root/backend/db/schema.sql" \
      -inventory "$app_root/backend/db/schema_inventory.sql" \
      -migrations "$app_root/backend/db/migrations" "$@"
}

audit_field() {
  local output="$1"
  local field="$2"
  local values
  values="$(printf '%s\n' "$output" | awk -v prefix="$field=" '{ for (i=1; i<=NF; i++) if (index($i,prefix)==1) print substr($i,length(prefix)+1) }' | sort -u)"
  if [[ -z "$values" || "$(printf '%s\n' "$values" | wc -l | tr -d ' ')" != "1" ]]; then
    fail "migration audit did not return exactly one $field value"
  fi
  printf '%s' "$values"
}

rollback_cutover() {
  printf 'Post-cutover verification failed; restoring the exact retained QA database.\n' >&2
  if ! database_exists "$QA_STABLE_DATABASE" \
     || ! database_exists "$QA_ROLLBACK_DATABASE" \
     || database_exists "$QA_FAILED_DATABASE"; then
    printf 'CRITICAL: rollback database names are not in the exact expected state; manual recovery is required.\n' >&2
    return 1
  fi
  if ! qa_psql postgres --command "alter database $QA_STABLE_DATABASE with allow_connections false;" \
     || ! qa_psql postgres --command "alter database $QA_ROLLBACK_DATABASE with allow_connections false;" \
     || ! qa_psql postgres --command "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$QA_STABLE_DATABASE','$QA_ROLLBACK_DATABASE') and pid <> pg_backend_pid();"; then
    qa_psql postgres --command "alter database $QA_STABLE_DATABASE with allow_connections true;" || true
    qa_psql postgres --command "alter database $QA_ROLLBACK_DATABASE with allow_connections true;" || true
    printf 'CRITICAL: rollback could not lock both exact databases; the names were not changed.\n' >&2
    return 1
  fi
  if ! qa_psql postgres --command "alter database $QA_STABLE_DATABASE rename to $QA_FAILED_DATABASE;"; then
    qa_psql postgres --command "alter database $QA_STABLE_DATABASE with allow_connections true;" || true
    qa_psql postgres --command "alter database $QA_ROLLBACK_DATABASE with allow_connections true;" || true
    printf 'CRITICAL: rollback could not move the failed QA database aside; the names were not changed.\n' >&2
    return 1
  fi
  if ! qa_psql postgres --command "alter database $QA_ROLLBACK_DATABASE rename to $QA_STABLE_DATABASE;"; then
    if ! qa_psql postgres --command "alter database $QA_FAILED_DATABASE rename to $QA_STABLE_DATABASE;" \
       || ! qa_psql postgres --command "alter database $QA_STABLE_DATABASE with allow_connections true;"; then
      printf 'CRITICAL: rollback rename failed and the new QA database could not be restored to its stable name; manual recovery is required.\n' >&2
      return 1
    fi
    printf 'CRITICAL: the old QA database could not be restored; the new QA database remains active and must be inspected.\n' >&2
    return 1
  fi
  if ! qa_psql postgres --command "alter database $QA_STABLE_DATABASE with allow_connections true;"; then
    printf 'CRITICAL: the old QA database name was restored but connections could not be re-enabled; manual recovery is required.\n' >&2
    return 1
  fi
  cutover_complete=false
  printf 'The exact retained QA database was restored successfully.\n' >&2
  return 0
}

set_user_triggers() {
  local database="$1"
  local action="$2"
  [[ "$action" == "enable" || "$action" == "disable" ]] || fail "invalid user-trigger action"
  qa_psql "$database" --command "
do \$trigger_guard\$
declare table_row record;
begin
  for table_row in
    select namespace.nspname as schema_name, relation.relname as table_name
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind in ('r','p')
    order by relation.oid
  loop
    execute format('alter table %I.%I $action trigger user', table_row.schema_name, table_row.table_name);
  end loop;
end
\$trigger_guard\$;"
}

cleanup() {
  local status=$?
  if [[ "$cleanup_running" == "true" ]]; then
    return
  fi
  cleanup_running=true
  trap - EXIT ERR
  set +e

  rm -f -- "$raw_dump" "$sanitized_dump"
  if [[ "$status" -ne 0 && "$cutover_complete" == "true" ]]; then
    rollback_cutover
  fi
  if [[ "$raw_created" == "true" ]]; then
    drop_exact_scratch_database "$QA_RAW_DATABASE"
  fi
  if [[ "$status" -ne 0 && "$next_created" == "true" && "$cutover_complete" == "false" ]]; then
    drop_exact_scratch_database "$QA_NEXT_DATABASE"
  fi

  unset DEV_DB_PASSWORD QA_DB_PASSWORD PGPASSWORD
  exit "$status"
}
trap cleanup EXIT

for name in \
  EXPECTED_GIT_COMMIT MANGORTS_QA_COPY_IMAGE_COMMIT \
  DEV_DB_HOST DEV_DB_PORT DEV_DB_NAME DEV_DB_USER DEV_DB_MASTER_USER DEV_DB_PASSWORD MAX_DEV_DATABASE_BYTES \
  QA_DB_HOST QA_DB_PORT QA_DB_USER QA_DB_PASSWORD QA_STABLE_DATABASE \
  QA_RAW_DATABASE QA_NEXT_DATABASE QA_ROLLBACK_DATABASE QA_FAILED_DATABASE \
  JONAT_QA_EMAIL JONAT_QA_COGNITO_SUB; do
  require_env "$name"
done

[[ "$EXPECTED_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "EXPECTED_GIT_COMMIT is not an exact lowercase Git SHA"
[[ "$MANGORTS_QA_COPY_IMAGE_COMMIT" == "$EXPECTED_GIT_COMMIT" ]] || fail "copy image revision differs from the approved commit"
[[ "$DEV_DB_HOST" =~ (^|[-.])dev(cluster)?([-.]|$) ]] || fail "Dev host is not visibly Dev-marked"
[[ ! "$DEV_DB_HOST" =~ (^|[-.])(qa|prod)([-.]|$) ]] || fail "Dev host contains a QA or production marker"
[[ "$QA_DB_HOST" =~ (^|[-.])qa([-.]|$) ]] || fail "QA host is not visibly QA-marked"
[[ ! "$QA_DB_HOST" =~ (^|[-.])(dev|prod)([-.]|$) ]] || fail "QA host contains a Dev or production marker"
[[ "$DEV_DB_PORT" == "5432" && "$QA_DB_PORT" == "5432" ]] || fail "both database ports must be 5432"
[[ "$MAX_DEV_DATABASE_BYTES" =~ ^[1-9][0-9]*$ ]] || fail "MAX_DEV_DATABASE_BYTES is not a positive integer"
[[ "$QA_STABLE_DATABASE" == "mangorts_qa" ]] || fail "stable QA database must be mangorts_qa"
[[ "$QA_RAW_DATABASE" =~ ^mangorts_qa_raw_[0-9]{8}_[0-9]{6}$ ]] || fail "invalid raw QA database name"
[[ "$QA_NEXT_DATABASE" =~ ^mangorts_qa_next_[0-9]{14}$ ]] || fail "invalid next QA database name"
[[ "$QA_ROLLBACK_DATABASE" =~ ^mangorts_qa_rollback_[0-9]{14}$ ]] || fail "invalid rollback QA database name"
[[ "$QA_FAILED_DATABASE" =~ ^mangorts_qa_failed_[0-9]{14}$ ]] || fail "invalid failed QA database name"
[[ "$JONAT_QA_EMAIL" == "jonathankim829@gmail.com" ]] || fail "Jonat QA email differs from the approved value"
[[ "$JONAT_QA_COGNITO_SUB" =~ ^[0-9a-fA-F-]{36}$ ]] || fail "Jonat QA Cognito subject is not a UUID"

dev_capabilities="$(dev_psql --tuples-only --no-align --command "
with me as (
  select oid,rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
  from pg_catalog.pg_roles where rolname=current_user
), checks as (
  select current_database() as database_name,current_user as user_name,
    current_setting('server_version_num')::integer as server_version_num,
    me.rolsuper or me.rolcreatedb or me.rolcreaterole or me.rolreplication or me.rolbypassrls as unsafe_role_attributes,
    has_database_privilege(current_user,current_database(),'CREATE') as database_create,
    has_database_privilege(current_user,current_database(),'TEMP') as database_temp,
    exists(select 1 from pg_catalog.pg_database d where d.datdba=me.oid) as owns_database,
    exists(select 1 from pg_catalog.pg_namespace n where n.nspname<>'information_schema' and n.nspname!~'^pg_' and has_schema_privilege(current_user,n.oid,'CREATE')) as schema_create,
    exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname<>'information_schema' and n.nspname!~'^pg_' and c.relkind in ('r','p','f','v','m') and has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as table_write,
    exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname<>'information_schema' and n.nspname!~'^pg_' and c.relkind='S' and has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE')) as sequence_write,
    exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname<>'information_schema' and n.nspname!~'^pg_' and c.relowner=me.oid) as owns_relation,
    exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname<>'information_schema' and n.nspname!~'^pg_' and p.proowner=me.oid) as owns_function,
    exists(select 1 from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace where n.nspname<>'information_schema' and n.nspname!~'^pg_' and t.typowner=me.oid) as owns_type,
    exists(select 1 from pg_catalog.pg_extension e where e.extowner=me.oid) as owns_extension,
    exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname<>'information_schema' and n.nspname!~'^pg_' and p.prosecdef and has_function_privilege(current_user,p.oid,'EXECUTE')) as executable_security_definer
  from me
)
select concat_ws('|',database_name,user_name,server_version_num,unsafe_role_attributes,database_create,database_temp,owns_database,schema_create,table_write,sequence_write,owns_relation,owns_function,owns_type,owns_extension,executable_security_definer) from checks;")"
IFS='|' read -r dev_database dev_user dev_version dev_unsafe_role dev_database_create dev_database_temp dev_owns_database dev_schema_create dev_table_write dev_sequence_write dev_owns_relation dev_owns_function dev_owns_type dev_owns_extension dev_security_definer <<< "$dev_capabilities"
[[ "$dev_database" == "$DEV_DB_NAME" && "$dev_user" == "$DEV_DB_USER" ]] || fail "Dev database identity differs from the injected read-only tuple"
[[ "$dev_user" != "$DEV_DB_MASTER_USER" ]] || fail "Dev source credential is the Dev master user"
[[ "$dev_version" =~ ^17[0-9]{4}$ ]] || fail "Dev source is not PostgreSQL 17.x"
for unsafe_value in "$dev_unsafe_role" "$dev_database_create" "$dev_database_temp" "$dev_owns_database" "$dev_schema_create" "$dev_table_write" "$dev_sequence_write" "$dev_owns_relation" "$dev_owns_function" "$dev_owns_type" "$dev_owns_extension" "$dev_security_definer"; do
  [[ "$unsafe_value" == "f" ]] || fail "Dev login failed the database-enforced read-only capability check"
done

dev_database_bytes="$(dev_psql --tuples-only --no-align --command "select pg_database_size(current_database());")"
[[ "$dev_database_bytes" =~ ^[0-9]+$ ]] || fail "Dev database size audit did not return bytes"
(( dev_database_bytes <= MAX_DEV_DATABASE_BYTES )) || fail "Dev database exceeds the reviewed 4-GiB copy ceiling"
printf 'Dev source size guard passed: %s bytes (maximum %s).\n' "$dev_database_bytes" "$MAX_DEV_DATABASE_BYTES"

qa_identity="$(qa_psql postgres --tuples-only --no-align --command "
select concat_ws(
  '|',
  current_database(),
  current_user,
  current_setting('server_version_num'),
  case when pg_is_in_recovery() then 'recovery' else 'primary' end
);")"
IFS='|' read -r qa_database qa_user qa_version qa_recovery_state <<< "$qa_identity"
[[ "$qa_database" == "postgres" ]] || fail "QA writer did not connect to the postgres maintenance database"
[[ "$qa_user" == "$QA_DB_USER" ]] || fail "QA writer login differs from the reviewed RDS master username"
[[ "$qa_version" =~ ^17[0-9]{4}$ ]] || fail "QA writer target is not PostgreSQL 17.x"
[[ "$qa_recovery_state" == "primary" ]] || fail "QA writer endpoint is not the primary"

database_exists "$QA_STABLE_DATABASE" || fail "stable QA database does not exist"
for database in "$QA_RAW_DATABASE" "$QA_NEXT_DATABASE" "$QA_ROLLBACK_DATABASE" "$QA_FAILED_DATABASE"; do
  if database_exists "$database"; then
    fail "refusing existing generated QA database $database"
  fi
done

printf 'QA copy source and target guards passed for release %s.\n' "$EXPECTED_GIT_COMMIT"

PGPASSWORD="$QA_DB_PASSWORD" createdb \
  --host "$QA_DB_HOST" --port "$QA_DB_PORT" --username "$QA_DB_USER" \
  --maintenance-db postgres --no-password "$QA_RAW_DATABASE"
raw_created=true

PGPASSWORD="$DEV_DB_PASSWORD" PGOPTIONS='-c default_transaction_read_only=on' pg_dump \
  --host "$DEV_DB_HOST" --port "$DEV_DB_PORT" --username "$DEV_DB_USER" \
  --dbname "$DEV_DB_NAME" --no-password --format custom --compress=6 \
  --no-owner --no-privileges --file "$raw_dump"

PGPASSWORD="$QA_DB_PASSWORD" pg_restore \
  --host "$QA_DB_HOST" --port "$QA_DB_PORT" --username "$QA_DB_USER" \
  --dbname "$QA_RAW_DATABASE" --no-password --exit-on-error \
  --no-owner --no-privileges "$raw_dump"

qa_psql "$QA_RAW_DATABASE" --file "$app_root/scripts/qa_dev_copy_preflight.sql"
qa_psql "$QA_RAW_DATABASE" --file "$app_root/scripts/qa_dev_copy_sanitize.sql"
qa_psql "$QA_RAW_DATABASE" --file "$app_root/scripts/qa_dev_copy_verify.sql"
raw_business_data_sha="$(preserved_business_data_sha256 "$QA_RAW_DATABASE")"

PGPASSWORD="$QA_DB_PASSWORD" pg_dump \
  --host "$QA_DB_HOST" --port "$QA_DB_PORT" --username "$QA_DB_USER" \
  --dbname "$QA_RAW_DATABASE" --no-password --data-only --format custom --compress=6 \
  --no-owner --no-privileges --exclude-table-data=public.schema_migrations \
  --file "$sanitized_dump"
pg_restore --list "$sanitized_dump" >/dev/null

drop_exact_scratch_database "$QA_RAW_DATABASE"
raw_created=false
rm -f -- "$raw_dump"

PGPASSWORD="$QA_DB_PASSWORD" createdb \
  --host "$QA_DB_HOST" --port "$QA_DB_PORT" --username "$QA_DB_USER" \
  --maintenance-db postgres --no-password "$QA_NEXT_DATABASE"
next_created=true

empty_audit="$(run_migrator "$QA_NEXT_DATABASE" -mode audit 2>&1)"
printf '%s\n' "$empty_audit"
[[ "$(audit_field "$empty_audit" public_tables)" == "0" ]] || fail "fresh next database was not empty"
[[ "$(audit_field "$empty_audit" server_version_num)" =~ ^17[0-9]{4}$ ]] || fail "fresh next database is not PostgreSQL 17.x"

run_migrator "$QA_NEXT_DATABASE" -mode schema -baseline-migrations -require-empty-database
baseline_audit="$(run_migrator "$QA_NEXT_DATABASE" -mode audit 2>&1)"
printf '%s\n' "$baseline_audit"
baseline_schema_sha="$(audit_field "$baseline_audit" schema_inventory_sha256)"
baseline_repository_sha="$(audit_field "$baseline_audit" repository_schema_sha256)"
[[ "$baseline_schema_sha" =~ ^[0-9a-f]{64}$ ]] || fail "canonical baseline schema fingerprint is invalid"
[[ "$baseline_repository_sha" =~ ^[0-9a-f]{64}$ ]] || fail "repository schema fingerprint is invalid"
[[ "$(audit_field "$baseline_audit" missing_from_ledger)" == "0" ]] || fail "canonical baseline is missing migration ledger entries"
[[ "$(audit_field "$baseline_audit" unknown_to_repository)" == "0" ]] || fail "canonical baseline has unknown migration ledger entries"

set_user_triggers "$QA_NEXT_DATABASE" disable
PGPASSWORD="$QA_DB_PASSWORD" pg_restore \
  --host "$QA_DB_HOST" --port "$QA_DB_PORT" --username "$QA_DB_USER" \
  --dbname "$QA_NEXT_DATABASE" --no-password --single-transaction --exit-on-error \
  --no-owner --no-privileges "$sanitized_dump"

set_user_triggers "$QA_NEXT_DATABASE" enable

qa_psql "$QA_NEXT_DATABASE" --file "$app_root/scripts/qa_dev_copy_verify.sql"
next_business_data_sha="$(preserved_business_data_sha256 "$QA_NEXT_DATABASE")"
[[ "$next_business_data_sha" == "$raw_business_data_sha" ]] || fail "restored next database changed the exact preserved business data projection"

parity_audit="$(run_migrator "$QA_NEXT_DATABASE" -mode audit 2>&1)"
printf '%s\n' "$parity_audit"
[[ "$(audit_field "$parity_audit" schema_inventory_sha256)" == "$baseline_schema_sha" ]] || fail "restored next database schema differs from its clean canonical baseline"
[[ "$(audit_field "$parity_audit" repository_schema_sha256)" == "$baseline_repository_sha" ]] || fail "restored next database repository fingerprint differs from the image"
[[ "$(audit_field "$parity_audit" missing_from_ledger)" == "0" ]] || fail "restored next database is missing migration ledger entries"
[[ "$(audit_field "$parity_audit" unknown_to_repository)" == "0" ]] || fail "restored next database has unknown migration ledger entries"

jonat_user_count="$(qa_psql "$QA_NEXT_DATABASE" --tuples-only --no-align --command "select count(*) from users where lower(btrim(email)) = '$JONAT_QA_EMAIL';")"
[[ "$jonat_user_count" == "1" ]] || fail "expected exactly one copied Jonat user, found $jonat_user_count"
subject_owner_count="$(qa_psql "$QA_NEXT_DATABASE" --tuples-only --no-align --command "select count(*) from users where cognito_subject = '$JONAT_QA_COGNITO_SUB' and lower(btrim(email)) <> '$JONAT_QA_EMAIL';")"
[[ "$subject_owner_count" == "0" ]] || fail "Jonat QA Cognito subject is already bound to another user"
jonat_subject="$(qa_psql "$QA_NEXT_DATABASE" --tuples-only --no-align --command "select cognito_subject from users where lower(btrim(email)) = '$JONAT_QA_EMAIL';")"
if [[ "$jonat_subject" != "$JONAT_QA_COGNITO_SUB" ]]; then
  [[ "$jonat_subject" == qa-disabled:* ]] || fail "copied Jonat user was not in the expected inert identity state"
  updated_count="$(qa_psql "$QA_NEXT_DATABASE" --tuples-only --no-align --command "with updated as (update users set cognito_subject = '$JONAT_QA_COGNITO_SUB', updated_timestamp = now() where lower(btrim(email)) = '$JONAT_QA_EMAIL' and cognito_subject = 'qa-disabled:' || user_id::text returning 1) select count(*) from updated;")"
  [[ "$updated_count" == "1" ]] || fail "failed to bind exactly one copied Jonat user"
fi

mapfile -t jonat_company_ids < <(qa_psql "$QA_NEXT_DATABASE" --tuples-only --no-align --command "select membership.company_id from users actor join company_memberships membership on membership.user_id = actor.user_id where lower(btrim(actor.email)) = '$JONAT_QA_EMAIL' order by membership.company_id;")
[[ "${#jonat_company_ids[@]}" == "1" ]] || fail "expected exactly one surviving Jonat company membership, found ${#jonat_company_ids[@]}"
qa_company_id="${jonat_company_ids[0]}"
[[ "$qa_company_id" =~ ^[0-9a-fA-F-]{36}$ ]] || fail "surviving Jonat company ID is not a UUID"

qa_psql "$QA_NEXT_DATABASE" --file "$app_root/scripts/qa_dev_copy_verify.sql"

qa_psql postgres --command "alter database $QA_STABLE_DATABASE with allow_connections false;"
qa_psql postgres --command "alter database $QA_NEXT_DATABASE with allow_connections false;"
qa_psql postgres --command "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$QA_STABLE_DATABASE','$QA_NEXT_DATABASE') and pid <> pg_backend_pid();"

if ! qa_psql postgres --command "alter database $QA_STABLE_DATABASE rename to $QA_ROLLBACK_DATABASE;"; then
  if ! qa_psql postgres --command "alter database $QA_STABLE_DATABASE with allow_connections true;" \
     || ! qa_psql postgres --command "alter database $QA_NEXT_DATABASE with allow_connections true;"; then
    fail "CRITICAL: the first cutover rename failed and connection recovery also failed; inspect both exact database names"
  fi
  fail "failed to rename the stable QA database; both original names remain"
fi

if ! qa_psql postgres --command "alter database $QA_NEXT_DATABASE rename to $QA_STABLE_DATABASE;"; then
  if ! qa_psql postgres --command "alter database $QA_ROLLBACK_DATABASE rename to $QA_STABLE_DATABASE;"; then
    fail "CRITICAL: the second cutover rename failed and the old QA database could not be restored to the stable name"
  fi
  if ! qa_psql postgres --command "alter database $QA_STABLE_DATABASE with allow_connections true;" \
     || ! qa_psql postgres --command "alter database $QA_NEXT_DATABASE with allow_connections true;"; then
    fail "CRITICAL: the old QA database name was restored after cutover failure but connection recovery failed"
  fi
  fail "failed to activate the verified next database; original QA name was restored"
fi

next_created=false
cutover_complete=true
qa_psql postgres --command "alter database $QA_STABLE_DATABASE with allow_connections true;"

if ! qa_psql "$QA_STABLE_DATABASE" --file "$app_root/scripts/qa_dev_copy_verify.sql"; then
  if rollback_cutover; then
    fail "post-cutover data verification failed; original QA was restored"
  fi
  fail "CRITICAL: post-cutover data verification and automatic rollback both failed; manual recovery is required"
fi

final_business_data_sha="$(preserved_business_data_sha256 "$QA_STABLE_DATABASE")"
if [[ "$final_business_data_sha" != "$raw_business_data_sha" ]]; then
  if rollback_cutover; then
    fail "post-cutover preserved business data projection changed; original QA was restored"
  fi
  fail "CRITICAL: post-cutover preserved business data projection changed and automatic rollback failed; manual recovery is required"
fi

final_audit="$(run_migrator "$QA_STABLE_DATABASE" -mode audit 2>&1)"
printf '%s\n' "$final_audit"
if [[ "$(audit_field "$final_audit" schema_inventory_sha256)" != "$baseline_schema_sha" \
   || "$(audit_field "$final_audit" repository_schema_sha256)" != "$baseline_repository_sha" \
   || "$(audit_field "$final_audit" missing_from_ledger)" != "0" \
   || "$(audit_field "$final_audit" unknown_to_repository)" != "0" ]]; then
  if rollback_cutover; then
    fail "post-cutover schema audit failed; original QA was restored"
  fi
  fail "CRITICAL: post-cutover schema audit and automatic rollback both failed; manual recovery is required"
fi

rm -f -- "$sanitized_dump"
unset DEV_DB_PASSWORD QA_DB_PASSWORD PGPASSWORD

printf 'QA_COPY_STATUS=success\n'
printf 'QA_COPY_RELEASE_COMMIT=%s\n' "$EXPECTED_GIT_COMMIT"
printf 'QA_COPY_SCHEMA_INVENTORY_SHA256=%s\n' "$baseline_schema_sha"
printf 'QA_COPY_BUSINESS_DATA_SHA256=%s\n' "$raw_business_data_sha"
printf 'QA_COPY_REPOSITORY_SCHEMA_SHA256=%s\n' "$baseline_repository_sha"
printf 'QA_COPY_COMPANY_ID=%s\n' "$qa_company_id"
printf 'QA_COPY_ROLLBACK_DATABASE=%s\n' "$QA_ROLLBACK_DATABASE"
