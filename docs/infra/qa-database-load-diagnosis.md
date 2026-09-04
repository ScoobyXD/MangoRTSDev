# QA Database Load Diagnosis Runbook

## Safety boundary

This runbook is strictly read-only. Use only the database-enforced `mangorts_readonly` login against QA PostgreSQL 17.x. Never use an application, writer, owner, migration, or administrator credential. Do not cancel a backend, run `VACUUM` or `ANALYZE`, restart RDS or ECS, change AWS monitoring, or modify data or schema without separate explicit approval after an exact PID or process is proved.

The persistent CPU process is not yet identified. The access-boundary verifier failed because human/admin AWS profiles were active in the same session as `mangorts-dev-agent-readonly`, and no direct QA read-only PostgreSQL connection is available locally. QA RDS is private. Therefore no live PostgreSQL process snapshot was captured, and autovacuum, auto-analyze, or another worker must not be stated as the cause.

## Proved incident timeline

The following facts come from sanitized CloudWatch metrics and aggregate-only QA logs collected during the September 3–4 investigation:

1. The September 1 RDS backup finished at `01:27:20Z`.
2. The failed copy logged its source and target guards at `01:28:51Z`.
3. RDS CPU was approximately 3–6% through `01:29Z`, rose to 19.225% at `01:30Z`, reached 60.021% at `01:31Z`, and then stayed near 51–54%.
4. The copy logged 51 deletes and four updates between `01:31:43Z` and `01:32:43Z`, but never logged its success marker.
5. The copy's single database connection remained through `03:58Z` and disappeared at `03:59Z`. CPU remained near 52% with zero reported client connections.
6. In the zero-client `04:00Z–04:19Z` window, CPU remained 51–53%. Storage latency and queue depth were low; I/O and WAL showed only small periodic bursts. EBS balances remained healthy.
7. RDS reported no restart, failover, storage, or maintenance event during the copy. Logical-replication slot metrics were empty.
8. A later simple copy succeeded at `10:18:14Z`, caused a brief CPU spike, and returned to the same approximately 52% baseline.
9. During the September 4 authenticated startup burst, database connections jumped from 1 to the application maximum of 20, CPU reached 99.523%, and free memory fell to approximately 51–55 MB.
10. Seventy `/v1/me` requests returned HTTP 200, but seven took 2–35 seconds. The ALB recorded three 504 responses while the ECS target remained healthy.
11. At `04:20Z–04:30Z`, QA still held 20 database connections and approximately 51–55% CPU despite zero ALB requests.

These facts prove the copy and CPU-baseline timing and the later connection-pool exhaustion. They support, but do not prove, one PostgreSQL-internal process consuming roughly one of the instance's two vCPUs after the failed bulk work.

## Required access before inspection

Start only when all of the following are true:

1. If the approved private path uses AWS or another cloud-integrated workflow, the AWS session passes `scripts/verify_agent_db_access_boundary.py` and only the designated read-only profile is usable. An ordinary direct database path does not require that verifier.
2. An approved private path to QA RDS exists.
3. The PostgreSQL login is the database-enforced `mangorts_readonly` role.
4. Execute the complete script as one DBeaver script. It opens an explicit read-only transaction, and the identity query must report `PROCEED_READ_ONLY`; otherwise stop before running the remaining queries.
5. `can_read_all_stats` is true. If it is false or other sessions' query text is redacted, stop. A human may separately approve granting `pg_read_all_stats` to the read-only role; do not substitute a writer or administrator credential.

## Two-snapshot PostgreSQL inspection

Run the complete script in DBeaver, save the results privately, wait 60 seconds, and run the complete script again. Compare PIDs, waits, blockers, progress counters, tuple counts, I/O counters, and timestamps. The guard immediately after the identity query deliberately aborts the read-only transaction when any preflight condition fails, so the inspection queries cannot continue. Do not share raw query text or application identifiers outside the approved incident record.

This is plain PostgreSQL 17 SQL. It contains no psql meta-commands and no data or schema write. Run the whole block together; do not run the inspection statements outside its explicit read-only transaction.

```sql
start transaction read only;

select
  clock_timestamp() at time zone 'UTC' as captured_at_utc,
  current_database() as database_name,
  current_user as database_user,
  session_user as login_user,
  current_setting('server_version_num')::integer as server_version_num,
  current_setting('transaction_read_only') as transaction_read_only,
  pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') as can_read_all_stats,
  case
    when current_setting('server_version_num')::integer between 170000 and 179999
      and current_setting('transaction_read_only') = 'on'
      and current_user = 'mangorts_readonly'
      and session_user = 'mangorts_readonly'
      and pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')
    then 'PROCEED_READ_ONLY'
    else 'STOP'
  end as inspection_status;

select 1 / case
  when current_setting('server_version_num')::integer between 170000 and 179999
    and current_setting('transaction_read_only') = 'on'
    and current_user = 'mangorts_readonly'
    and session_user = 'mangorts_readonly'
    and pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')
  then 1
  else 0
end as read_only_inspection_guard;

select
  clock_timestamp() at time zone 'UTC' as captured_at_utc,
  a.pid,
  a.leader_pid,
  a.datname,
  a.usename,
  a.application_name,
  a.client_addr,
  a.backend_type,
  a.state,
  a.wait_event_type,
  a.wait_event,
  a.backend_start,
  a.xact_start,
  a.query_start,
  a.state_change,
  clock_timestamp() - a.xact_start as transaction_age,
  clock_timestamp() - a.query_start as query_age,
  a.backend_xid,
  a.backend_xmin,
  case when a.backend_xmin is null then null else age(a.backend_xmin) end as backend_xmin_age,
  a.query_id,
  a.query
from pg_stat_activity as a
order by
  (a.pid = pg_backend_pid()),
  a.xact_start nulls last,
  a.query_start nulls last,
  a.pid;

select
  clock_timestamp() at time zone 'UTC' as captured_at_utc,
  a.pid,
  a.backend_type,
  a.state,
  a.wait_event_type,
  a.wait_event,
  pg_blocking_pids(a.pid) as blocking_pids,
  a.xact_start,
  a.query_start,
  a.query
from pg_stat_activity as a
where
  cardinality(pg_blocking_pids(a.pid)) > 0
  or a.wait_event_type is not null
order by a.pid;

select
  clock_timestamp() at time zone 'UTC' as captured_at_utc,
  l.pid,
  a.backend_type,
  a.state,
  a.wait_event_type,
  a.wait_event,
  l.locktype,
  l.database,
  l.relation::regclass as relation,
  l.page,
  l.tuple,
  l.virtualxid,
  l.transactionid,
  l.classid,
  l.objid,
  l.objsubid,
  l.virtualtransaction,
  l.mode,
  l.granted,
  l.fastpath,
  l.waitstart,
  pg_blocking_pids(l.pid) as blocking_pids,
  a.query
from pg_locks as l
left join pg_stat_activity as a on a.pid = l.pid
order by l.granted, l.waitstart nulls last, l.pid, l.locktype, l.mode;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, p.*
from pg_stat_progress_vacuum as p
order by p.pid;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, p.*
from pg_stat_progress_analyze as p
order by p.pid;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, p.*
from pg_stat_progress_create_index as p
order by p.pid;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, p.*
from pg_stat_progress_cluster as p
order by p.pid;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, p.*
from pg_stat_progress_copy as p
order by p.pid;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, p.*
from pg_stat_progress_basebackup as p
order by p.pid;

select
  clock_timestamp() at time zone 'UTC' as captured_at_utc,
  s.schemaname,
  s.relname,
  s.relid,
  pg_total_relation_size(s.relid) as total_bytes,
  pg_size_pretty(pg_total_relation_size(s.relid)) as total_size,
  s.n_live_tup,
  s.n_dead_tup,
  round(100.0 * s.n_dead_tup / nullif(s.n_live_tup + s.n_dead_tup, 0), 2) as dead_tuple_percent,
  s.n_mod_since_analyze,
  s.n_ins_since_vacuum,
  s.last_vacuum,
  s.last_autovacuum,
  s.last_analyze,
  s.last_autoanalyze,
  s.vacuum_count,
  s.autovacuum_count,
  s.analyze_count,
  s.autoanalyze_count,
  age(c.relfrozenxid) as frozen_xid_age,
  mxid_age(c.relminmxid) as multixact_age
from pg_stat_user_tables as s
join pg_class as c on c.oid = s.relid
order by s.n_dead_tup desc, total_bytes desc, s.schemaname, s.relname;

select
  clock_timestamp() at time zone 'UTC' as captured_at_utc,
  d.datname,
  d.datallowconn,
  d.datistemplate,
  has_database_privilege(d.datname, 'CONNECT') as can_connect,
  case
    when has_database_privilege(d.datname, 'CONNECT')
      or pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')
    then pg_database_size(d.datname)
    else null
  end as database_bytes,
  age(d.datfrozenxid) as frozen_xid_age,
  mxid_age(d.datminmxid) as multixact_age
from pg_database as d
order by database_bytes desc nulls last, d.datname;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, s.*
from pg_stat_io as s
order by s.backend_type, s.object, s.context;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, s.*
from pg_stat_database as s
order by s.datname nulls last;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, s.*
from pg_stat_wal as s;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, s.*
from pg_stat_checkpointer as s;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, s.*
from pg_stat_bgwriter as s;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, p.*
from pg_prepared_xacts as p
order by p.prepared;

select clock_timestamp() at time zone 'UTC' as captured_at_utc, r.*
from pg_replication_slots as r
order by r.slot_name;

rollback;
```

## Proof-driven decision table

| Two-snapshot proof | Interpretation | Next step | Risk or rollback consideration |
|---|---|---|---|
| One vacuum or analyze PID is present and its progress counters increase | Maintenance is active and progressing | Leave it running and continue read-only monitoring | Cancellation discards progress and the work may restart later |
| A maintenance PID is unchanged and names exact blocking PIDs | Maintenance is blocked, not merely slow | Review the blocking transaction and request separate approval for an action against only the proved blocker | Cancelling a statement can abort its transaction; application retry can recreate the load |
| A client or copy PID has an old transaction, holds locks or `backend_xmin`, and matches the incident work | An abandoned client transaction is proved | Request separate approval to act on only that PID | Ending the session rolls back its open transaction and is not reversible; rollback work can temporarily add load |
| An advisory-lock waiter and blocker pair is present | A specific serialized application operation is blocking peers | Fix the application path first; request separate approval only if the exact live blocker must be interrupted | Cancelling waiters without fixing the caller can immediately recreate the pool exhaustion |
| No maintenance, client, blocker, or progress PID explains the CPU while CloudWatch still shows the baseline | PostgreSQL SQL views are insufficient to identify the OS process | Request separate approval to enable Enhanced Monitoring or Performance Insights before considering a restart | Monitoring changes may cost money; a restart destroys the evidence and causes downtime |
| Multiple candidates exist or counters conflict | Cause is not proved | Take another read-only snapshot and correlate exact timestamps with CloudWatch | Do not select a convenient hypothesis or perform a broad cancellation |
| CPU and connection count return to normal before inspection | The incident recovered, but cause remains unproved | Preserve the metrics and wait for the next reproducible snapshot | Recovery alone does not justify declaring autovacuum or another process the cause |

No row in this table authorizes a corrective action. Any cancellation, manual maintenance, restart, deployment, monitoring change, or database cleanup requires a separate explicit approval after the exact target and expected effect are documented.
